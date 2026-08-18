/**
 * Decides which findings get posted. Pure functions, no state, no history.
 *
 * The model decides what is wrong; this decides what gets said. Keeping the
 * threshold and the comment cap here as code — rather than as requests in a
 * prompt — is what makes them actually hold.
 */

import { SEVERITY_ORDER } from './rules.mjs';

/** Ignore anything the model is not reasonably sure about. */
export const MIN_CONFIDENCE = 0.6;

/** Never bury a reviewer under one PR's worth of comments. */
export const MAX_COMMENTS = 12;

/*
 * The same rule firing on the same file is one observation, not six. A run
 * posted six near-identical GEN-000 comments on one file — each individually
 * valid, collectively noise, and every extra comment is paid output tokens on
 * the next run too, because posted comments come back as context. Two per
 * (rule, file) keeps the pattern visible; the summary notes the rest exist.
 */
export const MAX_PER_RULE_FILE = 2;

/** FNV-1a. Short, stable, and enough to tell two findings apart. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Stable identifier for a finding, so a re-review does not repost what is
 * already on the PR. Deliberately excludes confidence and body text: the same
 * issue on the same line is the same issue even if the wording shifts.
 */
export function findingId(f) {
  return hash32(`${f.ruleId}|${f.file}|${f.line}|${f.severity}`);
}

/**
 * Filter findings down to what should be posted.
 *
 * @param {Array<object>} findings
 * @param {{alreadyPosted?:Set<string>, minConfidence?:number,
 *          minSeverity?:string, maxComments?:number}} opts
 * @returns {{kept:Array<object>, dropped:Array<{finding:object, reason:string}>}}
 */
export function gateFindings(findings, opts = {}) {
  const {
    alreadyPosted = new Set(),
    minConfidence = MIN_CONFIDENCE,
    minSeverity = 'nit',
    maxComments = MAX_COMMENTS,
    maxPerRuleFile = MAX_PER_RULE_FILE,
  } = opts;

  const floor = SEVERITY_ORDER[minSeverity] ?? SEVERITY_ORDER.nit;
  const kept = [];
  const dropped = [];
  const perRuleFile = new Map();

  // Most severe first, then most confident, so the comment cap keeps the
  // findings that matter rather than whichever the model happened to list.
  const ordered = [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.confidence - a.confidence
  );

  for (const f of ordered) {
    const fid = findingId(f);

    if (f.confidence < minConfidence) {
      dropped.push({ finding: f, reason: `confidence ${f.confidence}` });
      continue;
    }
    if (SEVERITY_ORDER[f.severity] > floor) {
      dropped.push({ finding: f, reason: `below ${minSeverity}` });
      continue;
    }
    if (alreadyPosted.has(fid)) {
      dropped.push({ finding: f, reason: 'already posted' });
      continue;
    }
    const rfKey = `${f.ruleId}|${f.file}`;
    if ((perRuleFile.get(rfKey) ?? 0) >= maxPerRuleFile) {
      dropped.push({
        finding: f,
        reason: `more than ${maxPerRuleFile} × ${f.ruleId} on ${f.file}`,
      });
      continue;
    }
    if (kept.length >= maxComments) {
      dropped.push({
        finding: f,
        reason: `over the ${maxComments}-comment cap`,
      });
      continue;
    }
    perRuleFile.set(rfKey, (perRuleFile.get(rfKey) ?? 0) + 1);
    kept.push({ ...f, _fid: fid });
  }

  return { kept, dropped };
}
