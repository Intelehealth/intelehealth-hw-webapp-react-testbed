/**
 * OpenRouter client for the review agent.
 *
 * Free models come with three constraints that shape everything here:
 *
 *   1. Most of them do not support structured outputs, so we cannot rely on a
 *      JSON schema being enforced. We ask for JSON, then parse defensively.
 *   2. The free lineup churns — models appear and disappear weekly. Hardcoding
 *      IDs guarantees a workflow that breaks silently one morning, so we
 *      discover what is currently free at runtime and fall back through a chain.
 *   3. The daily request cap is low (50/day, or 1000 once you have bought $10
 *      of credit). Requests are a budget to be spent, not a free resource, so
 *      the diff is packed into as few calls as possible.
 *
 * Pure functions live here alongside the client so they can be unit tested
 * without touching the network.
 */

const BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

/** Rough token estimate. Deliberately pessimistic — overrunning context is worse. */
export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / CHARS_PER_TOKEN);
}

/**
 * Split a unified diff into per-file sections.
 * @param {string} diff
 * @returns {Array<{file:string, patch:string}>}
 */
export function splitDiffByFile(diff) {
  if (!diff?.trim()) return [];
  const out = [];
  // Keep the `diff --git` header with its section.
  const sections = diff.split(/(?=^diff --git )/m).filter(s => s.trim());
  for (const patch of sections) {
    // `diff --git a/path b/path` — take the b-side, which is the new path.
    const m = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(patch);
    out.push({ file: m ? m[2] : 'unknown', patch });
  }
  return out;
}

/**
 * Pack per-file diffs into as few requests as possible without blowing the
 * context window.
 *
 * A file whose own diff exceeds the budget is truncated rather than dropped —
 * a partial review of a big file beats no review at all, and the truncation is
 * marked inline so the model knows not to reason about what it cannot see.
 *
 * @param {Array<{file:string, patch:string}>} files
 * @param {{budgetChars:number, maxChunks:number}} opts
 * @returns {{chunks:Array<Array<{file:string,patch:string}>>, skipped:string[], truncated:string[]}}
 */
export function packChunks(files, { budgetChars, maxChunks }) {
  const chunks = [];
  const skipped = [];
  const truncated = [];
  let current = [];
  let currentSize = 0;

  // Smallest first, so one enormous file cannot starve everything behind it.
  const ordered = [...files].sort((a, b) => a.patch.length - b.patch.length);

  for (const f of ordered) {
    let patch = f.patch;
    if (patch.length > budgetChars) {
      patch =
        patch.slice(0, budgetChars) + '\n... [diff truncated for length] ...\n';
      truncated.push(f.file);
    }
    if (currentSize + patch.length > budgetChars && current.length) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push({ file: f.file, patch });
    currentSize += patch.length;
  }
  if (current.length) chunks.push(current);

  if (chunks.length > maxChunks) {
    for (const chunk of chunks.slice(maxChunks))
      skipped.push(...chunk.map(f => f.file));
    return { chunks: chunks.slice(0, maxChunks), skipped, truncated };
  }
  return { chunks, skipped, truncated };
}

/**
 * Recover a JSON object from whatever a free model actually returned.
 *
 * Free models routinely wrap JSON in markdown fences, prefix it with "Here is
 * the review:", or emit <think> blocks first. Without this, roughly a third of
 * responses would be thrown away.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  // Reasoning models emit their scratchpad first.
  let s = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const attempt = candidate => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  };

  let parsed = attempt(s);
  if (parsed) return parsed;

  // ```json ... ``` fences
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fenced) {
    parsed = attempt(fenced[1].trim());
    if (parsed) return parsed;
    s = fenced[1];
  }

  // Scan for the first balanced object, respecting strings and escapes.
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return attempt(s.slice(start, i + 1));
    }
  }
  return null;
}

/**
 * Compact one-line-per-rule digest for the prompt.
 *
 * The full rulebook is ~14 KB of prose. Sending it on every request would eat
 * the context budget a free model needs for the actual diff, so the model gets
 * IDs, severities and titles, and the prose stays as documentation for humans.
 *
 * Muted rules are omitted entirely — that is how the feedback loop's mute
 * decision reaches the model. On an exploration slot a muted rule is put back,
 * so it can still earn its way out of the mute.
 *
 * @param {Record<string, {title:string, severity:string, state:string}>} rules
 * @param {(ruleId:string)=>boolean} isExploring
 * @returns {{digest:string, included:string[], exploring:string[]}}
 */
