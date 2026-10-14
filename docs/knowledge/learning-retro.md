# Learning retro — SDK & platform gotchas

Durable, hard-won learnings for future agents working this repo: things the Now
SDK (`@servicenow/sdk` 4.13.9) and the ServiceNow runtime do that aren't obvious
from the docs or type definitions, and that cost real debugging time.

This file is **not** a coding standard (how we *decide* to build — that lives in
`CODING_STANDARDS.md`) and **not** a decision record (the *why* — `docs/adr/`).
It is a running log of "the platform surprised us here; here's the rule." Each
entry is *symptom → root cause → rule*. Add to it whenever a bug turns out to be
a platform/SDK behaviour rather than a mistake in our own logic.

---

## 1. Relative imports between server modules need the explicit `.ts` extension

- **Symptom:** at runtime (not build) a Scripted REST / server-module call throws
  `com.glide.module_support.exceptions.ModuleResolutionException: No module with
  path "x_snc_brb_app/.../src/server/rest/envelope" found in sys_module table`.
- **Root cause:** every file under `src/server/**` is compiled into its own
  `sys_module` record and loaded with `require()` at runtime. The registered
  module path **keeps the `.ts`** (e.g. `.../src/server/rest/envelope.ts`). An
  extensionless import specifier (`'./envelope'`) resolves to a path that was
  never registered.
- **Rule:** use the explicit extension for our own server↔server imports —
  `import { withEnvelope } from './envelope.ts'`. The server `tsconfig.json`
  already sets `allowImportingTsExtensions: true`, so the compiler is happy.
- **Scope — where it does *not* apply:**
  - `@servicenow/*` package imports (`@servicenow/glide`, `@servicenow/glide/sn_ws_int`,
    `@servicenow/sdk/core`) — package specifiers, resolved by the platform. No `.ts`.
  - Fluent `.now.ts` → server-module imports (e.g. `../../server/rest/me`) — the
    build resolves these and appends `.ts` itself in the generated `operation_script`.
  - Client code under `src/client/**` — rollup bundles it into one artifact, so a
    `.ts` extension there **breaks** the bundling. Keep client imports extensionless.

## 2. A `RestApi` route `script` must reference a server-module *function declaration*

- **Symptom:** build fails with `TS80: Unable to resolve the reference, ensure the
  imported module is within the src/server directory.` pointing at the route's
  `script:` property — even though the import path is correct.
- **Root cause:** the build's module resolver only wires up a route handler that is
  a named **function declaration** exported from a server module. A `const` bound to
  a value returned by another function (e.g. `export const me = withEnvelope(...)`)
  is not recognised.
- **Rule:** export a function declaration and have it delegate to any cross-cutting
  wrapper:
  ```ts
  const meHandler = withEnvelope('GET /me', (req, res, ctx) => { /* ... */ })
  export function me(request, response) { meHandler(request, response) }
  ```

## 3. The scoped `GlideUser` (`gs.getUser()`) is *fenced* — not every typed method exists at runtime

- **Symptom:** `Cannot find function getManagerID in object
  com.glide.script.fencing.ScopedUser@...` thrown from a handler, despite
  `getManagerID()` being present in the `@servicenow/glide` type definitions.
- **Root cause:** the `@servicenow/glide` d.ts files describe the full Glide surface,
  but scoped execution exposes only a subset on `ScopedUser`. The type checker can't
  see the fence, so it compiles and then throws at runtime.
- **Rule:** don't assume a `GlideUser` method exists just because it type-checks.
  For the manager and similar fields, read via `GlideRecord` on `sys_user`
  (`gr.get(sysId); gr.getValue('manager')`), and prefer `gs.*` statics for identity.
  Confirmed available on the scoped user in this SDK: `getID()`, `getName()`,
  `getDisplayName()`, `getAllRoles()`.

## 4. ServiceNow does not reliably deliver `response.setBody()` — use the stream writer

- **Symptoms (two faces of the same issue):**
  1. A bare HTTP **500** set via `setBody()` is replaced by a generic ServiceNow
     HTML page ("Instance Unavailable"), so a custom JSON error body never reaches
     the client (the client saw an unparseable body → `requestId=(none)`).
  2. Even a **200** response lost a field: the client received a body without the
     `roles` array and white-screened on `data.roles.indexOf(...)`.
