/**
 * Tests for the OpenRouter path.
 *
 * The pure functions are tested directly; the runner is exercised end to end
 * against a stub OpenRouter server, because the failure modes that actually
 * bite with free models — narrated JSON, invented file paths, invented rule
 * IDs, 429s mid-run — only show up in the full pipeline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  chooseModels,
  extractJson,
  packChunks,
  rankModels,
  splitDiffByFile,
} from '../lib/openrouter.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'review.mjs');

// --- diff splitting --------------------------------------------------------

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,2 +10,3 @@
+const z = 3;
`;

test('splits a diff into per-file sections keyed by the new path', () => {
  const files = splitDiffByFile(DIFF);
  assert.deepEqual(
    files.map(f => f.file),
    ['src/a.ts', 'src/b.ts']
  );
  assert.match(files[0].patch, /const y = 2/);
  assert.ok(
    !files[0].patch.includes('const z = 3'),
    'sections must not bleed into each other'
  );
});

test('a renamed file is keyed by its new path', () => {
  const renamed =
    'diff --git a/old/name.ts b/new/name.ts\n--- a/old/name.ts\n+++ b/new/name.ts\n@@ -1 +1 @@\n+x\n';
  assert.equal(splitDiffByFile(renamed)[0].file, 'new/name.ts');
});

test('an empty diff yields no sections', () => {
  assert.deepEqual(splitDiffByFile(''), []);
  assert.deepEqual(splitDiffByFile('   '), []);
});

// --- chunk packing ---------------------------------------------------------

const mkFiles = sizes =>
  sizes.map((n, i) => ({ file: `f${i}.ts`, patch: 'x'.repeat(n) }));

test('small files are packed together into one request', () => {
  const { chunks } = packChunks(mkFiles([100, 100, 100]), {
    budgetChars: 1000,
    maxChunks: 4,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 3);
});

test('files are split across requests once the budget is exceeded', () => {
  const { chunks } = packChunks(mkFiles([600, 600, 600]), {
    budgetChars: 1000,
    maxChunks: 4,
  });
  assert.equal(chunks.length, 3);
});

test('a file larger than the budget is truncated rather than dropped', () => {
  const { chunks, truncated } = packChunks(mkFiles([5000]), {
    budgetChars: 1000,
    maxChunks: 4,
  });
  assert.deepEqual(truncated, ['f0.ts']);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0][0].patch, /diff truncated for length/);
  assert.ok(chunks[0][0].patch.length <= 1100);
});

test('the request cap reports what it dropped instead of silently truncating', () => {
  const { chunks, skipped } = packChunks(mkFiles([900, 900, 900, 900]), {
    budgetChars: 1000,
    maxChunks: 2,
  });
  assert.equal(chunks.length, 2);
  assert.equal(skipped.length, 2);
});

test('one huge file does not starve the small ones behind it', () => {
  // With only one request available and a file that fills the whole budget,
  // the small file must still be the one that gets reviewed.
  const { chunks, skipped } = packChunks(
    [
      { file: 'big.ts', patch: 'x'.repeat(1000) },
      { file: 'small.ts', patch: 'y'.repeat(10) },
    ],
    { budgetChars: 1000, maxChunks: 1 }
  );
  assert.deepEqual(
    chunks[0].map(f => f.file),
    ['small.ts']
  );
  assert.deepEqual(skipped, ['big.ts']);
});

// --- JSON recovery ---------------------------------------------------------

const OBJ = '{"summary":"ok","findings":[]}';

test('parses a clean JSON reply', () => {
  assert.deepEqual(extractJson(OBJ), { summary: 'ok', findings: [] });
});

test('recovers JSON from markdown fences', () => {
  assert.deepEqual(extractJson('```json\n' + OBJ + '\n```'), {
    summary: 'ok',
    findings: [],
  });
  assert.deepEqual(extractJson('```\n' + OBJ + '\n```'), {
    summary: 'ok',
    findings: [],
  });
});

test('recovers JSON despite narration before and after', () => {
  const narrated = `Sure! Here is my review:\n\n${OBJ}\n\nLet me know if you need more detail.`;
  assert.deepEqual(extractJson(narrated), { summary: 'ok', findings: [] });
});

test('strips a reasoning model scratchpad', () => {
  assert.deepEqual(
    extractJson(`<think>Let me look at this...</think>\n${OBJ}`),
    {
      summary: 'ok',
      findings: [],
    }
  );
});

test('handles braces inside strings without losing the object', () => {
  const tricky = 'Here:\n{"summary":"use {a: 1} instead","findings":[]}\nDone.';
  assert.equal(extractJson(tricky).summary, 'use {a: 1} instead');
});

test('handles escaped quotes inside strings', () => {
  const tricky = '{"summary":"he said \\"hi\\" then left","findings":[]}';
  assert.equal(extractJson(tricky).summary, 'he said "hi" then left');
});

test('returns null rather than guessing on unusable output', () => {
  assert.equal(extractJson('I cannot review this.'), null);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
  assert.equal(extractJson('{"broken": '), null);
  assert.equal(
    extractJson('[1,2,3]'),
    null,
    'a bare array is not the expected shape'
  );
});

// --- model selection -------------------------------------------------------

/* The chain configured in production, so the tests exercise what actually runs. */
const LIVE_CHAIN = [
  { id: 'deepseek/deepseek-v4-pro', context: 204800, structured: true },
  { id: 'qwen/qwen3-coder', context: 262144, structured: true },
  { id: 'z-ai/glm-4.7', context: 204800, structured: true },
];

