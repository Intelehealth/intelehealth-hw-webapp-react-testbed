# Claude PR review agent

An automated pull request reviewer that applies a written rulebook and gets
quieter over time about the rules people keep dismissing.

## When it runs

- A PR **into `main` or `dev`** is opened, reopened, or marked ready for review.
  PRs targeting anything else are not reviewed.
- Someone adds the **`review-again`** label to such a PR. The label is removed
  again afterwards so it can be reapplied.
- Someone with write access comments **`/review`** on it.

Deliberately **not** on `synchronize`. Pushing follow-up commits to an open PR
does not re-review it, which keeps the free tier from being spent on
work-in-progress. The cost is real and worth stating plainly: a review goes
stale the moment the author pushes a fix, so a PR can carry a clean review of
code that no longer exists. Re-request it with the label or the comment when the
diff has moved enough to matter.

Two caveats on the comment trigger. GitHub runs `issue_comment` workflows from
the **default branch**, so `/review` only works once this workflow is merged to
`main` — the label and the open/reopen triggers work from a PR branch straight
away. And `/review` is restricted to `OWNER`/`MEMBER`/`COLLABORATOR`, because
without that gate any drive-by commenter could spend the day's request budget.

## How it works

Once triggered, a review is three steps:

1. **Prepare** — the workflow computes the diff against the merge base and
   writes it to `.claude-review/pr.diff`.
2. **Review** — `scripts/openrouter-review.mjs` sends the diff and a compact
   rules digest to a free model on OpenRouter and writes structured findings to
   `.claude-review/findings.json`.
3. **Post** — `scripts/post-review.mjs` validates those findings, gates them
   against the learned per-rule weights, maps them onto lines GitHub will
   accept, and posts one review.

Step 2 is the only provider-specific part. Anything that writes
`findings.json` in the schema below works — the shipped alternative is
`workflows/claude-pr-review.yml`, which uses `anthropics/claude-code-action@v1`
and can read the surrounding source rather than only the diff. Swapping
providers does not touch the rulebook, the gating, or the feedback loop.

The split between step 2 and step 3 is the whole design. Claude decides *what*
is wrong; the script decides *what gets said*. That keeps the comment cap, the
confidence thresholds, and the mute list as code rather than as polite requests
in a prompt, and it means every posted comment carries a machine-readable
marker tying it back to a rule.

## The feedback loop

Each comment ends with a hidden marker:

```html
<!-- claude-review rule=SEC-001 fid=k3f9q2m conf=0.85 score=0.6 sev=blocker -->
```

Weekly, `scripts/tune-rules.mjs` walks recent PRs, finds those markers, and
works out how humans actually responded:

| Signal | Outcome |
| --- | --- |
| 👎 reaction | rejected |
| 👍 reaction | accepted |
| Reply matching a dismissal phrase ("false positive", "by design", …) | rejected |
| Reply matching an agreement phrase ("good catch", "fixed", …) | accepted |
| The flagged code changed after the comment (comment went outdated) | accepted |
| PR closed with no response at all | ignored (weak negative) |
| PR still open with no response | not scored yet |

Each rule carries a Beta posterior over "does this rule produce comments people
act on". The prior is worth three observations centred on 0.7 — a hand-written
rule is presumed useful, but not strongly. The posterior mean is the rule's
**weight**.

A finding is posted when `confidence × weight` clears a per-severity gate:

| Severity | Gate |
| --- | --- |
| blocker | 0.30 |
| major | 0.36 |
| minor | 0.42 |
| nit | 0.50 |

Nits have to be more certain than blockers to earn a comment, which is the
right trade when reviewer attention is the scarce resource.

As evidence accumulates, rules change state:

- **active** — normal.
- **probation** — weight below 0.5 with at least 5 observations. Only blocker
  and major findings are posted.
- **muted** — weight below 0.3 with at least 8 observations. Silent.

Two things stop this from ratcheting one way forever:

- **Decay.** Observations lose half their weight every 90 days, so the rulebook
  reflects how a rule behaves now, not how it behaved before someone rewrote it.