- **Root cause:** `RESTAPIResponse.setBody()` does not guarantee the raw object is
  serialized and returned verbatim; 5xx statuses in particular get platform
  substitution.
- **Rule:** write JSON directly through the stream writer for **both** success and
  error responses, via a single helper:
  ```ts
  function sendJson(response, status, body) {
    response.setStatus(status)
    response.setContentType('application/json')
    response.getStreamWriter().writeString(JSON.stringify(body))
  }
  ```
  Also normalize/guard on the client (e.g. default `roles` to `[]`) so an unexpected
  shape can never crash the shell.

## 5. The N5 error envelope only covers *handler* errors; platform auth rejections bypass it

- **Symptom / boundary:** unauthenticated or ACL-denied requests return ServiceNow's
  own error representation (and status) *before* our route handler runs, so they are
  **not** the `{ error: { code, message, requestId } }` envelope.
- **Rule:** the client's `brbApi` must tolerate a non-envelope error body — fall back
  to a synthetic code like `http_<status>` and an empty `requestId` when the parsed
  payload has no `error`. Don't assume every failed response is our envelope.

## 6. Debugging technique — requestId correlation across UI / console / syslog

- Generate a per-request GUID (`gs.generateGUID()`), log it on the server in both the
  start and finish/error lines, and return it in the response envelope. The same id
  then appears in the UI, the browser console (`brbApi` log), and the instance
  `syslog`, so one request can be traced end-to-end.
- A temporary `?debug=error` query param on `GET /me` (server throws when present,
  client forwards it from the page URL) is a cheap way to exercise the whole error
  path on demand and confirm the envelope reaches the browser. Remove such hooks once
  verified.

## 7. A scoped auto-number field default must call `global.getNextObjNumberPadded()`

- **Symptom:** inserting a record on a scoped table with an auto-number `number`
  field throws, during `GlideRecord.applyDefault` → `insert`,
  `java.lang.SecurityException: getNextObjNumberPadded undefined, maybe missing
  global qualifier`. Surfaced by the `leave_request` ATF test (the Jasmine step's
  seed insert failed before any assertion ran).
- **Root cause:** the number field's default `javascript:getNextObjNumberPadded();`
  (as shown in the SDK `table-guide` standalone example) resolves against the
  **global** `NumberManager` Business Rule, which is not in the scoped sandbox. The
  bare call is `undefined` in a scoped (ES-latest) execution context.
- **Rule:** in a scoped app, qualify the default with `global.` —
  `default: 'javascript:global.getNextObjNumberPadded();'`. (Confirmed by SN KB0779911
  and community threads; the global-prefixed form is what UI-configured scoped number
  fields use.)

## 8. `now-sdk build` runs `pnpm install` — the build is coupled to dependency resolution

- **Symptom:** `now-sdk build` (via `pnpm run build`) fails with a `pnpm install`
  error — registry `429`/`ERR_PNPM_FETCH` or a frozen-lockfile mismatch — even though
  no source changed. It appeared only after adding a `devDependency` (vitest) that
  could not be fetched / was not yet in `pnpm-lock.yaml`.
- **Root cause:** the SDK build shells out to `pnpm install` before compiling, so a
  dependency that cannot resolve breaks **build**, not just `pnpm test`. A dev-only
  tool that never runs on-instance still has to install for the build to proceed.
- **Rule:** keep `package.json` installable and the lockfile in sync. Add deps with
  `pnpm add` (which updates the lockfile) rather than hand-editing `package.json`; pin
  the version and commit `pnpm-lock.yaml`. If the registry is unreachable, don't add a
  dep — the half-added manifest will block every `build` until install succeeds.

## 9. ATF won't run until `sn_atf.runner.enabled=true`, and the CLI error hides why

- **Symptom:** `now-sdk cicd test run --test-name "…"` resolves the name but fails
  `400: Start ATF test Failed with the given test ID` — no mention of ATF being off.
  `--run-in-cloud` instead fails `500: Cannot run in Cloud Runner, store application
  not installed`.
