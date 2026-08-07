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
 * Never exits non-zero for review content. A broken reviewer must not break
 * anyone's CI.
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
} from './lib/github.mjs';
import { gateFindings, SEVERITY_ORDER } from './lib/scoring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(HERE, '..', 'rules.json');
const FINDINGS_PATH = '.claude-review/findings.json';
const MARKER = 'ih-tek-review';

const REPO = process.env.REPO;
const PR_NUMBER = process.env.PR_NUMBER;
const HEAD_SHA = process.env.HEAD_SHA;
const DIFF_TRUNCATED = process.env.DIFF_TRUNCATED === 'true';
const REQUEST_CHANGES_ON_BLOCKER =
  process.env.REQUEST_CHANGES_ON_BLOCKER === '1';

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

function commentBody(f, rule) {
  const parts = [
    `**${SEVERITY_LABEL[f.severity]} · ${f.ruleId}** — ${f.title}`,
    '',
    f.body,
  ];

  if (f.suggestion) {
    parts.push(
      '',
      '```suggestion',
      f.suggestion.replace(/^```\w*\n?|```$/g, ''),
      '```'
    );
  }

  const notes = [];
  if (f._exploring) {
    notes.push(
      'This rule is currently muted because past comments from it were dismissed. ' +
        'It is being re-tested on this PR — your reaction decides whether it comes back.'
    );
  }
  if (rule.state === 'probation') {
    notes.push(
      'This rule is on probation; feedback on it is weighted heavily.'
    );
  }
  if (notes.length) parts.push('', `> ${notes.join(' ')}`);

  parts.push(
    '',
    '<sub>👍 if this was useful, 👎 if it was not — the reviewer tunes itself from these reactions.</sub>',
    `<!-- ${MARKER} rule=${f.ruleId} fid=${f._fid} conf=${f.confidence} score=${f._score} sev=${f.severity}${f._exploring ? ' explore=1' : ''} -->`
  );
  return parts.join('\n');
}

function summaryBody({ summary, kept, dropped, outOfDiff, invalid, rules }) {
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

  const noise = dropped.filter(d => !/already posted/.test(d.reason));
  if (noise.length) {
    lines.push(
      '',
      '<details><summary>' +
        noise.length +
        ' finding(s) suppressed by the feedback loop</summary>',
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

  const muted = Object.entries(rules).filter(
    ([, r]) => r.state === 'muted'
  ).length;
  lines.push(
    '',
    `<sub>Rulebook v${rules._version ?? '?'} · ${Object.keys(rules).length - 1} rules · ${muted} muted. ` +
      'See `.github/review/review-rules.md`. React 👍/👎 on any comment to tune the reviewer.</sub>',
    `<!-- ${MARKER} summary -->`
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
    return;
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(FINDINGS_PATH, 'utf8'));
  } catch (err) {
    console.error(`findings.json is not valid JSON: ${err.message}`);
    return;
  }

  const book = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  const rules = book.rules;

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

  // --- idempotency: what did earlier runs already say? --------------------
  const existing = await getReviewComments(REPO, PR_NUMBER);
  const alreadyPosted = new Set();
  for (const c of existing) {
    const m = new RegExp(`<!-- ${MARKER} .*?fid=([a-z0-9]+)`).exec(
      c.body || ''
    );
    if (m) alreadyPosted.add(m[1]);
  }
  console.log(`${alreadyPosted.size} finding(s) already posted on this PR.`);

  // --- gate against learned weights ---------------------------------------
  const { kept, dropped } = gateFindings(valid, rules, {
    prNumber: PR_NUMBER,
    maxComments: book.defaults?.maxCommentsPerPR ?? 12,
    explorationPercent: book.defaults?.explorationPercent ?? 10,
    alreadyPosted,
  });
  console.log(
    `${kept.length} finding(s) passed the gate, ${dropped.length} dropped.`
  );

  // --- map to lines GitHub will accept ------------------------------------
  const files = await getPullFiles(REPO, PR_NUMBER);
  const lineIndex = new Map();
  for (const file of files)
    lineIndex.set(file.filename, commentableLines(file.patch));

  const inline = [];
  const outOfDiff = [];
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
      body: commentBody(f, rules[f.ruleId]),
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
    invalid,
    rules: { ...rules, _version: book.version },
  });

  // Nothing new to say and nothing already said: stay quiet.
  if (inline.length === 0 && outOfDiff.length === 0 && alreadyPosted.size > 0) {
    console.log('No new findings since the last run. Not posting.');
    return;
  }

  writeFileSync(
    '.claude-review/posted.json',
    JSON.stringify({ inline, outOfDiff, dropped }, null, 2)
  );

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
}

main().catch(err => {
  // Log loudly, exit clean. The reviewer is advisory; it must never be the
  // reason a pull request cannot merge.
  console.error(`post-review failed: ${err.stack || err.message}`);
});