- **Exploration.** A muted rule is still tried on roughly 10% of PRs — chosen by
  a deterministic hash of the rule ID and PR number, so re-runs on the same PR
  agree with each other. Those comments say they are a re-test, and they bypass
  the score gate (a muted rule's weight could never clear it, so without the
  bypass the mechanism would never fire). This is how a rule that was genuinely
  fixed earns its way back without anyone intervening.

Weights are recomputed from the full ledger on every run, never incremented in
place. The job is therefore idempotent, and a mis-scored outcome can be fixed by
editing `feedback-ledger.json` by hand and re-running.

The tuning job opens a PR rather than pushing. Somebody always sees which rules
are about to go quiet, and why.

## Files

| Path | What it is |
| --- | --- |
| `review-rules.md` | The rulebook. Human-written. Edit this. |
| `rules.json` | Learned state: weight, status, and evidence per rule. Machine-written. |
| `feedback-ledger.json` | Every scored comment. The source of truth for weights. |
| `findings.schema.json` | Contract between the model and the posting script. |
| `scripts/openrouter-review.mjs` | Produces findings via OpenRouter free models. |
| `scripts/post-review.mjs` | Gates findings and posts the review. |
| `scripts/tune-rules.mjs` | The learning loop. |
| `scripts/sync-rules.mjs` | Keeps the markdown and the JSON in agreement. |
| `scripts/lib/scoring.mjs` | Pure scoring logic. All of it unit tested. |
| `scripts/lib/github.mjs` | Dependency-free GitHub REST/GraphQL client. |
| `scripts/lib/openrouter.mjs` | Model discovery, diff chunking, JSON recovery. |

The scripts have no npm dependencies. They run on the Node 20 already present
on `ubuntu-latest`, so there is no install step, no lockfile to maintain, and no
supply-chain surface on a workflow that runs against every PR.

## Setup

