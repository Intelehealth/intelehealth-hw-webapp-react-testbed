#!/usr/bin/env node
/**
 * Reads the findings Claude produced, gates them against the learned rule
 * weights, and posts a single PR review.
 *
 * Why this is a separate step and not something the model does itself:
 *   - every posted comment carries a machine-readable marker, so the tuning
 *     job can attribute human feedback back to a specific rule and finding;
 *   - the comment cap, the confidence gates and the mute list are enforced
 *     deterministically rather than being suggestions in a prompt;
 *   - re-runs on `synchronize` are idempotent — the same finding is never
 *     posted twice;
 *   - a line outside the diff cannot 422 the whole review and lose the rest of
 *     the comments with it.
 *
 * Exits non-zero when the PR should not merge: either findings stand against
 * it, or the review did not actually complete. Both are deliberate — see
 * BLOCK_ON_FINDINGS and REQUIRE_COMPLETE_REVIEW below.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  commentableLines,
  createIssueComment,
  createReview,
  getPullFiles,
  getReviewComments,
  getReviews,
  getReviewThreads,
} from './lib/github.mjs';
import { findingId, gateFindings } from './lib/gate.mjs';
import { changedLines, fileLineHashes, identify } from './lib/memory.mjs';
import { parseRules, SEVERITY_ORDER } from './lib/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(HERE, '..', 'review-rules.md');
const FINDINGS_PATH = '.claude-review/findings.json';
const MARKER = 'ih-tek-review';

const REPO = process.env.REPO;
const PR_NUMBER = process.env.PR_NUMBER;
const HEAD_SHA = process.env.HEAD_SHA;
const DIFF_TRUNCATED = process.env.DIFF_TRUNCATED === 'true';
const REQUEST_CHANGES_ON_BLOCKER =
  process.env.REQUEST_CHANGES_ON_BLOCKER === '1';

/**
 * When set, unresolved findings make this script exit non-zero, which fails the
 * check and — with branch protection requiring it — blocks the merge.
 *
 * This covers findings specifically. A review that never ran is handled by
 * REQUIRE_COMPLETE_REVIEW below — the two are separate because they mean
 * different things to whoever has to clear the check.
 */
const BLOCK_ON_FINDINGS = process.env.BLOCK_ON_FINDINGS !== '0';

/** Least severe finding that still blocks. Default: anything at all. */
const BLOCK_MIN_SEVERITY = process.env.BLOCK_MIN_SEVERITY || 'nit';

/**
 * When set, a review that did not actually complete fails the check too.
 *
 * Without this, a model that returns a well-formed empty result — because it
 * gave up, or because half the diff never fit in the budget — is
 * indistinguishable from a genuinely clean review, and quietly unblocks the
 * merge. A gate that green-lights unread code is not a gate.
 *
 * The cost is that a provider outage holds merges until someone re-requests a
 * review or applies `skip-review`. That is the deliberate trade: the escape
 * hatch is explicit and visible, rather than a silent pass.
 */
const REQUIRE_COMPLETE_REVIEW = process.env.REQUIRE_COMPLETE_REVIEW !== '0';

/**
 * Convergence guard: after this many review rounds on one PR, only a `blocker`
 * may open a NEW thread. Everything else is listed advisory-only.
 *
 * Every real fix adds code, and new code is legitimately in scope, so a
 * reviewer with no round limit can always find something else — measured on
 * testbed#23, three consecutive fix rounds each produced fresh findings, and by
 * the third they were a style opinion and an outright false positive (a "race
 * condition" on a single-threaded increment). A developer who fixes everything
 * asked of them must be able to finish. Standing findings are unaffected: this
 * caps what can be newly *opened*, never what is already known to be wrong.
 */
const MAX_NEW_FINDING_ROUNDS = Number(process.env.MAX_NEW_FINDING_ROUNDS || 3);

const SEVERITY_LABEL = {
  blocker: '🔴 Blocker',
  major: '🟠 Major',
  minor: '🟡 Minor',
  nit: '⚪ Nit',
};

