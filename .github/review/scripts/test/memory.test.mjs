/**
 * Tests for the cross-run memory: line-independent identity, changed-line
 * scoping, and the mechanical "the flagged code is gone" check.
 *
 * The failure these guard against is live, not hypothetical: on testbed#22 a
 * pure line shift re-minted every finding id and the bot reposted findings it
 * had already made; on hw-webapp-react#318 the model changed its own anchor
 * span between runs with the same effect.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  changedLines,
  identify,
  normalizeLine,
  scopeMap,
} from '../lib/memory.mjs';
import * as awaitHash from '../lib/gate.mjs';

const HOOK = `import { useEffect, useState } from 'react';

const NOTES_ENDPOINT = '/api/visits';

export const useVisitNotes = (visitId: string) => {
  const [notes, setNotes] = useState([]);

  const fetchNotes = async () => {
    try {
      const response = await fetch(NOTES_ENDPOINT);
      setNotes(response);
    } catch (error) {
      console.log('boom', error);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [visitId]);

  return { notes };
};
`;

test('scopeMap resolves symbols in this repo’s arrow-function style', () => {
  const map = scopeMap(HOOK);
  const lineOf = text => HOOK.split('\n').findIndex(l => l.includes(text));
  assert.match(map[lineOf("console.log('boom'")], /useVisitNotes>fetchNotes/);
  assert.match(map[lineOf('fetchNotes();')], /useVisitNotes/);
});

test('the identity survives lines being inserted above the finding', () => {
  const finding = f => ({
    ruleId: 'STD-008',
    file: 'src/hooks/useVisitNotes.ts',
    ...f,
  });
  const lineOf = (src, text) =>
    src.split('\n').findIndex(l => l.includes(text)) + 1;

  const shifted = '/** docs */\n/** more docs */\n\n' + HOOK;
  const before = identify(
    finding({ line: lineOf(HOOK, "console.log('boom'") }),
    HOOK
  );
  const after = identify(
    finding({ line: lineOf(shifted, "console.log('boom'") }),
    shifted
  );
  assert.equal(before.bucket, after.bucket, 'a line shift must not re-mint the id');
});

test('two rules on the same line stay distinct findings', () => {
  const line =
    HOOK.split('\n').findIndex(l => l.includes("console.log('boom'")) + 1;
  const a = identify(
    { ruleId: 'STD-008', file: 'x.ts', line },
    HOOK
  );
  const b = identify(
    { ruleId: 'ASYNC-002', file: 'x.ts', line },
    HOOK
  );
  assert.notEqual(a.bucket, b.bucket);
});

test('a missing source file degrades to a whole-file bucket, never a crash', () => {
  const { bucket, anchors } = identify(
    { ruleId: 'SEC-001', file: 'gone.ts', line: 10 },
    null
  );
  assert.ok(bucket);
  assert.deepEqual(anchors, []);
});

test('the anchor window covers the line above, so an off-by-one report still anchors the real code', () => {
  // Observed live: the model flagged the `return` line below the actual
  // `message!` offender. The window must include the line above the reported
  // one so the fix is still detected as touching the region.
  const src = 'const a = 1;\nconst preview = message!.slice(0, 40);\nreturn `x ${preview}`;\n';
  const { anchors } = identify(
    { ruleId: 'TS-002', file: 'x.ts', line: 3 },
    src
  );
  const { hash32 } = awaitHash;
  assert.ok(
    anchors.includes(hash32('const preview = message!.slice(0, 40);')),
    'the line above the reported one must be anchored'
  );
});

test('normalizeLine treats reformatting as the same line', () => {
  assert.equal(
    normalizeLine('   setNotes(  payload.notes )  ;'),
    normalizeLine('setNotes( payload.notes ) ;')
  );
});

test('changedLines reports only the lines a commit touched, whitespace ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-git-'));
  const git = args =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 't@t']);
    git(['config', 'user.name', 't']);
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\nthree\nfour\n');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
    const base = git(['rev-parse', 'HEAD']).trim();

    // Reindent line two (whitespace only) and rewrite line three.
    writeFileSync(join(dir, 'a.ts'), 'one\n  two\nTHREE\nfour\n');
    git(['add', '.']);
    git(['commit', '-qm', 'change']);
    const head = git(['rev-parse', 'HEAD']).trim();

    const ranges = changedLines(base, head, dir);
    assert.ok(ranges.has('a.ts'));
    assert.ok(ranges.get('a.ts').has(3), 'a rewritten line is in scope');
    assert.ok(
      !ranges.get('a.ts').has(2),
      'a whitespace-only change must not re-open a line'
    );
    assert.ok(!ranges.get('a.ts').has(1));

    assert.equal(
      changedLines('0000000', head, dir),
      null,
      'an unreachable sha must return null (fail open), not an empty map'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
