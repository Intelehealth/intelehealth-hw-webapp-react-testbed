#!/usr/bin/env node
/**
 * The learning loop.
 *
 * Walks recent pull requests, finds the review comments this agent posted,
 * works out how humans actually responded to each one, and rebuilds the rule
 * weights in rules.json from that evidence. Rules whose comments keep getting
 * dismissed slide into probation and then get muted; rules whose comments get
 * acted on hold their ground.
 *
 * Signals, strongest first:
 *   👎 reaction .......................... rejected  (explicit, unambiguous)
 *   👍 reaction .......................... accepted  (explicit, unambiguous)
 *   human reply matching a dismissal phrase  rejected
 *   human reply matching an agreement phrase accepted
 *   comment went outdated ................ accepted  (the flagged code changed
 *                                                     after we commented on it)
 *   PR closed, none of the above ......... ignored   (weak negative)
 *   PR still open, none of the above ..... undecided (not scored yet)
 *
 * Every scored comment is written to feedback-ledger.json, and weights are
 * recomputed from the whole ledger each run. That makes the job idempotent and
 * lets you correct a mis-scored outcome by editing the ledger by hand.
 *
 *   node tune-rules.mjs [--days 30] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getCommentReactions, graphql, rest, restAll } from './lib/github.mjs';
import { rebuildRules, evidenceCount } from './lib/scoring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(HERE, '..', 'rules.json');
const LEDGER_PATH = join(HERE, '..', 'feedback-ledger.json');
const REPORT_PATH = process.env.REPORT_PATH || 'tuning-report.md';

const REPO = process.env.REPO;
const NOW = process.env.RUN_TIMESTAMP || new Date().toISOString();
const MARKER = 'claude-review';
const MAX_LEDGER_ENTRIES = 5000;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const DAYS =
  Number(argv[argv.indexOf('--days') + 1]) ||
  Number(process.env.LOOKBACK_DAYS) ||
  30;

const DISMISSAL =
  /\b(false positive|not an issue|not a problem|wontfix|won't fix|by design|intentional|disagree|incorrect|irrelevant|out of scope|already handled|no it('?s| is) not)\b/i;
const AGREEMENT =
  /\b(good catch|nice catch|great catch|fixed|done|will fix|fixing|addressed|thanks|thank you|agreed|you'?re right|makes sense)\b/i;

function log(...a) {
  console.log(...a);
}

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return { lastRunAt: null, entries: {} };
  try {
    const l = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    return { lastRunAt: l.lastRunAt ?? null, entries: l.entries || {} };
  } catch {
    return { lastRunAt: null, entries: {} };
  }
}

/** Pull the marker fields out of a comment body we wrote. */
function parseMarker(body = '') {
  const m = new RegExp(`<!-- ${MARKER} ([^>]*?)-->`).exec(body);
  if (!m || /summary/.test(m[1])) return null;
  const out = {};
  for (const pair of m[1].trim().split(/\s+/)) {
    const [k, v] = pair.split('=');
    if (k && v) out[k] = v;
  }
  return out.rule && out.fid ? out : null;
}

/** Which review threads are resolved, keyed by comment databaseId. */
async function fetchThreadState(repo, prNumber) {
  const [owner, name] = repo.split('/');
  const query = `
    query($owner:String!, $name:String!, $number:Int!, $cursor:String) {
      repository(owner:$owner, name:$name) {
        pullRequest(number:$number) {
          reviewThreads(first:100, after:$cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              isResolved
              isOutdated
              comments(first:50) {
                nodes {
                  databaseId
                  body
                  author { login }
                  authorAssociation
                }
              }
            }
          }
        }
      }
    }`;

  const byComment = new Map();
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    let data;
    try {
      data = await graphql(query, {
        owner,
        name,
        number: Number(prNumber),
        cursor,
      });
    } catch (err) {
      log(
        `  GraphQL thread lookup failed (${err.message.slice(0, 120)}); falling back to REST signals only.`
      );
      return byComment;
    }
    const threads = data?.repository?.pullRequest?.reviewThreads;
    if (!threads) break;

    for (const t of threads.nodes) {
      const nodes = t.comments?.nodes || [];
      const root = nodes[0];
      if (!root?.databaseId) continue;
      const replies = nodes
        .slice(1)
        .filter(c => !/\[bot\]$/.test(c.author?.login || ''));
      byComment.set(root.databaseId, {
        isResolved: t.isResolved,
        isOutdated: t.isOutdated,
        replies: replies.map(r => r.body || ''),
      });
    }

    if (!threads.pageInfo.hasNextPage) break;
    cursor = threads.pageInfo.endCursor;
  }
  return byComment;
}

