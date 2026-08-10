/**
 * End-to-end test for post-review.mjs against a stub GitHub API.
 *
 * Runs the real script as a child process with GITHUB_API_URL pointed at a
 * local server, so the whole path — parse, validate, gate, diff-map, post — is
 * exercised without touching the network. This is what catches the failures
 * that unit tests on pure functions cannot: a wrong request body, a comment on
 * a line outside the diff, or a crash on malformed model output.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'post-review.mjs');

const PATCH = [
  '@@ -1,3 +1,5 @@',
  ' const a = 1;',
  '+const b = 2;',
  '+const c = 3;',
  ' const d = 4;',
].join('\n');

/** Stub GitHub API. Records every request so the test can assert on them. */
async function startStub({ existingComments = [], failReview = false } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      });
      const send = (code, payload) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.url.startsWith('/repos/acme/app/pulls/7/comments'))
        return send(200, existingComments);
      if (req.url.startsWith('/repos/acme/app/pulls/7/files')) {
        return send(200, [{ filename: 'src/a.ts', patch: PATCH }]);
      }
      if (req.url.startsWith('/repos/acme/app/pulls/7/reviews')) {
        return failReview
          ? send(422, { message: 'line must be part of the diff' })
          : send(200, { id: 1 });
      }
      if (req.url.startsWith('/repos/acme/app/issues/7/comments'))
        return send(201, { id: 2 });
      send(404, { message: 'not found' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, requests, port: server.address().port };
}

async function runPostReview(findings, stub, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'claude-review-'));
  await mkdir(join(dir, '.claude-review'), { recursive: true });
  if (findings !== null) {
    await writeFile(
      join(dir, '.claude-review', 'findings.json'),
      typeof findings === 'string' ? findings : JSON.stringify(findings)
    );
  }
  // execFile rejects on a non-zero exit, and a non-zero exit is now a normal
  // outcome — it is how the merge gate reports unresolved findings. Capture the
  // code instead of letting it throw.
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    ({ stdout, stderr } = await run(process.execPath, [SCRIPT], {
      cwd: dir,
      env: {
        ...process.env,
        GITHUB_API_URL: `http://127.0.0.1:${stub.port}`,
        GITHUB_TOKEN: 'stub-token',
        REPO: 'acme/app',
        PR_NUMBER: '7',
        HEAD_SHA: 'deadbeef',
        BLOCK_ON_FINDINGS: '0',
        ...env,
      },
    }));
  } catch (err) {
    ({ stdout = '', stderr = '' } = err);
    exitCode = err.code ?? 1;
  }
  await rm(dir, { recursive: true, force: true });
  return { stdout, stderr, exitCode };
}

const findingsPayload = findings => ({
  summary: 'Looks reasonable overall.',
  findings,
});

const base = {
  ruleId: 'SEC-001',
  file: 'src/a.ts',
  line: 2,
  severity: 'blocker',
  confidence: 0.9,
  title: 'SQL built by string concatenation',
  body: 'Use a parameterised query here.',
};

