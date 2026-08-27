/**
 * Cross-run memory for the reviewer, derived from the checkout and the PR
 * itself — no database, no state file. Three jobs:
 *
 *   1. A line-independent identity for a finding. The v1 fid hashed the line
 *      number, so any line shift re-minted every fid and the bot reposted
 *      findings it had already made (hw-webapp-react#318, reproduced
 *      deterministically on testbed#22). The v2 bucket keys on the enclosing
 *      symbol instead, read from the file on disk — never from model output.
 *
 *   2. The set of lines actually changed since the last reviewed commit, so a
 *      re-review only accepts NEW findings from code the developer touched.
 *      Without this, every commit invites the model to re-litigate the whole
 *      file and developers chase a moving target.
 *
 *   3. Normalised line hashes, so "the flagged code is gone" is a mechanical
 *      check against the file rather than the model's opinion.
 *
 * Everything here fails open toward reviewing and closed toward resolving: a
 * parse failure means findings post (worst case a duplicate comment), never
 * that a thread resolves (worst case a buried defect).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hash32 } from './gate.mjs';

/**
 * Trim and collapse internal whitespace so pure reformatting does not change
 * a line's identity.
 */
export function normalizeLine(line) {
  return String(line || '')
    .trim()
    .replace(/\s+/g, ' ');
}

const DECLARATION =
  /(?:function|class)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=|([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?(?:function\b|\()/;

/**
 * Map each line of a source file to its enclosing named scope, e.g.
 * `useVisitNotes>fetchNotes`.
 *
 * A brace-depth walk with one twist this repo's dominant style demands: in
 * `export const f = (\n  ...\n): T => {` the declaration name sits on a line
 * whose braces net to zero, and the `{` arrives lines later. The name is
 * therefore carried forward as `pending` until a brace opens a block, rather
 * than being required on the same line. Without this the walk resolves no
 * symbol at all on arrow-function modules — measured on the production repo,
 * that is exactly the *.logic.ts / hooks / services files a reviewer flags
 * most.
 *
 * Heuristic by design: braces inside strings or comments can skew it. The
 * consumer treats a wrong-but-stable symbol the same as a right one — identity
 * only needs determinism — and a missing symbol degrades to a content anchor.
 */
export function scopeMap(source) {
  const lines = String(source || '').split('\n');
  const stack = [];
  let pending = null;
  const out = [];

  for (const line of lines) {
    const m = DECLARATION.exec(line);
    if (m) pending = m[1] || m[2] || m[3];

    for (const ch of line) {
      if (ch === '{') {
        stack.push(pending || '');
        pending = null;
      } else if (ch === '}') {
        stack.pop();
      }
    }

    // A statement that ended without opening a block consumes the pending
    // name — `const X = [1, 2];` must not label the next block.
    if (pending && /;\s*$/.test(line) && !line.includes('{')) pending = null;

    out.push(stack.filter(Boolean).join('>') || null);
  }
  return out;
}

/**
 * The v2 identity of a finding: rule + file + enclosing scope, with the scope
 * read from the checked-out file. Line numbers, severity, confidence and
 * wording are all excluded — every one of them varied across runs on the
 * incidents this replaces.
 *
 * Fallback order when no symbol resolves: the normalised content of the
 * flagged line, else the whole file. A coarser bucket can at worst suppress a
 * near-identical second instance in the same scope; a finer one reposts
 * duplicates forever. Reporting bias goes to the coarse side only within one
 * scope, which is where a same-rule repeat is almost always the same finding.
 */
export function identify(finding, source) {
  let anchor = null;
  let scopeKey = 'file';
  if (source) {
    const lines = source.split('\n');
    const content = normalizeLine(lines[finding.line - 1] || '');
    if (content.length >= 6) anchor = hash32(content);
    const symbol = scopeMap(source)[finding.line - 1];
    scopeKey = symbol || anchor || 'file';
  }
  return {
    bucket: hash32(`v2|${finding.ruleId}|${finding.file}|${scopeKey}`),
    anchor,
  };
}

/**
 * New-file line numbers changed between two commits, per file, whitespace
 * ignored (`-w`): a pure re-indent must not count as a change, or wrapping a
 * body in a try-block would re-open every finding inside it.
 *
 * Returns null when git cannot answer (unreachable sha after a force-push,
 * shallow clone) — the caller must treat null as "everything is in scope",
 * never as "nothing changed".
 */
export function changedLines(baseSha, headSha, cwd = process.cwd()) {
  const r = spawnSync(
    'git',
    ['diff', '-w', '--unified=0', `${baseSha}..${headSha}`],
    { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 }
  );
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;

  const map = new Map();
  let file = null;
  for (const line of r.stdout.split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      file = f[1];
      if (!map.has(file)) map.set(file, new Set());
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      const set = map.get(file);
      if (count === 0) {
        // Pure deletion: mark the line the deletion sits against, so a
        // finding about "something is now missing here" stays in scope.
        set.add(Math.max(1, start));
      } else {
        for (let i = 0; i < count; i++) set.add(start + i);
      }
    }
  }
  return map;
}

/**
 * The set of normalised line hashes present in a file right now. Used as the
 * mechanical half of "this finding is fixed": the anchor recorded when the
 * comment was posted must be absent from the file before its thread may
 * resolve. Model silence alone is never sufficient.
 */
export function fileLineHashes(path) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const hashes = new Set();
  for (const line of source.split('\n')) {
    const content = normalizeLine(line);
    if (content.length >= 6) hashes.add(hash32(content));
  }
  return hashes;
}