1. **Create an OpenRouter API key** at
   [openrouter.ai/keys](https://openrouter.ai/keys).

2. **Set the privacy settings before you use it.** In OpenRouter's privacy
   settings there are separate controls for paid and free models governing
   whether requests may be routed to providers that train on your data. Free
   models are free largely because that routing is permitted. Turn training off
   for free models. OpenRouter itself does not store prompts unless you opt in
   to logging, but its policy does not bind the upstream provider.

   This matters more here than in most codebases. The reviewer sends diff
   content, and diffs of clinical code contain table names, field names and
   sometimes fixture data. Decide deliberately what may leave your
   infrastructure before switching this on. If the answer is "nothing", use the
   Claude workflow with an API key instead — paid API traffic is not trained on.

3. **Add the key** as a repository or organisation secret named
   `OPENROUTER_API_KEY` (Settings → Secrets and variables → Actions).

4. **Optionally pin your preferred models** as a repository *variable* — not a
   secret — named `OPENROUTER_MODELS`, comma-separated, best first:

   ```
   deepseek/deepseek-chat:free,qwen/qwen-2.5-coder-32b-instruct:free
   ```

   Leave it unset and the script picks the largest-context free models
   available at that moment. Free models are retired often, so this is a
   preference, not a pin: any listed model that is no longer free is skipped
   rather than causing a failure.

5. **Copy `.github/workflows/` and `.github/review/`** into your repository. If
   you are using OpenRouter, delete `workflows/claude-pr-review.yml` — leaving
   both means every PR gets reviewed twice.

6. **Consider putting $10 of credit on the OpenRouter account.** The free tier
   allows 20 requests per minute and 50 per day; a one-off $10 top-up raises the
   daily cap to 1,000 and is not consumed by `:free` models. At 4 requests per
   PR, 50/day is roughly a dozen pull requests before the reviewer goes quiet
   for the rest of the day. On a team your size that ceiling will bite.

7. **Open a test PR** with something obviously wrong in it — a string-concatenated
   SQL query is a good probe — and confirm the review appears.

`rules.json` ships seeded and ready; nothing else needs configuring.

### Free-tier budget

Each batch of files is one OpenRouter request. `MAX_REQUESTS` in the workflow
caps how many a single PR may spend, defaulting to 4. Files that do not fit are
named in the summary comment rather than silently dropped, so you can always
tell the difference between "reviewed and clean" and "never looked at".

Raise `MAX_REQUESTS` if you have topped up and want deeper coverage on large
PRs; lower it to 2 if you are staying on 50/day.

## Day-to-day

**React to the comments.** 👍 and 👎 are the highest-quality signal the loop
gets, and they are the only one that is unambiguous. Everything else is
inference. Ask the team to spend the two seconds.

**Read the weekly tuning PR** before merging it. It lists which rules moved,
which are muted, and how much evidence sits behind each move.

**Adding a rule:** add it to `review-rules.md`, then run

```bash
node .github/review/scripts/sync-rules.mjs --write
```

The `validate` job fails any PR where the two files disagree, so they cannot
drift apart.

**Removing a rule:** delete it from `review-rules.md` and run the same command.
Its history moves into the `retired` block rather than being lost.

**Tuning by hand:** the knobs are `defaults.maxCommentsPerPR` and
`defaults.explorationPercent` in `rules.json`, and `SEVERITY_GATES` in
`scripts/lib/scoring.mjs`.

**Watch `GEN-000`.** That is the bucket for real problems no rule covers. When
the same kind of `GEN-000` finding keeps getting accepted, that is a rule asking
to be written.

## Running it locally

```bash
# See what the loop would do without writing anything
GITHUB_TOKEN=$(gh auth token) REPO=owner/name \
  node .github/review/scripts/tune-rules.mjs --days 60 --dry-run

# Tests
node --test .github/review/scripts/test/*.test.mjs
```

## Deliberate limits

**It never blocks a merge.** The review posts as `COMMENT`, and
`post-review.mjs` exits zero even when it fails. Set
`REQUEST_CHANGES_ON_BLOCKER: "1"` in the workflow if you want blockers to
request changes — but note that a review from `GITHUB_TOKEN` does not satisfy a
branch protection "required approvals" rule either way.

**Fork PRs on public repositories are skipped.** GitHub withholds secrets from
those runs, so the review step cannot authenticate. This is a GitHub security
boundary, not something to work around.

**Large diffs are truncated** at 400 KB, and the summary says so when it
happens. Lockfiles, snapshots, minified output, and build directories are
excluded from the diff before that limit applies.

**Feedback is sparse and noisy.** "Ignored" is weak evidence — someone may have
agreed and simply not clicked anything. That is why it counts for 40% of a
rejection, why muting needs eight observations, and why decay and exploration
exist. Treat the weights as a way to keep the bot quiet about things your team
demonstrably does not care about, not as a measure of whether a rule is correct.

**The OpenRouter reviewer only sees the diff.** It cannot open the surrounding
file, grep for the caller, or check whether a guard exists elsewhere in the
repo, because a chat completion is one shot with no tools. Rules that need
repo-wide context — SEC-002 (is this route actually behind a guard?), DATA-005
(does an index exist?), TS-005 (is there already a helper?) — will miss more
often than the rest. Expect the feedback loop to push those toward probation,
and read that as a limitation of the provider rather than of the rule. The
Claude workflow, which has `Read` and `Grep`, does noticeably better on exactly
those.

**Free models are weaker at line numbers.** Counting new-file line numbers out
of a diff hunk is genuinely hard for a small model. `post-review.mjs` checks
every line against the diff and demotes anything out of range into the summary,
so a miscount degrades into a less convenient comment rather than a failed
review — but expect a share of findings to land in the summary rather than
inline.

**It is not reinforcement learning in the training sense.** No model weights are
updated. It is a bandit-flavoured control loop over which rules are allowed to
speak. That is the version that works at the volume of feedback a real team
produces; a fine-tuning pipeline would need orders of magnitude more labelled
data than a repository generates.
