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
} from './lib/github.mjs';
import { gateFindings } from './lib/gate.mjs';
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

  parts.push(
    '',
    `<!-- ${MARKER} rule=${f.ruleId} fid=${f._fid} conf=${f.confidence} sev=${f.severity} -->`
  );
  return parts.join('\n');
}

function summaryBody({
  summary,
  kept,
  dropped,
  outOfDiff,
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

  lines.push(
    '',
    `<sub>${ruleCount} rules — see \`.github/review/review-rules.md\`.</sub>`,
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
  const { kept, dropped } = gateFindings(valid, {
    alreadyPosted,
  });
  console.log(
    `${kept.length} finding(s) passed the gate, ${dropped.length} dropped.`
  );

  // What is wrong with this PR *right now*, independent of what earlier runs
  // already said. `kept` excludes anything already posted, so a re-run where
  // every problem still stands would otherwise look clean and let the merge
  // through. The merge decision has to be about the code, not about which
  // comments happen to be new.
  const { kept: unresolved } = gateFindings(valid, {
    alreadyPosted: new Set(),
  });
  const blocking = unresolved.filter(
    f => SEVERITY_ORDER[f.severity] <= SEVERITY_ORDER[BLOCK_MIN_SEVERITY]
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
    invalid,
    ruleCount,
  });

  // Nothing new to say and nothing already said: stay quiet.
  if (inline.length === 0 && outOfDiff.length === 0 && alreadyPosted.size > 0) {
    console.log('No new findings since the last run. Not posting.');
    applyMergeGate(blocking, incomplete);
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

  applyMergeGate(blocking, incomplete);
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
