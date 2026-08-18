# PR Review Rulebook

This is the instruction set the automated reviewer applies to every pull request,
and it is the **only** configuration it has. Edit this file and the next review
uses it — there is no generated companion file and no sync step to run.

Treat it as a living document: when the reviewer misses something a human caught,
add a rule; when a rule keeps firing on non-issues, reword it or delete it.

## How the reviewer uses this file

Each rule below is sent to the model as one compact line — ID, severity, title.
The prose under each rule is for you, not the model, so write it for whoever
edits this file next.

Every finding must cite one of these rule IDs; anything citing an ID that is not
here is discarded before it reaches the pull request.

Severities:

- **blocker** — would cause data loss, a security hole, a patient-safety issue,
  or a production outage. Should not merge.
- **major** — a real bug or a design decision that will be expensive to undo.
- **minor** — a genuine issue with a bounded cost.
- **nit** — worth mentioning, never worth blocking on.

The bot is instructed to stay silent below 60% confidence, and to skip anything
a linter or formatter already enforces. Reviewer attention is the scarce
resource being protected here, not model tokens.

## Scope

Review only lines the PR adds or modifies. Reading surrounding code for context
is expected; reporting pre-existing issues in untouched code is not.

**These rules describe the application.** They apply to `src/**` — the React app
and its tests. They do **not** apply to build and CI tooling: `.github/**`,
`*.config.ts`, and scripts that run in Actions rather than in the browser.

That distinction is not a loophole, it is what keeps the rules meaningful. A CI
script's `console.log` is its only output channel, not stray debugging. A Node
script has no `.component.ts` to be named after and no HTTP wrapper to prefer
over `fetch`. The 200-line target describes a React component, not a build
script. Applying `STD` to tooling would produce findings on every workflow file
in perpetuity, and a reviewer that cries wolf gets ignored — taking the findings
that mattered with it.

`SEC` and `PHI` are the exception: a committed credential or a leaked patient
identifier is a defect wherever it appears, tooling included.

---

## SEC — Security

**SEC-001 · blocker · Injection via unparameterised query.** String
concatenation or template literals building SQL, or user input reaching a Mongo
query operator position. Sequelize `replacements`/`bind`, or an explicit
parameterised query, is required. In Mongoose, reject any path where a
request-supplied object can land where a query operator is expected — that is
how `$ne`/`$gt` operator injection gets in.

**SEC-002 · blocker · Missing authentication or authorisation on a new route.**
A new Express route, NestJS controller method, or Socket.IO event handler that
does not sit behind the project's auth guard/middleware, or that authenticates
the caller but never checks that the caller is allowed to touch _this_ record.
Broken object-level authorisation is the most common real vulnerability in this
kind of codebase; flag it explicitly rather than assuming a guard exists further
up.

**SEC-003 · blocker · Secret, key, or credential committed.** API keys, tokens,
private keys, connection strings with embedded passwords, or `.env` files in the
diff. Applies to test fixtures too.