- **Root cause:** ATF execution is gated by the private property
  `sn_atf.runner.enabled` (default **false** so tests never run on prod). The 400 is
  the generic "couldn't start" message when no runner is available. The **ATF Cloud
  Runner** is a separately-installed store app, absent on a stock PDI.
- **Rule:** set `sn_atf.runner.enabled=true` on the sub-prod dev instance (kept true
  here by project decision; needs `atf_test_admin`/admin). Run server-side tests via
  the default scheduled runner — **omit** `--run-in-cloud` unless the Cloud Runner app
  is installed.

## 10. Unit-testing a Script Include's pure core off-instance without drift

- **Need:** a fast local (Vitest/Node) test for pure logic that lives inside a Script
  Include, whose body is a string-only `.js` using `Class.create()` with Glide
  auto-injected — importing it in Node throws `Class is not defined`.
- **Technique (keeps one copy of the logic, so no client/server drift per ADR 0006):**
  1. Author the pure function at top level in the SI `.js` and have the class method
     delegate to it (`count: function (a, b) { return countWorkingDays(a, b) }`).
  2. Export it for Node only, behind a guard the scoped runtime skips:
     `if (typeof module !== 'undefined' && module.exports) { module.exports = { countWorkingDays } }`.
  3. In the Vitest setup file, shim the platform global before import:
     `globalThis.Class = globalThis.Class || { create: function () { return function () {} } }`.
  4. Put the test **outside `src/server/`** (e.g. `test/`) so the SDK never bundles it
     as a `sys_module`, and keep vitest config as `.mts` to avoid the Vite CJS warning.
- **Rule:** the mandated coverage is still the on-instance ATF test; the local suite is
  an optional fast loop over genuinely pure, single-home logic only.

## 11. `Table()` and `Role()` are keyed by `name` (coalesce), not `$id`

