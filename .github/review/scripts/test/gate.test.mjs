/**
 * The gate is what stops the reviewer flooding a PR. It is small on purpose —
 * confidence floor, severity floor, dedupe, cap — and these tests are what keep
 * it that way.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { gateFindings, findingId, MIN_CONFIDENCE } from '../lib/gate.mjs';

const f = (over = {}) => ({
  ruleId: 'SEC-001',
  file: 'src/a.ts',
  line: 10,
  severity: 'major',
  confidence: 0.9,
  title: 't',
  body: 'b',
  ...over,
});

test('a confident finding is kept', () => {
  const { kept } = gateFindings([f()]);
  assert.equal(kept.length, 1);
  assert.ok(kept[0]._fid, 'kept findings carry a stable id');
});

test('anything below the confidence floor is dropped', () => {
  const { kept, dropped } = gateFindings([
    f({ confidence: MIN_CONFIDENCE - 0.01 }),
  ]);
  assert.equal(kept.length, 0);
  assert.match(dropped[0].reason, /confidence/);
});

test('the severity floor drops what sits below it', () => {
  const { kept, dropped } = gateFindings([f({ severity: 'nit' })], {
    minSeverity: 'major',
  });
  assert.equal(kept.length, 0);
  assert.match(dropped[0].reason, /below major/);
  const both = gateFindings(
    [f({ severity: 'blocker' }), f({ severity: 'nit' })],
    {
      minSeverity: 'major',
    }
  );
  assert.equal(both.kept.length, 1);
  assert.equal(both.kept[0].severity, 'blocker');
});

test('a finding already on the PR is not posted twice', () => {
  const finding = f();
  const { kept, dropped } = gateFindings([finding], {
    alreadyPosted: new Set([findingId(finding)]),
  });
  assert.equal(kept.length, 0);
  assert.match(dropped[0].reason, /already posted/);
});

test('the comment cap keeps the most severe findings', () => {
  const many = [
    f({ severity: 'nit', line: 1 }),
    f({ severity: 'blocker', line: 2 }),
    f({ severity: 'minor', line: 3 }),
  ];
  const { kept } = gateFindings(many, { maxComments: 1 });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].severity, 'blocker');
});

test('at equal severity the more confident finding wins the cap', () => {
  const { kept } = gateFindings(
    [f({ line: 1, confidence: 0.7 }), f({ line: 2, confidence: 0.95 })],
    { maxComments: 1 }
  );
  assert.equal(kept[0].line, 2);
});

test('finding ids are stable across runs but distinguish real differences', () => {
  assert.equal(findingId(f()), findingId(f()));
  assert.equal(
    findingId(f()),
    findingId(f({ confidence: 0.61, body: 'reworded' })),
    'wording and confidence must not change identity'
  );
  assert.notEqual(findingId(f()), findingId(f({ line: 11 })));
  assert.notEqual(findingId(f()), findingId(f({ ruleId: 'SEC-002' })));
});