const AVAILABLE = [
  { id: 'big/model:free', context: 262144, structured: false },
  { id: 'mid/model:free', context: 128000, structured: true },
  { id: 'small/model:free', context: 32000, structured: false },
];

test('preferred models lead the chain when they are still available', () => {
  const chain = chooseModels(AVAILABLE, ['mid/model:free'], 3);
  assert.equal(chain[0].id, 'mid/model:free');
  assert.equal(chain.length, 3, 'the rest are appended as fallbacks');
});

test('a preferred model that no longer exists is skipped, not fatal', () => {
  const chain = chooseModels(
    AVAILABLE,
    ['retired/model:free', 'small/model:free'],
    2
  );
  assert.equal(chain[0].id, 'small/model:free');
});

test('with no preference the largest context comes first', () => {
  assert.equal(chooseModels(AVAILABLE, [], 1)[0].id, 'big/model:free');
});

test('the chain never exceeds the requested length', () => {
  assert.equal(chooseModels(AVAILABLE, [], 2).length, 2);
});

test('a model that guarantees JSON outranks a bigger one that does not', () => {
  // The regression this locks in: ranking on context alone put a 262k model
  // with no structured-output support ahead of a 128k model that had it, and
  // the big one returned prose the parser could not read.
  const ranked = rankModels(AVAILABLE);
  assert.equal(ranked[0].id, 'mid/model:free');
  assert.ok(
    ranked.every(
      (m, i) => i === 0 || !m.structured || ranked[i - 1].structured
    ),
    'every structured model sorts ahead of every unstructured one'
  );
});

test('among equally capable models the larger context still wins', () => {
  const ranked = rankModels([
    { id: 'small/structured:free', context: 8000, structured: true },
    { id: 'large/structured:free', context: 262144, structured: true },
  ]);
  assert.equal(ranked[0].id, 'large/structured:free');
});

test('ranking does not mutate the caller array', () => {
  const input = [...AVAILABLE];
  rankModels(input);
  assert.deepEqual(
    input.map(m => m.id),
    AVAILABLE.map(m => m.id)
  );
});

// --- end to end ------------------------------------------------------------

async function startStub({ replies, models = AVAILABLE }) {
  const calls = [];
  let i = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const send = (code, payload) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.url.endsWith('/models')) {
        return send(200, {
          data: models.map(m => ({
            id: m.id,
            context_length: m.context,
            supported_parameters: m.structured ? ['structured_outputs'] : [],
          })),
        });
      }
      if (req.url.endsWith('/key'))
        return send(200, { data: { usage: 1, limit: null } });
      if (req.url.endsWith('/chat/completions')) {
        calls.push(JSON.parse(body));
        const reply = replies[Math.min(i++, replies.length - 1)];
        if (reply.status && reply.status !== 200)
          return send(reply.status, { error: reply.body });
        return send(200, {
          model: reply.model || 'big/model:free',
          choices: [{ message: { content: reply.content } }],
          usage: { total_tokens: 100 },
        });
      }
      send(404, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, calls, port: server.address().port };
}