/**
 * Decide the outcome for one of our comments.
 * @returns {{outcome:'accepted'|'rejected'|'ignored'|'undecided', signal:string}}
 */
function scoreComment({ reactions, thread, prClosed, isOutdated }) {
  const has = c => reactions.some(r => r.content === c);
  if (has('-1')) return { outcome: 'rejected', signal: 'thumbs-down' };
  if (has('+1') || has('hooray') || has('rocket'))
    return { outcome: 'accepted', signal: 'thumbs-up' };

  for (const reply of thread?.replies || []) {
    if (DISMISSAL.test(reply))
      return { outcome: 'rejected', signal: 'reply-dismissal' };
    if (AGREEMENT.test(reply))
      return { outcome: 'accepted', signal: 'reply-agreement' };
  }

  if (isOutdated || thread?.isOutdated) {
    return { outcome: 'accepted', signal: 'code-changed-after-comment' };
  }

  if (prClosed) return { outcome: 'ignored', signal: 'pr-closed-no-response' };
  return { outcome: 'undecided', signal: 'pr-open-no-response' };
}

async function harvest(ledger) {
  const since = new Date(Date.parse(NOW) - DAYS * 86_400_000).toISOString();
  log(`Scanning pull requests in ${REPO} updated since ${since}...`);

  const prs = (
    await restAll(
      `/repos/${REPO}/pulls?state=all&sort=updated&direction=desc`,
      { max: 300 }
    )
  ).filter(pr => pr.updated_at >= since);
  log(`${prs.length} pull request(s) in window.`);

  let scanned = 0;
  let scored = 0;

  for (const pr of prs) {
    const comments = await restAll(
      `/repos/${REPO}/pulls/${pr.number}/comments`,
      { max: 200 }
    );
    const ours = comments
      .map(c => ({ comment: c, marker: parseMarker(c.body) }))
      .filter(x => x.marker);
    if (ours.length === 0) continue;

    scanned += ours.length;
    const threads = await fetchThreadState(REPO, pr.number);
    const prClosed = pr.state === 'closed';

    for (const { comment, marker } of ours) {
      const prev = ledger.entries[comment.id];
      // Settled outcomes on a closed PR never change; skip the API calls.
      if (prev && prev.final) continue;

      const reactions =
        comment.reactions && comment.reactions.total_count === 0
          ? []
          : await getCommentReactions(REPO, comment.id);

      const { outcome, signal } = scoreComment({
        reactions,
        thread: threads.get(comment.id),
        prClosed,
        // `position: null` on a review comment means the diff moved under it.
        isOutdated: comment.position === null,
      });

      if (outcome === 'undecided') continue;

      const explicit = signal === 'thumbs-up' || signal === 'thumbs-down';
      ledger.entries[comment.id] = {
        ruleId: marker.rule,
        fid: marker.fid,
        pr: pr.number,
        outcome,
        signal,
        explore: marker.explore === '1',
        at: comment.created_at,
        // An explicit reaction, or any outcome on a closed PR, is final.
        final: explicit || prClosed,
      };
      scored++;
    }
  }

  log(`Examined ${scanned} agent comment(s); ${scored} newly scored.`);
  return ledger;
}

function pruneLedger(ledger) {
  const ids = Object.keys(ledger.entries);
  if (ids.length <= MAX_LEDGER_ENTRIES) return ledger;
  const keep = ids
    .sort(
      (a, b) =>
        Date.parse(ledger.entries[b].at) - Date.parse(ledger.entries[a].at)
    )
    .slice(0, MAX_LEDGER_ENTRIES);
  const entries = {};
  for (const id of keep) entries[id] = ledger.entries[id];
  return { ...ledger, entries };
}

