#!/usr/bin/env node
/**
 * Keeps review-rules.md (the human rulebook) and rules.json (the learned state)
 * in agreement.
 *
 *   node sync-rules.mjs --check   exit 1 if they disagree  (runs in CI)
 *   node sync-rules.mjs --write   add new rules, retire removed ones
 *
 * Learned stats are never discarded by --write: a rule removed from the
 * markdown moves into the `retired` block with its history intact, and comes
 * back with that history if it is ever re-added.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeState,
  computeWeight,
  evidenceCount,
  PRIOR_ALPHA,
  PRIOR_BETA,
  round3,
} from './lib/scoring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MD_PATH = join(HERE, '..', 'review-rules.md');
const JSON_PATH = join(HERE, '..', 'rules.json');

const SEED_WEIGHT = round3(PRIOR_ALPHA / (PRIOR_ALPHA + PRIOR_BETA)); // 0.7

/** Extract `**ID · severity · Title.**` headings from the rulebook. */
export function parseRulebook(markdown) {
  const re =
    /^\*\*([A-Z]+-\d+)\s*[·.]\s*(blocker|major|minor|nit)\s*[·.]\s*([^*]+?)\*\*/gm;
  const rules = {};
  const seen = new Set();
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const [, id, severity, title] = m;
    if (seen.has(id))
      throw new Error(`Duplicate rule id in review-rules.md: ${id}`);
    seen.add(id);
    rules[id] = { title: title.trim().replace(/\.$/, ''), severity };
  }
  return rules;
}

function emptyStats() {
  return { accepted: 0, rejected: 0, ignored: 0 };
}

function load() {
  const md = parseRulebook(readFileSync(MD_PATH, 'utf8'));
  let book;
  try {
    book = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  } catch {
    book = null;
  }
  if (!book) {
    book = {
      version: 0,
      updatedAt: null,
      defaults: { maxCommentsPerPR: 12, explorationPercent: 10 },
      rules: {},
      retired: {},
    };
  }
  book.retired ||= {};
  return { md, book };
}

function reconcile(md, book) {
  const problems = [];
  const rules = {};

  for (const [id, meta] of Object.entries(md)) {
    const existing = book.rules[id] || book.retired[id];
    if (!existing) {
      problems.push(`rules.json is missing ${id} (present in review-rules.md)`);
      rules[id] = {
        title: meta.title,
        severity: meta.severity,
        weight: SEED_WEIGHT,
        state: 'active',
        stats: emptyStats(),
        history: [],
      };
      continue;
    }

    const stats = { ...emptyStats(), ...(existing.stats || {}) };
    const weight = computeWeight(stats);
    const state = computeState(weight, evidenceCount(stats));

    if (existing.title !== meta.title)
      problems.push(`${id}: title differs from review-rules.md`);
    if (existing.severity !== meta.severity)
      problems.push(`${id}: severity differs from review-rules.md`);
    if (existing.weight !== weight)
      problems.push(
        `${id}: weight ${existing.weight} does not match stats (${weight})`
      );
    if (existing.state !== state)
      problems.push(
        `${id}: state ${existing.state} does not match weight (${state})`
      );
    if (book.retired[id])
      problems.push(`${id}: listed as retired but present in review-rules.md`);

    rules[id] = {
      title: meta.title,
      severity: meta.severity,
      weight,
      state,
      stats,
      history: existing.history || [],
    };
  }

  const retired = { ...book.retired };
  for (const id of Object.keys(book.rules)) {
    if (md[id]) continue;
    problems.push(
      `${id} is in rules.json but not in review-rules.md (will be retired)`
    );
    retired[id] = { ...book.rules[id], retired: true };
  }
  for (const id of Object.keys(md)) delete retired[id];

  return { rules, retired, problems };
}

function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  const { md, book } = load();
  const count = Object.keys(md).length;
  if (count === 0) {
    console.error(
      'No rules parsed from review-rules.md — check the heading format.'
    );
    process.exit(1);
  }

  const { rules, retired, problems } = reconcile(md, book);

  if (mode === 'check') {
    if (problems.length) {
      console.error(
        `rules.json is out of sync with review-rules.md (${problems.length} problem(s)):`
      );
      for (const p of problems) console.error(`  - ${p}`);
      console.error(
        '\nRun: node .github/review/scripts/sync-rules.mjs --write'
      );
      process.exit(1);
    }
    console.log(`rules.json is in sync (${count} rules).`);
    return;
  }

  const next = {
    version: (book.version || 0) + (problems.length ? 1 : 0),
    updatedAt: process.env.SYNC_TIMESTAMP || book.updatedAt,
    defaults: book.defaults || { maxCommentsPerPR: 12, explorationPercent: 10 },
    rules,
    retired,
  };
  writeFileSync(JSON_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(
    `Wrote rules.json: ${count} active rules, ${Object.keys(retired).length} retired.`
  );
  for (const p of problems) console.log(`  - ${p}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
