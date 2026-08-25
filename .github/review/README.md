# PR review agent

An automated reviewer that applies a written rulebook to pull requests and blocks the
merge while it has findings against one.

**Purely rule-based.** One file — `review-rules.md` — is the entire configuration. No
generated companion file, no learned weights, no sync step.

Setup, known limits and prioritised improvements are kept in the maintainer handoff,
outside this repo. Ask the owner (**@Zeeshan-IH**) if you need it.

## When it runs

A pull request is reviewed automatically when it is opened. Pushing to it does not
re-review — that only marks the result stale; add the **`review-again`** label for a
fresh one.

The check still reports on every `pull_request` event, because it is a required check and
one that never reports leaves a PR unmergeable forever:

| Event                              | Check                         | Requests |
| ---------------------------------- | ----------------------------- | -------- |
| PR opened / reopened / ready       | 🔴 on findings, 🟢 when clean | ≤ 6      |
| Push to an open PR                 | 🔴 review is stale            | 0        |
| `review-again` label               | 🔴 on findings, 🟢 when clean | ≤ 6      |
| Draft, or a PR into another branch | 🟢 not gated                  | 0        |

A push always sends the check back to red: a review that passed against code you have
since changed must not keep the merge unblocked.

## How it works

1. **Prepare** — the workflow diffs against the merge base into `.claude-review/pr.diff`,
   excluding lockfiles, snapshots and build output.
2. **Review** — `scripts/review.mjs` sends the diff plus a one-line-per-rule digest of
   `review-rules.md` to an OpenRouter model, and writes `.claude-review/findings.json`.
3. **Post** — `scripts/post-review.mjs` validates the findings, applies the gate, maps
   them onto lines GitHub will accept, posts one review, and sets the exit code.

The split between 2 and 3 is the design: **the model decides what is wrong, the script
decides what gets said.** The confidence floor and the comment cap are code, not requests
in a prompt.

Step 2 is the only provider-specific part. Anything that writes `findings.json` in the
documented schema works — swapping providers touches nothing else.

## Rule categories

Every rule ID is `PREFIX-NNN`, where the prefix is its section in `review-rules.md`:

| Prefix  | Covers                                             |
| ------- | -------------------------------------------------- |
| `SEC`   | Security                                           |
| `PHI`   | Patient and personal data                          |
| `DATA`  | Databases, ORMs, migrations                        |
| `API`   | Interfaces and contracts                           |
| `ASYNC` | Async, errors, and control flow                    |
| `RT`    | Realtime: Socket.IO and WebRTC                     |
| `FE`    | Frontend: React, Angular, Vue, Ionic, React Native |
| `TS`    | TypeScript and code health                         |
| `TEST`  | Tests                                              |
| `OPS`   | Configuration, deployment, observability           |
| `STD`   | Project standards from the README                  |
| `GEN`   | Uncategorised                                      |

`PHI` is the healthcare-specific one — Protected Health Information, though the section
also covers ordinary personal data like phone numbers and addresses.

**These are not fixed.** The parser requires only `^[A-Z][A-Z0-9]*-\d+$`. To add a
category, write a `## PERF — Performance` heading and its rules. Nothing else to run.

## Adding a rule

Edit `review-rules.md`. One bold lead-in plus prose:

```markdown
**FE-008 · minor · Inline styles on a new component.** Style via the project's
CSS modules instead, so theming stays in one place.
```

Severity is `blocker | major | minor | nit` and decides what survives the comment cap and
what the merge gate blocks on. A typo in the severity silently drops the rule — the tests
assert the shipped rulebook parses, so run them after editing.

## Files

| Path                         | What it is                                             |
| ---------------------------- | ------------------------------------------------------ |
| `review-rules.md`            | The rulebook. The only file you edit.                  |
| `scripts/review.mjs`         | Produces findings via OpenRouter.                      |
| `scripts/post-review.mjs`    | Gates findings, posts the review, sets the exit code.  |
| `scripts/lib/rules.mjs`      | Parses the rulebook.                                   |
| `scripts/lib/gate.mjs`       | Confidence floor, severity floor, dedupe, comment cap. |
| `scripts/lib/openrouter.mjs` | Model discovery, diff chunking, JSON recovery.         |
| `scripts/lib/github.mjs`     | Dependency-free GitHub REST client.                    |
| `findings.schema.json`       | Contract between the model and the posting script.     |

No npm dependencies — they run on the Node 20 already present on `ubuntu-latest`.

## Running the tests

```bash
node --test .github/review/scripts/test/*.test.mjs
```

## Deliberate limits

**An unread diff never reads as clean.** An empty findings array means either "the code is
fine" or "the model gave up", and those are indistinguishable to branch protection. The
review records whether it actually engaged, and an incomplete review fails the check with
a different message from "you have findings to fix". The cost is that a provider outage
holds merges until someone re-requests a review — deliberate, because a silent pass
leaves no trace of having been skipped.

**It only sees the diff.** One chat completion per batch, no tools, no filesystem. It
cannot open a config file or grep for a caller, so rules needing repo context miss more
often. This is the biggest constraint — see the handoff for what would fix it.

**Large diffs cap out** at 6 requests × 40,000 chars. Beyond that, files are dropped and
the review reports inconclusive. Raise `MAX_REQUESTS` or split the PR.

**Fork PRs are skipped** — GitHub withholds secrets from those runs.

**There is no `/review` comment trigger.** A comment handler can only request a review by
applying the label, and GitHub does not start workflow runs from events created by
`GITHUB_TOKEN` — so the label lands and nothing happens. Enabling it needs a PAT or GitHub
App token; the label needs neither.
