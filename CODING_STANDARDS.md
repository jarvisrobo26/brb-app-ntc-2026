# Coding standards

Repo-specific rules for **change discipline** (the branch/PR workflow for maps and specs), **doc ownership**, and Fluent authoring. This is the *Standards* axis for the `code-review` skill — not a generic ServiceNow / Fluent style guide.

Product spec lives in [`PRD.md`](./PRD.md). Agent contract lives in [`AGENTS.md`](./AGENTS.md). Domain terms live in [`GLOSSARY.md`](./GLOSSARY.md).

## Doc ownership

| File | Role |
| --- | --- |
| `README.md` | Human setup + usage |
| `PRD.md` | Product requirements (frozen; changes go to a new version) |
| `AGENTS.md` | Agent contract / single source of truth — real file |
| `CLAUDE.md` | Symlink → `AGENTS.md` (never a second copy) |
| `GLOSSARY.md` | Ubiquitous language only — no runbooks, no Git/process |
| `CODING_STANDARDS.md` | This file — standards / process / branches & PRs (maps & specs) / Fluent authoring |
| `docs/agents/` | Skills wiring (issue tracker, triage, domain, subagents) |
| `docs/adr/` | Architecture decisions when recorded |
| `docs/research/` | Research ticket write-ups (created lazily when a research ticket produces one) |
| `docs/knowledge/` | Running log of SDK/platform learnings (`learning-retro.md`) — gotchas, not standards or decisions |

No `CONTRIBUTING.md`. No `docs/README.md` index.

## Change discipline — branches & PRs

Fork from `develop`; never push to it directly. Two integration-branch kinds: a **map** `feat/<map-slug>` (design/decisions) and a **spec** `feat/<spec-slug>` (build). A spec realizes a map's locked design; its implementation tickets are tracer-bullet vertical slices (see the `to-issues` skill).

| Ticket | Branch from → name | Merges |
| --- | --- | --- |
| Decision (grilling) | map feat → `grilling/<topic>` | → map feat; its ADR + `GLOSSARY.md` edits must land |
| Research / prototype | map feat → `research/`·`prototype/<topic>` | **don't merge** — answer lives in the issue (+ `docs/research/` or an ADR); keep tip as reference |
| Implementation | spec feat → `task/<issue#>-<slug>` | → spec feat **by PR only**; one ticket = one PR; run `code-review` first; never onto the branch directly, never into `develop` |
| Map / spec land | `develop` → the `feat/…` branch | → `develop` by PR when done |

- Push each `feat/…` to `origin` when work begins and keep it current with `develop`. Each branch's name lives in its map/spec issue, not here.
- Tiny unrelated fixes may go straight to `develop` (or a short PR) when outside any open map/spec.
- Claim/resolve/PR mechanics: [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).

## Fluent authoring conventions

How agents build the Fluent app so it stays on-pattern across sessions, tools, and IDEs. These are **durable rules**, not rationale — each subsection names the [ADR](./docs/adr/) that owns the decision; read the ADR for the "why", and don't restate it here (doc ownership). Always run the `now-sdk` skill's orientation first in this project (it is versioned to the installed `@servicenow/sdk`), and treat its guidance as authoritative where it is more specific than this file.

> The `src/` tree currently holds the stock *incident-manager* scaffold. Replacing it with the real brb-app tables/code is the **build effort, out of scope for the #2 map**; these conventions are the spec that build follows.

### Record identity — `Now.ID` / `keys.ts`