/** Validate a single finding. Returns an error string, or null if it is fine. */
function validateFinding(f, i) {
  if (typeof f !== 'object' || f === null)
    return `finding[${i}] is not an object`;
  if (!/^[A-Z]+-\d+$/.test(f.ruleId || ''))
    return `finding[${i}] has a bad ruleId`;
  if (typeof f.file !== 'string' || !f.file) return `finding[${i}] has no file`;
  if (!Number.isInteger(f.line) || f.line < 1)
    return `finding[${i}] has a bad line`;
  if (!(f.severity in SEVERITY_ORDER))
    return `finding[${i}] has a bad severity`;
  if (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1)
    return `finding[${i}] has a bad confidence`;
  if (typeof f.title !== 'string' || !f.title)
    return `finding[${i}] has no title`;
  if (typeof f.body !== 'string' || !f.body) return `finding[${i}] has no body`;
  return null;
}

function commentBody(f) {
  const parts = [
    `**${SEVERITY_LABEL[f.severity]} · ${f.ruleId}** — ${f.title}`,
    '',
    f.body,
  ];

  /*
   * No ```suggestion fences. The model kept writing prose advice into them,
   * and GitHub's "Apply suggestion" button commits fence content into the file
   * verbatim — one click would have replaced a line of code with a sentence.
   * Suggestions were also most of the paid output tokens.
   */

  /*
   * fid is the legacy line-keyed id, kept so older script versions on open
   * branches still recognise the comment. bid is the line-independent v2
   * identity; ah anchors the flagged line's content so "fixed" can be checked
   * against the file rather than taken on the model's word.
   */
  parts.push(
    '',
    `<!-- ${MARKER} rule=${f.ruleId} fid=${f._fid ?? findingId(f)} bid=${f._bucket}` +
      `${f._anchors.length ? ` ah=${f._anchors.join(',')}` : ''} conf=${f.confidence} sev=${f.severity} sha=${HEAD_SHA} -->`
  );
  return parts.join('\n');
}

function summaryBody({
  summary,
  kept,
  dropped,
  outOfDiff,
  outOfScope,
  deferred = [],
  invalid,
  ruleCount,
}) {
  const counts = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const f of kept) counts[f.severity]++;

  const lines = ['## IH Tek review', ''];
  lines.push(summary || '_No summary was produced._', '');

  if (kept.length === 0) {
    // A clean verdict is only honest when something was actually read. The
    // generator says so in the summary when it reviewed nothing at all.
    if (!/nothing was reviewed/i.test(summary || '')) {
      lines.push(
        'No findings above the confidence threshold. Nothing to flag.'
      );
    }
  } else {
    lines.push(
      'Findings: ' +
        Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([sev, n]) => `${SEVERITY_LABEL[sev]} ${n}`)
          .join(' · ')
    );
  }

  if (outOfDiff.length) {
    lines.push(
      '',
      '### Findings outside the diff',
      '',
      'These could not be attached to a line this PR changed:',
      ''
    );
    for (const f of outOfDiff) {
      lines.push(`- **${f.ruleId}** \`${f.file}:${f.line}\` — ${f.title}`);
    }
  }

  if (deferred.length) {
    lines.push(
      '',
      '<details><summary>' +
        deferred.length +
        ' further finding(s) — advisory only, not blocking</summary>',
      '',
      'This pull request has been through several review rounds. To let it converge,',
      'only blockers open new threads from here; these are recorded for judgement',
      'rather than raised as conversations.',
      ''
    );
    for (const f of deferred) {
      lines.push(
        `- \`${f.ruleId}\` ${f.file}:${f.line} — ${f.title}`
      );
    }
    lines.push('', '</details>');
  }

  if (outOfScope.length) {
    lines.push(
      '',
      '<details><summary>' +
        outOfScope.length +
        ' finding(s) on code unchanged since the last review — not raised</summary>',
      '',
      'These lines were not touched by the commits since the previous review, so no new',
      'comment was opened for them. They will be raised if that code is ever modified.',
      ''
    );
    for (const f of outOfScope) {
      lines.push(`- \`${f.ruleId}\` ${f.file}:${f.line} — ${f.title}`);
    }
    lines.push('', '</details>');
  }

  const noise = dropped.filter(d => !/already posted/.test(d.reason));
  if (noise.length) {
    lines.push(
      '',
      '<details><summary>' +
        noise.length +
        ' finding(s) below the posting thresholds</summary>',
      ''
    );
    for (const d of noise) {
      lines.push(
        `- \`${d.finding.ruleId}\` ${d.finding.file}:${d.finding.line} — ${d.reason}`
      );
    }
    lines.push('', '</details>');
  }

  if (invalid.length) {
    lines.push(
      '',
      `<sub>${invalid.length} malformed finding(s) discarded: ${invalid.join('; ')}</sub>`
    );
  }
  if (DIFF_TRUNCATED) {
    lines.push(
      '',
      '<sub>⚠️ The diff was truncated for size — later files were not reviewed.</sub>'
    );
  }

  lines.push(
    '',
    `<sub>${ruleCount} rules — see \`.github/review/review-rules.md\`.</sub>`,
    // sha records which commit this review read, so the next run can scope
    // new findings to code changed since — the anti-churn contract.
    `<!-- ${MARKER} summary sha=${HEAD_SHA} -->`
  );
  return lines.join('\n');
}

