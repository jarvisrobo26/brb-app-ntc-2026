# Glossary

Ubiquitous language for **brb-app** ("Be Right Back"), a leave tracker built as a ServiceNow Fluent application with the Now SDK. Employees apply for leave and their manager approves it.

## Domain

**Employee**
A person who requests leave. Represented by a ServiceNow user record (`sys_user`) holding the `x_snc_brb_app.employee` role — the base role every app user has.
_Avoid_: staff, associate, user (when meaning the person requesting leave).

**Manager**
The person who approves or rejects an Employee's Leave Request. Derived from the Employee's `manager` reference on their user record; the Employee does not choose them. Deciding a request requires **both** the `x_snc_brb_app.manager` role (a capability gate) **and** being the requester's `sys_user.manager` (the row-scoping relationship) — which is why a Manager can never decide their own request. Every Employee has exactly one Manager; an Employee with no `manager` on their user record has no Manager and so cannot submit a Leave Request — it has no one to route to and stays in Draft.
_Avoid_: approver (as a separate role), supervisor.

**Admin**
The person who defines Leave Types and grants annual allowances. Holds the standalone `x_snc_brb_app.admin` role, which does **not** contain Employee or Manager: an Admin cannot view or decide Leave Requests.
_Avoid_: administrator, superuser.

**Leave Request**
A single submission by an Employee asking for time away over a date range. The central record of the app. An Employee _applies for leave_ by creating a Leave Request.
_Avoid_: leave application, time-off request, leave form.

**Approval**
The Manager's decision on a Leave Request: approved or rejected.
_Avoid_: sign-off, authorisation.

**State**
Where a Leave Request sits in its lifecycle: Draft, Submitted, Approved, Rejected or Cancelled. The only editable state is Draft; Rejected and Cancelled are terminal.
_Avoid_: status (realized as the `state` field on the Leave Request table).

**Leave Type**
The category a Leave Request falls under (for example sick or casual leave), carrying an annual allowance in days.
_Avoid_: leave category, leave kind.

**Leave Balance**
The number of leave days an Employee has remaining for a Leave Type, computed on read as the all-time sum of their Ledger Entry deltas for that type. Scoped to one (Employee, Leave Type) pair; derived only from the Ledger, never from the Leave Type's annual allowance.
_Avoid_: leave quota, entitlement (unless the two are later distinguished).

**Available Balance**
The days an Employee can actually commit to a new Leave Request of a Leave Type: the Leave Balance minus the days held by their other Submitted requests of that type (I6), never shown below zero. The I6 submit gate refuses a request whose days exceed it.
_Avoid_: remaining balance, free balance.

**Hold**
The days a Submitted Leave Request reserves against an Employee's available balance before any Ledger Entry exists. A hold is not a Ledger Entry: only approval writes a DEDUCT. The hold is released when the request is rejected or cancelled while Submitted (I6).
_Avoid_: reservation, pending deduction, provisional balance.

**Ledger Entry**
An append-only record of a single change to an Employee's Leave Balance. Its kind is GRANT (an allowance), DEDUCT (an approval) or RESTORE (a cancelled approval), and it carries a signed delta in days. The Ledger is the source of truth for balance.
_Avoid_: transaction, balance adjustment.

**Audit Event**
An append-only record of one Leave Request state change: the request, the actor, and the from/to State.
_Avoid_: history entry, log entry, activity.

**Notification**
An in-app message telling a recipient that one of their Leave Requests changed State. One Notification is created per routed transition per recipient — the requester and their Manager — and carries a read/unread state. Notifications are delivered by **consuming** the Leave Request's state-change event, never by the state machine itself, so a failed delivery never blocks a transition; email is a future channel behind the same event. Distinct from an Audit Event: an Audit Event is one immutable record of a transition, a Notification is a per-recipient, readable message about it.
_Avoid_: alert, email (as a synonym for the in-app Notification), toast.

**Working Day**
A Monday-to-Friday calendar day that counts toward a Leave Request's duration. A request's days requested (I9) is the count of Working Days in its date range, start and end inclusive; a range with zero Working Days cannot be submitted. Weekends (Saturday, Sunday) are the only non-working days — public holidays are not modelled and there is no Schedule or holiday calendar.
_Avoid_: business day, workday.