- **Symptom:** a review (and a literal reading of `CODING_STANDARDS.md`'s "every
  metadata record carries a stable `$id`") flags tables for omitting
  `$id: Now.ID[...]`. But `Table()`/`Role()` don't accept `$id`, and adding it is
  unnecessary.
- **Root cause:** the SDK identifies these by their `name` and records them as
  **composite/coalesce** entries in `keys.ts` (confirmed: the `sys_db_object` entry is
  keyed by `{ name: 'x_snc_brb_app_leave_type' }`). Only APIs like `Acl`,
  `ScriptInclude`, `BusinessRule`, `RestApi`, and ATF `Test` take an explicit `$id`.
- **Rule:** don't add `$id` to `Table()`/`Role()`; the `name` is the stable identity
  (renaming orphans the old record, same as a key rename). The `now-sdk` `table-api`
  docs are authoritative over the generic `$id` list in `CODING_STANDARDS.md`.

## 12. An ATF `Test` step `script` must be a static template literal — no `${…}` interpolation

- **Symptom:** `now-sdk build` prints `Plugin "TestPlugin" failed to transform
  "CallExpressionShape" shape into record … Failed to cast IdentifierShape to
  PropertyAccessShape` once per `Test()` — yet still ends `Build completed
  successfully`, so the tests are silently missing from the output.
- **Root cause:** the Test plugin reads `runServerSideScript({ script })` statically. A
  template literal with `${SHARED_HELPERS}` is an identifier expression it cannot
  resolve.
- **Rule:** keep each step `script` a plain template literal and repeat shared staging
  helpers inline in every script. Grep the build output for `ERROR` — a successful
  build line does not mean every record was emitted.

## 13. With auto-ACLs off, a table needs a *record-level* `write` ACL — field ACLs alone refuse every secure write

- **Symptom:** `GlideRecordSecure.update()` returns `null` with **no error message** and
  the row is unchanged (`POST /requests/{id}/submit` → submit "refused", state stays
  `draft`). The same table's ATF submit tests passed.
- **Root cause:** `createAccessControls: false` removes the generated rules, and we
  authored only field-level `write` ACLs. A secure write needs a record-level
  (`table`, no field) `write` ACL first; without one it is denied before any field ACL
  runs.
- **Rule:** for a table with auto-ACLs off, author the record-level rule for **every**
  operation (`read`, `write`, `create`, `delete`) *and* the field rules. A silent
  `null` from a secure update means "no allowing ACL", not "a Business Rule aborted".

## 14. `GlideRecordSecure.insert()` can return a sys_id and `201` while dropping every field

- **Symptom:** `POST /requests` returned `201`; the stored row had empty `requester`,
  `leave_type`, `start_date`, `days` (only defaults like `state=draft` and `number`).
  The owner's N1 read ACL then hid the row, so the next call said "not found".
- **Root cause:** field write ACLs are evaluated against the half-built in-memory row
  (and, here, there was no record-level write ACL — #13). Denied fields are **silently
  dropped**; `insert()` still succeeds, and the create ACL had already passed on the
  in-memory values.
- **Rule:** after a secure insert, don't trust the sys_id — re-read the row and assert
  the fields. We insert with plain `GlideRecord` behind `canCreate()` and re-read with
  `GlideRecordSecure.get()` (ADR 0004 amendment). Spike whether the secure insert works
  once #13 is fixed.
- **Diagnostic that cracked it:** in the failing branch, log a plain `GlideRecord.get(id)`
  of the row (exists? requester? state?) next to `gr.canRead()` — it separates "never
  persisted" from "ACL denies the owner" in one run.

## 15. `gs.getErrorMessages()` returns the *session* backlog, not just this request's errors

- **Symptom:** submit failed with "Access to event … has been refused" although the
  failing step had nothing to do with events. The message was added by the *previous*
  request (`POST /requests`) and still sat in the session.
- **Root cause:** `gs.addErrorMessage` messages persist in the session until displayed.
  Logging `gs.getErrorMessages()` **before** the update (`preMsgs`) proved it.
- **Rule:** never relay `getErrorMessages()` as the reason for a refusal without
  checking it was produced by the attempt in question (compare before/after, or clear
  first). A message that doesn't match the failing step is probably stale.
- **Applied:** `requests.ts` `newErrorMessages(before)` relays only messages a transition
  attempt added; submit/approve/reject/cancel also confirm the committed state landed
  (`stateLanded`) before treating `update()` as success. `PATCH /leave-types/{id}` re-reads
  the row after `update()` and returns `500 update_not_saved` if the edit did not persist.

## 16. A scoped app must register every custom event before `gs.eventQueue`

- **Symptom:** "Access to event 'x_snc_brb_app.state_changed' from scope 'brb_app' has
  been refused. The event is not defined." surfaced as a (stale, see #15) error.
- **Root cause:** a Business Rule queued an event that was never registered in
  `sysevent_register`. ATF did not catch it.
- **Rule:** register events with `Record({ table: 'sysevent_register' })` setting both
  `suffix` and `event_name` (`explain registering-events-guide`). Open: the message kept
  appearing after the registered record was verified on the instance (correct scope,
  matches OOTB scoped events) even with the cache cleared — cause not found.

## 17. ATF server-side tests do not reproduce the facade's security context

- **Symptom:** every T4–T6 ATF test passed while the real REST path failed three ways
  (#13, #14, #16). The `atf.rest` route can't stand in either: it does not run as the
  impersonated user without a Basic Auth profile per demo user (see the parked
  `facade-rest-spike.now.ts`).
- **Rule:** green ATF ≠ the facade works. Verify a slice end-to-end as a real
  impersonated user in the UI before calling it done, and pin config preconditions
  (record-level ACL present, event registered) in a regression test —
  `facade-create-submit-regression.now.ts`. Un-park the REST suite when per-user Basic
  Auth profiles exist.

## 18. A field write ACL sees the OLD value — value-aware authorization belongs in a `before` Business Rule

- **Symptom:** a manager's Approve returned `200`, but the request stayed `submitted`
  (`approver` empty). No error, no log, `update()` returned the sys_id. Employee submit
  worked, which hid the problem.
- **Root cause:** inside a field-level `write` ACL, `current.<field>` is the value
  **before** the write (logged on-instance: `current.state=submitted`,
  `current.state.changes()=false` while approving). A script branching on the pending
  value never reaches its branch and falls through to `answer = false`; the secure update
  then drops the field and still reports success. Submit passed by accident — the old
  value `draft` hit the requester branch.
- **Rule:** an ACL can only decide from the *current/old* state, the actor and the
  record. Anything that depends on **what is being written** (who may approve vs cancel)
  goes in a `before` Business Rule, where `current` holds the new value and
  `setAbortAction(true)` refuses it. Don't trust an ACL script that reads the new value of
  its own field. Same family as #13/#14: a secure write that "succeeds" but changed
  nothing means an ACL denied it silently — check `persistedState` after `update()`.
- **Diagnostic that cracked it:** `gs.info` *inside* the ACL script logging
  `current.<field>`, `current.<field>.changes()`, the actor and the relationships —
  ACL scripts can log, and it showed the old value in one run.

## 19. A `GlideAggregate` `SUM` with no `groupBy` can return one row's value, not the total

- **Symptom:** the home page showed `0 available of -1` for Annual Leave although the
  ledger held +25, −1 and +20 (net 44). `LeaveBalance.getBalance` returned `-1`, the lone
  DEDUCT. The ATF balance tests passed.
- **Root cause:** `_sumLedgerDelta` ran `addQuery` + `addAggregate('SUM','delta')` and read
  the first row with no `groupBy`. In the live session that yielded a single row's value;
  the same aggregate with `groupBy('leave_type')` returned `44`. (The exact platform
  reason is unconfirmed — only the difference between the two forms was observed.)
- **Rule:** always `groupBy` the aggregate (here `leave_type`) and read the group's
  `getAggregate`. Verify a total by comparing it with the raw rows at least once
  on-instance — don't trust a green ATF (see #17).
- **Diagnostic that cracked it:** log the raw rows (plain `GlideRecord`) next to a grouped
  aggregate in the same handler; a total that disagrees with the rows points at the
  aggregate form.

## 20. A restrictive write ACL also blanks the secure insert of *trusted* rows (grants)

- **Symptom:** the admin's "Grant 20 days" showed *Allowance granted* (`201`), but the
  balance never moved; the ledger gained blank rows.
- **Root cause:** the grant handler inserted with `GlideRecordSecure`; the ledger's
  append-only `write` ACL (`answer = false`) denied every field, which was silently
  dropped — exactly #14 on a second table. The create ACL had passed on the in-memory row.
- **Rule:** for any `GlideRecordSecure.insert()` into a table with a restrictive field/
  `write` ACL, assume fields are dropped. Gate with `canCreate()`, insert with plain
  `GlideRecord`, and **re-read to assert the key field landed** before returning success.
  Blank rows from earlier attempts cannot be removed when `delete` is denied.

## 21. Server `strictNullChecks` is off — branch on validator results with a type guard, not `!r.ok`

- **Symptom:** the editor (strict TypeScript) reported `'parsed.value' is possibly
  'undefined'` (TS18048) and `string | undefined` not assignable (TS2345) across
  `grants.ts`, `requests.ts`, `leave-types.ts`, `balance-preview.ts` and
  `admin-validation.ts` — 56 errors — while `pnpm run build` passed.
- **Root cause:** the server `tsconfig.json` has no `strict`, so `strictNullChecks` is off.
  Under that setting a `{ ok: true; value } | { ok: false; code }` union does **not** narrow
  on `if (!r.ok)`, so `Validated<T>` had been written as a flat shape with optional
  `value?` / `code?` / `message?` — which strict-mode editors then (correctly) flag.
- **Rule:** `Validated<T>` is now a real discriminated union in `src/server/rest/validated.ts`
  and handlers branch with the type guard `isInvalid(parsed)`; a user-defined guard narrows in
  both modes, so `parsed.value` is non-optional afterwards. Check with
  `npx tsc -p src/server/tsconfig.json --noEmit --strict` (clean) as well as the build. New
  validators use `ok()` / `fail()` from `validated.ts`, never a local flat shape.
