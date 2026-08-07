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
  const { stdout, stderr } = await run(process.execPath, [SCRIPT], {
    cwd: dir,
    env: {
      ...process.env,
      GITHUB_API_URL: `http://127.0.0.1:${stub.port}`,
      GITHUB_TOKEN: 'stub-token',
      REPO: 'acme/app',
      PR_NUMBER: '7',
      HEAD_SHA: 'deadbeef',
      ...env,
    },
  });
  await rm(dir, { recursive: true, force: true });
  return { stdout, stderr };
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
      /<!-- claude-review rule=SEC-001 fid=\w+/
    );
    assert.match(review.body.body, /## Automated PR review/);
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
        'old\n<!-- claude-review rule=SEC-001 fid=' +
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
