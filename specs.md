# Spec: Build brb-app on ServiceNow Fluent (realize the #2 locked design)

> Source: https://github.com/jarvisrobo26/brb-app/issues/21

Build spec for the brb-app Fluent application. The design is locked and plan-only in the map [#2](https://github.com/jarvisrobo26/brb-app/issues/2); this spec hands that design to a `to-issues` vertical-slice breakdown. It restates no decisions — every realization choice lives in [`PRD.md`](../blob/main/PRD.md) v0.2 and ADRs [0001](../blob/main/docs/adr/0001-four-table-schema-and-status-choice-model.md)–[0009](../blob/main/docs/adr/0009-deploy-and-seed-data.md); this spec names *what to build* and *how it will be tested*, and points at the owning doc for the *how*.

## Problem Statement

Leave runs on email and spreadsheets. Balances drift, requests get lost, and nobody knows who is out until they are out. Employees cannot see what they have left; managers approve without context (PRD §1).

Separately, the design for solving this on ServiceNow Fluent is now fully locked (map #2: nine ADRs + GLOSSARY + CODING_STANDARDS + AGENTS), but **no working application exists**. The `src/` tree still holds the stock *incident-manager* scaffold. There is a complete blueprint and nothing that runs.

## Solution

Build the brb-app Fluent application exactly as the ADRs specify, replacing the incident-manager scaffold, so that an employee can request time off, a manager can approve it with team-overlap context, and every balance stays correct and explainable from an append-only ledger.

Concretely, a clean checkout runs `npm run setup` (ADR 0009) and lands a working scoped app `x_snc_brb_app`: four domain tables + one notification table, a custom state machine, scoped roles and ACLs, a single Scripted REST facade, and a role-branched React SPA on one UI Page — plus an ATF regression suite that fails when any invariant I1–I9 or role rule N1 is broken.

## User Stories

### Employee — requesting and tracking leave
1. As an employee, I want to open the app and land on a home screen (E1) showing my requests and my balance per leave type, so that I can see my situation at a glance.
2. As an employee, I want to create a new leave request (E2) by picking a leave type, start date and end date with an optional note (max 500 chars), so that I can ask for time off in under a minute (F1, G1).
3. As an employee, I want the new-request form to show my current balance, the working days requested, and my balance after this request *before* I submit (F2), computed by the server so it can never drift from the gate (ADR 0005/0006).
4. As an employee, I want the working-day count to be Mon–Fri inclusive of both ends and to ignore weekends (ADR 0006, I9), so that the requested days match what actually comes off my balance.
5. As an employee, I want submit to be refused with a field-level error if end is before start (I2), the start is in the past or beyond one year (I8), the range is zero working days (I9), it overlaps another active request of mine (I3), or it exceeds my available balance (I6), so that I only ever submit valid requests.
6. As an employee, I want a submitted request to place a pending hold on my balance (so available = ledger balance − days held by my other Submitted requests of that type), so that I cannot double-spend days I have already asked for (I6, Hold).
7. As an employee, I want to view a single request's detail (E3) including its current state and decision reason if any, so that I know where it stands.
8. As an employee, I want to see my full request history and my ledger entries (E4), so that my balance is explainable entry by entry (G3).
9. As an employee, I want to cancel a Draft, Submitted, or Approved request, so that I can back out of a plan.
10. As an employee, I want cancelling an Approved request before its start date to restore the deducted days (RESTORE), and cancelling on or after the start date to be refused (F8), so that balances stay honest.
11. As an employee, I want to be notified when my request is submitted, approved, rejected, or cancelled (F7), so that I never have to chase a decision (G2).
12. As an employee, I want to be unable to see anyone else's requests, balance, or the team calendar (N1, PRD §2), so that privacy is preserved.
13. As an employee with no manager, I want submit to be blocked server-side with a clear message (issue #19, PRD §2), so that a request never dead-ends with no approver.

### Manager — deciding with context
14. As a manager, I want a queue (M1) of my direct reports' submitted requests, so that I can work through what needs a decision.
15. As a manager, I want a decision screen (M2) that shows the request plus my report's computed available balance, so that I decide with the balance in view.
16. As a manager, I want the decision screen to show which of my direct reports have Approved or Submitted requests overlapping this request's window, showing name and dates only — never leave type or note (F6, N7), so that I can judge team coverage without leaking private detail.
17. As a manager, I want to approve a submitted request, writing a DEDUCT ledger entry, provided the balance still covers the days (I6 re-check), so that the balance moves only when I commit the decision (F5).
18. As a manager, I want to reject a submitted request only with a reason of 1–500 chars (F4), releasing the hold, so that rejections are always explained.
19. As a manager, I want to be unable to decide my own request or a request from someone who is not my direct report (I4, N1), so that approvals are always independent.
20. As a manager, I want a second decision on an already-decided request to be refused (I7), so that a decision applies exactly once.
21. As a manager, I want to be notified of transitions on requests I own (F7), so that I stay in the loop.

### Admin — minimal setup
22. As an admin, I want to define leave types and retire them via an active flag (ADR 0004), so that the catalog of leave reflects policy.
23. As an admin, I want to grant an employee an annual allowance, writing a GRANT ledger entry that never overwrites a number (F10, I1), so that balances are always append-only.
24. As an admin, I want to pick an employee by id and name to grant to (A2, the "blind grant" seam, ADR 0008), without being able to read requests, ledgers, or decide anything (ADR 0003 standalone non-superuser admin).

### Cross-cutting — correctness, access, operability
25. As any user, I want every balance change to be an append-only ledger entry with no update or delete path (F9, I1, N2), so that the balance is auditable forever.
26. As any user, I want the balance to always equal the sum of signed ledger deltas per (employee, leave type) (ADR 0005, G3), so that it is correct and reconstructable.
27. As any user, I want all my traffic to go through one typed client (`brbApi`) to one Scripted REST facade (ADR 0004/0008), so that there is one versioned contract and one place errors are shaped.
28. As any user, I want each screen to load in a single round-trip from a screen-shaped composite endpoint (N3), so that the app feels fast.
29. As any user, I want errors returned as a consistent envelope carrying a request id that is shown and logged (N5, ADR 0004), so that a failure is diagnosable.
30. As an operator, I want a clean checkout to deploy and seed in one command (`npm run setup`, ADR 0009) with demo data on by default and opt-out for prod (`--demoData false`), so that onboarding and demos are trivial.
31. As an operator, I want re-deploying to update seed fixtures in place and never double-grant (idempotent via `Now.ID`/`keys.ts`, ADR 0009), so that deploys are safe to repeat.
32. As an operator, I want a post-deploy smoke check that asserts balance = ledger sum and available ≥ 0 for every seeded employee (reconciliation, ADR 0005/0009), so that a bad deploy is caught immediately.
33. As a developer, I want the incident-manager scaffold fully removed, so that `src/` contains only brb-app.
34. As a developer, I want notifications delivered by consumers of one registered platform event `x_snc_brb_app.state_changed` (ADR 0007), with the in-app channel as the fifth table and email deferred as a future additive consumer, so that delivery is decoupled and a failed delivery never blocks a transition (F7).
35. As an accessibility user, I want Horizon AA primitives plus semantic landmarks, labelled controls, keyboard operability, focus management, and `aria-live` on async/preview (N6, ADR 0008), so that the app is usable without a mouse.

## Implementation Decisions

All decisions are already locked; the build realizes them. Modules to build, each with its owning ADR:

- **Schema (ADR 0001):** four standalone `x_snc_brb_app_{leave_type,leave_request,ledger_entry,audit_event}` tables (no `task` inheritance; Employee = OOTB `sys_user`). `state` is canonical (not `status`); choices are lowercase string slugs — Leave Request `draft/submitted/approved/rejected/cancelled`, Ledger `grant/deduct/restore`. `delta` is signed so balance = `SUM(delta)`. Timestamps use OOTB `sys_created_on`.
- **State machine (ADR 0002):** one `StateModel` on `leave_request` owns **all** transition gating (the six PRD §4 transitions, forward-only; each invariant = one named `sttrm_transition_condition`). Five Business Rules own only plumbing/side-effects: `assign_state_model`, `compute_days`, `enforce_transitions` (via `global.STTRMModel`), `apply_ledger_effect` (one DEDUCT/RESTORE, validate-first/write-last), `record_transition` (Audit Event + `gs.eventQueue` of `state_changed`). I7 is structural (no re-decision transition + committed-state eval). N4 is validate-first/write-last + ledger-as-truth + reconciliation, **not** true two-record atomicity. Observe the enforcement-BR constraints in ADR 0002 §"Enforcement BR implementation constraints" (inline the enforcement script as a string, qualify `global.STTRMModel`, cross-scope privileges).
- **Roles & ACLs (ADR 0003):** three scoped roles `x_snc_brb_app.{employee,manager,admin}` (`manager` contains `employee`; `admin` standalone non-superuser). The `manager` role is the capability gate; the `sys_user.manager` field is the row key, making I4 "never own" structural. ACL matrix: N1 read scoping, one value-aware `state` write ACL for I4, draft-only field write locks for I5, append-only ledger/audit (no update/delete; admin creates `grant` only), `leave_type`+`note` field read ACLs for N7 defense-in-depth, `adminOverrides:false` on sensitive ACLs. The no-manager-submit block is enforced server-side (issue #19).
- **Data access facade (ADR 0004):** **one** custom scoped Scripted REST API (`RestApi()`, base `x_snc_brb_app`) is the single client path — no Table API, no GlideAjax, no processors. Handlers use `GlideRecordSecure` so ADR 0003 ACLs still enforce; plain `GlideRecord` only in the two named aggregations (`LeaveBalance` and the F6 overlap query, which owns the name+dates-only projection). Writes are intent-named action endpoints, one per transition (`/submit|approve|reject|cancel`, `/reject` requires reason); reads are screen-shaped composites (one round-trip). `allowWebServiceAccess` **off** on all four tables; `RestApi` authenticated + `enforceAcl:true`. The facade owns the N5 observability seam (request id, structured logs, error envelope `{ error: { code, message, requestId } }`).
- **Balance (ADR 0005):** one `LeaveBalance` Script Include is the sole home for ledger arithmetic. `balance = SUM(delta)` via `GlideAggregate` per (employee, leave_type), all-time (no leave-year filter in v1); `held = SUM(days)` of the employee's other `submitted` requests of that type; `available = max(0, balance − held)`. Returns one `{ balance, held, available }` object. Submit gate refuses `days > available`; approve re-check uses raw `balance`; F2 "balance after" = `available − days`. `LeaveBalance` takes a server-trusted `employee` only (never client input).
- **Working days (ADR 0006):** one server-side `WorkingDays` Script Include counts Mon–Fri calendar dates in `[start, end]`, both ends inclusive, whole days only. No Schedule/holiday calendar. One implementation, three callers (`compute_days` BR, the I9 condition, the balance-preview endpoint); the React preview reads the count from the endpoint. `WorkingDays` is a pure counter that may return 0; the I9 submit gate owns the zero-day refusal (`days ≥ 1`).
- **Notifications (ADR 0007):** per-transition notifications are consumer-side deliveries of the one registered event `x_snc_brb_app.state_changed`. In-app channel = a fifth table `x_snc_brb_app_notification` written by a `ScriptAction` consumer — one row per routed transition per recipient (requester + manager; `draft→cancelled` notifies no one), deduped on `(source_audit_event, recipient)`. Email is a deferred future `EmailNotification` consumer of the same event. ACLs per ADR 0003 style; a mark-as-read REST action updates `read`/`read_at`. Async on the default queue so a failed delivery never blocks the committed transition.
- **Client (ADR 0008):** one role-branched React SPA on a single UI Page (URLSearchParams routing), a strict four-layer stack (presentational → screens → hooks → `brbApi`, with `brbApi` the sole `fetch()` caller). `@servicenow/react-components` used as presentational primitives only; the Table-API connected / `RecordProvider` family is a named anti-pattern. Eight screens: E1 Home, E2 New Request, E3 Request Detail, E4 History & Ledger, M1 Queue, M2 Decide, A1 Leave Types, A2 Grant Allowance, plus a role-aware shell + `Forbidden` + error boundary. Finalizes the ADR 0004 contract adding `GET /me` (server-authoritative roles), `GET /manager/queue`, admin-only `GET /employees` (id+name blind grant). Hand-rolled hooks (no React Query v1); controlled forms + manual dirty-tracking; F2 preview server-driven; typed `AppError` from the N5 envelope. No draft UI v1 (E2 creates-then-submits; `PATCH /requests/{id}` contract-only).
- **Deploy & seed (ADR 0009):** `npm run setup` = `now-sdk build && now-sdk install`; `--demoData` true by default (prod opts out). Seed = Fluent `Record()` fixtures tagged `installMethod:'demo'` (routed to `unload.demo`), idempotent by construction via `Now.ID`/`keys.ts`. Fixture set: 1 admin + 1 manager + 2 employees (`sys_user`, employees' `manager` → the manager) + role grants (`sys_user_has_role`) + the Leave Types + one GRANT per employee per type. No Leave Requests / DEDUCT / RESTORE / Audit Events / Notifications (those come from exercising the live state machine). Reconciliation is a post-deploy smoke check reusing `LeaveBalance`, owned by the build/CI pipeline. Cross-table refs need `now-sdk dependencies --add tables sys_user sys_user_has_role`.
- **Authoring discipline:** follow `CODING_STANDARDS.md` throughout — `Now.ID`/`keys.ts` only (never fabricate a `sys_id`), `--frozenKeys` in CI, confirm before deleting any Fluent definition, `src/` layout and the module-vs-string-script rule, the four-layer client stack. Run the `now-sdk` orientation first (AGENTS.md rule 1). Removing the incident-manager scaffold is a `Table()`/`Record()`-class deletion — confirm with the user before deleting those definitions (AGENTS.md rule 4).

## Testing Decisions

Grounded in `docs/research/tdd-patterns-and-scope.md` (the SDK ships exactly one first-class test capability: ATF authored in Fluent, run on a sub-prod instance via `now-sdk cicd`). A good test asserts **external behavior at the invariant/contract boundary, not implementation details**, carries the invariant id in its name (`I1`…`I9`, `F4`, `N1` per PRD §6/§10), and covers a positive **and** a negative case wherever a rule has two sides.

- **Primary seam — the Scripted REST facade (confirmed with the user).** The single ADR 0004 facade, exercised at **L3** via ATF `atf.rest` + `atf.server`, is the one high seam where the ledger/state-machine/ACL invariants and role access (N1) surface. This is the heaviest layer and carries the product's core guarantees (G3, N1/N2, append-only). Test through the facade, not against the StateModel/Business Rules directly.
- **Modules tested:**
  - *Script Includes* `LeaveBalance` and `WorkingDays` at **L2** (ATF `atf.server.runServerSideScript` + Jasmine 3.1), as installed on the instance (GlideAggregate for `LeaveBalance`).
  - *State machine, Business Rules, ACLs, ledger, and the whole facade* at **L3** — I1–I9, F4, F5, F6/N7 projection, F7, F8, and N1 for all three roles (`createUser` + `impersonate`), per the invariant→layer→mechanism map in the research doc §3a.
  - *React SPA* at **L5** (`uiTestScript` + TestingLibrary) as a **thin happy-path smoke set only** (submit→decide, G1); authorization is already asserted at L3, so keep L5 small and brittle-aware. Verify `@servicenow/react-components` render into inspectable DOM before investing (research §6).
- **Optional fast inner loop — L1, narrow (confirmed with the user).** An off-instance Vitest suite is recommended but **optional and scoped to genuinely pure, single-home logic only**: `WorkingDays` weekday arithmetic (Mon→Fri=5, Fri→Mon=2, Wed→Wed=1, Sat→Sun=0) and client `useForm`/dirty-state, `AppError`/N5-envelope parsing, submit-disable logic. It is an unsupported add-on, Glide must never be mocked into false green, and a local green **never** substitutes for the invariant's mandated ATF test (PRD §10). L0 static validation (`now-sdk build` type-check, `--frozenKeys`, lint) is free and always on.
- **Prior art in the codebase:** none yet (no tests exist). The authoritative patterns and the fixed scope are the research doc (`docs/research/tdd-patterns-and-scope.md` §3–§5) and the SDK `atf-guide`/`ci-integration` topics it cites. Co-locate ATF tests with their Fluent source as `*.now.ts`, group them in one gating `TestSuite()` ("BRB Regression"), and wire `now-sdk cicd testsuite run` into CI after `install`, with `now-sdk build --frozenKeys` as the pre-merge guard. Author the `balance = SUM(delta)` reconciliation once and include it in the gating suite (it is both the I1 assertion and the deploy-time check).
- **Explicitly not tested:** OOTB platform behavior and default CRUD with no custom rule behind it; PRD §3 non-goals; `PATCH /requests/{id}` beyond an L3 REST-contract check (unused by the v1 client). Never hardcode `sys_id`s in tests (AGENTS.md rule 3).

## Out of Scope

- **Re-deciding the design.** Every realization choice is locked in the ADRs; this build does not reopen them. A genuine conflict surfaced during the build is flagged (AGENTS.md rule 2), not silently overridden.
- **PRD v1 non-goals (PRD §3):** payroll integration, accrual engines, carry-over, calendar sync, public-holiday/working-day calendars, multi-country rules, half-days and hourly leave, delegation chains / out-of-office approvers, mobile app, team calendar for employees.
- **Email delivery channel (PRD assumption 5):** the notification *interface* (the `state_changed` event + in-app table) is in scope; a concrete email `EmailNotification` consumer is deferred past v1.
- **A balance cache (N3 fallback):** v1 is compute-on-read. A transactional + reconciled cache is a conditional future decision only if the p95 target is missed.
- **`sys_user` ACLs** beyond what the blind-grant `GET /employees` endpoint needs (ADR 0003/0008).
- **The CI/instance wiring itself** (auth env vars, test-instance targeting, confirming ATF is enabled) — a separate setup task (research §6; candidate for the `wizard` skill).

## Further Notes

- This spec is the input to a `to-issues` breakdown; expect it to decompose into tracer-bullet vertical slices (the user chose a whole-app spec over a thin-slice-first spec, so slicing happens at `to-issues` time). A natural first slice is the submit→approve happy path (F1–F5) end-to-end through one table, the facade, and one screen, since it touches every layer.
- Base branch for the map's work is `feat/2-fluent-design` (ADR/standards docs live there); confirm with the user where the build effort should branch from before starting.
- The build must begin by running the `now-sdk` orientation and reading GLOSSARY + the relevant ADRs + CODING_STANDARDS (AGENTS.md rules 1–2), and must use the glossary's words throughout.
- Open items to resolve at authoring time (research §6): confirm the dev/test instance has ATF enabled; verify `atf.uiTestScript` reach into the `@servicenow/react-components` DOM before committing to L5 depth.