export function buildRulesDigest(rules, isExploring = () => false) {
  const lines = [];
  const included = [];
  const exploring = [];

  for (const [id, rule] of Object.entries(rules)) {
    if (rule.state === 'muted') {
      if (!isExploring(id)) continue;
      exploring.push(id);
    }
    const note =
      rule.state === 'probation'
        ? ' (only report at blocker/major severity)'
        : '';
    lines.push(`${id} [${rule.severity}] ${rule.title}${note}`);
    included.push(id);
  }

  return { digest: lines.join('\n'), included, exploring };
}

/**
 * Rank candidate models best-first: structured-output support, then context.
 *
 * The whole pipeline depends on the reply parsing as strict JSON, and most free
 * models cannot guarantee that. Ranking on context alone puts a large-context
 * model that rambles ahead of a smaller one that answers in the required shape,
 * and the rambling one then wins the chain and returns nothing usable.
 *
 * @param {Array<{id:string, context:number, structured:boolean}>} models
 */
export function rankModels(models) {
  return [...models].sort(
    (a, b) =>
      Number(b.structured) - Number(a.structured) || b.context - a.context
  );
}

/**
 * Fetch the models that are currently free, best first.
 * @param {string} apiKey
 * @returns {Promise<Array<{id:string, context:number, structured:boolean}>>}
 */
export async function listFreeModels(apiKey) {
  const res = await fetch(`${BASE}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok)
    throw new Error(
      `GET /models -> ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  const { data } = await res.json();

  return rankModels(
    (data || [])
      .filter(m => typeof m.id === 'string' && m.id.endsWith(':free'))
      .map(m => ({
        id: m.id,
        context: Number(m.context_length) || 0,
        structured: (m.supported_parameters || []).includes(
          'structured_outputs'
        ),
      }))
  );
}

/**
 * OpenRouter rejects a `models` fallback array longer than this with a 400.
 * Every chain that reaches the API is clamped to it.
 */
export const MAX_FALLBACK_MODELS = 3;

/**
 * Choose the model chain to send.
 *
 * `preferred` wins where those models are actually available today; anything
 * still free is appended as a fallback so a retired model degrades into a
 * slightly worse review rather than a red workflow.
 *
 * @param {Array<{id:string, context:number, structured:boolean}>} available
 * @param {string[]} preferred
 * @param {number} limit
 */
export function chooseModels(
  available,
  preferred = [],
  limit = MAX_FALLBACK_MODELS
) {
  const byId = new Map(available.map(m => [m.id, m]));
  const chain = [];
  for (const id of preferred) {
    if (byId.has(id)) chain.push(byId.get(id));
  }
  for (const m of available) {
    if (chain.length >= limit) break;
    if (!chain.some(c => c.id === m.id)) chain.push(m);
  }
  return chain.slice(0, limit);
}

/**
 * One chat completion, with OpenRouter's built-in fallback chain.
 *
 * OpenRouter falls back through `models` on rate limits, downtime, context
 * errors and moderation, which covers exactly the failure modes free models
 * hit. Retries here are only for transport-level problems.
 *
 * @param {{apiKey:string, models:string[], system:string, user:string,
 *          maxTokens?:number, jsonMode?:boolean, retries?:number,
 *          referer?:string, title?:string}} opts
 * @returns {Promise<{text:string, model:string, usage:object|null}>}
 */
export async function complete(opts) {
  const {
    apiKey,
    models,
    system,
    user,
    maxTokens = 4000,
    jsonMode = false,
    retries = 2,
    referer = 'https://github.com',
    title = 'PR Review Agent',
  } = opts;

  const chain = models.slice(0, MAX_FALLBACK_MODELS);

  const body = {
    model: chain[0],
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  };
  if (chain.length > 1) body.models = chain;
  if (jsonMode) body.response_format = { type: 'json_object' };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          // OpenRouter uses these for attribution on its dashboard.
          'http-referer': referer,
          'x-title': title,
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new Error(
          `POST /chat/completions -> ${res.status}: ${text.slice(0, 400)}`
        );
        if (!retryable || attempt === retries) throw lastErr;
        const wait =
          Number(res.headers.get('retry-after')) * 1000 || 2 ** attempt * 4000;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      const json = JSON.parse(text);
      // OpenRouter can return a 200 whose body carries a provider error.
      if (json.error)
        throw new Error(
          `provider error: ${JSON.stringify(json.error).slice(0, 300)}`
        );
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        model: json.model || chain[0],
        usage: json.usage || null,
      };
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw lastErr;
      await new Promise(r => setTimeout(r, 2 ** attempt * 2000));
    }
  }
  throw lastErr;
}

/** Remaining free-tier allowance, for logging. Never throws. */
export async function keyStatus(apiKey) {
  try {
    const res = await fetch(`${BASE}/key`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    return data || null;
  } catch {
    return null;
  }
}
