#!/usr/bin/env node
/**
 * Produces .claude-review/findings.json using OpenRouter's free models.
 *
 * Drop-in replacement for the Claude Code Action step. It writes the same file
 * in the same schema, so post-review.mjs, the rule gating and the whole
 * feedback loop carry on unchanged — only the thing generating the findings
 * changes.
 *
 * The trade versus an agentic reviewer is real and worth stating: this sends
 * the diff and gets findings back in one shot per chunk. It cannot go and read
 * the surrounding file, grep for the caller, or check whether a guard exists
 * elsewhere. Expect more misses on anything that needs repo context, and lean
 * on the confidence gates to keep the noise down.
 *
 * Never exits non-zero. A failed review must not fail anyone's build.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildRulesDigest,
  chooseModels,
  complete,
  estimateTokens,
  extractJson,
  keyStatus,
  listModels,
  MAX_FALLBACK_MODELS,
  packChunks,
  splitDiffByFile,
  CHARS_PER_TOKEN,
} from './lib/openrouter.mjs';
import { isExplorationSlot } from './lib/scoring.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(HERE, '..', 'rules.json');
const OUT_DIR = '.claude-review';
const DIFF_PATH = join(OUT_DIR, 'pr.diff');
const FINDINGS_PATH = join(OUT_DIR, 'findings.json');
const DEBUG_PATH = join(OUT_DIR, 'openrouter-debug.json');

const API_KEY = process.env.OPENROUTER_API_KEY;
const PR_NUMBER = process.env.PR_NUMBER || '0';
const PR_TITLE = process.env.PR_TITLE || '';
const PR_BODY = (process.env.PR_BODY || '').slice(0, 1500);
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS) || 4;
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS) || 4000;
const PREFERRED = (process.env.OPENROUTER_MODELS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/** Free tier allows 20 requests/minute. Stay comfortably under it. */
const REQUEST_SPACING_MS = 3500;

/**
 * Even on a 262k-context model, quality falls off long before the window does.
 * Capping the chunk keeps a weak model focused on a reviewable amount of code.
 */
const MAX_CHUNK_CHARS = 40_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SYSTEM_PROMPT = `You are a precise code reviewer. You review only the changed lines in a git diff.

You reply with a single JSON object and nothing else. No prose before it, no prose after it, no markdown code fences.

You are strict about false positives. A short review with two real problems is far more valuable than a long one with ten guesses. If you are not confident something is a genuine defect, leave it out.

Never report: formatting or style that a linter handles, naming preferences, missing comments, speculative refactors, praise, or restatements of what the code does.`;

function userPrompt({ digest, chunk, chunkIndex, chunkCount }) {
  const files = chunk.map(f => f.file).join('\n');
  const diff = chunk.map(f => f.patch).join('\n');

  return `Review this pull request diff against the rules below.

${PR_TITLE ? `PULL REQUEST TITLE\n${PR_TITLE}\n` : ''}${PR_BODY ? `\nDESCRIPTION\n${PR_BODY}\n` : ''}
RULES — every finding must cite one of these rule IDs. If you find a real problem that no rule covers, use GEN-000 and name the missing rule in the body.

${digest}

FILES IN THIS BATCH${chunkCount > 1 ? ` (batch ${chunkIndex + 1} of ${chunkCount})` : ''}
${files}

DIFF
${diff}

Report only problems in lines this diff ADDS or MODIFIES. Lines starting with "+" are added; lines starting with " " are unchanged context shown for reference only — do not report issues in them.

You are seeing only the diff, not the whole repository. If judging something would require code you cannot see, either lower your confidence accordingly or leave it out.

Reply with exactly this JSON shape:

{
  "summary": "2-3 sentences on this batch of changes",
  "findings": [
    {
      "ruleId": "SEC-001",
      "file": "exact path from the FILES list above",
      "line": 42,
      "endLine": 42,
      "severity": "blocker | major | minor | nit",
      "confidence": 0.85,
      "title": "one line, under 80 characters",
      "body": "why this is a problem here and what to do about it",
      "suggestion": "optional: exact replacement code for those lines, no code fences"
    }
  ]
}

"line" must be the line number in the NEW version of the file, counted from the diff hunk headers (@@ -old,n +new,n @@). Count carefully: added and context lines advance the new-file counter, removed lines do not.

"confidence" is your honest probability from 0 to 1 that an experienced engineer on this codebase would agree this is a real problem. Anything below 0.6 should not be reported at all.

If you find nothing worth reporting, return an empty findings array. That is a perfectly good answer.`;
}

