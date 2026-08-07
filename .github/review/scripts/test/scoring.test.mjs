import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  computeWeight,
  computeState,
  evidenceCount,
  gateFindings,
  findingId,
  isExplorationSlot,
  decayFactor,
  rebuildRules,
  SEVERITY_GATES,
} from '../lib/scoring.mjs';
import { commentableLines } from '../lib/github.mjs';
import { parseMarker, scoreComment } from '../tune-rules.mjs';
import { parseRulebook } from '../sync-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = join(HERE, '..', '..');

const NOW = '2026-08-07T00:00:00Z';
const rule = (over = {}) => ({
  title: 't',
  severity: 'major',
  weight: 0.7,
  state: 'active',
  stats: { accepted: 0, rejected: 0, ignored: 0 },
  history: [],
  ...over,
});
const finding = (over = {}) => ({
  ruleId: 'SEC-001',
  file: 'src/a.ts',
  line: 10,
  severity: 'major',
  confidence: 0.8,
  title: 'x',
  body: 'y',
  ...over,
});

// --- weights ---------------------------------------------------------------

test('a fresh rule sits exactly at the 0.7 prior', () => {
  assert.equal(computeWeight({ accepted: 0, rejected: 0, ignored: 0 }), 0.7);
});

test('acceptances raise the weight, rejections lower it', () => {
  const up = computeWeight({ accepted: 10, rejected: 0, ignored: 0 });
  const down = computeWeight({ accepted: 0, rejected: 10, ignored: 0 });
  assert.ok(up > 0.7, `expected >0.7, got ${up}`);
  assert.ok(down < 0.3, `expected <0.3, got ${down}`);
  assert.ok(up <= 1 && down >= 0);
});

test('an ignored comment counts less than an outright rejection', () => {
  const ignored = computeWeight({ accepted: 0, rejected: 0, ignored: 10 });
  const rejected = computeWeight({ accepted: 0, rejected: 10, ignored: 0 });
  assert.ok(ignored > rejected);
});

test('one bad reaction cannot mute a rule', () => {
  const stats = { accepted: 0, rejected: 1, ignored: 0 };
  assert.equal(
    computeState(computeWeight(stats), evidenceCount(stats)),
    'active'
  );
});

test('a consistently dismissed rule is muted once evidence accumulates', () => {
  const stats = { accepted: 0, rejected: 12, ignored: 0 };
  assert.equal(
    computeState(computeWeight(stats), evidenceCount(stats)),
    'muted'
  );
});

test('a mixed rule lands on probation rather than muted', () => {
  const stats = { accepted: 2, rejected: 6, ignored: 0 };
  const w = computeWeight(stats);
  assert.ok(w >= 0.3 && w < 0.5, `weight ${w} should be in the probation band`);
  assert.equal(computeState(w, evidenceCount(stats)), 'probation');
});

// --- decay -----------------------------------------------------------------

test('feedback decays with a 90-day half-life', () => {
  assert.equal(decayFactor(NOW, NOW), 1);
  const ninetyDaysAgo = new Date(
    Date.parse(NOW) - 90 * 86_400_000
  ).toISOString();
  assert.ok(Math.abs(decayFactor(ninetyDaysAgo, NOW) - 0.5) < 0.01);
  const yearAgo = new Date(Date.parse(NOW) - 365 * 86_400_000).toISOString();
  assert.ok(decayFactor(yearAgo, NOW) < 0.1);
});

test('a rule recovers as old rejections age out', () => {
  const old = new Date(Date.parse(NOW) - 400 * 86_400_000).toISOString();
  const rules = { 'SEC-001': rule({ weight: 0.2, state: 'muted' }) };
  const outcomes = Array.from({ length: 12 }, () => ({
    ruleId: 'SEC-001',
    outcome: 'rejected',
    at: old,
  }));
  const { rules: next } = rebuildRules(rules, outcomes, NOW);
  assert.ok(
    next['SEC-001'].weight > 0.5,
    'stale rejections should stop dominating'
  );
  assert.equal(next['SEC-001'].state, 'active');
});

test('rebuild is idempotent and recomputes from the ledger, not from prior stats', () => {
  const rules = {
    'SEC-001': rule({ stats: { accepted: 99, rejected: 0, ignored: 0 } }),
  };
  const outcomes = [{ ruleId: 'SEC-001', outcome: 'rejected', at: NOW }];
  const a = rebuildRules(rules, outcomes, NOW);
  const b = rebuildRules(a.rules, outcomes, NOW);
  assert.equal(
    a.rules['SEC-001'].stats.accepted,
    0,
    'stale stats must be discarded'
  );
  assert.deepEqual(a.rules['SEC-001'].stats, b.rules['SEC-001'].stats);
  assert.equal(a.rules['SEC-001'].weight, b.rules['SEC-001'].weight);
  assert.equal(b.changes.length, 0, 'a second identical run changes nothing');
});

