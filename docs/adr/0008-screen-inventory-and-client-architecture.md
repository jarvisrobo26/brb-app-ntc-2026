# Screen inventory and client component architecture

Status: accepted

## Decision

The brb-app React client is **one role-branched Single Page Application served
from one UI Page**, structured as a strict four-layer stack over the ADR 0004
Scripted REST facade. This ticket (#12) fixes three things ADR 0004 left open:
the **screen inventory**, the **component/service layering** over the chosen
data-access pattern, and — because "the exact read list finalizes with the screen
inventory" (ADR 0004) — the **finalized client↔facade endpoint contract**,
adding three new routes (`GET /me`, `GET /manager/queue`, `GET /employees`).

The client uses `@servicenow/react-components` as **presentational primitives
only**. The `ui-page-guide`'s headline patterns — `NowRecordListConnected`,
`RecordProvider` + `FormColumnLayout` + `FormActionBar`, `useRecord()` — are
Table-API **connected** components; using them would reopen the raw Table API
path that ADR 0004 deliberately closed (`allowWebServiceAccess` off on all four
tables). They are therefore a **named anti-pattern** here: every byte of
server data reaches the client through the single typed `brbApi` service.

This realizes map direction #3 (the React UI Page is the only delivery surface)
and is deliberately a **thin UI over the already-guarded server model**: it adds
no authorization or business logic. N1/N7/I4/I5 stay in the ADR 0003 ACLs, the
#6 StateModel + Business Rules, and the ADR 0004 facade handlers. The client's
jobs are routing, presentation, form capture, and consuming the N5 error
envelope.

## Delivery shape — one role-branched SPA

One `UiPage` hosts the whole app. Navigation is **URLSearchParams-based** (map
`ui-page-guide` default: `?view=home`, `?view=decide&id=123`), with browser
back/forward via `popstate` and Polaris-iframe title handling. No router library
and no hash routing.

The shell is **role-aware**: on load it calls `GET /me` and renders only the
views the caller's roles permit. Because `manager` contains `employee` (ADR
0003), a manager moves between their own requests and their decision queue
without a page reload. A user who lands on a view their roles forbid gets the
shared **`Forbidden`** screen — a UX courtesy only; the server ACLs (ADR 0003)
and facade authorization (ADR 0004) remain the real enforcement.

## Screen inventory

Eight screens plus shared chrome, each a view in the one SPA, each mapped 1:1
onto facade endpoints.

| # | Screen | Route | Roles | Primary endpoint(s) |
|---|---|---|---|---|
| — | App shell (role-aware nav) · `Forbidden` · error boundary | — | all | `GET /me` |
| E1 | **Home** — balance + available per leave type, active/recent requests | `?view=home` | employee | `GET /my/dashboard` |
| E2 | **New Request** — F1 form (type/start/end/note) + F2 live preview | `?view=new` | employee | `GET /leave-types`, `GET /balance-preview` |
| E3 | **Request Detail** — request + audit timeline + decision reason; cancel (F8) | `?view=request&id=` | employee (+ its manager) | `GET /requests/{id}` |
| E4 | **History & Ledger** — full request history + ledger entries (G3) | `?view=history` | employee | `GET /my/history` |
| M1 | **Queue** — direct reports' Submitted requests | `?view=queue` | manager | `GET /manager/queue` |
| M2 | **Decide** — request + available + F6 overlap + approve/reject | `?view=decide&id=` | manager | `GET /requests/{id}/decision-view` |
| A1 | **Leave Types** — list + create/edit (name, allowance, active) | `?view=leave-types` | admin | `GET/POST/PATCH /leave-types` |
| A2 | **Grant Allowance** — pick employee + type + days (F10) | `?view=grants` | admin | `GET /employees`, `POST /grants` |

Two granularity calls are baked in:

- **E4 folds request-history and the ledger into one screen.** The PRD and this
  ticket phrase them together, and the ledger is what makes the balance
  *explainable* (G3), so the historical request list and the ledger entries that
  moved the balance belong on one screen.
- **E1 Home stays distinct from E4.** Home is the at-a-glance active view
  (current balances + in-flight requests, serving G1); E4 is the full historical
  / audit view. Keeping them separate keeps the `/my/dashboard` payload lean.

### Draft has no UI in v1

