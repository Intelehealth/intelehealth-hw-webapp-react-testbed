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
 * Is this a unit-test file rather than application code?
 *
 * Test bodies are the bulk of a typical PR here and the least rewarding thing
 * to spend input tokens on: a table-driven suite is hundreds of near-identical
 * lines, which is also what sends a model into a repetition loop. Their names
 * still travel with the prompt, so TEST-001/002 ("fix with no regression test")
 * stay answerable without paying for the bodies.
 *
 * @param {string} path
 */
export function isTestFile(path) {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)__(tests|mocks)__\//.test(path) ||
    /(^|\/)tests?\//.test(path)
  );
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
  return salvageJson(s.slice(start));
}

/*
 * Close a reply that ran out of output budget before it closed its brackets.
 *
 * Under `json_schema` the decoder is grammar-constrained, but JSON permits
 * unlimited whitespace between tokens — so an emitted `{"findings": []` may be
 * followed by thousands of newlines until max_tokens, legally, and the object
 * never closes. Observed repeatedly on one file in PR #309: 8000 completion
 * tokens, 255k chars, no `}`. A penalty only shifts the odds of a legal token;
 * it cannot forbid it, which is why this must be recoverable rather than merely
 * discouraged.
 *
 * The bytes the model did emit are its real answer. Drop the whitespace flood,
 * shut any string and bracket still open, and parse what is left.
 */
export function salvageJson(text) {
  const stack = [];
  let out = '';
  let inString = false;
  let escaped = false;

  for (const c of text) {
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (/\s/.test(c)) continue;
    out += c;
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
  }

  if (inString) out += '"';
  // A dangling `,` or `:` is the start of a value that never arrived.
  out = out.replace(/[,:]+$/, '');
  while (stack.length) out += stack.pop();

  try {
    const parsed = JSON.parse(out);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Rank candidate models best-first: structured-output support, then context.
 *
 * Structured output first, then non-reasoning, then context. The pipeline needs
 * strict JSON in a bounded reply; a reasoning model can spend the whole output
 * budget thinking and return a truncated fragment. Ranking on context alone puts a large-context
 * model that rambles ahead of a smaller one that answers in the required shape,
 * and the rambling one then wins the chain and returns nothing usable.
 *
 * @param {Array<{id:string, context:number, structured:boolean}>} models
 */
export function rankModels(models) {
  return [...models].sort(
    (a, b) =>
      Number(b.structured) - Number(a.structured) ||
      Number(a.reasoning) - Number(b.reasoning) ||
      b.context - a.context
  );
}

/**
 * Fetch every model OpenRouter offers, best first, each with a `free` flag.
 * Fetching is not the spending decision — chooseModels is.
 *
 * @param {string} apiKey
 * @returns {Promise<Array<{id:string, context:number, structured:boolean, free:boolean}>>}
 */
export async function listModels(apiKey) {
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
      .filter(m => typeof m.id === 'string')
      .map(m => ({
        id: m.id,
        context: Number(m.context_length) || 0,
        structured: (m.supported_parameters || []).includes(
          'structured_outputs'
        ),
        // Reasoning models spend the output budget thinking before replying, so
        // they need far more headroom for the same answer. Rank them below an
        // equally capable non-reasoning model rather than excluding them.
        reasoning: (m.supported_parameters || []).includes('reasoning'),
        free:
          m.id.endsWith(':free') ||
          (Number(m.pricing?.prompt) === 0 &&
            Number(m.pricing?.completion) === 0),
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
 * `preferred` wins whether the model is free or paid — naming a paid model is
 * the explicit decision to spend. Auto-filled fallbacks are free only, so a
 * repository that pins nothing can never start billing by itself.
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
  /*
   * Only free models auto-fill. Paid ones must be named.
   *
   * An auto-filled model must not cost the chain its JSON schema. `jsonMode` is
   * `chain.every(m => m.structured)`, so one model without structured outputs
   * disables the schema for every model ahead of it — including a paid primary
   * that was named precisely to get it. The free catalogue churns weekly, so
   * without this the chain silently loses schema enforcement the week an
   * unlucky model happens to rank highest.
   */
  const namedAreStructured =
    chain.length > 0 && chain.every(m => m.structured);
  for (const m of available.filter(m => m.free !== false)) {
    if (chain.length >= limit) break;
    if (namedAreStructured && !m.structured) continue;
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
 *          maxTokens?:number, jsonMode?:boolean, schema?:object|null,
 *          disableReasoning?:boolean, retries?:number,
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
    schema = null,
    disableReasoning = true,
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
    frequency_penalty: 0.4,
    /*
     * Cut the whitespace runaway at the provider instead of paying for it to
     * reach max_tokens. Pretty-printed JSON never contains a blank line, let
     * alone four, so this cannot truncate a healthy reply — and salvageJson
     * closes whatever the stop leaves open.
     */
    stop: ['\n\n\n\n'],
    // Ask for OpenRouter's own accounting in every reply, rather than relying
    // on the provider including it by default.
    usage: { include: true },
  };
  if (chain.length > 1) body.models = chain;

  /*
   * One model id is served by several providers at different prices, and the
   * default routing balances price against uptime. Two identical runs came
   * back ~70% apart per token because of it. Input tokens are ~99% of this
   * workload, so the provider's rate is effectively the whole bill.
   */
  body.provider = { sort: 'price' };
  /*
   * `json_object` guarantees syntactically valid JSON and nothing else — the
   * model is free to name the keys whatever it likes. Observed in production:
   * a reply keyed `rule_id` instead of `ruleId` parsed cleanly, then every
   * finding was thrown away as "invented rule id undefined". `json_schema`
   * with strict:true is what actually pins the field names down.
   */
  if (schema && jsonMode) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'review_findings', strict: true, schema },
    };
  } else if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  /*
   * Reading a diff and emitting findings against a fixed rulebook is
   * pattern-matching, not multi-step deduction — there is nothing here for a
   * chain of thought to work out. Left on, a reasoning model spends the whole
   * output budget thinking and returns a truncated fragment: deepseek-v4-pro
   * burned 4000 of 4001 completion tokens and replied "No diff was provided
   * for review." OpenRouter normalises this across providers and ignores it on
   * models that cannot reason, so it is safe to send unconditionally.
   */
  if (disableReasoning) body.reasoning = { enabled: false };

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
        // A 401/402/400 will never succeed on a retry, and retrying it burns
        // requests against a daily cap. Mark it so the catch below rethrows
        // instead of sleeping and trying the same doomed request again.
        if (!retryable) lastErr.fatal = true;
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
        // The exact body sent, for the debug artifact. The API key travels in
        // a header, never in the body, so this is safe to persist.
        request: body,
      };
    } catch (err) {
      lastErr = err;
      lastErr.request = body;
      // The non-retryable throw above lands here too, so honour it — otherwise
      // every 4xx is retried the full count before failing identically.
      if (err.fatal || attempt === retries) throw lastErr;
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
