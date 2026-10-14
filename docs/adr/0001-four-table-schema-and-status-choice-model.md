# Four-table schema and state choice model

Status: accepted

## Decision

We realize PRD §7 as **four standalone `x_snc_brb_app_*` tables** (no `task`
inheritance, per map ADR direction #1) plus the OOTB `sys_user` table as the
Employee. The Employee is **not** a fifth custom table — "Employee" always means
a `sys_user` record. The four tables, their columns, and the two choice lists are
fixed below.

### Tables and columns

Scope prefix `x_snc_brb_app_`; all table names are ≤ 30 chars. Every reference to
a person is a `ReferenceColumn` to `sys_user`. Timestamps use the OOTB
`sys_created_on` / `sys_created_by` audit fields rather than custom columns,
except where the acting user or decision moment differs from record creation.

**`x_snc_brb_app_leave_type`** — "Leave Type" (admin-maintained)

| Column | Type | Notes |
|---|---|---|
| `name` | StringColumn | mandatory |
| `annual_allowance` | IntegerColumn | whole days |
| `active` | BooleanColumn | default `true` |

**`x_snc_brb_app_leave_request`** — "Leave Request" (the central record)

| Column | Type | Notes |
|---|---|---|
| `number` | StringColumn + `autoNumber` | prefix `LR` (e.g. `LR0001001`) |
| `requester` | ReferenceColumn → `sys_user` | mandatory |
| `leave_type` | ReferenceColumn → `x_snc_brb_app_leave_type` | mandatory |
| `start_date` | DateColumn | calendar date, no timezone; mandatory |
| `end_date` | DateColumn | mandatory |
| `days` | IntegerColumn | working days (Mon–Fri, I9), read-only / computed |
| `note` | MultiLineTextColumn | `maxLength` 500 |
| `state` | ChoiceColumn | mandatory, default `draft` — see state choices |
| `approver` | ReferenceColumn → `sys_user` | the deciding manager |
| `decision_reason` | MultiLineTextColumn | `maxLength` 500 |
| `decided_at` | DateTimeColumn | read-only; the decision moment |

`created_at` = OOTB `sys_created_on`. The `sttrm_model` reference field required
by the state machine is **added by #6**, not here (this ADR only fixes that
`state` is a ChoiceColumn with the values below, which is all the state model
needs from the schema).

**`x_snc_brb_app_ledger_entry`** — "Ledger Entry" (append-only; source of truth
for balance, map ADR #5)

| Column | Type | Notes |
|---|---|---|
| `employee` | ReferenceColumn → `sys_user` | mandatory |
| `leave_type` | ReferenceColumn → `x_snc_brb_app_leave_type` | mandatory |
| `entry_kind` | ChoiceColumn | mandatory — see entry-kind choices |
| `delta` | IntegerColumn | **signed** days; mandatory |
| `source_request` | ReferenceColumn → `x_snc_brb_app_leave_request` | nullable (null for `grant`) |
| `actor` | ReferenceColumn → `sys_user` | who caused the entry |

`timestamp` = OOTB `sys_created_on`. Append-only (I1, I9/F9, N2) is enforced by
ACL (no update/delete path) in the ACL/roles ticket, not by this schema.

**`x_snc_brb_app_audit_event`** — "Audit Event" (append-only state-change trail)

| Column | Type | Notes |
|---|---|---|
| `request` | ReferenceColumn → `x_snc_brb_app_leave_request` | mandatory |
| `actor` | ReferenceColumn → `sys_user` | who made the change |
| `from_state` | ChoiceColumn | same choices as `leave_request.state`; nullable on create |
| `to_state` | ChoiceColumn | same choices as `leave_request.state`; mandatory |

`timestamp` = OOTB `sys_created_on`.

### Choice models

Both choice fields store **lowercase string slugs** (not OOTB integer `state`
values). Slugs are self-documenting in Business Rules, ACLs, the `StateModel`,
and the React client, and are stable over time.

**Leave Request `state`** (default `draft`):

| Stored value | Label |
|---|---|
| `draft` | Draft |
| `submitted` | Submitted |
| `approved` | Approved |
| `rejected` | Rejected |
| `cancelled` | Cancelled |

Transitions and gating are decided in #6; this ADR only fixes the value set.

**Ledger Entry `entry_kind`**:

| Stored value | Label |
|---|---|
| `grant` | GRANT |
| `deduct` | DEDUCT |
| `restore` | RESTORE |

### Signed delta convention

`delta` is a signed integer: `grant` and `restore` write a **positive** delta,
`deduct` writes a **negative** delta. Balance is therefore `SUM(delta)` with no
per-kind branching, which keeps "balance computed on read" (map ADR #5) and the
deploy-time reconciliation check (success metric: balance = ledger sum) trivial.

## Considered options

- **`state` vs `status` as the field/term.** PRD §7 and the earlier GLOSSARY used
  "status" ("from status, to status"). We standardize on **`state`** everywhere —
  column name, label, and ubiquitous language — because it is the ServiceNow
  platform idiom the custom state machine (`sttrm_model`, the generic
  `evaluateTransition` enforcement rule whose filter names the real column) and
  most ServiceNow developers expect. This is a deliberate deviation from the PRD's
  wording; it does **not** change PRD behaviour, only the realized term. GLOSSARY
  is updated to make "State" canonical and deprecate "status".
- **Integer state values (OOTB `task.state` style) vs string slugs.** Chose slugs
  for readability and stability across BRs/ACLs/StateModel/React.
- **Unsigned `delta` + sign derived from `entry_kind` vs signed `delta`.** Chose
  signed so balance is a plain sum.
- **Custom `timestamp`/`created_at` columns vs OOTB `sys_created_on`.** Chose the
  OOTB audit fields to avoid redundant, drift-prone columns.

## Consequences

- For a custom (base `sttrm_model`) table, the state machine's `stateField` may be
  any ChoiceColumn, so naming the field `state` and giving it these choices is all
  #6 needs from the schema; #6 still adds the `sttrm_model` reference field and the
  assign-model + `evaluateTransition` Business Rules.
- The generic `evaluateTransition` enforcement rule's `filterCondition` must name
  the real column: `stateVALCHANGES^EQ`.
- Append-only (Ledger, Audit) and role-based visibility (N1, N7) are enforced by
  ACLs in a separate ticket; the schema alone does not guarantee them.
