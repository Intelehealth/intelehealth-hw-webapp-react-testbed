/**
 * Minimal GitHub REST + GraphQL client.
 *
 * Deliberately dependency-free: these scripts run in CI on every PR, and a
 * zero-dependency script needs no `npm install` step, has no supply-chain
 * surface, and cannot break because a transitive dependency shipped a bad
 * release. Node 20+ has everything required.
 */

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const GRAPHQL =
  process.env.GITHUB_GRAPHQL_URL || 'https://api.github.com/graphql';

function token() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error('GITHUB_TOKEN is not set');
  return t;
}

function baseHeaders() {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token()}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'claude-pr-review-agent',
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * REST request with retry on 5xx and secondary-rate-limit responses.
 * @param {string} path e.g. `/repos/o/r/pulls/1/files`
 * @param {{method?:string, body?:unknown, retries?:number}} [opts]
 */
export async function rest(path, opts = {}) {
  const { method = 'GET', body, retries = 3 } = opts;
  const url = path.startsWith('http') ? path : `${API}${path}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        ...baseHeaders(),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.ok) {
      const text = await res.text();
      return {
        data: text ? JSON.parse(text) : null,
        link: res.headers.get('link') || '',
      };
    }

    const text = await res.text();
    const retryable =
      res.status >= 500 ||
      res.status === 429 ||
      (res.status === 403 && /rate limit|abuse|secondary/i.test(text));

    lastErr = new Error(
      `${method} ${url} -> ${res.status}: ${text.slice(0, 600)}`
    );
    if (!retryable || attempt === retries) throw lastErr;

    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000
    );
  }
  throw lastErr;
}

/** Follow `Link: rel="next"` until exhausted. */
export async function restAll(path, { max = 1000 } = {}) {
  const out = [];
  let url = path.includes('?')
    ? `${path}&per_page=100`
    : `${path}?per_page=100`;
  while (url && out.length < max) {
    const { data, link } = await rest(url);
    if (!Array.isArray(data)) break;
    out.push(...data);
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
  }
  return out.slice(0, max);
}

/** GraphQL request. Used only where REST has no equivalent (thread resolution). */
export async function graphql(query, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { ...baseHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(json.errors || json).slice(0, 600)}`
    );
  }
  return json.data;
}

/**
 * Parse a unified diff patch into the set of new-file line numbers that GitHub
 * will accept a RIGHT-side review comment on.
 *
 * This matters: posting a review with a single out-of-diff line makes the
 * entire review request fail with a 422, losing every other comment with it.
 * We check up front and demote anything out of range into the summary instead.
 *
 * @param {string} patch
 * @returns {Set<number>}
 */
export function commentableLines(patch) {
  const lines = new Set();
  if (!patch) return lines;

  let newLine = 0;
  for (const raw of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (raw.startsWith('-')) continue; // removed: exists only on the LEFT side
    if (raw.startsWith('+') || raw.startsWith(' ')) {
      lines.add(newLine);
      newLine++;
    }
  }
  return lines;
}

/** Files touched by a PR, with their patches. */
export async function getPullFiles(repo, prNumber) {
  return restAll(`/repos/${repo}/pulls/${prNumber}/files`, { max: 300 });
}

/** Existing review comments on a PR. */
export async function getReviewComments(repo, prNumber) {
  return restAll(`/repos/${repo}/pulls/${prNumber}/comments`, { max: 500 });
}

/** Reviews on a PR (their bodies carry the bot's summary markers). */
export async function getReviews(repo, prNumber) {
  return restAll(`/repos/${repo}/pulls/${prNumber}/reviews`, { max: 200 });
}

/**
 * Review threads on a PR, with resolution state and the root comment of each.
 * GraphQL because REST has no notion of a thread, only of comments.
 */
export async function getReviewThreads(repo, prNumber) {
  const [owner, name] = repo.split('/');
  const query = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id isResolved isOutdated path
            comments(first: 1) { nodes { databaseId author { login } body } }
          }
        }
      }
    }
  }`;
  const nodes = [];
  let cursor = null;
  do {
    const data = await graphql(query, {
      owner,
      name,
      number: Number(prNumber),
      cursor,
    });
    const threads = data.repository.pullRequest.reviewThreads;
    nodes.push(...threads.nodes);
    cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

/** Reactions on a single PR review comment. */
export async function getCommentReactions(repo, commentId) {
  return restAll(`/repos/${repo}/pulls/comments/${commentId}/reactions`, {
    max: 100,
  });
}

/**
 * Post one review containing all inline comments plus a summary body.
 * @param {string} repo
 * @param {number|string} prNumber
 * @param {{commitId:string, body:string, event:'COMMENT'|'REQUEST_CHANGES', comments:Array<object>}} opts
 */
export async function createReview(
  repo,
  prNumber,
  { commitId, body, event, comments }
) {
  const { data } = await rest(`/repos/${repo}/pulls/${prNumber}/reviews`, {
    method: 'POST',
    body: { commit_id: commitId, body, event, comments },
  });
  return data;
}

/** Post a plain issue comment (used as the fallback when inline posting fails). */
export async function createIssueComment(repo, prNumber, body) {
  const { data } = await rest(`/repos/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
  return data;
}