function writeReport(book, next, changes, ledger) {
  const outcomes = Object.values(ledger.entries);
  const tally = outcomes.reduce(
    (acc, o) => ((acc[o.outcome] = (acc[o.outcome] || 0) + 1), acc),
    {}
  );

  const lines = [
    '## Review agent tuning report',
    '',
    `Run at ${NOW} over a ${DAYS}-day window.`,
    '',
    `Ledger holds ${outcomes.length} scored comment(s): ` +
      `${tally.accepted || 0} accepted, ${tally.rejected || 0} rejected, ${tally.ignored || 0} ignored.`,
    '',
  ];

  if (changes.length === 0) {
    lines.push('No rule weights changed this run.');
  } else {
    lines.push(
      '### Rules that moved',
      '',
      '| Rule | Weight | State | Evidence |',
      '| --- | --- | --- | --- |'
    );
    for (const c of changes.sort((a, b) => a.weight[1] - b.weight[1])) {
      const arrow = c.weight[1] < c.weight[0] ? '↓' : '↑';
      const state =
        c.state[0] === c.state[1]
          ? c.state[1]
          : `**${c.state[0]} → ${c.state[1]}**`;
      lines.push(
        `| \`${c.ruleId}\` ${c.title} | ${c.weight[0]} ${arrow} ${c.weight[1]} | ${state} | ` +
          `${c.stats.accepted}✓ / ${c.stats.rejected}✗ / ${c.stats.ignored}∅ |`
      );
    }
  }

  const muted = Object.entries(next).filter(([, r]) => r.state === 'muted');
  const probation = Object.entries(next).filter(
    ([, r]) => r.state === 'probation'
  );

  if (muted.length) {
    lines.push('', '### Currently muted', '');
    for (const [id, r] of muted) {
      lines.push(
        `- \`${id}\` ${r.title} — weight ${r.weight} over ${evidenceCount(r.stats).toFixed(1)} observations`
      );
    }
    lines.push(
      '',
      `Muted rules are still re-tested on roughly ${book.defaults?.explorationPercent ?? 10}% of pull requests, ` +
        'so a rule that was fixed can earn its way back without anyone intervening.'
    );
  }
  if (probation.length) {
    lines.push('', '### On probation (blocker/major findings only)', '');
    for (const [id, r] of probation)
      lines.push(`- \`${id}\` ${r.title} — weight ${r.weight}`);
  }

  const gen = outcomes.filter(
    o => o.ruleId === 'GEN-000' && o.outcome === 'accepted'
  ).length;
  if (gen > 0) {
    lines.push(
      '',
      `### Worth a look`,
      '',
      `${gen} accepted \`GEN-000\` finding(s) in the ledger — real problems no rule covers yet. ` +
        'Read them and consider promoting the recurring ones into `review-rules.md`.'
    );
  }

  lines.push(
    '',
    '---',
    '',
    'Weights are the mean of a Beta posterior per rule, seeded at 0.7 and updated from human ' +
      'reactions, thread replies, and whether the flagged code actually changed. Observations ' +
      'decay with a 90-day half-life so the rulebook reflects how each rule behaves now.'
  );

  const report = lines.join('\n');
  writeFileSync(REPORT_PATH, report + '\n');
  return report;
}

async function main() {
  if (!REPO) throw new Error('REPO must be set (owner/name).');

  const book = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  let ledger = loadLedger();

  ledger = pruneLedger(await harvest(ledger));

  const outcomes = Object.values(ledger.entries).map(e => ({
    ruleId: e.ruleId,
    outcome: e.outcome,
    at: e.at,
  }));

  const { rules: nextRules, changes } = rebuildRules(book.rules, outcomes, NOW);
  const report = writeReport(book, nextRules, changes, ledger);

  log('');
  log(report);
  log('');

  if (DRY_RUN) {
    log('--dry-run: nothing written.');
    return;
  }

  if (changes.length === 0) {
    log('No weight changes; leaving rules.json untouched.');
    ledger.lastRunAt = NOW;
    writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, 'changed=false\n', {
        flag: 'a',
      });
    }
    return;
  }

  writeFileSync(
    RULES_PATH,
    JSON.stringify(
      {
        ...book,
        version: (book.version || 0) + 1,
        updatedAt: NOW,
        rules: nextRules,
      },
      null,
      2
    ) + '\n'
  );
  ledger.lastRunAt = NOW;
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');

  log(
    `Updated ${changes.length} rule(s); rulebook is now v${(book.version || 0) + 1}.`
  );
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=true\nchange_count=${changes.length}\n`,
      { flag: 'a' }
    );
  }
}

// Only run when invoked directly, so the scoring helpers above stay importable
// from the test file.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`tune-rules failed: ${err.stack || err.message}`);
    process.exit(1);
  });
}

export { scoreComment, parseMarker };