- **Every** metadata record carries a stable identity, but the *form* depends on the API. For APIs that accept one (`Acl`, `BusinessRule`, `ScriptInclude`, `RestApi`, `StateModel`, `Record`, ATF `Test`, …) that identity is `$id: Now.ID['descriptive-key']` — never omit it, since omitting it keys the record by coalesce fields and a rename then orphans the old record. **`Table` and `Role` are the exception: they take *no* `$id`** and are keyed by their `name` (a coalesce entry in `keys.ts`); the `name` *is* the stable identity, so renaming one still orphans the old record. Don't add `$id` to a `Table()`/`Role()` — the `now-sdk` `table-api` docs are authoritative here (see `docs/knowledge/learning-retro.md` #11).
- **Never fabricate, invent, or hardcode a `sys_id`.** `Now.ID[...]` is the only sanctioned source of new identities; the build generates the `sys_id` and records it in `keys.ts`. The *only* acceptable raw `sys_id` strings are ones returned by a live `now-sdk query`/transform against the instance.
- **Key names** are kebab-case, descriptive, and scoped to the record/feature: `leave-request-read-acl`, `assign-state-model`, `enforce-transitions`, `i6-balance-covers`. ATF test keys carry the invariant ID (see *Test-by-invariant*).
- **Referencing a record is not `Now.ID`.** To point one record at another, pass the **exported variable** (or `variable.$id` where a string id is required), or `Now.ref('table', { … })` for a platform record by coalesce keys. `Now.ID[...]` in a `data`/script field writes the **literal key string**, not a `sys_id`. Per [ADR 0002](./docs/adr/0002-custom-state-machine.md), never interpolate `Now.ID[...]` into a script/string field — resolve records at runtime instead.
- `keys.ts` lives at `src/fluent/generated/keys.ts`, is **auto-generated**, **committed**, and not hand-edited except to fix a specific mapping. CI builds with `--frozenKeys` so an out-of-date `keys.ts` fails the build rather than silently regenerating.
- **Deletion is destructive and tracked.** Removing a `Table()` / `BusinessRule()` / `Record()` / `Acl()` call while its `keys.ts` entry remains generates an **upgrade-time delete record** that removes it from every installed instance. Never delete a Fluent definition as a quick "remove", and **never without confirming with the user first** — the code alone cannot reveal install history. For ATF tests whose underlying rule is gone, use `Now.del('sys_atf_test', '<sysId>')` **and** delete the dead source file (see *Test-by-invariant*).

### Table / field / role / choice naming — [ADR 0001](./docs/adr/0001-four-table-schema-and-status-choice-model.md), [ADR 0003](./docs/adr/0003-role-and-acl-model.md)

- Scope is `x_snc_brb_app`. Four standalone tables, all ≤ 30 chars, no `task` inheritance: `x_snc_brb_app_leave_type`, `x_snc_brb_app_leave_request`, `x_snc_brb_app_ledger_entry`, `x_snc_brb_app_audit_event`. **Employee is OOTB `sys_user`** — never a fifth custom table.
- Field names are `snake_case`. The canonical term is **`state`, never `status`** — column name, label, choices, Business Rules, ACLs, the `StateModel`, and the React client all say `state`.
- Choice values are **lowercase string slugs**, not OOTB integer `state` values: Leave Request `draft` / `submitted` / `approved` / `rejected` / `cancelled`; Ledger `grant` / `deduct` / `restore`. `delta` is a **signed** integer so balance is a plain `SUM(delta)`.
- Every reference to a person is a `ReferenceColumn → sys_user`. Timestamps use OOTB `sys_created_on` / `sys_created_by`; add a custom date column only when the acting moment genuinely differs from record creation (e.g. `decided_at`). Server-set fields (`approver`, `decided_at`, `days`, `number`, `sttrm_model`) have **no user write ACL**.
- Roles are scope-prefixed: `x_snc_brb_app.employee`, `x_snc_brb_app.manager` (contains `employee`), `x_snc_brb_app.admin` (**standalone**, non-superuser). Reference data and types are **retired via an `active` flag, never deleted**.

### File layout under `src/`

```text
src/
  fluent/
    tables/           <type>.now.ts — one metadata record (or small cohesive group) per file
    roles/
    acls/
    business-rules/
    script-includes/
    state-models/
    rest-apis/
    tests/            ATF Test() definitions, keyed/named by invariant
    generated/keys.ts (auto-generated, committed)
  server/             server-side TS modules (business-rules/, script-includes/, rest/, …)
  client/             the React UI Page SPA (see Server / client split)
```

