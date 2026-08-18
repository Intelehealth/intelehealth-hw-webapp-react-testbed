/**
 * The rulebook is review-rules.md and nothing else.
 *
 * There is no generated companion file, no learned state, no sync step. Edit
 * the markdown, and the next review uses it. That is the whole contract.
 */

/** Severity ordering, most severe first. Used for sorting and for the floor. */
export const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2, nit: 3 };

export const SEVERITIES = Object.keys(SEVERITY_ORDER);

/**
 * Pull the rules out of review-rules.md.
 *
 * A rule is a bold lead-in of the form:
 *   **SEC-001 · blocker · Injection via unparameterised query.** Prose...
 *
 * Anything else in the file — headings, preamble, notes to humans — is ignored,
 * so the document stays readable as a document.
 *
 * @param {string} markdown
 * @returns {Array<{id:string, severity:string, title:string}>}
 */
export function parseRules(markdown) {
  const re = /\*\*([A-Z][A-Z0-9]*-\d+)\s*·\s*([a-z]+)\s*·\s*([^*]+?)\*\*/g;
  const rules = [];
  const seen = new Set();

  let m;
  while ((m = re.exec(markdown)) !== null) {
    const [, id, severity, rawTitle] = m;
    if (!SEVERITIES.includes(severity)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    rules.push({
      id,
      severity,
      title: rawTitle.trim().replace(/\.$/, ''),
    });
  }
  return rules;
}

/**
 * One line per rule, for the prompt.
 *
 * Deliberately compact: the diff is what deserves the context window, not a
 * restatement of the rulebook's prose.
 *
 * @param {Array<{id:string, severity:string, title:string}>} rules
 */
export function buildDigest(rules) {
  return rules.map(r => `${r.id} [${r.severity}] ${r.title}`).join('\n');
}