test('rebuild records what changed', () => {
  const rules = { 'SEC-001': rule() };
  const outcomes = Array.from({ length: 12 }, () => ({
    ruleId: 'SEC-001',
    outcome: 'rejected',
    at: NOW,
  }));
  const { changes } = rebuildRules(rules, outcomes, NOW);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].state, ['active', 'muted']);
});

// --- gating ----------------------------------------------------------------

test('a healthy rule with a confident finding gets posted', () => {
  const { kept } = gateFindings(
    [finding()],
    { 'SEC-001': rule() },
    { prNumber: 1 }
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0]._score, 0.56);
});

test('a low-weight rule is filtered out even at high confidence', () => {
  const { kept, dropped } = gateFindings(
    [finding({ confidence: 0.9 })],
    { 'SEC-001': rule({ weight: 0.35 }) },
    { prNumber: 1 }
  );
  assert.equal(kept.length, 0);
  assert.match(dropped[0].reason, /below major gate/);
});

test('unknown rule ids are dropped, not posted', () => {
  const { kept, dropped } = gateFindings(
    [finding({ ruleId: 'NOPE-999' })],
    {},
    { prNumber: 1 }
  );
  assert.equal(kept.length, 0);
  assert.match(dropped[0].reason, /unknown rule/);
});

test('muted rules stay silent on ordinary pull requests', () => {
  const rules = { 'SEC-001': rule({ state: 'muted', weight: 0.2 }) };
  let silent = 0;
  for (let pr = 1; pr <= 100; pr++) {
    const { kept } = gateFindings([finding()], rules, {
      prNumber: pr,
      explorationPercent: 10,
    });
    if (kept.length === 0) silent++;
  }
  assert.ok(
    silent >= 85 && silent < 100,
    `expected ~90 silent PRs, got ${silent}`
  );
});

test('an exploration slot actually posts, bypassing the score gate', () => {
  // Regression guard: a muted rule's weight can never clear the gate, so if
  // exploration did not bypass it, muted rules could never recover and the
  // whole mechanism would be dead code.
  const rules = { 'SEC-001': rule({ state: 'muted', weight: 0.15 }) };
  const explored = [];
  for (let pr = 1; pr <= 200; pr++) {
    const { kept } = gateFindings([finding()], rules, {
      prNumber: pr,
      explorationPercent: 10,
    });
    if (kept.length) explored.push({ pr, kept });
  }
  assert.ok(explored.length > 0, 'muted rules must occasionally be re-tested');
  assert.equal(
    explored[0].kept[0]._exploring,
    true,
    'explored findings are flagged as such'
  );
});

test('exploration is deterministic, so re-runs on a PR agree', () => {
  const a = isExplorationSlot('SEC-001', 42, 10);
  for (let i = 0; i < 20; i++)
    assert.equal(isExplorationSlot('SEC-001', 42, 10), a);
  assert.equal(
    isExplorationSlot('SEC-001', 42, 0),
    false,
    '0% disables exploration'
  );
});

test('probation suppresses minor and nit findings but keeps blockers', () => {
  const rules = { 'SEC-001': rule({ state: 'probation', weight: 0.45 }) };
  const opts = { prNumber: 1 };
  assert.equal(
    gateFindings([finding({ severity: 'minor', confidence: 1 })], rules, opts)
      .kept.length,
    0
  );
  assert.equal(
    gateFindings([finding({ severity: 'blocker', confidence: 1 })], rules, opts)
      .kept.length,
    1
  );
});

test('findings already posted are not posted again', () => {
  const f = finding();
  const { kept, dropped } = gateFindings(
    [f],
    { 'SEC-001': rule() },
    {
      prNumber: 1,
      alreadyPosted: new Set([findingId(f)]),
    }
  );
  assert.equal(kept.length, 0);
  assert.match(dropped[0].reason, /already posted/);
});

test('finding ids are stable across reruns but distinguish real differences', () => {
  assert.equal(
    findingId(finding()),
    findingId(finding({ body: 'reworded', confidence: 0.99 }))
  );
  assert.notEqual(findingId(finding()), findingId(finding({ line: 11 })));
  assert.notEqual(
    findingId(finding()),
    findingId(finding({ file: 'src/b.ts' }))
  );
});

test('the comment cap keeps the most severe findings', () => {
  const many = [
    ...Array.from({ length: 8 }, (_, i) =>
      finding({ severity: 'nit', line: 100 + i, confidence: 1 })
    ),
    finding({ severity: 'blocker', line: 5, confidence: 0.9 }),
  ];
  const { kept } = gateFindings(
    many,
    { 'SEC-001': rule() },
    { prNumber: 1, maxComments: 3 }
  );
  assert.equal(kept.length, 3);
  assert.equal(kept[0].severity, 'blocker');
});