async function main() {
  if (!REPO || !PR_NUMBER) {
    console.error('REPO and PR_NUMBER must be set.');
    return;
  }

  if (!existsSync(FINDINGS_PATH)) {
    console.log(
      'No findings.json was produced — the review step likely failed. Nothing to post.'
    );
    failIncomplete('the review step produced no output at all');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(FINDINGS_PATH, 'utf8'));
  } catch (err) {
    console.error(`findings.json is not valid JSON: ${err.message}`);
    failIncomplete('the review step produced unreadable output');
    return;
  }

  // An explicit false means the generator knows it did not read the whole
  // diff. Absent (an older findings.json) is treated as reviewed, so this
  // cannot retroactively block PRs written before the flag existed.
  const incomplete =
    payload.reviewed === false
      ? payload.inconclusive || 'the review did not complete'
      : null;

  const rules = parseRules(readFileSync(RULES_PATH, 'utf8'));
  const ruleCount = rules.length;

  // --- validate -----------------------------------------------------------
  const raw = Array.isArray(payload.findings) ? payload.findings : [];
  const invalid = [];
  const valid = [];
  raw.forEach((f, i) => {
    const err = validateFinding(f, i);
    if (err) invalid.push(err);
    else valid.push(f);
  });
  console.log(
    `Parsed ${valid.length} valid finding(s), ${invalid.length} discarded.`
  );

  // --- memory: what did earlier runs already say? --------------------------
  //
  // Prior findings are read back from the bot's own comment markers — the PR
  // is the state store. Only comments authored by a bot count: any human can
  // quote-reply a marker verbatim, and a forged marker must not suppress a
  // finding.
  const existing = await getReviewComments(REPO, PR_NUMBER);
  const isBot = u => u?.type === 'Bot' || /\[bot\]$/.test(u?.login || '');
  const priors = [];
  for (const c of existing) {
    if (!isBot(c.user)) continue;
    const body = c.body || '';
    if (!body.includes(`<!-- ${MARKER} `)) continue;
    const rule = /rule=([A-Z]+-\d+)/.exec(body)?.[1];
    if (!rule) continue;
    priors.push({
      rule,
      file: c.path,
      bid: /\bbid=([a-z0-9]+)/.exec(body)?.[1] || null,
    });
  }
  console.log(`${priors.length} prior finding(s) recorded on this PR.`);

  // The bot's own OPEN threads, for two decisions: which stale threads a
  // still-live finding should supersede, and which threads a dead finding
  // should resolve. Failure degrades to "no thread knowledge" — everything
  // still posts and gates; nothing resolves.
  let openThreads = [];
  try {
    for (const t of await getReviewThreads(REPO, PR_NUMBER)) {
      if (t.isResolved) continue;
      const root = t.comments?.nodes?.[0];
      const login = root?.author?.login || '';
      if (!/\[bot\]$|^github-actions$/.test(login)) continue;
      const body = root.body || '';
      if (!body.includes(`<!-- ${MARKER} `)) continue;
      const rule = /rule=([A-Z]+-\d+)/.exec(body)?.[1];
      if (!rule) continue;
      openThreads.push({
        threadId: t.id,
        commentId: root.databaseId,
        isOutdated: t.isOutdated === true,
        path: t.path,
        rule,
        bid: /\bbid=([a-z0-9]+)/.exec(body)?.[1] || null,
        ahs: (/\bah=([a-z0-9,]+)/.exec(body)?.[1] || '')
          .split(',')
          .filter(Boolean),
      });
    }
  } catch (err) {
    console.error(`Could not list review threads: ${err.message}`);
    openThreads = [];
  }

  // The commit the last complete review actually read, from the summary
  // marker. Absent on a first review — then everything is in scope.
  let lastSha = null;
  let rounds = 0;
  try {
    for (const review of await getReviews(REPO, PR_NUMBER)) {
      if (!isBot(review.user)) continue;
      const m = new RegExp(`<!-- ${MARKER} summary sha=([0-9a-f]{7,40}) -->`).exec(
        review.body || ''
      );
      if (m) {
        lastSha = m[1];
        rounds++;
      }
    }
  } catch (err) {
    console.error(`Could not read prior reviews: ${err.message}`);
  }

  // --- identity + scope classification -------------------------------------
  //
  // standing:   already raised on this PR (matched by line-independent
  //             identity). Not re-posted; still counts against the merge.
  // fresh:      new finding on code changed since the last review. Posted.
  // outOfScope: new finding on code NOT touched since the last review.
  //             Dropped entirely and listed in the summary — a re-review must
  //             not re-litigate code the developer did not change, or every
  //             commit mints fresh findings and the PR never converges.
  //
  // ranges === null means "cannot tell what changed" (first review, or the
  // last-reviewed sha is unreachable after a force-push) and fails open to
  // reviewing everything — never to dropping anything.
  const priorBids = new Set(priors.map(p => p.bid).filter(Boolean));
  const priorRuleFile = new Set(priors.map(p => `${p.rule}|${p.file}`));
  const ranges =
    lastSha && HEAD_SHA ? changedLines(lastSha, HEAD_SHA) : null;
  if (lastSha) {
    console.log(
      `Last reviewed commit: ${lastSha.slice(0, 7)}. ` +
        (ranges
          ? `${ranges.size} file(s) changed since.`
          : 'git could not diff against it — everything is in scope.')
    );
  }

  const sources = new Map();
  const sourceFor = f => {
    if (!sources.has(f.file)) {
      try {
        sources.set(f.file, readFileSync(f.file, 'utf8'));
      } catch {
        sources.set(f.file, null);
      }
    }
    return sources.get(f.file);
  };

  // A standing finding normally stays quiet — but when its open thread
  // anchors code that no longer exists, the thread is a stale signpost: the
  // developer sees an outdated conversation and no comment at the actual
  // location. Re-anchor it: post the finding fresh at its current line, and
  // queue the stale thread to be resolved with a note pointing forward. One
  // open thread per live finding, always on current code.
  const currentHashes = new Map();
  const hashesOf = path => {
    if (!currentHashes.has(path)) currentHashes.set(path, fileLineHashes(path));
    return currentHashes.get(path);
  };
  const staleThreadFor = f => {
    const t =
      openThreads.find(x => x.bid && x.bid === f._bucket) ||
      openThreads.find(x => x.rule === f.ruleId && x.path === f.file);
    if (!t) return null;
    const hashes = hashesOf(t.path);
    const anchorGone = t.ahs.length
      ? !hashes || t.ahs.some(h => !hashes.has(h))
      : t.isOutdated === true;
    return anchorGone ? t : null;
  };

  const standing = [];
  const fresh = [];
  const outOfScope = [];
  const reposts = [];
  for (const f of valid) {
    const { bucket, anchors } = identify(f, sourceFor(f));
    f._bucket = bucket;
    f._anchors = anchors;

    // Migration: comments posted by older script versions carry no bid, so a
    // (rule, file) match also counts as standing. Coarse, but the coarse side
    // suppresses a duplicate comment; the fine side reposts forever.
    if (priorBids.has(bucket) || priorRuleFile.has(`${f.ruleId}|${f.file}`)) {
      standing.push(f);
      const stale = staleThreadFor(f);
      if (stale) {
        f._supersedes = stale;
        reposts.push(f);
      }
      continue;
    }
    if (ranges) {
      const changed = ranges.get(f.file);
      const end =
        Number.isInteger(f.endLine) && f.endLine > f.line ? f.endLine : f.line;
      let touched = false;
      if (changed) {
        for (let ln = f.line; ln <= end && !touched; ln++) {
          if (changed.has(ln)) touched = true;
        }
      }
      if (!touched) {
        outOfScope.push(f);
        continue;
      }
    }
    fresh.push(f);
  }
  console.log(
    `${standing.length} standing, ${fresh.length} new, ${outOfScope.length} out of scope` +
      (reposts.length ? `, ${reposts.length} re-anchored` : '') +
      '.'
  );
  for (const f of outOfScope) {
    console.log(
      `   out of scope (code unchanged since last review): ${f.ruleId} ${f.file}:${f.line}`
    );
  }

  /*
   * Convergence guard. Past the round budget, only a blocker may open a new
   * thread; the rest are reported advisory-only in the summary so nothing is
   * hidden, but the developer is no longer handed a fresh list every time they
   * fix the last one. Standing findings still count and still block.
   */
  const deferred = [];
  if (rounds >= MAX_NEW_FINDING_ROUNDS && fresh.length) {
    for (let i = fresh.length - 1; i >= 0; i--) {
      if (fresh[i].severity !== 'blocker') deferred.push(...fresh.splice(i, 1));
    }
    if (deferred.length) {
      console.log(
        `Round ${rounds + 1} of review: deferring ${deferred.length} non-blocker ` +
          `finding(s) to advisory so this PR can converge.`
      );
    }
  }

  // --- gate ----------------------------------------------------------------
  const { kept, dropped } = gateFindings(fresh, {
    alreadyPosted: new Set(),
  });
  console.log(
    `${kept.length} finding(s) passed the gate, ${dropped.length} dropped.`
  );

  // What is wrong with this PR *right now*: standing findings plus new ones.
  // Out-of-scope findings are excluded — blocking a merge on a finding the
  // developer was never shown is a trap, not a gate. maxComments is lifted
  // here: the posting cap must never truncate the merge decision.
  const { kept: unresolved } = gateFindings([...standing, ...fresh], {
    alreadyPosted: new Set(),
    maxComments: Infinity,
  });
  const blocking = unresolved.filter(
    f => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[BLOCK_MIN_SEVERITY]
  );

  // --- map to lines GitHub will accept ------------------------------------
  const files = await getPullFiles(REPO, PR_NUMBER);
  const lineIndex = new Map();
  for (const file of files)
    lineIndex.set(file.filename, commentableLines(file.patch));

  // Re-anchored findings post alongside the genuinely new ones. A repost that
  // cannot land inline (its current line is outside the diff) is skipped and
  // its stale thread left open — a stale anchor beats no anchor at all.
  const superseded = [];
  const inline = [];
  const outOfDiff = [];
  for (const f of reposts) {
    const allowed = lineIndex.get(f.file);
    if (!allowed || !allowed.has(f.line)) continue;
    inline.push({
      path: f.file,
      line: f.line,
      side: 'RIGHT',
      body: commentBody(f),
    });
    superseded.push({
      threadId: f._supersedes.threadId,
      commentId: f._supersedes.commentId,
      rule: f.ruleId,
      path: f._supersedes.path,
      reason: 'superseded',
    });
  }
  for (const f of kept) {
    const allowed = lineIndex.get(f.file);
    if (!allowed || !allowed.has(f.line)) {
      outOfDiff.push(f);
      continue;
    }
    const comment = {
      path: f.file,
      line: f.line,
      side: 'RIGHT',
      body: commentBody(f),
    };
    // Multi-line comments need start_line to also be in the diff.
    if (
      Number.isInteger(f.endLine) &&
      f.endLine > f.line &&
      allowed.has(f.endLine)
    ) {
      comment.start_line = f.line;
      comment.start_side = 'RIGHT';
      comment.line = f.endLine;
    }
    inline.push(comment);
  }
  if (outOfDiff.length) {
    console.log(
      `${outOfDiff.length} finding(s) fell outside the diff; moved into the summary.`
    );
  }

  const hasBlocker = kept.some(f => f.severity === 'blocker');
  const body = summaryBody({
    summary: payload.summary,
    kept,
    dropped,
    outOfDiff,
    outOfScope,
    deferred,
    invalid,
    ruleCount,
  });

  // Nothing new to say and something already said: stay quiet. Fixed threads
  // still resolve — the plan carries no superseded entries here because there
  // was nothing to repost.
  if (inline.length === 0 && outOfDiff.length === 0 && priors.length > 0) {
    console.log('No new findings since the last run. Not posting.');
    writeResolvePlan({ incomplete, standing, fresh, openThreads, superseded: [] });
    applyMergeGate(blocking, incomplete);
    return;
  }

  writeFileSync(
    '.claude-review/posted.json',
    JSON.stringify({ inline, outOfDiff, dropped }, null, 2)
  );

  let postedInline = false;
  try {
    await createReview(REPO, PR_NUMBER, {
      commitId: HEAD_SHA,
      body,
      event:
        hasBlocker && REQUEST_CHANGES_ON_BLOCKER
          ? 'REQUEST_CHANGES'
          : 'COMMENT',
      comments: inline,
    });
    postedInline = true;
    console.log(`Posted a review with ${inline.length} inline comment(s).`);
  } catch (err) {
    // The review API is all-or-nothing. Rather than lose the whole review to
    // one bad line reference, fall back to a single summary comment.
    console.error(
      `Inline review failed, falling back to a summary comment: ${err.message}`
    );
    const fallback = [
      body,
      '',
      '### Findings',
      '',
      ...kept.map(
        f =>
          `- **${SEVERITY_LABEL[f.severity]} · ${f.ruleId}** \`${f.file}:${f.line}\` — ${f.title}\n\n  ${f.body.replace(/\n/g, '\n  ')}`
      ),
    ].join('\n');
    try {
      await createIssueComment(REPO, PR_NUMBER, fallback);
      console.log('Posted the fallback summary comment.');
    } catch (err2) {
      console.error(`Fallback comment also failed: ${err2.message}`);
    }
  }

  // A stale thread is resolved only once its replacement comment is live —
  // if the inline post failed, the old thread stays as the finding's anchor.
  writeResolvePlan({
    incomplete,
    standing,
    fresh,
    openThreads,
    superseded: postedInline ? superseded : [],
  });

  applyMergeGate(blocking, incomplete);
}