test('posts one review with an inline comment on a line inside the diff', async () => {
  const stub = await startStub();
  try {
    await runPostReview(findingsPayload([base]), stub);
    const review = stub.requests.find(
      r => r.method === 'POST' && r.url.includes('/reviews')
    );
    assert.ok(review, 'a review should have been posted');
    assert.equal(review.body.commit_id, 'deadbeef');
    assert.equal(review.body.event, 'COMMENT');
    assert.equal(review.body.comments.length, 1);
    assert.equal(review.body.comments[0].path, 'src/a.ts');
    assert.equal(review.body.comments[0].line, 2);
    assert.equal(review.body.comments[0].side, 'RIGHT');
    assert.match(
      review.body.comments[0].body,
      /<!-- ih-tek-review rule=SEC-001 fid=\w+/
    );
    assert.match(review.body.body, /## IH Tek review/);
  } finally {
    stub.server.close();
  }
});

test('a finding outside the diff is moved into the summary, not sent inline', async () => {
  const stub = await startStub();
  try {
    await runPostReview(findingsPayload([{ ...base, line: 999 }]), stub);
    const review = stub.requests.find(r => r.url.includes('/reviews'));
    assert.equal(
      review.body.comments.length,
      0,
      'must not send an out-of-diff line'
    );
    assert.match(review.body.body, /Findings outside the diff/);
    assert.match(review.body.body, /src\/a\.ts:999/);
  } finally {
    stub.server.close();
  }
});

test('REQUEST_CHANGES only when explicitly enabled', async () => {
  const stub = await startStub();
  try {
    await runPostReview(findingsPayload([base]), stub, {
      REQUEST_CHANGES_ON_BLOCKER: '1',
    });
    const review = stub.requests.find(r => r.url.includes('/reviews'));
    assert.equal(review.body.event, 'REQUEST_CHANGES');
  } finally {
    stub.server.close();
  }
});

test('a finding already posted on an earlier run is not reposted', async () => {
  const existing = [
    {
      id: 100,
      body:
        'old\n<!-- ih-tek-review rule=SEC-001 fid=' +
        (await import('../lib/scoring.mjs')).findingId(base) +
        ' -->',
    },
  ];
  const stub = await startStub({ existingComments: existing });
  try {
    const { stdout } = await runPostReview(findingsPayload([base]), stub);
    assert.match(stdout, /No new findings since the last run/);
    assert.equal(stub.requests.filter(r => r.method === 'POST').length, 0);
  } finally {
    stub.server.close();
  }
});

test('falls back to a plain comment when the inline review is rejected', async () => {
  const stub = await startStub({ failReview: true });
  try {
    const { stdout } = await runPostReview(findingsPayload([base]), stub);
    const fallback = stub.requests.find(r =>
      r.url.includes('/issues/7/comments')
    );
    assert.ok(fallback, 'should fall back rather than lose the review');
    assert.match(fallback.body.body, /SQL built by string concatenation/);
    assert.match(stdout, /fallback/i);
  } finally {
    stub.server.close();
  }
});

test('malformed model output is discarded without crashing', async () => {
  const stub = await startStub();
  try {
    const { stdout } = await runPostReview(
      findingsPayload([
        { ...base, ruleId: 'lowercase-id' },
        { ...base, line: 'not a number' },
        { ...base, severity: 'catastrophic' },
        { ...base, confidence: 7 },
        base,
      ]),
      stub
    );
    assert.match(stdout, /Parsed 1 valid finding\(s\), 4 discarded/);
    const review = stub.requests.find(r => r.url.includes('/reviews'));
    assert.equal(review.body.comments.length, 1);
  } finally {
    stub.server.close();
  }
});

test('invalid JSON and a missing file are both survivable', async () => {
  for (const input of ['{ not json', null]) {
    const stub = await startStub();
    try {
      const { stdout, stderr } = await runPostReview(input, stub);
      assert.equal(stub.requests.filter(r => r.method === 'POST').length, 0);
      assert.ok(/not valid JSON|No findings.json/.test(stdout + stderr));
    } finally {
      stub.server.close();
    }
  }
});

// --- merge gate ------------------------------------------------------------

test('unresolved findings fail the check so the merge is blocked', async () => {
  const stub = await startStub();
  try {
    const { exitCode, stderr } = await runPostReview(
      findingsPayload([base]),
      stub,
      { BLOCK_ON_FINDINGS: '1' }
    );
    assert.equal(exitCode, 1, 'a finding must fail the check');
    assert.match(stderr, /1 unresolved finding\(s\)/);
  } finally {
    stub.server.close();
  }
});

test('a clean PR does not block the merge', async () => {
  const stub = await startStub();
  try {
    const { exitCode, stdout } = await runPostReview(
      findingsPayload([]),
      stub,
      { BLOCK_ON_FINDINGS: '1' }
    );
    assert.equal(exitCode, 0);
    assert.match(stdout, /Merge gate is clear/);
  } finally {
    stub.server.close();
  }
});

test('findings already posted still block on a re-run', async () => {
  // The regression this guards: `kept` excludes anything a previous run already
  // commented on, so gating on it would let a PR whose every problem still
  // stands sail through the second time it is checked.
  const existing = [
    {
      id: 100,
      body:
        'old\n<!-- ih-tek-review rule=SEC-001 fid=' +
        (await import('../lib/scoring.mjs')).findingId(base) +
        ' -->',
    },
  ];
  const stub = await startStub({ existingComments: existing });
  try {
    const { exitCode, stdout } = await runPostReview(
      findingsPayload([base]),
      stub,
      { BLOCK_ON_FINDINGS: '1' }
    );
    assert.match(stdout, /No new findings since the last run/);
    assert.equal(
      exitCode,
      1,
      'the problem still exists, so it must still block'
    );
  } finally {
    stub.server.close();
  }
});

test('BLOCK_MIN_SEVERITY lets nits through while majors still block', async () => {
  for (const [severity, expected] of [
    ['nit', 0],
    ['major', 1],
  ]) {
    const stub = await startStub();
    try {
      const { exitCode } = await runPostReview(
        findingsPayload([{ ...base, severity, confidence: 0.95 }]),
        stub,
        { BLOCK_ON_FINDINGS: '1', BLOCK_MIN_SEVERITY: 'major' }
      );
      assert.equal(exitCode, expected, `severity ${severity}`);
    } finally {
      stub.server.close();
    }
  }
});

// --- incomplete reviews ----------------------------------------------------

test('a review that did not complete does not pass the gate', async () => {
  // The hole this closes: a model that returns a well-formed empty result
  // because it gave up looks identical to a genuinely clean review, and would
  // otherwise unblock the merge on code nothing ever read.
  const stub = await startStub();
  try {
    const { exitCode, stderr } = await runPostReview(
      {
        summary: 'No code was provided for review.',
        findings: [],
        reviewed: false,
        inconclusive: 'the model reported that it did not see the code',
      },
      stub,
      { BLOCK_ON_FINDINGS: '1' }
    );
    assert.equal(exitCode, 1, 'an unread diff must not read as clean');
    assert.match(stderr, /did not complete/);
    assert.match(stderr, /did not see the code/);
  } finally {
    stub.server.close();
  }
});

test('a completed clean review still passes', async () => {
  const stub = await startStub();
  try {
    const { exitCode } = await runPostReview(
      { summary: 'Looks fine.', findings: [], reviewed: true },
      stub,
      { BLOCK_ON_FINDINGS: '1' }
    );
    assert.equal(exitCode, 0);
  } finally {
    stub.server.close();
  }
});

test('findings.json without the flag is treated as reviewed', async () => {
  // Older output has no `reviewed` key. Absent must not mean "incomplete", or
  // upgrading would retroactively block every open PR.
  const stub = await startStub();
  try {
    const { exitCode } = await runPostReview(findingsPayload([]), stub, {
      BLOCK_ON_FINDINGS: '1',
    });
    assert.equal(exitCode, 0);
  } finally {
    stub.server.close();
  }
});

test('a missing or unreadable findings.json blocks rather than passes', async () => {
  for (const input of ['{ not json', null]) {
    const stub = await startStub();
    try {
      const { exitCode, stderr } = await runPostReview(input, stub, {
        BLOCK_ON_FINDINGS: '1',
      });
      assert.equal(exitCode, 1, 'no output means nothing was reviewed');
      assert.match(stderr, /did not complete/);
    } finally {
      stub.server.close();
    }
  }
});

test('REQUIRE_COMPLETE_REVIEW=0 restores the advisory behaviour', async () => {
  const stub = await startStub();
  try {
    const { exitCode } = await runPostReview(
      { summary: 'gave up', findings: [], reviewed: false },
      stub,
      { BLOCK_ON_FINDINGS: '1', REQUIRE_COMPLETE_REVIEW: '0' }
    );
    assert.equal(exitCode, 0);
  } finally {
    stub.server.close();
  }
});

test('a clean PR still gets a short summary', async () => {
  const stub = await startStub();
  try {
    await runPostReview(findingsPayload([]), stub);
    const review = stub.requests.find(r => r.url.includes('/reviews'));
    assert.equal(review.body.comments.length, 0);
    assert.match(
      review.body.body,
      /No findings above the confidence threshold/
    );
  } finally {
    stub.server.close();
  }
});