async function runReview(stub, { diff = DIFF, rules, env = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'or-review-'));
  await mkdir(join(dir, '.claude-review'), { recursive: true });
  await writeFile(join(dir, '.claude-review', 'pr.diff'), diff);

  // The script reads review-rules.md relative to itself, so point it at a copy
  // only when the test needs different rules.
  let scriptPath = SCRIPT;
  if (rules) {
    const reviewDir = join(dir, 'review');
    await mkdir(join(reviewDir, 'scripts', 'lib'), { recursive: true });
    await writeFile(join(reviewDir, 'review-rules.md'), rules);
    for (const f of ['review.mjs']) {
      await writeFile(
        join(reviewDir, 'scripts', f),
        await readFile(join(HERE, '..', f))
      );
    }
    for (const f of ['openrouter.mjs', 'rules.mjs', 'gate.mjs']) {
      await writeFile(
        join(reviewDir, 'scripts', 'lib', f),
        await readFile(join(HERE, '..', 'lib', f))
      );
    }
    scriptPath = join(reviewDir, 'scripts', 'review.mjs');
  }

  const { stdout, stderr } = await run(process.execPath, [scriptPath], {
    cwd: dir,
    env: {
      ...process.env,
      OPENROUTER_BASE_URL: `http://127.0.0.1:${stub.port}`,
      OPENROUTER_API_KEY: 'stub-key',
      PR_NUMBER: '7',
      ...env,
    },
  });
  const findings = JSON.parse(
    await readFile(join(dir, '.claude-review', 'findings.json'), 'utf8')
  );
  await rm(dir, { recursive: true, force: true });
  return { stdout, stderr, findings };
}

const RULES_FILE = `# Rulebook

**SEC-001 · blocker · Injection.** String concatenation building SQL.
`;

const goodFinding = {
  ruleId: 'SEC-001',
  file: 'src/a.ts',
  line: 2,
  severity: 'blocker',
  confidence: 0.9,
  title: 'SQL injection',
  body: 'Parameterise this.',
};

test('produces findings.json in the schema post-review.mjs expects', async () => {
  const stub = await startStub({
    replies: [
      {
        content: JSON.stringify({
          summary: 'Looks risky.',
          findings: [goodFinding],
        }),
      },
    ],
  });
  try {
    const { findings } = await runReview(stub, { rules: RULES_FILE });
    assert.equal(findings.findings.length, 1);
    assert.equal(findings.findings[0].ruleId, 'SEC-001');
    assert.match(findings.summary, /Looks risky/);
    assert.equal(typeof findings.findings[0].confidence, 'number');
  } finally {
    stub.server.close();
  }
});

test('narrated and fenced replies still yield findings', async () => {
  const stub = await startStub({
    replies: [
      {
        content:
          'Sure!\n```json\n' +
          JSON.stringify({ summary: 's', findings: [goodFinding] }) +
          '\n```\nHope that helps!',
      },
    ],
  });
  try {
    const { findings } = await runReview(stub, { rules: RULES_FILE });
    assert.equal(findings.findings.length, 1);
  } finally {
    stub.server.close();
  }
});

test('invented rule IDs and file paths are discarded', async () => {
  const stub = await startStub({
    replies: [
      {
        content: JSON.stringify({
          summary: 's',
          findings: [
            { ...goodFinding, ruleId: 'MADE-UP-1' },
            { ...goodFinding, file: 'src/does-not-exist.ts' },
            { ...goodFinding, confidence: 0.2 },
            { ...goodFinding, severity: 'catastrophic' },
            goodFinding,
          ],
        }),
      },
    ],
  });
  try {
    const { findings, stdout } = await runReview(stub, { rules: RULES_FILE });
    assert.equal(
      findings.findings.length,
      1,
      'only the valid finding survives'
    );
    assert.match(stdout, /4 rejected/);
  } finally {
    stub.server.close();
  }
});

test('an unparseable reply triggers exactly one repair attempt', async () => {
  const stub = await startStub({
    replies: [
      { content: 'I am unable to produce JSON right now.' },
      {
        content: JSON.stringify({
          summary: 'recovered',
          findings: [goodFinding],
        }),
      },
    ],
  });
  try {
    const { findings, stdout } = await runReview(stub, { rules: RULES_FILE });
    assert.match(stdout, /retrying once/);
    assert.equal(findings.findings.length, 1);
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.server.close();
  }
});