**SEC-004 · major · Unvalidated request input.** A handler reading `req.body`,
`req.query`, or `req.params` and using it without schema validation
(`class-validator` DTO, Joi, Zod, or the project's equivalent). Type assertions
in TypeScript are not validation — `as CreateUserDto` proves nothing at runtime.

**SEC-005 · major · Mass assignment.** Spreading a request body straight into a
model create/update (`Model.create({ ...req.body })`, `Object.assign(user,
req.body)`). Fields like `role`, `isAdmin`, `verified`, or `tenantId` become
attacker-controlled.

**SEC-006 · major · Unsafe rendering or DOM injection.** `dangerouslySetInnerHTML`,
Angular `bypassSecurityTrustHtml`, Vue `v-html`, or direct `innerHTML` assignment
with data that is not provably static or sanitised.

**SEC-007 · major · Weak or hand-rolled cryptography.** MD5/SHA-1 for passwords,
`Math.random()` for tokens or IDs, custom encryption, or JWTs verified without
checking the algorithm and expiry.

**SEC-008 · major · Overly permissive CORS or cookie flags.** `origin: '*'`
alongside credentials, or session cookies missing `httpOnly`, `secure`, or
`sameSite`.

**SEC-009 · minor · Dependency added with no obvious need.** A new runtime
dependency in `package.json` that duplicates something already present or that
is doing work a few lines of code would do. Note it; do not block.

---

## PHI — Patient and personal data

These matter more here than in a typical codebase. Apply them to anything that
looks like patient identity, clinical notes, visit records, prescriptions,
diagnoses, phone numbers, or location.

**PHI-001 · blocker · Patient-identifying data in logs.** `console.log`,
logger calls, or error messages that include a patient name, identifier,
phone number, address, or clinical detail. Log an opaque ID instead.

**PHI-002 · blocker · Patient data sent to a third party.** New calls to an
analytics, monitoring, crash-reporting, or AI service whose payload could carry
PHI. Includes Sentry `extra`/`context` and analytics event properties.

**PHI-003 · major · Patient data in client-side storage.** `localStorage`,
`sessionStorage`, IndexedDB, or `AsyncStorage` holding clinical or identifying
data without a clear, deliberate reason and a cleanup path on logout.

**PHI-004 · major · Over-broad response payload.** An endpoint returning a whole
patient or user document where the caller needs a few fields. Call out the
specific fields that should not be crossing the wire.

**PHI-005 · minor · Missing audit trail on a sensitive action.** Create, update,
export, or delete of clinical records without a corresponding audit log entry,
where the codebase has an audit mechanism.

---

## DATA — Databases, ORMs, migrations

**DATA-001 · blocker · Destructive or irreversible migration.** A migration that
drops a column or table, or changes a type in a way that loses data, without a
documented backfill and rollback path. Also flag migrations with no `down`.

**DATA-002 · blocker · Multi-step write with no transaction.** Two or more
related writes that must succeed or fail together, issued without a Sequelize
transaction or a Mongo session. Partial writes here mean corrupted clinical
records.

**DATA-003 · major · N+1 query.** A query inside a loop or `.map()` over a
result set. In Sequelize, prefer `include`; in Mongoose, prefer `populate` or a
single `$in` query.

**DATA-004 · major · Unbounded query.** `findAll` / `find({})` with no `limit`,
no pagination, and no obvious bound on row count. It works on a dev database and
falls over on a real one.

**DATA-005 · major · New query pattern with no supporting index.** A filter or
sort on fields that are unlikely to be indexed, with no accompanying migration
or schema index. Say which index you would add.

**DATA-006 · minor · Schema change without a corresponding migration.** A model
or entity definition changed with nothing in the migrations directory.

**DATA-007 · minor · Connection or session not released.** A transaction,
session, or connection acquired without a `finally` that releases it on the
error path.

---

## API — Interfaces and contracts

**API-001 · major · Breaking change to a published contract.** A removed or
renamed field, a changed type, a narrowed enum, or a newly required request
field on an endpoint or event that clients already use — with no versioning and
no deprecation path. Mobile clients in particular cannot be upgraded in lockstep.

**API-002 · major · Wrong or misleading status codes.** Errors returned as
`200`, validation failures as `500`, or a `catch` that swallows everything into
one generic status.

**API-003 · minor · Inconsistent response shape.** A new endpoint whose success
or error envelope differs from the pattern the rest of the service uses.

**API-004 · minor · Undocumented endpoint.** A new public route with no Swagger/
OpenAPI decorator or doc entry, in a service that otherwise documents its routes.

---

## ASYNC — Async, errors, and control flow

**ASYNC-001 · blocker · Unhandled promise rejection path.** An `async` function
called without `await` or `.catch()` where a rejection would be silently lost, or
an `async` callback passed to an API that ignores the returned promise
(`setInterval`, `forEach`, Express handlers without an error wrapper).

**ASYNC-002 · major · Swallowed error.** `catch {}`, `catch (e) { console.log(e) }`
with no rethrow or recovery, or a catch that returns a success value. If the
error is genuinely expected, that reasoning belongs in a comment.

**ASYNC-003 · major · Awaiting in a loop where the work is independent.**
Sequential `await` inside a `for` loop over items with no dependency between
iterations. Use `Promise.all` — bounded with a concurrency limit if the list can
be large.

**ASYNC-004 · major · Race condition on shared state.** Two async paths reading
and writing the same in-memory map, cache entry, or record with no locking,
compare-and-set, or atomic update.

**ASYNC-005 · minor · External call with no timeout or retry policy.** `fetch`,
`axios`, or a database call to a remote service with no timeout, in code where a
hang would block a request path.

---

## RT — Realtime: Socket.IO and WebRTC

**RT-001 · blocker · Socket event handler without authentication.** A
`socket.on(...)` handler that trusts a client-supplied user or room ID instead of
the identity established at connection time.

**RT-002 · major · Listener registered without cleanup.** `socket.on`,
`addEventListener`, `RTCPeerConnection` event handlers, or subscriptions added
with no matching removal on disconnect, unmount, or teardown. This is the usual
source of a slow memory leak and of handlers firing twice.

**RT-003 · major · Peer connection or media track not closed.** An
`RTCPeerConnection`, `MediaStream`, or track opened without a path that closes
it and stops the tracks — including on the error and early-return paths. On
mobile this leaves the camera light on.

**RT-004 · major · Broadcast to a room without an authorisation check.**
Emitting to a room derived from user input, or joining a room without verifying
the user belongs to it.

**RT-005 · minor · No reconnection or degraded-network handling.** New realtime
code that assumes a stable connection. Relevant for low-bandwidth field use.

---

## FE — Frontend: React, Angular, Vue, Ionic, React Native

**FE-001 · major · Effect with a wrong or missing dependency array.** A
`useEffect`/`useCallback`/`useMemo` whose dependencies do not match what it
reads, causing a stale closure or an infinite render loop.

**FE-002 · major · State update after unmount.** An async result written to
state with no cancellation, `AbortController`, or mounted guard.

**FE-003 · major · Subscription without teardown.** An RxJS subscription in
Angular with no `takeUntil`/`async` pipe, a Vue watcher never stopped, or a
React effect that returns no cleanup where it should.

**FE-004 · minor · Expensive work on every render.** Non-trivial computation,
object/array literals, or new function identities passed as props into memoised
children, causing avoidable re-renders.

**FE-005 · minor · Unkeyed or index-keyed list.** `key={index}` on a list that
can reorder, insert, or delete.

**FE-006 · minor · Accessibility gap on a new interactive element.** A clickable
`div`, a form control with no label, or an icon-only button with no accessible
name.

**FE-007 · minor · User-facing string hardcoded.** New copy inserted directly
rather than through the project's i18n mechanism, in a codebase that has one.

---

## TS — TypeScript and code health

**TS-001 · major · `any` or a type assertion hiding a real mismatch.** `any`,
`as unknown as X`, or a non-null assertion `!` used to silence the compiler
rather than because the invariant is genuinely known. Say what the correct type
is.

**TS-002 · major · Missing null/undefined handling.** A value that can be
`undefined` — an optional field, an array `find`, an env var, a `JSON.parse`
result — used without a check.

**TS-003 · minor · `@ts-ignore` / `eslint-disable` with no justification.**
Suppressions are fine when explained; unexplained ones accumulate.

**TS-004 · minor · Dead or unreachable code.** Commented-out blocks, unused
exports, or branches that cannot be taken, introduced by this PR.

**TS-005 · minor · Duplicated logic.** The same non-trivial logic added in a
second place where an existing helper would do, or where a helper is now
warranted.

---

## TEST — Tests

**TEST-001 · major · Bug fix with no regression test.** A PR that fixes
described broken behaviour without a test that would have caught it.

**TEST-002 · minor · New business logic with no test coverage.** A new service
method, reducer, or non-trivial pure function with no accompanying test, in a
repo that has a test suite.

**TEST-003 · minor · Flaky test pattern.** A test depending on wall-clock time,
network access, a fixed sleep, or execution order.

**TEST-004 · minor · Assertion that cannot fail.** `expect(true).toBe(true)`,
a snapshot committed without review, or a test with no assertion at all.

---

## OPS — Configuration, deployment, observability

**OPS-001 · major · Configuration hardcoded.** A URL, timeout, feature flag,
region, or limit written inline where the project uses config or environment
variables. Especially anything that differs between environments.

**OPS-002 · major · New env var with no default, no validation, and no docs.**
It will work locally and crash on deploy.

**OPS-003 · minor · Missing observability on a new critical path.** A new
integration, job, or payment/clinical workflow with no logging or metric at its
failure points.

**OPS-004 · minor · Backwards-incompatible change with no deploy ordering
note.** A change that requires the migration, the API, and the client to ship in
a particular order, with nothing in the PR description saying so.

**OPS-005 · major · Automated safety net removed or weakened.** A CI workflow,
test, coverage threshold, lint rule, or type check deleted, disabled, or
loosened, without the PR saying what replaces it. Includes skipping tests
(`.skip`, `xit`), lowering a coverage floor, adding a broad `eslint-disable` at
file scope, and removing a required status check. Say which protection is being
given up and what now catches that class of problem instead. A deliberate
removal is fine; an unexplained one is how a repo quietly loses its guardrails.

---

## STD — Project standards

These come from the conventions documented in the repository README. They are
house style rather than defects, so most sit at `minor` — but they are the rules
that keep a codebase readable as it grows, and a reviewer that ignores them
leaves the whole category to chance.

**STD-001 · minor · Constant defined outside a constants file.** A literal that
is configuration rather than a one-off — an endpoint path, a storage key, a
timeout, a limit, a feature-flag name, a route, an enum-like set of strings —
declared inline in a component, hook, or service. Move it to the module's
`*.constant.ts` (e.g. `auth.constant.ts`, `api.constant.ts`) and import it.
Repeating the same literal in two places is the clearest signal it belongs there.

**STD-002 · minor · Constant not named in PASCAL_SNAKE_CASE.** Exported
constants are upper-case words joined by underscores: `MAX_RETRY_COUNT`,
`AUTH_TOKEN_KEY`, `DEFAULT_PAGE_SIZE`. Not `maxRetryCount`, not `MaxRetryCount`,
not `MAXRETRYCOUNT`. The name must also say what the value _is_ — `TIMEOUT_MS`
rather than `TIMEOUT`, `PATIENT_LIST_ENDPOINT` rather than `URL2`.

**STD-003 · minor · Uninformative identifier.** A variable, parameter, function,
or type whose name does not say what it holds or does: `data`, `res`, `temp`,
`val`, `arr`, `obj`, `flag`, `x`, `handleClick2`, or a name that describes the
type rather than the meaning (`stringArray` instead of `visitIds`). Loop indices
and idiomatic short names in a two-line scope are fine. Say what the value means
in this domain, not what shape it has.

**STD-004 · nit · Single-line comment where a block comment belongs.** Code
comments use the multi-line form:

```ts
/**
 * Explains why, not what.
 */
```

Not `// like this`. Applies to comments explaining code; `// eslint-disable`
directives, `// @ts-expect-error` and similar tooling pragmas are not comments in
this sense and stay as they are.

**STD-005 · minor · File naming convention not followed.** New files use the
suffix for their kind: `.component.ts`, `.service.ts`, `.hook.ts`, `.types.ts`,
`.reducer.ts`, `.util.ts`, `.constant.ts`, `.test.ts`. A service named
`authHelpers.ts` or a hook named `useAuth.ts` should be `auth.service.ts` and
`auth.hook.ts`.

**STD-006 · minor · Web API used directly instead of the project's wrapper.**
`localStorage` / `sessionStorage`, `fetch` / `XMLHttpRequest`, `document.cookie`,
IndexedDB, `WebSocket`, the File API, Geolocation, and the Notification API all
have project utilities or services. Call those instead — the wrappers carry the
auth, error handling, and cleanup that direct calls skip. Name the utility that
should have been used.

**STD-007 · nit · File is growing past the size limit.** The project targets a
maximum of 200 lines per file, preferably 150–180, with one responsibility each.
Flag a file this PR pushes well beyond that, and say which responsibility should
move out.

**STD-008 · major · Console statement left in the code.** No `console.log` ships.
Temporary logging for a genuinely hard bug on `dev` is allowed only when it was
agreed in advance, and it comes out before the PR is reviewed — so by the time
the reviewer sees it, there should be none.

Flag every one, including the escapes a linter cannot catch:

- a `console.log` behind `// eslint-disable-next-line no-restricted-syntax`
- `console.debug`, `console.info`, `console.trace`, `console.table`, or
  `console.dir` — the ESLint rule here only matches `console.log`, so these pass
  lint and still ship
- a `console.log` reached through an alias or a wrapper written to dodge the rule
- logging left behind a `if (import.meta.env.DEV)` guard, unless it is deliberate
  instrumentation the PR description explains

`console.warn` and `console.error` are permitted for real error paths. Test
files are exempt — ESLint already turns the rule off there.

If a statement genuinely must stay, the PR description has to say why and who
agreed to it; absent that, treat it as debugging that was forgotten. In this
codebase a stray `console.log` on a patient object is also a `PHI-001` — cite
both when the logged value could carry patient data.

**STD-009 · major · Coverage bypassed with an ignore pragma.** A new
`/* v8 ignore next */`, `/* c8 ignore next */`, `/* c8 ignore start|stop */`,
`/* istanbul ignore next|else|file */`, or a per-file `coverage` exclusion added
to `vitest.config.ts`. The project requires 100% branches, functions, lines and
statements — a pragma does not meet that bar, it removes the code from the
measurement, so the number stays at 100% while the code goes untested.

Treat the pragma as the signal that the code is hard to test, and say which of
these it is:

- **Unreachable by construction** — a `default:` on an exhaustive switch, an
  `if (!x) throw` after the type system already guarantees `x`. The honest fix
  is usually to delete the branch, not to hide it.
- **Hard to reach because of a seam** — an error path behind a real `fetch`, a
  timer, a browser API. Inject the dependency or use the project's wrapper, and
  the branch becomes reachable in a test.
- **Genuinely untestable** — rare. Then the pragma stays, and the PR says in a
  comment on that line why, so the next reader does not have to re-derive it.

Existing pragmas are out of scope; only flag ones this PR adds. There are
already ~40 in `src/`, so treat each new one as widening a gap rather than
following a precedent.

---

## GEN — Uncategorised

**GEN-000 · minor · Issue not covered by an existing rule.** Used when the bot
believes it has found a real problem that no rule above describes. The finding
body must propose the rule that would cover it. Review these periodically — a
GEN-000 that recurs is a rule waiting to be written.

---

## Editing this file

**Adding a rule:** write the entry in the right section. That is the whole
procedure — nothing to regenerate, nothing to keep in step.

```markdown
**FE-008 · minor · Inline styles on a new component.** Style via the project's
CSS modules instead, so theming stays in one place.
```

The shape is `**ID · severity · Title.** prose`. Severity is one of `blocker`,
`major`, `minor`, `nit`.

**Removing a rule:** delete it. Findings citing it stop being accepted from the
next review onward.

**Adding a category:** write a `## PERF — Performance` heading and put rules
under it. Prefixes are free-form; the parser only requires `PREFIX-NNN`.

Two things that bite:

- **A typo in the severity silently drops the rule.** `critical` is not a
  severity, so that line is skipped and the rule simply never fires. Run
  `node --test .github/review/scripts/test/rules.test.mjs` after editing — it
  asserts this file parses and every rule is usable.
- **Severity is the lever that matters.** Every rule faces the same confidence
  floor; severity decides what survives the comment cap and what the merge gate
  blocks on.