test('gates are ordered so nits need more confidence than blockers', () => {
  assert.ok(SEVERITY_GATES.blocker < SEVERITY_GATES.major);
  assert.ok(SEVERITY_GATES.major < SEVERITY_GATES.minor);
  assert.ok(SEVERITY_GATES.minor < SEVERITY_GATES.nit);
});

// --- diff parsing ----------------------------------------------------------

const PATCH = [
  '@@ -1,4 +1,6 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' const d = 5;',
  ' const e = 6;',
  '@@ -20,2 +22,3 @@',
  ' let x;',
  '+let y;',
  ' let z;',
].join('\n');

test('commentable lines follow the new-file numbering', () => {
  const lines = commentableLines(PATCH);
  assert.deepEqual(
    [...lines].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 22, 23, 24]
  );
});

test('lines outside any hunk are not commentable', () => {
  const lines = commentableLines(PATCH);
  assert.ok(!lines.has(10));
  assert.ok(!lines.has(100));
});

test('an empty or missing patch yields no commentable lines', () => {
  assert.equal(commentableLines('').size, 0);
  assert.equal(commentableLines(undefined).size, 0);
});

// --- marker round-trip -----------------------------------------------------

test('the marker written into a comment can be parsed back out', () => {
  const body =
    'text\n<!-- ih-tek-review rule=SEC-001 fid=abc123 conf=0.8 score=0.56 sev=major -->';
  assert.deepEqual(parseMarker(body), {
    rule: 'SEC-001',
    fid: 'abc123',
    conf: '0.8',
    score: '0.56',
    sev: 'major',
  });
});

test('summary markers and foreign comments are ignored', () => {
  assert.equal(parseMarker('<!-- ih-tek-review summary -->'), null);
  assert.equal(parseMarker('just a human comment'), null);
  assert.equal(parseMarker(''), null);
});

// --- outcome scoring -------------------------------------------------------

const react = c => [{ content: c }];

test('an explicit reaction beats every other signal', () => {
  assert.equal(
    scoreComment({
      reactions: react('-1'),
      thread: { isOutdated: true },
      prClosed: true,
    }).outcome,
    'rejected'
  );
  assert.equal(
    scoreComment({ reactions: react('+1'), prClosed: false }).outcome,
    'accepted'
  );
});

test('a dismissive reply counts against the rule', () => {
  const r = scoreComment({
    reactions: [],
    thread: { replies: ['This is a false positive.'] },
    prClosed: true,
  });
  assert.equal(r.outcome, 'rejected');
  assert.equal(r.signal, 'reply-dismissal');
});

test('an agreeing reply counts for the rule', () => {
  const r = scoreComment({
    reactions: [],
    thread: { replies: ['Good catch, fixed.'] },
    prClosed: true,
  });
  assert.equal(r.outcome, 'accepted');
});

test('code changing under the comment counts as agreement', () => {
  const r = scoreComment({
    reactions: [],
    thread: { replies: [] },
    prClosed: false,
    isOutdated: true,
  });
  assert.equal(r.outcome, 'accepted');
  assert.equal(r.signal, 'code-changed-after-comment');
});

test('silence scores only once the PR is closed', () => {
  assert.equal(
    scoreComment({ reactions: [], thread: {}, prClosed: false }).outcome,
    'undecided'
  );
  assert.equal(
    scoreComment({ reactions: [], thread: {}, prClosed: true }).outcome,
    'ignored'
  );
});

// --- rulebook integrity ----------------------------------------------------

test('review-rules.md and rules.json describe the same rules', () => {
  const md = parseRulebook(
    readFileSync(join(REVIEW_DIR, 'review-rules.md'), 'utf8')
  );
  const book = JSON.parse(readFileSync(join(REVIEW_DIR, 'rules.json'), 'utf8'));
  assert.ok(Object.keys(md).length > 0, 'no rules parsed from the markdown');
  assert.deepEqual(Object.keys(md).sort(), Object.keys(book.rules).sort());
  for (const [id, meta] of Object.entries(md)) {
    assert.equal(
      book.rules[id].severity,
      meta.severity,
      `${id} severity mismatch`
    );
    assert.equal(book.rules[id].title, meta.title, `${id} title mismatch`);
  }
});

test('every rule carries a severity the gates understand', () => {
  const book = JSON.parse(readFileSync(join(REVIEW_DIR, 'rules.json'), 'utf8'));
  for (const [id, r] of Object.entries(book.rules)) {
    assert.ok(
      SEVERITY_GATES[r.severity],
      `${id} has an unknown severity: ${r.severity}`
    );
    assert.ok(r.weight >= 0 && r.weight <= 1, `${id} weight out of range`);
  }
});