/**
 * Decide which of the bot's own threads are provably fixed, and write the
 * list for the resolve job. This script never resolves anything itself — the
 * mutation needs a stronger token, which lives in a separate job with no
 * checkout, so model-adjacent code never runs next to it.
 *
 * A thread qualifies only when ALL of the following hold, each mechanical:
 *   - the run was complete (an unread diff proves nothing about any finding);
 *   - the bot authored the thread's root comment, and no human has resolved
 *     or touched its resolution state (isResolved === false);
 *   - the finding did not reappear in this run under its line-independent
 *     identity, nor under its (rule, file) pair;
 *   - the exact line content the comment anchored to is gone from the file
 *     on disk. Model silence alone is never treated as proof of a fix.
 *
 * Anything ambiguous stays open. An open thread on fixed code is one click of
 * noise; a resolved thread on an unfixed defect is a buried bug.
 */
function writeResolvePlan({ incomplete, standing, fresh, openThreads, superseded }) {
  const plan = [];
  if (!incomplete) {
    const live = [...standing, ...fresh];
    const liveBids = new Set(live.map(f => f._bucket).filter(Boolean));
    const liveRuleFile = new Set(live.map(f => `${f.ruleId}|${f.file}`));
    const hashesByFile = new Map();
    const hashesFor = path => {
      if (!hashesByFile.has(path)) hashesByFile.set(path, fileLineHashes(path));
      return hashesByFile.get(path);
    };

    for (const t of openThreads) {
      // A live finding keeps its thread open — unless the thread was just
      // superseded by a re-anchored comment at the code's current location.
      if (t.bid && liveBids.has(t.bid)) continue;
      if (liveRuleFile.has(`${t.rule}|${t.path}`)) continue;
      // The recorded region must have actually changed in the file — every
      // anchored line still present means nothing was touched, and model
      // silence alone must not resolve anything.
      if (t.ahs.length) {
        const hashes = hashesFor(t.path);
        if (hashes && t.ahs.every(h => hashes.has(h))) continue;
      }

      plan.push({
        threadId: t.threadId,
        commentId: t.commentId,
        rule: t.rule,
        path: t.path,
        reason: 'fixed',
      });
    }
    plan.push(...superseded);
  }
  writeFileSync('.claude-review/resolve-plan.json', JSON.stringify(plan, null, 2));
  console.log(
    `${plan.length} thread(s) queued for resolution` +
      (superseded.length ? ` (${superseded.length} superseded by a re-anchor)` : '') +
      '.'
  );
}

