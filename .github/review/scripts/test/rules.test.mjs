/**
 * The rulebook is the only input a human edits, and it is parsed out of prose.
 * These tests pin the parse so a formatting slip in review-rules.md cannot
 * silently drop a rule from every future review.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseRules, buildDigest, SEVERITY_ORDER } from '../lib/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULEBOOK = join(HERE, '..', '..', 'review-rules.md');

test('parses id, severity and title out of a rule line', () => {
  const rules = parseRules(
    '**SEC-001 · blocker · Injection via unparameterised query.** String concat.'
  );
  assert.deepEqual(rules, [
    {
      id: 'SEC-001',
      severity: 'blocker',
      title: 'Injection via unparameterised query',
    },
  ]);
});

test('ignores prose, headings and anything that is not a rule', () => {
  const md = `# Rulebook

Some preamble about how to edit this file.

## SEC — Security

**SEC-001 · blocker · Injection.** Prose here.

Not a rule: **bold text** in the middle of a paragraph.
`;
  assert.deepEqual(
    parseRules(md).map(r => r.id),
    ['SEC-001']
  );
});

test('rejects a severity the gate would not understand', () => {
  // A typo like "critical" must drop the rule loudly-by-absence rather than
  // producing a rule the gate can never rank.
  const rules = parseRules('**SEC-002 · critical · Something.** Prose.');
  assert.deepEqual(rules, []);
});

test('a duplicated id keeps only the first definition', () => {
  const rules = parseRules(
    '**SEC-001 · blocker · First.** x\n**SEC-001 · minor · Second.** y'
  );
  assert.equal(rules.length, 1);
  assert.equal(rules[0].severity, 'blocker');
});

test('accepts multi-word prefixes and multi-digit numbers', () => {
  const rules = parseRules('**ASYNC-012 · major · Race condition.** x');
  assert.equal(rules[0].id, 'ASYNC-012');
});

test('the digest is one compact line per rule', () => {
  const digest = buildDigest([
    { id: 'SEC-001', severity: 'blocker', title: 'Injection' },
    { id: 'FE-005', severity: 'minor', title: 'Index key' },
  ]);
  assert.equal(digest, 'SEC-001 [blocker] Injection\nFE-005 [minor] Index key');
});

// --- the real rulebook -----------------------------------------------------

test('the shipped rulebook parses and every rule is usable', () => {
  const rules = parseRules(readFileSync(RULEBOOK, 'utf8'));
  assert.ok(rules.length > 0, 'review-rules.md must yield rules');
  for (const r of rules) {
    assert.match(r.id, /^[A-Z][A-Z0-9]*-\d+$/, `bad id: ${r.id}`);
    assert.ok(r.severity in SEVERITY_ORDER, `bad severity on ${r.id}`);
    assert.ok(r.title.length > 0, `no title on ${r.id}`);
  }
  assert.equal(
    new Set(rules.map(r => r.id)).size,
    rules.length,
    'rule ids must be unique'
  );
});