`Draft` is a real model state (ADR 0001/0002), but v1 exposes **no draft-
management UI**. E2 **creates a Draft then immediately submits** in one user
action (`POST /requests` → `POST /requests/{id}/submit`), serving G1 (<60 s to
submit). ADR 0004's `PATCH /requests/{id}` (edit-draft) stays in the contract
but is **unused by the v1 client**: there is no draft list and no draft-edit
screen. To change a Submitted/Approved request the user cancels and submits
anew, exactly as the PRD prescribes ("Only Draft is editable… cancel it and
submit a new one").

## Component / service layering

A strict four-layer stack with a **one-way dependency rule**:

1. **Presentational** — `@servicenow/react-components` primitives (`Card`,
   `Button`, `Input`, `Textarea`, `Select`, `DatePicker`, `Modal`, `Tabs`,
   `Alert`, …) plus tiny local presentational components. Props in, callbacks
   out, no data fetching.
2. **Screens / containers** — one per view (`screens/`). Own view state, call
   hooks, compose presentational components.
3. **Data / action hooks** — `hooks/` wrapping `brbApi` (`useDashboard()`,
   `useHistory()`, `useRequest(id)`, `useDecisionView(id)`, `useBalancePreview()`,
   `useLeaveTypes()`, `useManagerQueue()`, plus action hooks for the transitions
   and admin writes). Each exposes `{ data, loading, error, refetch }` and/or
   action functions, and normalizes the N5 error envelope into a typed
   `AppError`.
4. **Service client** — `services/brbApi.ts`: the single typed module, one
   function per facade endpoint, and **the only code in the client that calls
   `fetch()`** (restating ADR 0004). It adds `X-UserToken: window.g_ck`,
   surfaces the request-id, and parses the error envelope. Shared request/
   response TypeScript types live in `types/`.

**Dependency rule:** components never import `brbApi` directly — only hooks call
it; `brbApi` is the sole `fetch()` site. This keeps the "single pattern"
guarantee of ADR 0004 structurally visible in the client, not just a convention.

### Data-fetching: hand-rolled hooks, no React Query/SWR

A small `useAsync` plus the per-resource hooks above cover all data flow. No
data-fetching library is added in v1: there is nothing to cache (ADR 0005 is
compute-on-read, no cache v1), reads are coarse single-round-trip composites
(ADR 0004, N3), and keeping the sanctioned-dependency surface small matters for a
scoped app. React Query/SWR remain a future option if caching/invalidation ever
become real.

### State management

React Context for cross-cutting state only: a **`SessionContext`** (identity +
resolved roles + `hasManager`, from `GET /me`) and navigation helpers. Everything
else is local screen state. No Redux / global store.

## Forms, dirty-state, and the F2 live preview

Because the connected `RecordProvider` family is out (so `useRecord().form
.isDirty` is unavailable), forms are **controlled local-state forms** with a
small shared `useForm` helper. Dirty-state is tracked **manually** (compare
against initial values) and warns on in-app navigation via the `Modal` component
and on `beforeunload` — the patterns-guide discipline, implemented over our own
state instead of `useRecord`.

**F2 live preview** is a **debounced (~300 ms)** `GET /balance-preview` on
`(type, start, end)` changes. The **server is the single source of truth** for
the working-day count (I9 / `WorkingDays`) and for balance-after (ADR 0005): the
client does **no** day math, so the preview and the I6 submit gate can never
drift. Submit is disabled when days ≤ 0, over-available, or the form is invalid;
the server gate is still the real guard.

## Error & loading conventions (N5 consumption)

`brbApi` parses the ADR 0004 envelope `{ error: { code, message, requestId } }`
into a typed **`AppError`** carrying the `requestId`. Shared `<LoadingState>` and
`<ErrorState>` presentational components render the hook-exposed `loading` /
`error` uniformly; the **`requestId` is shown in the error UI** (so a user can
quote it to support) and logged — **never swallowed** (N5). A **top-level React
error boundary** catches render crashes so a thrown component never blanks the
page.

## Admin employee-picker — a new seam (F10)

A2 Grant needs to select an employee, but ADR 0003 makes Admin **standalone &
non-superuser** (no request/ledger read) and puts `sys_user` ACLs **out of
scope**, so the client has no sanctioned way to list employees. This ADR adds
**one admin-only facade endpoint, `GET /employees`**, returning **id + name
only** of users holding the `employee` role. The facade reads `sys_user`
server-side (admin-gated), keeping ingress on the single pattern rather than
re-opening the Table API or using a `sys_user` reference picker. The grant is
**blind**: no balance is shown, because Admin cannot read the ledger (ADR 0003),
and F10 only requires that a GRANT be written, never that a number be shown or
overwritten.

## Accessibility baseline (N6, WCAG 2.1 AA)

Primary strategy: **lean on the Horizon `@servicenow/react-components`**, which
ship AA-accessible primitives. Recorded baseline every screen follows: semantic
landmarks, labeled form controls, full keyboard operability (no inline
handlers), **focus management on view change and in modals**, Horizon color
tokens for contrast, field errors associated via `aria-describedby`, and an
`aria-live` region for async errors and the F2 preview update. Detailed
per-component a11y is a build concern. This settles the N6 item the map flagged
as "sharpens once the screen inventory is decided."

## Finalized facade endpoint contract

The exact client↔facade routes (ADR 0004 said these finalize here). **Three are
new in this ADR (⭐);** the rest confirm ADR 0004.

| Verb / route | Screen | Returns / payload |
|---|---|---|
| ⭐ `GET /me` | shell | identity + brb roles + `hasManager` |
| `GET /my/dashboard` | E1 | balance+available per type, active/recent requests |
| ⭐ `GET /my/history` | E4 | full request history + ledger entries |
| `GET /requests/{id}` | E3 | one request + audit timeline |
| `GET /leave-types` | E2 / A1 | active types (all, incl. inactive, for admin) |
| `GET /balance-preview?type=&start=&end=` | E2 | balance, working days (I9), balance-after |
| ⭐ `GET /manager/queue` | M1 | direct reports' Submitted requests |
| `GET /requests/{id}/decision-view` | M2 | request + available + overlap (name+dates only, N7) |
| ⭐ `GET /employees` *(admin)* | A2 | employees (id + name only) |
| `POST /requests` · `POST …/submit` | E2 | create Draft → submit |
| `POST …/approve` · `…/reject` (reason) · `…/cancel` | M2 / E3 | transitions |
| `POST /grants` *(admin)* | A2 | F10 GRANT |
| `POST /leave-types` · `PATCH /leave-types/{id}` *(admin)* | A1 | maintain types |
| `PATCH /requests/{id}` | — | contract-only; unused by the v1 client (no draft UI) |

## Considered options

- **One role-branched SPA vs one UI Page per role.** Chose one SPA: matches the
  `ui-page-guide` default, a single build/entry/service layer, and lets a manager
  (who is also an employee) switch between their requests and their queue without
  a reload. Per-role pages would duplicate the shell and service layer and split
  the `manager`-contains-`employee` experience across endpoints.
- **Presentational `@servicenow/react-components` vs the connected / record-
  context family.** Chose presentational-only. `NowRecordListConnected` /
  `RecordProvider` talk to the Table API directly, which would force
  `allowWebServiceAccess: true` and reopen the ingress ADR 0004 closed — a direct
  contradiction of the "single pattern" decision. The accepted cost: we forgo the
  OOTB list/form wiring and feed Horizon primitives from our own hooks.
- **Server-authoritative `GET /me` vs client globals (`g_user`).** Chose `/me`:
  client globals don't know our scoped `x_snc_brb_app.*` roles, and role-gating
  the shell from untrusted client state would be fragile. `/me` makes identity +
  roles server-derived; it is a courtesy gate over the real ACL enforcement.
- **Hand-rolled hooks vs React Query/SWR.** Chose hand-rolled: no cache in v1
  (ADR 0005), coarse single-round-trip reads (ADR 0004), and a smaller dependency
  surface. The library stays a future option.
- **E4 combined History & Ledger vs separate screens; E1 separate from E4.**
  Chose combined E4 (history is only explainable alongside the ledger, G3) and a
  distinct lean E1 (at-a-glance active view, G1).
- **No draft UI vs a draft list + edit screen.** Chose no draft UI: E2
  creates-then-submits in one action (G1), and the PRD already says the way to
  change a non-Draft request is cancel-and-resubmit. `PATCH /requests/{id}` stays
  contract-only.
- **Admin `GET /employees` facade route vs a `sys_user` reference picker / Table
  API.** Chose the facade route (id+name, admin-gated): the picker/Table API
  would reopen the closed ingress and need `sys_user` client read that ADR 0003
  ruled out of scope. Grant stays blind to respect Admin's non-superuser read
  boundary.

## Consequences

- **ADR 0004's read list is now finalized**, with three new routes (`/me`,
  `/manager/queue`, `/employees`). The write surface is unchanged from ADR 0004.
