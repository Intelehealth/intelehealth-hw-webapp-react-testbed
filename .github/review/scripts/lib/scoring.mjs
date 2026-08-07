/**
 * Pure scoring logic for the review agent's feedback loop.
 *
 * No I/O, no network, no clock reads — everything here is a pure function of
 * its inputs so it can be unit tested and so two runs over the same PR always
 * make the same decisions.
 *
 * The model is a Beta-Bernoulli posterior per rule. Each rule starts with a
 * prior worth three observations centred on 0.7 (we assume a hand-written rule
 * is probably useful, but we do not assume it strongly). Every human reaction
 * to a comment the rule produced updates that posterior. The posterior mean is
 * the rule's weight, and the weight gates whether future findings get posted.
 */

/** Prior: alpha/(alpha+beta) = 0.7, total strength 3 observations. */
export const PRIOR_ALPHA = 2.1;
export const PRIOR_BETA = 0.9;

/** An ignored comment is weak evidence against a rule, not proof. */
export const IGNORED_WEIGHT = 0.4;

/** Minimum effective score (confidence x weight) required to post a finding. */
export const SEVERITY_GATES = {
  blocker: 0.3,
  major: 0.36,
  minor: 0.42,
  nit: 0.5,
};

export const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2, nit: 3 };

/** State transition thresholds. */
export const MUTE_WEIGHT = 0.3;
export const MUTE_MIN_EVIDENCE = 8;
export const PROBATION_WEIGHT = 0.5;
export const PROBATION_MIN_EVIDENCE = 5;

/**
 * @typedef {{accepted:number, rejected:number, ignored:number}} RuleStats
 * @typedef {{title:string, severity:string, weight:number, state:string,
 *            stats:RuleStats, history?:Array<object>}} Rule
 * @typedef {{ruleId:string, file:string, line:number, endLine?:number,
 *            severity:string, confidence:number, title:string, body:string,
 *            suggestion?:string}} Finding
 */

/**
 * Posterior mean of the rule's usefulness, in [0,1].
 * @param {RuleStats} stats
 * @returns {number}
 */
export function computeWeight(stats) {
  const accepted = Math.max(0, stats.accepted || 0);
  const rejected = Math.max(0, stats.rejected || 0);
  const ignored = Math.max(0, stats.ignored || 0);
  const alpha = PRIOR_ALPHA + accepted;
  const beta = PRIOR_BETA + rejected + ignored * IGNORED_WEIGHT;
  return round3(alpha / (alpha + beta));
}

/** Total human observations backing a rule. */
export function evidenceCount(stats) {
  return (stats.accepted || 0) + (stats.rejected || 0) + (stats.ignored || 0);
}

/**
 * Decide a rule's state from its weight and how much evidence backs it.
 * A rule is never muted on thin evidence — that is the whole point of
 * requiring a minimum observation count before demoting it.
 * @param {number} weight
 * @param {number} n
 * @returns {'active'|'probation'|'muted'}
 */
export function computeState(weight, n) {
  if (n >= MUTE_MIN_EVIDENCE && weight < MUTE_WEIGHT) return 'muted';
  if (n >= PROBATION_MIN_EVIDENCE && weight < PROBATION_WEIGHT) return 'probation';
  return 'active';
}

/**
 * Deterministic 32-bit hash. Used for exploration slots so that re-running the
 * workflow on the same PR makes the same choice — no Math.random anywhere.
 * @param {string} str
 * @returns {number}
 */
export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Epsilon-greedy exploration: a muted rule is occasionally allowed to speak
 * again so it can earn its way back. Without this, a rule muted by a run of bad
 * luck stays muted forever and the loop can never correct itself.
 * @param {string} ruleId
 * @param {number|string} prNumber
 * @param {number} percent 0-100
 * @returns {boolean}
 */
export function isExplorationSlot(ruleId, prNumber, percent) {
  if (!percent || percent <= 0) return false;
  return hash32(`${ruleId}#${prNumber}`) % 100 < percent;
}

/**
 * Stable identifier for a finding, so re-runs on `synchronize` do not repost
 * the same comment. Deliberately excludes confidence and body text: the same
 * issue on the same line is the same issue even if the wording shifts.
 * @param {Finding} f
 * @returns {string}
 */
export function findingId(f) {
  return hash32(`${f.ruleId}|${f.file}|${f.line}|${f.severity}`)
    .toString(36)
    .padStart(7, '0');
}

/**
 * Gate findings against the learned rule weights.
 *
 * @param {Finding[]} findings
 * @param {Record<string, Rule>} rules
 * @param {{prNumber:number|string, maxComments:number, explorationPercent:number,
 *          alreadyPosted?:Set<string>}} opts
 * @returns {{kept:Finding[], dropped:Array<{finding:Finding, reason:string}>}}
 */