/**
 * Fail the check when the PR still has findings against it.
 *
 * Sets exitCode rather than calling process.exit so the review that was just
 * posted is not lost to an early teardown.
 */
function failIncomplete(reason) {
  if (!REQUIRE_COMPLETE_REVIEW) {
    console.log(
      `Review incomplete (${reason}), but REQUIRE_COMPLETE_REVIEW is off.`
    );
    return;
  }
  console.error(`\nThe review did not complete: ${reason}.`);
  console.error(
    'An absence of findings therefore does not mean this code is clean — it ' +
      'means it was not read. Re-request a review with the `review-again` ' +
      'label, or add `skip-review` to merge without one.'
  );
  process.exitCode = 1;
}

function applyMergeGate(blocking, incomplete) {
  if (incomplete) {
    // Report the findings we did get, then fail for the ones we may not have.
    if (blocking.length) {
      console.error(
        `${blocking.length} finding(s) posted before the review ran out.`
      );
    }
    failIncomplete(incomplete);
    return;
  }
  if (!blocking.length) {
    console.log('No unresolved findings. Merge gate is clear.');
    return;
  }
  const counts = {};
  for (const f of blocking) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const breakdown = Object.entries(counts)
    .map(([sev, n]) => `${n} ${sev}`)
    .join(', ');

  if (!BLOCK_ON_FINDINGS) {
    console.log(`${blocking.length} unresolved finding(s) (${breakdown}).`);
    console.log('BLOCK_ON_FINDINGS is off, so this does not fail the check.');
    return;
  }

  console.error(
    `\n${blocking.length} unresolved finding(s) on this pull request: ${breakdown}.`
  );
  console.error(
    'Address them, then re-request a review with the `review-again` label ' +
      'or a `/review` comment. To merge anyway, add the `skip-review` label.'
  );
  process.exitCode = 1;
}

main().catch(err => {
  // An API failure before the gate ran means we do not know whether this PR is
  // clean. Exiting zero here would publish a green check on an unread review,
  // so failIncomplete sets the exit code (when REQUIRE_COMPLETE_REVIEW is on)
  // and returns — it never exits, the log below always runs.
  console.error(`post-review failed: ${err.stack || err.message}`);
  failIncomplete(`post-review failed before the gate ran (${err.message})`);
});