test('a rate limited batch degrades to a partial review, not a crash', async () => {
  const stub = await startStub({
    replies: [{ status: 429, body: { message: 'rate limited' } }],
  });
  try {
    const { findings, stderr } = await runReview(stub, {
      rules: RULES_FILE,
      env: { MAX_REQUESTS: '1' },
    });
    assert.deepEqual(findings.findings, []);
    assert.match(findings.summary, /failed/i);
    assert.match(stderr, /429/);
  } finally {
    stub.server.close();
  }
});

test('a missing API key writes an empty review instead of failing the job', async () => {
  const stub = await startStub({ replies: [{ content: OBJ }] });
  try {
    const { findings } = await runReview(stub, {
      rules: RULES_FILE,
      env: { OPENROUTER_API_KEY: '' },
    });
    assert.deepEqual(findings.findings, []);
    assert.match(findings.summary, /no OpenRouter API key/i);
  } finally {
    stub.server.close();
  }
});

test('the request budget is respected and what was dropped is reported', async () => {
  const many = Array.from(
    { length: 6 },
    (_, i) =>
      `diff --git a/f${i}.ts b/f${i}.ts\n--- a/f${i}.ts\n+++ b/f${i}.ts\n@@ -1 +1,2 @@\n+${'x'.repeat(30000)}\n`
  ).join('');
  const stub = await startStub({
    replies: [{ content: JSON.stringify({ summary: 's', findings: [] }) }],
  });
  try {
    const { findings, stdout } = await runReview(stub, {
      diff: many,
      rules: RULES_FILE,
      env: { MAX_REQUESTS: '2' },
    });
    assert.equal(stub.calls.length, 2, 'never exceeds the request budget');
    assert.match(stdout, /Skipped \(request cap\)/);
    assert.match(findings.summary, /request budget/);
  } finally {
    stub.server.close();
  }
});

test('the fallback chain is sent so OpenRouter can reroute on rate limits', async () => {
  const stub = await startStub({
    replies: [{ content: JSON.stringify({ summary: 's', findings: [] }) }],
  });
  try {
    await runReview(stub, { rules: RULES_FILE });
    assert.ok(
      Array.isArray(stub.calls[0].models),
      'models array must be present'
    );
    assert.ok(stub.calls[0].models.length > 1, 'needs at least one fallback');
    assert.equal(stub.calls[0].temperature, 0.1);
  } finally {
    stub.server.close();
  }
});

test('JSON mode is only requested when every model in the chain supports it', async () => {
  const mixed = await startStub({
    replies: [{ content: OBJ }],
    models: [
      { id: 'a:free', context: 100000, structured: true },
      { id: 'b:free', context: 90000, structured: false },
    ],
  });
  try {
    await runReview(mixed, { rules: RULES_FILE });
    assert.equal(
      mixed.calls[0].response_format,
      undefined,
      'would 400 on the non-supporting fallback'
    );
  } finally {
    mixed.server.close();
  }

  const allStructured = await startStub({
    replies: [{ content: OBJ }],
    models: [{ id: 'a:free', context: 100000, structured: true }],
  });
  try {
    await runReview(allStructured, { rules: RULES_FILE });
    assert.equal(
      allStructured.calls[0].response_format.type,
      'json_schema',
      'a fully structured chain gets the strict schema, not bare json_object'
    );
  } finally {
    allStructured.server.close();
  }
});

test('a non-reasoning model outranks a reasoning one at equal capability', () => {
  // The regression this locks in: deepseek-v4-pro spent 4000 of 4001 completion
  // tokens reasoning and replied "No diff was provided for review."
  const ranked = rankModels([
    { id: 'thinker:v1', context: 1000000, structured: true, reasoning: true },
    { id: 'answerer:v1', context: 262144, structured: true, reasoning: false },
  ]);
  assert.equal(ranked[0].id, 'answerer:v1');
});

test('structured output still outranks non-reasoning', () => {
  const ranked = rankModels([
    { id: 'plain:v1', context: 262144, structured: false, reasoning: false },
    { id: 'thinker:v1', context: 262144, structured: true, reasoning: true },
  ]);
  assert.equal(
    ranked[0].id,
    'thinker:v1',
    'JSON support is the harder constraint'
  );
});

