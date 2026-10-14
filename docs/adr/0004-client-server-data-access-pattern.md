# Client-to-server data access pattern for the React UI Page

Status: accepted

## Decision

All client-to-server traffic from the brb-app React UI Page goes through **one
custom scoped Scripted REST API** (`RestApi()`, base `x_snc_brb_app`). This is
the single pattern every client call uses: **no direct client Table API, no
GlideAjax, no processors.** It realizes map direction #3 (the React UI Page is
the only delivery surface) and takes the seam ADR 0003 handed to #8 — the F6
**overlap projection** (N7) that cannot be an ACL and must be done server-side.

The facade is a **thin, intent-revealing skin** over the guarded server model
already decided in #6/#7: it adds no business logic. Transition legality stays in
the #6 `StateModel`, side-effects (ledger/audit/notify) stay in the #6 Business
Rules, and authorization stays in the #7 ACLs. The facade's only jobs are
shaping requests/responses per screen, enforcing the N7 projection, and owning
the N5 observability seam.

### Why a facade and not the Table API (the #3 (a)/(b) choice)

Research #3 framed the choice as **(a)** OOTB Table API via
`@servicenow/react-components` connected components + a thin Scripted REST, vs
**(b)** a single Scripted REST API for everything. We chose **(b)**:

- **N7 overlap projection is unavoidably server-side.** ADR 0003 proved "overlap
  omits leave type/note" cannot be an ACL (the viewing manager legitimately has
  field access to their own reports' rows). Only a server endpoint can return
  *name + dates only*, so a custom endpoint is mandatory regardless.
- **Balance (I6) and the F2 preview** are ledger aggregations — server-only too.
- **"The single pattern" is the literal ask of #8.** Option (a) is two patterns.
- **Smaller ingress.** The facade lets `allowWebServiceAccess` stay **off** on
  all four tables, closing the raw Table API path entirely; (a) requires it on.
- **One N5 seam** (request IDs, structured logs, "never swallow") and **one
  versioned contract** for the client.

The accepted cost: we forgo the OOTB `NowRecordListConnected` / `RecordProvider`
wiring and write our own thin service layer + list/pagination against the facade.

### ACLs still enforce: `GlideRecordSecure` in every handler

A Scripted REST handler runs server-side, where **plain `GlideRecord` bypasses
ACLs**. To keep ADR 0003's guarantees real — N1 row-scoping, the value-aware I4
`state` write ACL, the I5 draft-only field locks — every request / ledger / audit
read **and** the transition write use **`GlideRecordSecure`**. The #6 Business
Rules fire on the resulting DB write either way.

The **only** plain-`GlideRecord` code is the two exceptions ADR 0003 already
named, because they must aggregate across employees:

- **`LeaveBalance`** (I6) — sums ledger deltas and subtracts held days.
- **The F6 overlap query** — reads the deciding manager's reports' active
  requests and **hard-codes the name + dates projection** (N7). This is the seam
  ADR 0003 handed here; it lives in exactly one place.

### Write surface — intent-named action endpoints (one per transition)

Each endpoint maps 1:1 to a PRD §4 transition and carries only that move's
payload. The handler does `GlideRecordSecure.get(id)`, sets `state` (and
`decision_reason` on reject), and `update()`s — nothing more.

| Method / route | Transition | Notes |
|---|---|---|
| `POST /requests` | *(create Draft)* | `requester == me` (create ACL); F1 |
| `PATCH /requests/{id}` | *(edit Draft)* | Draft-only field writes (I5) |
| `POST /requests/{id}/submit` | Draft → Submitted | I2/I3/I6/I8/I9 via StateModel + #6 BRs; creates the Hold |
| `POST /requests/{id}/approve` | Submitted → Approved | Assigned manager only (I4); DEDUCT |
| `POST /requests/{id}/reject` | Submitted → Rejected | **Reason required in the payload** (F4); releases Hold |
| `POST /requests/{id}/cancel` | → Cancelled | From Draft/Submitted/Approved; F8 (before start); RESTORE if was Approved |
| `POST /grants` | *(ledger GRANT)* | Admin only; F10, via the ledger `create` ACL |
| `POST /leave-types`, `PATCH /leave-types/{id}` | — | Admin maintains types; retire via `active` flag |

A **generic `state` PATCH** was rejected: intent endpoints make F4's required
reason a contract-edge guarantee, give clean per-action N5 logging, and map 1:1
onto the transition table.

### Read surface — screen-shaped composite endpoints

Reads are **coarse and shaped per screen**, each doing its own aggregation /
projection in a single round-trip (N3), rather than fine-grained per-table
mirrors the client stitches together. Illustrative set (the exact list finalizes
with the screen inventory, which is not yet decided — the *pattern* is fixed
here, not a frozen route table):

| Route | Screen | Returns |
|---|---|---|
| `GET /my/dashboard` | Employee home | My requests + my balance per leave type |
| `GET /requests/{id}` | Request detail | One request (requester or its manager) |
| `GET /requests/{id}/decision-view` | Manager decision (F6) | Request + computed available balance + overlap set **(name + dates only, N7)** |
| `GET /balance-preview?type=&start=&end=` | Submit form (F2) | Current balance, working days (I9), balance-after |
| `GET /leave-types` | Submit form | Active leave types |

### Ingress is locked to the facade

- `allowWebServiceAccess` stays **off** on all four `x_snc_brb_app_*` tables, so
  the raw Table API is not a sanctioned path.
- The `RestApi()` **requires authentication** (UI Page session + `X-UserToken:
  window.g_ck`) and sets **`enforceAcl: true`** as belt-and-suspenders behind the
  `GlideRecordSecure` handlers.