/** Keep only findings that name a file we actually sent and a rule that exists. */
function sanitise(findings, chunkFiles, validRuleIds) {
  const fileSet = new Set(chunkFiles);
  const out = [];
  const rejected = [];

  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || typeof f !== 'object') continue;

    const ruleId = String(f.ruleId || '')
      .toUpperCase()
      .trim();
    const line = Number.parseInt(f.line, 10);
    const endLine = Number.parseInt(f.endLine, 10);
    const severity = String(f.severity || '')
      .toLowerCase()
      .trim();
    const confidence = Number(f.confidence);

    if (!validRuleIds.has(ruleId)) {
      rejected.push(`invented rule id ${f.ruleId}`);
      continue;
    }
    if (!fileSet.has(f.file)) {
      rejected.push(`file not in this batch: ${f.file}`);
      continue;
    }
    if (!Number.isInteger(line) || line < 1) {
      rejected.push(`bad line on ${ruleId}`);
      continue;
    }
    if (!['blocker', 'major', 'minor', 'nit'].includes(severity)) {
      rejected.push(`bad severity on ${ruleId}`);
      continue;
    }
    if (!Number.isFinite(confidence) || confidence < 0.6) {
      rejected.push(`confidence below threshold on ${ruleId}`);
      continue;
    }
    if (!f.title || !f.body) {
      rejected.push(`missing title or body on ${ruleId}`);
      continue;
    }

    out.push({
      ruleId,
      file: f.file,
      line,
      ...(Number.isInteger(endLine) && endLine >= line ? { endLine } : {}),
      severity,
      confidence: Math.min(1, Math.max(0, confidence)),
      title: String(f.title).slice(0, 120),
      body: String(f.body).slice(0, 4000),
      ...(f.suggestion
        ? { suggestion: String(f.suggestion).slice(0, 2000) }
        : {}),
    });
  }
  return { findings: out, rejected };
}