test('pins the reply shape with a strict json_schema, not bare json_object', async () => {
  // Regression: `json_object` only guarantees valid JSON, not field names. A
  // model replied with `rule_id` instead of `ruleId` and all five findings were
  // discarded as "invented rule id undefined".
  const stub = await startStub({
    replies: [{ content: OBJ }],
    models: LIVE_CHAIN,
  });
  try {
    await runReview(stub, { rules: RULES_FILE });
    const [call] = stub.calls;
    assert.equal(call.response_format.type, 'json_schema');
    assert.equal(call.response_format.json_schema.strict, true);
    const props = call.response_format.json_schema.schema.properties;
    assert.ok(props.findings.items.required.includes('ruleId'));
  } finally {
    stub.server.close();
  }
});

test('every request asks the provider not to reason', async () => {
  // deepseek-v4-pro spent 4000 of 4001 completion tokens reasoning and returned
  // the single line "No diff was provided for review." — the diff had been sent
  // (prompt_tokens 1978), the reply was simply truncated away.
  const stub = await startStub({ replies: [{ content: OBJ }] });
  try {
    await runReview(stub, { rules: RULES_FILE });
    assert.ok(stub.calls.length > 0);
    for (const call of stub.calls)
      assert.deepEqual(call.reasoning, { enabled: false });
  } finally {
    stub.server.close();
  }
});

test('a finding keyed rule_id survives instead of being thrown away', async () => {
  const snake = JSON.stringify({
    summary: 'x',
    findings: [
      {
        rule_id: 'SEC-001',
        path: 'src/a.ts',
        line_number: 2,
        level: 'major',
        score: 0.9,
        message: 'hardcoded secret',
        description: 'move it to an env var',
      },
    ],
  });
  const stub = await startStub({ replies: [{ content: snake }] });
  try {
    const { findings } = await runReview(stub, { rules: RULES_FILE });
    assert.equal(findings.findings.length, 1);
    assert.equal(findings.findings[0].ruleId, 'SEC-001');
    assert.equal(findings.findings[0].file, 'src/a.ts');
  } finally {
    stub.server.close();
  }
});

test('findings outside src/ are rejected unless the rule is SEC or PHI', async () => {
  // The rulebook scopes rules to src/**, but prose in a prompt is advisory —
  // a live run reported STD findings on .github/** anyway. Enforced in code.
  const ciDiff = `diff --git a/.github/scripts/deploy.mjs b/.github/scripts/deploy.mjs
index 111..222 100644
--- a/.github/scripts/deploy.mjs
+++ b/.github/scripts/deploy.mjs
@@ -1,2 +1,4 @@
 const x = 1;
+console.log(x);
+const token = 'hardcoded';
`;
  const reply = JSON.stringify({
    summary: 'x',
    findings: [
      {
        ruleId: 'STD-008',
        file: '.github/scripts/deploy.mjs',
        line: 2,
        severity: 'major',
        confidence: 0.9,
        title: 'console in tooling — out of scope',
        body: 'b',
      },
      {
        ruleId: 'SEC-001',
        file: '.github/scripts/deploy.mjs',
        line: 3,
        severity: 'blocker',
        confidence: 0.9,
        title: 'a credential is in scope anywhere',
        body: 'b',
      },
    ],
  });
  const stub = await startStub({ replies: [{ content: reply }] });
  try {
    const { findings } = await runReview(stub, {
      diff: ciDiff,
      rules: RULES_FILE,
    });
    assert.equal(findings.findings.length, 1);
    assert.equal(findings.findings[0].ruleId, 'SEC-001');
  } finally {
    stub.server.close();
  }
});

test('the model is no longer asked for suggestion blocks', async () => {
  // Models filled ```suggestion fences with prose; applying one would commit
  // a sentence into source. Dropped — also most of the paid output tokens.
  const stub = await startStub({
    replies: [{ content: OBJ }],
    models: LIVE_CHAIN,
  });
  try {
    await runReview(stub, { rules: RULES_FILE });
    const [call] = stub.calls;
    const props =
      call.response_format.json_schema.schema.properties.findings.items;
    assert.ok(!('suggestion' in props.properties));
    assert.ok(!props.required.includes('suggestion'));
    assert.match(call.messages.at(-1).content, /ONE sentence/);
  } finally {
    stub.server.close();
  }
});