- **`allowWebServiceAccess` stays off** on all four tables: the presentational-
  only rule means nothing in the client reaches for the Table API, so the ingress
  ADR 0004 closed stays closed.
- **A new seam against ADR 0003:** `GET /employees` reads `sys_user` server-side
  for Admin. ADR 0003 kept `sys_user` ACLs out of scope; the authoring ticket
  must gate this route to Admin and project to id+name only. `GET /me` similarly
  resolves the caller's scoped roles server-side.
- **The authoring tickets build to this contract.** Screen inventory, the four-
  layer `src/client/` layout (`screens/ · components/ · hooks/ · services/ ·
  types/ · contexts/ · utils/`), the `brbApi`-only-`fetch()` rule, and the N5/N6
  conventions here are the spec the build follows; replacing the incident-manager
  scaffold is the out-of-scope build effort (map).
- **N6 is now baselined** (was "not yet specified" in the map). Detailed
  per-component a11y remains a build concern.
- **CODING_STANDARDS Fluent-authoring section (#15)** is the home for the durable
  client-authoring rules (file layout, the presentational-only rule, the
  `brbApi`-only-`fetch()` rule); this ADR is the source #15 pulls from, not a
  second copy.
- **Forms are hand-built.** Without `RecordProvider`, dirty-state and validation
  are our code; the `useForm` helper keeps that in one place, and the F2 preview's
  server-only day math keeps gate and preview from drifting.