function writeFindings(payload) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(FINDINGS_PATH, JSON.stringify(payload, null, 2));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (!API_KEY) {
    console.error('OPENROUTER_API_KEY is not set.');
    writeFindings({
      summary: 'Review skipped: no OpenRouter API key configured.',
      findings: [],
      reviewed: false,
      inconclusive: 'no OpenRouter API key is configured',
    });
    return;
  }
  if (!existsSync(DIFF_PATH)) {
    console.error(`${DIFF_PATH} is missing.`);
    writeFindings({
      summary: 'Review skipped: no diff was produced.',
      findings: [],
      reviewed: false,
      inconclusive: 'the diff could not be produced',
    });
    return;
  }

  const diff = readFileSync(DIFF_PATH, 'utf8');
  if (!diff.trim()) {
    writeFindings({
      summary: 'No reviewable changes in this pull request.',
      findings: [],
      reviewed: true,
    });
    return;
  }

  const book = JSON.parse(readFileSync(RULES_PATH, 'utf8'));
  const explorationPercent = book.defaults?.explorationPercent ?? 10;
  const { digest, included, exploring } = buildRulesDigest(book.rules, ruleId =>
    isExplorationSlot(ruleId, PR_NUMBER, explorationPercent)
  );
  const validRuleIds = new Set(included);
  console.log(
    `Rulebook v${book.version}: ${included.length} rule(s) in play` +
      (exploring.length ? `, re-testing muted ${exploring.join(', ')}` : '')
  );

  // --- pick models --------------------------------------------------------
  let available;
  try {
    available = await listModels(API_KEY);
  } catch (err) {
    console.error(`Could not list models: ${err.message}`);
    writeFindings({
      summary: `Review skipped: OpenRouter unreachable (${err.message}).`,
      findings: [],
      reviewed: false,
      inconclusive: `OpenRouter was unreachable (${err.message})`,
    });
    return;
  }
  if (available.length === 0) {
    writeFindings({
      summary: 'Review skipped: no usable models are currently available.',
      findings: [],
      reviewed: false,
      inconclusive: 'no usable models were available',
    });
    return;
  }

  const chain = chooseModels(available, PREFERRED, MAX_FALLBACK_MODELS);
  const minContext = Math.min(...chain.map(m => m.context));
  const jsonMode = chain.every(m => m.structured);
  console.log(`Model chain: ${chain.map(m => m.id).join(' -> ')}`);
  console.log(
    `Smallest context in chain: ${minContext} tokens. JSON mode: ${jsonMode}.`
  );

  const status = await keyStatus(API_KEY);
  if (status) {
    console.log(
      `Key usage: ${status.usage ?? '?'} / limit ${status.limit ?? 'none'}` +
        (status.rate_limit
          ? ` (${status.rate_limit.requests}/${status.rate_limit.interval})`
          : '')
    );
  }

  // --- chunk the diff -----------------------------------------------------
  const overheadTokens = estimateTokens(SYSTEM_PROMPT + digest) + 800;
  const budgetTokens = Math.max(
    2000,
    minContext - MAX_OUTPUT_TOKENS - overheadTokens
  );
  const budgetChars = Math.min(
    MAX_CHUNK_CHARS,
    Math.floor(budgetTokens * CHARS_PER_TOKEN)
  );

  const files = splitDiffByFile(diff);
  const { chunks, skipped, truncated } = packChunks(files, {
    budgetChars,
    maxChunks: MAX_REQUESTS,
  });
  console.log(
    `${files.length} file(s) -> ${chunks.length} request(s) at ${budgetChars} chars each.` +
      (truncated.length ? ` Truncated: ${truncated.join(', ')}.` : '') +
      (skipped.length ? ` Skipped (request cap): ${skipped.join(', ')}.` : '')
  );

  // --- review -------------------------------------------------------------
  const all = [];
  const summaries = [];
  const debug = [];
  const seen = new Set();
  let failures = 0;
  let repaired = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkFiles = chunk.map(f => f.file);
    if (i > 0) await sleep(REQUEST_SPACING_MS);

    let result;
    try {
      result = await complete({
        apiKey: API_KEY,
        models: chain.map(m => m.id),
        system: SYSTEM_PROMPT,
        user: userPrompt({
          digest,
          chunk,
          chunkIndex: i,
          chunkCount: chunks.length,
        }),
        maxTokens: MAX_OUTPUT_TOKENS,
        jsonMode,
        title: `PR Review #${PR_NUMBER}`,
      });
    } catch (err) {
      console.error(`Batch ${i + 1} failed: ${err.message}`);
      debug.push({ batch: i + 1, files: chunkFiles, error: err.message });
      failures++;
      continue;
    }

    let parsed = extractJson(result.text);

    // Free models sometimes narrate before the JSON. One cheap repair attempt.
    if (!parsed) {
      console.log(
        `Batch ${i + 1}: unparseable reply from ${result.model}, retrying once.`
      );
      repaired++;
      await sleep(REQUEST_SPACING_MS);
      try {
        const repair = await complete({
          apiKey: API_KEY,
          models: chain.map(m => m.id),
          system: SYSTEM_PROMPT,
          user:
            'Your previous reply was not valid JSON. Return the same content as a single JSON ' +
            'object with keys "summary" and "findings", and nothing else.\n\n' +
            'Previous reply:\n' +
            result.text.slice(0, 6000),
          maxTokens: MAX_OUTPUT_TOKENS,
          jsonMode,
        });
        parsed = extractJson(repair.text);
      } catch (err) {
        console.error(`Batch ${i + 1} repair failed: ${err.message}`);
      }
    }

    if (!parsed) {
      debug.push({
        batch: i + 1,
        files: chunkFiles,
        model: result.model,
        unparseable: result.text.slice(0, 1200),
      });
      failures++;
      continue;
    }

    const { findings, rejected } = sanitise(
      parsed.findings,
      chunkFiles,
      validRuleIds
    );
    for (const f of findings) {
      const key = `${f.ruleId}|${f.file}|${f.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(f);
    }
    if (parsed.summary) summaries.push(String(parsed.summary).trim());

    console.log(
      `Batch ${i + 1}/${chunks.length} via ${result.model}: ` +
        `${findings.length} finding(s) kept, ${rejected.length} rejected.`
    );
    // A rejected finding means the model DID find something and we discarded
    // it. That is a very different problem from the model finding nothing, so
    // say why here rather than only in an artifact.
    for (const reason of [...new Set(rejected)].slice(0, 10)) {
      console.log(`   rejected: ${reason}`);
    }
    debug.push({
      batch: i + 1,
      files: chunkFiles,
      model: result.model,
      usage: result.usage,
      kept: findings.length,
      rejected,
    });
  }

  // --- assemble -----------------------------------------------------------
  const notes = [];
  if (truncated.length)
    notes.push(`Large diffs truncated in: ${truncated.join(', ')}.`);
  if (skipped.length) {
    notes.push(
      `Not reviewed — hit the ${MAX_REQUESTS}-request budget: ${skipped.join(', ')}.`
    );
  }
  if (failures === chunks.length) {
    notes.push(
      `**Nothing was reviewed.** All ${chunks.length} batch(es) failed, so an absence of ` +
        `findings below means the diff was never read — not that it is clean. ` +
        `See the workflow log for the provider error.`
    );
  } else if (failures) {
    notes.push(
      `${failures} of ${chunks.length} batch(es) failed and were skipped.`
    );
  }

  const summary =
    [summaries.join(' '), notes.join(' ')].filter(Boolean).join('\n\n') ||
    'No reviewable findings were produced.';

  // --- did the model actually read this diff? -----------------------------
  //
  // An empty findings array means one of two very different things: the code
  // is clean, or the model gave up and said so politely. Those are
  // indistinguishable downstream, and treating the second as a pass is how an
  // unreviewed PR sails through a merge gate. Anything short of a complete
  // read is reported as inconclusive rather than clean.
  const GAVE_UP =
    /\bno code (was )?(provided|supplied|given)|\bnothing (was )?(provided|supplied)|\bunable to review|\bcannot review|\bno (diff|changes|content) (was |were )?(provided|supplied|given)/i;

  let inconclusive = null;
  if (failures === chunks.length) {
    inconclusive = `all ${chunks.length} batch(es) failed`;
  } else if (failures) {
    inconclusive = `${failures} of ${chunks.length} batch(es) failed, so part of the diff was never read`;
  } else if (skipped.length) {
    inconclusive = `${skipped.length} file(s) exceeded the ${MAX_REQUESTS}-request budget and were never read: ${skipped.join(', ')}`;
  } else if (all.length === 0 && GAVE_UP.test(summaries.join(' '))) {
    inconclusive = 'the model reported that it did not see the code';
  } else if (all.length === 0 && repaired > 0) {
    inconclusive = `${repaired} batch(es) returned unparseable output and then found nothing, which usually means the model did not engage with the diff`;
  }

  if (inconclusive) {
    console.log(`Review is inconclusive: ${inconclusive}.`);
  }

  writeFindings({
    summary,
    findings: all,
    reviewed: !inconclusive,
    ...(inconclusive ? { inconclusive } : {}),
  });
  writeFileSync(
    DEBUG_PATH,
    JSON.stringify({ chain: chain.map(m => m.id), debug }, null, 2)
  );
  console.log(`Wrote ${all.length} finding(s) to ${FINDINGS_PATH}.`);
}

main().catch(err => {
  console.error(`openrouter-review failed: ${err.stack || err.message}`);
  try {
    writeFindings({ summary: `Review failed: ${err.message}`, findings: [] });
  } catch {
    /* nothing more we can do */
  }
});