**Seed data**
The minimal set of records a clean scaffold loads so the app can be demonstrated: one Admin, one Manager and two Employees (the Employees' `manager` set to the Manager and each user granted the right role), the Leave Types, and one GRANT Ledger Entry per Employee per Leave Type so balances are non-zero. Loaded as demo data by the single deploy command. Seed data contains no Leave Requests, DEDUCT/RESTORE Ledger Entries, Audit Events or Notifications — those are produced by exercising the live app during the demo.
_Avoid_: fixtures, test data, sample data, demo (unqualified).

## ServiceNow / Now SDK

**Scope**
The namespace that owns the app's metadata. For this app: `x_snc_brb_app` (`now.config.json`). Custom tables are prefixed with it.

**Fluent**
The TypeScript DSL for defining ServiceNow metadata (tables, ACLs, business rules, UI pages) in `.now.ts` files under `src/fluent/`.

**Table**
A ServiceNow database table, defined in Fluent with `Table()`. Names must start with the scope prefix.

**Now.ID**
`Now.ID['key']` gives a Fluent record a stable identity. Never hand-write sys_ids.

**keys.ts**
The generated file (`src/fluent/generated/keys.ts`) mapping each `Now.ID` key to its sys_id. Commit it. Removing a record's Fluent code can generate a delete record on upgrade, so confirm before deleting definitions.

**sys_id**
The 32-character unique identifier of a ServiceNow record.

**UI Page**
A standalone page served at an endpoint such as `x_snc_brb_app_<name>.do`. The app's React client is delivered through one — a single role-branched SPA whose views are selected via `URLSearchParams` (no router library, no hash routing).

**Screen**
One view of the React SPA, selected by a `?view=` parameter (for example `?view=home`, `?view=decide&id=`). The app has eight: the employee's Home, New Request, Request Detail and History & Ledger; the manager's Queue and Decide; and the admin's Leave Types and Grant Allowance. Which Screens a user sees is gated by their roles.
_Avoid_: page (reserved for the single UI Page), tab, route.

**brbApi**
The single typed client-side service module (`src/client/services/`) that is the **only** code in the React client that calls `fetch()`. It exposes one function per Scripted REST API endpoint, adds the `X-UserToken` header, and parses the N5 error envelope into a typed error. React components never fetch directly; they reach `brbApi` only through data/action hooks.
_Avoid_: api client, service (unqualified), data layer.

**Session**
The current user's server-authoritative identity for the client: who they are, which brb roles they hold (`employee`/`manager`/`admin`), and whether they have a manager (the "no manager ⇒ cannot submit" rule). Fetched once via the `GET /me` facade route and held in a React context; the client never infers roles from client-side globals such as `g_user`.
_Avoid_: current user, login, auth state.

**Scripted REST API**
The single custom scoped REST service (base `x_snc_brb_app`) that is the **only** path between the React client and the server. All reads and writes go through it; the client never uses the OOTB Table API or GlideAjax. Handlers read and write with `GlideRecordSecure` so ACLs still enforce, and own the F6 overlap projection (N7) and N5 observability.
_Avoid_: Table API (as the client data path), GlideAjax, processor, endpoint (as a synonym for the whole API).

**Business Rule**
Server-side logic that runs when a record is inserted, updated, deleted or queried. Owns the Leave Request's side-effects (ledger, Audit Event, notification) and plumbing — never transition gating.

**State Model**
The ServiceNow metadata that defines a table's states and the allowed transitions between them, and gates each transition. The Leave Request's lifecycle (its State transitions) is a custom State Model; transition gating lives here, not in a Business Rule.
_Avoid_: workflow, lifecycle engine, status machine.

**ACL**
Access control rule restricting who can read or write a table or field. Enforces N1 (an Employee only sees their own Leave Requests; a Manager also sees their direct reports') and N7 (leave type and note visible only to requester and manager). Row scoping is by the `requester == me || requester.manager == me` ownership check, not by role.

## Resolved decisions

Every question that was once open is now settled; each points to where the decision lives.

Resolved — behaviour when an Employee has no manager: they cannot submit a Leave Request (see PRD §2 "Users and roles"); captured in the **Manager** and **Session** terms above.

Resolved — see [ADR 0001](docs/adr/0001-four-table-schema-and-status-choice-model.md): the four table names, their fields, the Leave Request `state` choice values, and the Ledger Entry `entry_kind` choice values.

Resolved — see [ADR 0002](docs/adr/0002-custom-state-machine.md): the Leave Request state **transitions** and how each is gated — a custom State Model owns transition gating, Business Rules own side-effects, and I7 (one decision per request) is enforced by the forward-only transition graph.

Resolved — see [ADR 0003](docs/adr/0003-role-and-acl-model.md): the three scoped **roles** (`employee`/`manager`/`admin`) and the **ACL matrix** enforcing N1/N7 — row scoping via the `requester`/`requester.manager` ownership check, I4 as a value-aware `state` write ACL, append-only Ledger/Audit, and a standalone non-superuser Admin.

Resolved — see [ADR 0004](docs/adr/0004-client-server-data-access-pattern.md): the **client-to-server data access pattern** — one custom scoped Scripted REST API is the single path (no Table API, no GlideAjax); `GlideRecordSecure` handlers keep the N1/I4/I5 ACLs enforced, intent-named action endpoints drive the transitions, screen-shaped reads own the N7 overlap projection, and the facade owns the N5 observability seam.

Resolved — see [ADR 0005](docs/adr/0005-balance-and-available-days-computation.md): the **balance and available-days computation** — the `LeaveBalance` Script Include computes `balance = SUM(delta)` (all-time, per Employee/Leave Type) and `available = max(0, balance − held)` via `GlideAggregate`, returning one `{ balance, held, available }` object shared by the I6 gates and the F2 preview; the submit gate checks `available`, the approve re-check checks raw `balance`, and `LeaveBalance` only ever receives a server-trusted `employee`.

Resolved — see [ADR 0006](docs/adr/0006-working-day-counting.md): the **working-day counting approach (I9)** — a single server-side `WorkingDays` Script Include counts Mon–Fri calendar dates in the range, start and end inclusive; weekends are the only non-working days, with no Schedule and no holiday calendar; the utility is a pure counter that may return `0` (the `I9` submit gate owns the zero-day refusal), and the client F2 preview reads its result from the `balance-preview` endpoint rather than reimplementing the count.

Resolved — see [ADR 0007](docs/adr/0007-notification-mechanism.md): the **notification mechanism (F7)** — notifications are consumer-side deliveries of one registered platform event (`x_snc_brb_app.state_changed`, fired by the ADR 0002 `record_transition` after-BR), never wired into the state machine; a fifth `x_snc_brb_app_notification` table is the in-app channel, written by a `ScriptAction` consumer (requester + Manager, one row per routed transition per recipient, deduped on `source_audit_event`+`recipient`), with email a future additive consumer of the same event; read-scoped `recipient == me`, mark-as-read via a REST action, async on the default queue so a failed delivery never blocks the transition (N4/N5).

Resolved — see [ADR 0009](docs/adr/0009-deploy-and-seed-data.md): the **single-command deploy and seed-data approach (N8)** — a clean scaffold deploys and seeds in one command (`npm run setup` = `now-sdk build && now-sdk install`, demo data loaded by default); Seed data is authored as idempotent Fluent `Record()` fixtures tagged `installMethod: 'demo'` (not an install script or post-install Business Rule), keyed via `Now.ID` so re-deploys update in place and never double-grant; the fixture set is the four users + role grants + Leave Types + one GRANT per Employee per type, with no Leave Requests or downstream records; and the "reconciliation on every deploy" is a post-deploy smoke check (reusing ADR 0005 `LeaveBalance`) owned by the build/CI pipeline, flagged to #15.

Resolved — see [ADR 0008](docs/adr/0008-screen-inventory-and-client-architecture.md): the **screen inventory and client component architecture** — one role-branched React SPA of eight Screens over the ADR 0004 facade; `@servicenow/react-components` used as presentational primitives only (the connected/`RecordProvider` family is forbidden, as it would reopen the Table API); a four-layer stack (presentational → screens → hooks → `brbApi`) where `brbApi` is the sole `fetch()` caller; three new facade routes (`GET /me`, `GET /manager/queue`, admin-only `GET /employees`); server-driven F2 preview and the N6 accessibility baseline.
