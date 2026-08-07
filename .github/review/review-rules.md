# PR Review Rulebook

This is the instruction set the automated reviewer applies to every pull request.
It is meant to be edited by humans. Treat it as a living document: when the bot
misses something a human caught in review, add a rule; when a rule keeps firing
on non-issues, the tuning job will mute it and open a PR telling you so.

## How the reviewer uses this file

Every finding the bot reports must cite one of the rule IDs below. That citation
is what makes the feedback loop work — `tune-rules.mjs` groups outcomes by rule
ID, so a rule that keeps getting dismissed can be identified and muted without
touching the rules that are pulling their weight.

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

---

## GEN — Uncategorised

**GEN-000 · minor · Issue not covered by an existing rule.** Used when the bot
believes it has found a real problem that no rule above describes. The finding
body must propose the rule that would cover it. Review these periodically — a
GEN-000 that recurs is a rule waiting to be written.

---

## Editing this file

Adding a rule: add the entry above, then add a matching entry to
`.github/review/rules.json` with `state: "active"` and `weight: 0.7`. The
`validate-rules` step in the tuning workflow fails if the two files disagree, so
neither can drift.

Removing a rule: delete it from both files. Historical stats for that rule are
kept in `rules.json`'s `retired` block for reference.
