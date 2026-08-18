#!/usr/bin/env node
/**
 * Posts a digest of one review run to Slack, for debugging.
 *
 * Includes truncated previews of what was sent to and returned by the model.
 * The payload contains the diff — source code of a clinical codebase — and a
 * webhook URL is a bearer credential with no scoping, so this must only ever
 * point at a private channel. Full, untruncated copies of every request and
 * response live in the run artifact (openrouter-debug.json); the previews
 * exist so most debugging never needs the download.
 *
 * Never exits non-zero. A failed notification must not fail a review.
 */

import { readFileSync, existsSync } from 'node:fs';

const WEBHOOK = process.env.SLACK_WEBHOOK_URL;
const REPO = process.env.REPO || '';
const PR_NUMBER = process.env.PR_NUMBER || '';
const RUN_ID = process.env.RUN_ID || '';
const PR_AUTHOR = process.env.PR_AUTHOR || '';
const SERVER = process.env.GITHUB_SERVER_URL || 'https://github.com';

const DEBUG_PATH = '.claude-review/openrouter-debug.json';
const FINDINGS_PATH = '.claude-review/findings.json';

const readJson = path => {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
};

/** Sum the usage fields across batches; they are per-request. */
function totalUsage(batches) {
  const t = { prompt: 0, completion: 0, reasoning: 0, cost: 0 };
  for (const b of batches) {
    const u = b.usage;
    if (!u) continue;
    t.prompt += u.prompt_tokens || 0;
    t.completion += u.completion_tokens || 0;
    t.reasoning += u.completion_tokens_details?.reasoning_tokens || 0;
    t.cost += u.cost || 0;
  }
  return t;
}

async function main() {
  if (!WEBHOOK) {
    console.log('No SLACK_WEBHOOK_URL configured; skipping the Slack digest.');
    return;
  }

  const debug = readJson(DEBUG_PATH);
  const findings = readJson(FINDINGS_PATH);
  const batches = debug?.debug ?? [];
  const usage = totalUsage(batches);

  const failed = batches.filter(b => b.error).length;
  const unparseable = batches.filter(b => b.unparseable).length;
  const kept = batches.reduce((n, b) => n + (b.kept || 0), 0);
  const rejected = batches.reduce((n, b) => n + (b.rejected?.length || 0), 0);
  const served = [...new Set(batches.map(b => b.model).filter(Boolean))];

  const inconclusive =
    findings?.reviewed === false ? findings.inconclusive : null;
  const status = inconclusive
    ? '🔴 inconclusive'
    : kept > 0
      ? `🟠 ${kept} finding(s)`
      : '🟢 clean';

  const clip = (text, max) =>
    text.length > max
      ? `${text.slice(0, max)}\n… ${text.length - max} more chars, full copy in the artifact`
      : text;

  const prUrl = `${SERVER}/${REPO}/pull/${PR_NUMBER}`;
  const runUrl = `${SERVER}/${REPO}/actions/runs/${RUN_ID}`;

  const lines = [
    `*Review ${status}* — <${prUrl}|${REPO}#${PR_NUMBER}>`,
    '',
    ...(PR_AUTHOR ? [`*Raised by:* \`${PR_AUTHOR}\``] : []),
    `*Chain:* \`${(debug?.chain ?? []).join(' → ') || 'unknown'}\``,
    `*Served by:* \`${served.join(', ') || 'nothing'}\``,
    `*Batches:* ${batches.length}` +
      (failed ? ` · ${failed} failed` : '') +
      (unparseable ? ` · ${unparseable} unparseable` : ''),
    `*Findings:* ${kept} kept, ${rejected} rejected by validation`,
    `*Tokens:* ${usage.prompt} in, ${usage.completion} out` +
      (usage.reasoning ? ` (${usage.reasoning} reasoning)` : '') +
      ` · $${usage.cost.toFixed(4)}`,
  ];

  if (inconclusive) lines.push('', `*Why:* ${inconclusive}`);

  // The reasons validation discarded findings are the most useful debugging
  // signal there is: they mean the model found something and we threw it away.
  const reasons = [...new Set(batches.flatMap(b => b.rejected ?? []))].slice(
    0,
    5
  );
  if (reasons.length) {
    lines.push('', '*Rejected:*', ...reasons.map(r => `• ${r}`));
  }

  const errors = batches.filter(b => b.error).map(b => b.error.slice(0, 200));
  if (errors.length)
    lines.push('', '*Errors:*', ...errors.map(e => `• \`${e}\``));

  // Per-batch request and response previews. The user message carries the
  // rulebook digest and the diff; its head shows which files went out. Slack
  // rejects payloads past ~40k characters, so previews shrink to fit.
  for (const b of batches) {
    const req = b.request?.messages?.at(-1)?.content;
    const resp = b.response ?? b.unparseable;
    if (!req && !resp) continue;
    lines.push('', `*— Batch ${b.batch}* (\`${b.model || 'failed'}\`)`);
    if (req)
      lines.push(
        `*Sent* (${req.length} chars):`,
        '```' + clip(req, 700) + '```'
      );
    if (resp)
      lines.push(
        `*Received* (${resp.length} chars):`,
        '```' + clip(resp, 1200) + '```'
      );
  }

  lines.push('', `<${runUrl}|Run log and artifact>`);

  // Hard ceiling: drop preview lines from the end until the payload fits,
  // keeping the summary and the run link.
  while (lines.join('\n').length > 38000 && lines.length > 12) {
    lines.splice(lines.length - 3, 1);
  }

  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n'), mrkdwn: true }),
    });
    console.log(
      res.ok
        ? 'Posted the review digest to Slack.'
        : `Slack rejected the digest: ${res.status} ${(await res.text()).slice(0, 200)}`
    );
  } catch (err) {
    console.error(`Could not reach Slack: ${err.message}`);
  }
}

main().catch(err => {
  console.error(`notify-slack failed: ${err.message}`);
});
