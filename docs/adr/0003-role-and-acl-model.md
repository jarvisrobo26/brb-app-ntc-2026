# Role and ACL model for N1/N7

Status: accepted

## Decision

We realize PRD §2 (roles) and the non-functional guarantees **N1** (no
cross-employee data access, enforced server-side) and **N7** (leave type and
note visible only to the requester and their manager; overlap views omit them)
with **three custom scoped `Role`s** plus a **fixed `Acl` matrix** over the four
`x_snc_brb_app_*` tables. This realizes map ADR direction #4 and takes the seams
ADR 0002 handed to this ticket: **I4** (only the assigned manager decides, never
their own request) is a *write ACL*, **I5** (only Draft is editable) is a
field-level write lock, and the **append-only** guarantees for Ledger and Audit
(I1/F9/N2) are modify ACLs — #6 owns transition *mechanics*, #7 owns *who may
act*.

The division of labour is deliberate: the **`manager` role is a capability
gate**, while the **`sys_user.manager` field is the row-scoping key**. A request
is visible/decidable to me only when `requester == me` **or** `requester.manager
== me`. I4's "never their own" then falls out structurally — a manager's own
request has `requester.manager = their own boss`, never themselves, so they can
never satisfy the decision ACL on it.

### Roles

Three roles, all scope-prefixed, defined with the Fluent `Role()` API. `manager`
contains `employee` (a manager also requests their own leave); `admin` is
**standalone** — per PRD §2 it defines leave types and grants allowances but
**cannot view or decide requests**, so it must not inherit `employee`/`manager`.

| Role | `name` | `containsRoles` | Persona |
|---|---|---|---|
| Employee | `x_snc_brb_app.employee` | — | Base. Create/submit/cancel own requests; view own balance, ledger, request history. |
| Manager | `x_snc_brb_app.manager` | `[employee]` | Decide direct reports' requests; see reports' overlap. Still an employee. |
| Admin | `x_snc_brb_app.admin` | — (standalone) | Define leave types; grant annual allowances. **No** request/ledger read, **no** decide. |