### N5 observability lives in the facade

The facade is the single server seam, so it owns N5:

- **Request ID:** generate/propagate a correlation id per request; include it in
  every log line and in the error response.
- **Structured logs:** each resource logs start (route, user, requestId) and
  finish (status, elapsed ms) in a structured, scope-prefixed form.
- **Error envelope:** errors are **never swallowed** — caught, logged with stack
  + requestId, and returned as a consistent JSON `{ error: { code, message,
  requestId } }` with the right HTTP status.

### Client service layer

A **single typed client module** under `src/client/services/` (e.g. `brbApi`)
exposes one function per facade endpoint and is the **only** code that talks to
the facade. React components call it and never `fetch()` directly;
`@servicenow/react-components` are used as presentational components fed by this
service layer, not as Table-API connected components.

## Considered options

- **Single Scripted REST facade (chosen) vs Table API connected components + a
  thin REST.** The mix is two patterns, cannot do the N7 projection, and forces
  `allowWebServiceAccess: true`. The facade is one pattern, owns the projection,
  and closes the raw Table API ingress.
- **GlideAjax / processor.** Ruled out upstream by research #3 (`ui-page-guide`
  forbids GlideAjax from UI Pages).
- **Generic `state` PATCH vs intent-named action endpoints.** Chose intent
  endpoints: F4 reason at the contract edge, per-action logging, 1:1 transition
  mapping.
- **Fine-grained per-table reads vs screen-shaped composites.** Chose composites
  for N3 (one round-trip) and a single home for the N7 projection.
- **Plain `GlideRecord` vs `GlideRecordSecure` in handlers.** Chose
  `GlideRecordSecure`: plain `GlideRecord` would bypass the ADR 0003 ACLs. The
  only plain-`GlideRecord` code is the two named cross-employee aggregations.

## Consequences

- **N1 / I4 / I5 stay enforced server-side** because handlers use
  `GlideRecordSecure` and the facade holds no business logic; the #6 StateModel +
  BRs and #7 ACLs remain the single source of enforcement.
- **N7 has a concrete home:** the `decision-view` endpoint's hard-coded name +
  dates projection, plus the ADR 0003 field ACLs as defense-in-depth.
- **The raw Table API ingress is closed** (`allowWebServiceAccess` off). The
  facade is the only sanctioned path; integrations / break-glass access would be
  a separate, deliberate future decision.
- **N3:** screen-shaped endpoints give one round-trip per screen; balance is
  compute-on-read (no cache in v1, per map direction #5). The transactional +
  reconciled balance cache remains the documented N3 fallback.
- **N5 is now specified.** Transcribing this convention (and the data-access
  pattern / server-client split) into `CODING_STANDARDS.md` is **#15's** job —
  it owns the *Fluent authoring* section and is unblocked by this decision. This
  ADR is the source #15 pulls from; it is deliberately **not** written into
  #15's section here, to avoid doc-ownership drift.
- **Client shape is fixed:** a single typed `src/client/services/` client is the
  sole caller of the facade; components never fetch directly.
- **Unblocks #12 and #15.**


## Amendment — `POST /requests` inserts with plain `GlideRecord` (task/bug-fixes, 2026-10-14)

"`GlideRecordSecure` in every handler" is relaxed for **one** call: the Draft insert in
`POST /requests`. Observed on the instance: a `GlideRecordSecure.insert()` returned a
sys_id and the handler answered `201`, but the stored row had **empty `requester`,
`leave_type`, `start_date` and `days`** — only column defaults survived. The N1 read
ACL (`requester == me`) then hid the new Draft from its own owner, so the immediately
following `POST /requests/{id}/submit` returned `404 Leave request not found`.

The handler now (1) asks `GlideRecordSecure.canCreate()` — the create ACL
(`requester == me`) remains the authorization gate — (2) inserts with a plain
`GlideRecord`, and (3) re-reads the row through `GlideRecordSecure.get()` to build the
response, so a Draft its owner cannot read is refused (`403`) rather than orphaned.
Every **update** (submit, approve, reject, cancel, patch) stays on `GlideRecordSecure`,
so the I4/I5 field ACLs still gate them. Not proven: whether the secure insert would
work now that the record-level `write` ACL exists (ADR 0003 amendment) — worth a spike
before the larger refactor; if it does, this exception can be dropped.

Also: handlers must not surface `gs.getErrorMessages()` blindly. Session error
messages persist across requests, so a stale message from the preceding create call
was relayed as the *submit* error. Read messages produced by the transition just
attempted, not the session backlog.

**Same exception applies to `POST /grants`.** The ledger's append-only `write` ACL
(`answer = false`, ADR 0003) denies every field on a `GlideRecordSecure` insert, which
silently dropped them all: the handler returned `201` but stored a **blank** ledger row
(no employee, amount or kind), so the allowance never reached the balance. The handler now
gates with `canCreate()` (admin + `entry_kind == 'grant'` stays the authorization),
inserts with a plain `GlideRecord`, and re-reads the row, returning `500 grant_not_saved`
if it did not land. Two blank ledger rows from the failed attempts remain (the ledger
cannot be deleted from). Any handler that inserts into a table with a restrictive
`write`/field ACL must be checked for this.

**Handler convention (task/bug-fixes):** after any secure `update()`, confirm the write
landed with a plain re-read before answering success, and relay only the error messages
that attempt produced (`newErrorMessages`). Applied to submit, approve, reject, cancel and
`PATCH /leave-types/{id}`.