- Fluent metadata lives in **`.now.ts`** files under `src/fluent/<type>/`, importing APIs from `@servicenow/sdk/core`. `Now` is a global — never add it to an import.
- Server logic lives in **`src/server/`** (the `serverModules` dir) as TypeScript modules. In module files, import Glide APIs explicitly (`import { gs, GlideRecord } from '@servicenow/glide'`); in Script Include **class** files (`Class.create`) the Glide APIs are auto-injected — do **not** import them, and import sibling classes from `@servicenow/glide/<scope>`. Use `GlideDateTime`, never `gs.nowDateTime()` (disallowed in scoped apps).
- **Module vs string script:** `BusinessRule` / `RestApi` route / `ScriptAction` / `UiAction` take a TS **module function** via `import`; `ScriptInclude` / `ClientScript` / ACL scripts are **string-only** → use `Now.include('./file.js')` or an inline string. The `enforce_transitions` enforcement BR is the one deliberate inline template-literal **string** ([ADR 0002](./docs/adr/0002-custom-state-machine.md)) — the build rejects the `global.` namespace in an included `.js`.

### Data-access pattern — [ADR 0004](./docs/adr/0004-client-server-data-access-pattern.md)

- **One** custom scoped Scripted REST API (`RestApi()`, base `x_snc_brb_app`) is the single client-to-server path. **No** direct client Table API, **no** GlideAjax, **no** processors.
- Ingress is locked: `allowWebServiceAccess` stays **off** on all four tables; the `RestApi()` **requires authentication** (`X-UserToken: window.g_ck`) and sets **`enforceAcl: true`**. In Fluent this is realized on the route via `authentication: true` (→ `sys_ws_operation.requires_acl_authorization`, i.e. the "enforce ACL" flag) and `authorization: true` (→ requires an authenticated session). The route-level **`enforceAcl` *array*** names specific ACLs; leave it unset to keep default ACL enforcement — an empty `[]` **disables** it.
- Handlers use **`GlideRecordSecure`** so the [ADR 0003](./docs/adr/0003-role-and-acl-model.md) ACLs (N1/I4/I5) still enforce. The **only** sanctioned plain-`GlideRecord` code is the two named cross-employee aggregations: `LeaveBalance` (I6, [ADR 0005](./docs/adr/0005-balance-and-available-days-computation.md)) and the **F6 overlap query**, which hard-codes the **name + dates-only** projection (N7).
- **Writes** are intent-named action endpoints, 1:1 with the PRD transitions (`POST …/submit|approve|reject|cancel`, `/reject` requires a reason — F4), plus `POST /grants` (admin) and `/leave-types`. **Reads** are coarse, screen-shaped composites — one round-trip each (N3), compute-on-read balance, **no cache in v1**.
- The facade is **thin and holds no business logic**: transition legality stays in the `StateModel` (#6), side-effects (ledger/audit/notify) in the Business Rules (#6), authorization in the ACLs (#7). `LeaveBalance` only ever takes a **server-trusted** `employee`, never client input.

### Server / client split — [ADR 0008](./docs/adr/0008-screen-inventory-and-client-architecture.md)

- **Server** owns all enforcement: tables, roles, ACLs, the `StateModel`, Business Rules, Script Includes (`WorkingDays` for I9, `LeaveBalance` for I6), and the Scripted REST facade.
- **Client** is one role-branched React SPA on a **single UI Page** (`URLSearchParams` routing, no router library), a **strict four-layer stack** with a one-way dependency rule:
  1. **Presentational** — `@servicenow/react-components` primitives only; props in, callbacks out, no fetching.
  2. **Screens** (`src/client/screens/`) — one per view; own view state, compose primitives.
  3. **Hooks** (`src/client/hooks/`) — wrap `brbApi`, expose `{ data, loading, error, refetch }`, normalize the N5 envelope to a typed `AppError`.
  4. **Service** (`src/client/services/brbApi.ts`) — one function per facade endpoint and the **only** code in the client that calls `fetch()`. Shared types in `src/client/types/`.
- **Dependency rule:** components never import `brbApi` directly — only hooks call it. The connected `NowRecordListConnected` / `RecordProvider` / `useRecord` family is a **named anti-pattern** here (it talks to the Table API and would reopen the ingress ADR 0004 closed).
- The **F2 preview is server-driven** — the client does **no** day math, so the preview and the I6 submit gate can never drift. Identity + resolved scoped roles come from `GET /me` into a `SessionContext`; the `Forbidden` screen is a UX courtesy, not enforcement.

### Test-by-invariant (`I1`–`I9`) — PRD §6/§10

- Automated tests use the Fluent **ATF `Test()` API** (`src/fluent/tests/`). Each invariant **`I1`–`I9` has at least one test whose name/`$id` carries the invariant ID** (e.g. `test-i6-over-available-refused`), so every rule traces to a test that fails when the rule is broken. Cover a **positive AND a negative** case wherever a rule has both sides.
- One named `StateModel` transition condition per invariant (#6) maps **1:1** to one test per invariant — keep that traceability; do not lump invariants into one test.
- **Category selection:** server-side invariants and Script Includes (`WorkingDays`, `LeaveBalance`) via `atf.server` (`runServerSideScript`, `recordInsert` + `recordValidation`, `impersonate`); facade endpoints via `atf.rest`. Use `impersonate` to prove **role access (N1) for all three roles** (employee / manager / admin), including the denied cross-employee direct call. **The React UI Page is NOT tested with ATF `uiTestScript`** — all UI/browser testing is done with **Playwright**, introduced as a separate toolchain (see `docs/research/tdd-patterns-and-scope.md` §3 L5). Running ATF requires `sn_atf.runner.enabled = true`, kept permanently on the sub-prod dev instance.
- When an edit **removes** a rule, delete its test with `Now.del('sys_atf_test', '<sysId>')` and remove the source file; when a rule **changes**, update its test in place (don't delete-and-re-add).

### Error handling & observability (N5) — [ADR 0004](./docs/adr/0004-client-server-data-access-pattern.md)

- The Scripted REST facade is the **single server seam** that owns N5:
  - **Request ID** — generate/propagate a correlation id per request; include it in every log line and in the error response.
  - **Structured logs** — each resource logs start (route, user, requestId) and finish (status, elapsed ms) in a structured, scope-prefixed form.
  - **Error envelope** — errors are **never swallowed**: catch, log with stack + requestId, and return a consistent `{ error: { code, message, requestId } }` with the right HTTP status.
- **Client:** `brbApi` parses the envelope into a typed `AppError` carrying the `requestId`; shared `<LoadingState>` / `<ErrorState>` render `loading` / `error` uniformly; the **`requestId` is shown in the UI** (so a user can quote it) and logged; a top-level **error boundary** catches render crashes.
- **Side-effects are validate-first, write-last** in a single `before` context (#6), and **notification delivery is decoupled/async** off the `x_snc_brb_app.state_changed` event ([ADR 0007](./docs/adr/0007-notification-mechanism.md)) — a failed delivery **never blocks the committed transition** (N4/F7) and is logged. Never swallow a server exception; log it with `gs.error` and context.

## Agent-docs duty

- Process / Git / tracker conventions changed → update this file and/or [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).
- Fluent authoring conventions changed → update this file (the *Fluent authoring conventions* section, #15).
- Product requirements changed → update `PRD.md` (new version) and `AGENTS.md` where the agent contract shifts.
- Domain terms changed → update `GLOSSARY.md` only (no process or Git content there).
- Finished research → prefer a durable write-up under `docs/research/` (or an ADR under `docs/adr/`) plus the issue comment; the branch tip is optional reference, not the only record.
- Hit an SDK/platform gotcha (a bug that turned out to be platform behaviour, not our logic) → add a *symptom → root cause → rule* entry to [`docs/knowledge/learning-retro.md`](./docs/knowledge/learning-retro.md); keep standards/decisions out of it.