Role assignment is **explicit / admin-driven** in v1 (not auto-derived from being
listed as someone's `sys_user.manager`). **Deciding requires both** the `manager`
role **and** the relationship — neither alone suffices. The N8 seed wires this
up: `admin`→admin, `manager`→manager (gets `employee` by containment), two
employees→`employee`, and both employees' `sys_user.manager` set to the manager.

### ACL matrix

All `type: 'record'`. **`adminOverrides: false`** on every ACL below unless noted:
our scoped `admin` is not a super-user, and keeping even the platform `admin`
role subject to these rules is what makes N1/N2 testable. Row/ownership logic is
expressed as `script` (the `roles` list is the coarse capability gate; the script
is the fine-grained ownership check — the ACL "Trinity" ANDs them). `gs` calls
below use `gs.getUserID()` for the current user.

**`x_snc_brb_app_leave_request`** — N1 + I4 + I5

| Op | Field | Roles | Script (ownership / authz) | Enforces |
|---|---|---|---|---|
| `read` | *(record)* | `employee` | `current.requester == me \|\| current.requester.manager == me` | **N1** — rows filtered to requester + manager; direct GET by sys_id for anyone else is denied |
| `read` | `leave_type` | `employee` | `current.requester == me \|\| current.requester.manager == me` | **N7** (defense-in-depth; see note) |
| `read` | `note` | `employee` | `current.requester == me \|\| current.requester.manager == me` | **N7** (defense-in-depth) |
| `create` | *(record)* | `employee` | `current.requester == me` | Open only your own request, never on another's behalf |
| `write` | `leave_type`, `start_date`, `end_date`, `note` | `employee` | `current.requester == me && current.state == 'draft'` | **I5** — content editable only while Draft |
| `write` | `state` | `employee` | value-aware (below) | **I4** — who may drive each transition |
| `write` | `decision_reason` | `manager` | `current.requester.manager == me && current.requester != me` | Manager supplies the rejection/decision reason (F4) |
| `delete` | *(record)* | — | `answer = false` | Requests are **cancelled, never deleted** (protects N2 trail) |

`approver`, `decided_at`, `days`, `number` and `sttrm_model` are **server-set**
(the #6 Business Rules / autonumber) and have **no user write ACL**, so they are
denied to users by default and written only by trusted scoped BR code.

> **Superseded in part — see the "Amendment — `state` ACL is coarse; I4 moves to a
> Business Rule" section at the end.** The script below reads `current.state` as the
> pending new value; on the platform it is the *old* value, so it silently denies
> approve/reject. Kept as the original decision record.

The `state` write ACL is the one value-aware script (it encodes I4; #6's state
model still owns whether the transition itself is legal):

```js
var me = gs.getUserID();
var next = current.state;                 // the pending new value
var isRequester = (current.requester == me);
var isAssignedManager =
    gs.hasRole('x_snc_brb_app.manager') &&
    current.requester.manager == me &&
    current.requester != me;              // I4 "never their own"
if (next == 'approved' || next == 'rejected') {
    answer = isAssignedManager;           // only the assigned manager decides
} else if (next == 'submitted' || next == 'cancelled' || next == 'draft') {
    answer = isRequester;                 // employee drives own non-decision moves
} else {
    answer = false;
}
```

This is exactly what the state model (#6) does **not** do: stop an employee from
writing `state = 'approved'` on their own request.

**`x_snc_brb_app_ledger_entry`** — append-only (I1/F9/N2), own-balance read

| Op | Roles | Script | Enforces |
|---|---|---|---|
| `read` | `employee` | `current.employee == me` | Employee views own ledger only |
| `create` | `admin` | `current.entry_kind == 'grant'` | **F10** — admin grants allowances; DEDUCT/RESTORE come from trusted BRs (no ACL path) |
| `write` | — | `answer = false` | **Append-only** |
| `delete` | — | `answer = false` | **Append-only** |

**`x_snc_brb_app_audit_event`** — append-only, mirrors request row access

| Op | Roles | Script | Enforces |
|---|---|---|---|
| `read` | `employee` | `current.request.requester == me \|\| current.request.requester.manager == me` | Audit of a request readable by its requester + manager |
| `create` | — | *(none — written only by the #6 `record_transition` BR)* | Trail is system-generated |
| `write` | — | `answer = false` | **N2 — immutable** |
| `delete` | — | `answer = false` | **N2 — immutable** |

**`x_snc_brb_app_leave_type`** — shared reference data

| Op | Roles | Enforces |
|---|---|---|
| `read` | `employee`, `admin` | Everyone picks a type (`manager` reads via `employee`) |
| `create` / `write` / `delete` | `admin` | Admin maintains types; retire via the `active` flag, don't delete |

### N7 has two halves, and only one is an ACL

The field read ACLs above restrict `leave_type` + `note` to requester + manager.
But the **F6 overlap view** shows a manager their *own* direct reports'
overlapping requests — and the manager legitimately *has* field access to those
reports — so **"overlap omits type/note" cannot be an ACL rule**. It is enforced
by the read API **projecting only name + dates**. That is a seam handed to **#8
(data access)**, not an ACL. The field ACLs here are therefore defense-in-depth
(the record read ACL already scopes rows to requester + manager); they make N7
intent explicit and guard against a future broadening of the row rule.

### N1 is contingent on an ACL-respecting read path (constraint on #8)

Record ACLs are enforced by the client Table API and by server-side
**`GlideRecordSecure`**, but **plain server-side `GlideRecord` bypasses ACLs**.
So this ADR's N1 guarantee binds **#8's data-access layer to use
`GlideRecordSecure` (or the client Table API)** for all request/ledger/audit
reads. The explicit, documented exceptions are trusted scoped server code that
must aggregate across employees: the `LeaveBalance` hold computation (I6) and the
#6 BRs that insert ledger/audit rows — these run as plain `GlideRecord` by
design, which is also why the restrictive `create`/append-only ACLs above do not
block them.

### `sys_user` is out of scope

We add no ACLs to the OOTB `sys_user` table. N1 is about *leave* data, not the
user directory (display names are already broadly readable OOTB). The server /
REST layer returns only the minimal user fields it needs (name, and `manager`
for routing).

## Considered options

- **Row scoping by the `manager` role vs the `sys_user.manager` relationship.**
  Chose the relationship as the row key (role is only the capability gate). It is
  data-driven, matches the GLOSSARY definition of Manager, and makes I4's "never
  their own" structural rather than a separate check.
- **Script/condition read ACL vs a `sys_security_data_filter` for N1.** Chose a
  script read ACL for v1: simpler, directly testable, and adequate at 500
  employees. A paired Data Filter + Deny-Unless ACL (row-level query pushdown) is
  recorded as the **N3 performance fallback**, not built now.
- **I4 as a transition condition (#6) vs a write ACL (#7).** ADR 0002 already
  ruled I4 is *authz*, not transition mechanics. A value-aware `state` write ACL
  owns it; the state model owns transition legality. Without the ACL, the state
  model alone would let an employee self-approve.
- **`admin` contains `employee`/`manager` vs standalone.** Chose standalone:
  PRD §2 forbids admin from viewing or deciding requests, so inheritance would
  violate the spec. Combined with `adminOverrides: false`, admin genuinely cannot
  read requests or mutate the ledger.
- **Enforcing "overlap omits type/note" by ACL vs by query projection.** It
  cannot be an ACL (the overlap viewer is the reports' own manager, who has field
  access), so it is a #8 projection concern. The field ACLs remain as
  defense-in-depth.
- **`adminOverrides: true` (OOTB default posture) vs `false`.** Chose `false` on
  the sensitive ACLs so N1/N2 hold even for a platform admin and are testable;
  the cost is that break-glass access needs a deliberate, separate mechanism
  (out of scope for v1).

## Consequences

- **N1/N7/I4/I5 and append-only (I1/F9/N2) now have a concrete, buildable ACL
  surface.** The role-access tests the PRD mandates (§10: "Role access (N1) is
  tested for all three roles") map directly onto these ACLs.
- **Binding constraint on #8:** request/ledger/audit reads must go through
  `GlideRecordSecure` or the client Table API, and the overlap read must project
  only name + dates (N7). The `LeaveBalance`/BR aggregations are the named
  ACL-bypassing exception.
- **The scoped `admin` is intentionally narrow.** No request read, no decide, no
  ledger mutation; `adminOverrides: false`. Break-glass / support access is a
  deliberate future decision, not an accident of the admin role.
- **Role names are now fixed**, resolving the GLOSSARY open question: the app
  uses an explicit `employee` role (not merely the OOTB manager relationship).
- **Unblocks the Fluent authoring tickets** (#15 and the ACL/role build work):
  the role set, the ACL matrix, the value-aware `state` script, and the #8
  constraint are all specified here.
```

## Amendment — record-level `write` ACL (task/bug-fixes, 2026-10-14)

Found by manual validation (Abel could not submit a request). The Leave Request
table has auto-generated access controls **off**, and the matrix above defined only
**field-level** `write` ACLs. With no **record-level** `write` ACL, a
`GlideRecordSecure` update has nothing to allow it: `update()` returns `null`, with
no error message, and the field ACLs are never reached. The matrix is amended:

| Operation | Field | Roles | Script | Purpose |
|---|---|---|---|---|
| `write` | *(record)* | `employee` | `current.requester == me \|\| current.requester.manager == me` | Table-level gate a secure write needs before any field ACL is consulted. It only opens the row to requester + manager (N1); **which fields** each may change stays with the field ACLs above (I4 `state`, I5 draft content, `decision_reason`). |

Consequence for the "N1 is contingent on an ACL-respecting read path" constraint: a
secure **insert** also evaluates field write ACLs against the half-built row (see the
ADR 0004 amendment), so the create path is the one place the secure-everywhere rule
is relaxed. Record-level and field-level ACLs must both exist for a table whose
auto-ACLs are off — add the record-level rule whenever a field-level rule is added.


## Amendment — `state` ACL is coarse; I4 moves to a Business Rule (task/bug-fixes, 2026-10-14)

Found by manual validation (a manager's Approve returned `200` but the request stayed
Submitted). A field-level **write ACL cannot see the value being written**: inside the
`state` ACL, `current.state` is the **old** value (observed on-instance:
`current.state = submitted`, `current.state.changes() = false` while approving). The
original script's `approved`/`rejected` branch was therefore unreachable and fell through
to `answer = false`, and the secure update **silently dropped the write** (`update()`
returned the sys_id, no message). Submit only worked by accident — its old value `draft`
happened to hit the requester branch.

The decision is split along what each mechanism can see:

- **`state` write ACL — coarse, keyed on the current (old) state.** `draft`/`approved`:
  requester only. `submitted`: requester or the assigned manager (never the requester's
  own manager-self). `rejected`/`cancelled`: nobody (terminal).
- **`enforce_actor` Business Rule (new, `before`/`update`, order 40, `stateVALCHANGES`)
  — the value-aware half of I4**, because a BR sees the new value. Only the requester's
  assigned manager, and never the requester, may set `approved`/`rejected`; only the
  requester may set `submitted`/`cancelled`/`draft`. A refusal adds an error message and
  aborts the update, before the transition gate (order 50) runs.

This supersedes the "I4 as a write ACL, not a BR" reading above: I4's *authorization*
still lives outside the StateModel (ADR 0002 stands), but its value-aware part is a BR,
because the platform gives an ACL no way to express it. Direct Table API writes are
covered too (the BR fires on every update path).