export function gateFindings(findings, rules, opts) {
  const {
    prNumber,
    maxComments = 12,
    explorationPercent = 10,
    alreadyPosted = new Set(),
  } = opts;

  const kept = [];
  const dropped = [];

  for (const f of findings) {
    const rule = rules[f.ruleId];
    if (!rule) {
      dropped.push({ finding: f, reason: `unknown rule id ${f.ruleId}` });
      continue;
    }

    const fid = findingId(f);
    if (alreadyPosted.has(fid)) {
      dropped.push({ finding: f, reason: 'already posted on an earlier run' });
      continue;
    }

    let exploring = false;
    if (rule.state === 'muted') {
      if (isExplorationSlot(f.ruleId, prNumber, explorationPercent)) {
        exploring = true;
      } else {
        dropped.push({ finding: f, reason: 'rule muted by feedback loop' });
        continue;
      }
    }

    if (rule.state === 'probation' && SEVERITY_ORDER[f.severity] > SEVERITY_ORDER.major) {
      dropped.push({ finding: f, reason: 'rule on probation; only blocker/major posted' });
      continue;
    }

    const confidence = clamp01(f.confidence);
    const score = round3(confidence * rule.weight);
    const gate = SEVERITY_GATES[f.severity] ?? SEVERITY_GATES.minor;
    // Exploration deliberately bypasses the score gate. A muted rule's weight
    // is by definition too low to clear it, so leaving the gate in place here
    // would mean muted rules could never gather the evidence they need to
    // recover — the exploration slot would be dead code.
    if (!exploring && score < gate) {
      dropped.push({
        finding: f,
        reason: `score ${score} below ${f.severity} gate ${gate}`,
      });
      continue;
    }

    kept.push({ ...f, _fid: fid, _score: score, _exploring: exploring });
  }

  // Most severe first, then most confident. Cap so one noisy PR cannot bury
  // the author in comments.
  kept.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      b._score - a._score,
  );

  const overflow = kept.slice(maxComments);
  for (const f of overflow) {
    dropped.push({ finding: f, reason: `over the ${maxComments}-comment cap` });
  }

  return { kept: kept.slice(0, maxComments), dropped };
}

/** Half-life, in days, for how fast an old outcome stops counting. */
export const DECAY_HALF_LIFE_DAYS = 90;

/**
 * How much a single outcome still counts, given its age.
 *
 * Feedback decays so the rulebook tracks how a rule behaves *now*. Without it,
 * a rule that was noisy last year could never recover after its wording was
 * improved, and the loop would only ever ratchet in one direction.
 *
 * @param {string} outcomeAt ISO timestamp of the outcome
 * @param {string} now ISO timestamp of this run
 * @returns {number} decay factor in (0,1]
 */
export function decayFactor(outcomeAt, now) {
  const ageMs = Date.parse(now) - Date.parse(outcomeAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const ageDays = ageMs / 86_400_000;
  return round3(Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS));
}

/**
 * Rebuild every rule's stats, weight, and state from the full outcome ledger.
 *
 * This is a full recompute rather than an incremental update, deliberately: the
 * ledger is the single source of truth, so re-running the tuning job is
 * idempotent, a mis-scored outcome can be corrected by editing the ledger, and
 * the decay above is applied consistently to every observation on every run.
 *
 * @param {Record<string, Rule>} rules current rulebook (stats are ignored)
 * @param {Array<{ruleId:string, outcome:'accepted'|'rejected'|'ignored', at:string}>} outcomes
 * @param {string} now ISO timestamp of this run
 * @returns {{rules:Record<string,Rule>, changes:Array<object>}}
 */
export function rebuildRules(rules, outcomes, now) {
  const next = structuredClone(rules);
  for (const rule of Object.values(next)) {
    rule.stats = { accepted: 0, rejected: 0, ignored: 0 };
  }

  for (const o of outcomes) {
    const rule = next[o.ruleId];
    if (!rule) continue;
    const bucket =
      o.outcome === 'accepted' ? 'accepted' : o.outcome === 'rejected' ? 'rejected' : 'ignored';
    rule.stats[bucket] += decayFactor(o.at, now);
  }

  const changes = [];
  for (const [ruleId, rule] of Object.entries(next)) {
    for (const k of ['accepted', 'rejected', 'ignored']) rule.stats[k] = round3(rule.stats[k]);

    const before = { weight: rules[ruleId].weight, state: rules[ruleId].state };
    rule.weight = computeWeight(rule.stats);
    rule.state = computeState(rule.weight, evidenceCount(rule.stats));

    if (before.weight !== rule.weight || before.state !== rule.state) {
      const entry = {
        at: now,
        stats: { ...rule.stats },
        weight: [before.weight, rule.weight],
        state: [before.state, rule.state],
      };
      rule.history = [...(rule.history || []), entry].slice(-20);
      changes.push({ ruleId, title: rule.title, ...entry });
    }
  }

  return { rules: next, changes };
}

export function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function round3(n) {
  return Math.round(n * 1000) / 1000;
}
