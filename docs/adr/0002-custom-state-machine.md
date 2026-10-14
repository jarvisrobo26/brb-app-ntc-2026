# Custom state machine: StateModel gating + side-effect Business Rules

Status: accepted

## Decision

We enforce the PRD §4 transition table and invariants I1–I9 on
`x_snc_brb_app_leave_request` with **one custom `StateModel` that owns all
transition gating** plus **a small, fixed set of Business Rules that own only
side-effects and plumbing** — never gate logic. This realizes map ADR direction
#2 and the two research findings it rests on
([#3](https://github.com/jarvisrobo26/brb-app/issues/3),
[#4](https://github.com/jarvisrobo26/brb-app/issues/4)): the Fluent
`state-model-guide` forbids blocking a transition from a Business Rule
(`setAbortAction`), and the platform guarantees single-operation atomicity but
**not** multi-record atomicity, so N4 leans on ledger-as-truth plus the
deploy-time reconciliation check rather than a true two-record transaction.

ADR 0001 already fixed what this needs from the schema: `state` is a
`ChoiceColumn` with slugs `draft/submitted/approved/rejected/cancelled`, the
ledger `entry_kind` is `grant/deduct/restore`, and `delta` is signed so balance
is `SUM(delta)`. This ADR adds the `sttrm_model` reference field, the StateModel,
and the Business Rules.

### The StateModel (gating)

One `StateModel` on `x_snc_brb_app_leave_request`, `stateField: 'state'`, initial
state `draft`, with **exactly the six PRD transitions** and nothing else:

| From | To | Gating conditions (named 1:1 with the invariant) |
|---|---|---|
| `draft` | `submitted` | `I2` end ≥ start · `I8` start ≥ today and within one calendar year · `I9` ≥ 1 working day · `I3` no other overlapping active (Submitted/Approved) request · `I6` days ≤ available balance |
| `draft` | `cancelled` | — |
| `submitted` | `approved` | `I6` balance still covers the days (re-check) |
| `submitted` | `rejected` | `F4` `Mandatory Fields` on `decision_reason` |
| `submitted` | `cancelled` | — |
| `approved` | `cancelled` | `F8` today < `start_date` |

`rejected` and `cancelled` are terminal (no outgoing transitions); `approved`
goes only to `cancelled`.

**I7 (a decision applies once) is enforced structurally, with no dedicated guard
Business Rule.** There is no `approved→rejected`, no re-`approve`, and no
re-`reject` transition in the graph, and the enforcement rule evaluates the move
against the **committed `previous` state** — so a second decision on an
already-decided request has no valid transition and is refused. Concurrent
decisions serialize at the row level; the first wins, the second evaluates
against the now-committed state and is rejected (research #4).

Each gate is its **own named `sttrm_transition_condition`** (not one lumped
script), so each maps 1:1 to a PRD invariant and to the invariant-named test
(I1–I9) the PRD requires. Local checks (`I2`, `I8`, `I9`) take a lower `order`
than the DB-touching ones (`I3`, `I6`) so cheap checks run first. Conditions use
`conditionScript` via `Now.include('./Ix-*.js')`, return a boolean, and never
call `gs.addErrorMessage` (conditions run across REST/Flow/UI). `decision_reason`
presence uses a `Mandatory Fields` condition, not a script.

### The Business Rules (plumbing + side-effects only)

All on `x_snc_brb_app_leave_request`. None contains gate logic.

| # | Rule | When | Fires on | Order | Does |
|---|---|---|---|---|---|
| 1 | `assign_state_model` | `before` | `insert` | 10 | Sets the `sttrm_model` reference on new records (required for a custom-table model to be enforced). |
| 2 | `compute_days` | `before` | `insert`, `update` | 20 | When `start_date`/`end_date` change **and** `state == 'draft'`, sets `days` from the `WorkingDays` Script Include. Past Draft the value is frozen. |
| 2b | `enforce_actor` | `before` | `update` | 40 | Added by task/bug-fixes. Value-aware I4 actor check on a state change (only the assigned manager sets `approved`/`rejected`, never the requester; only the requester sets the other moves) — an ACL cannot see the new value ([ADR 0003](0003-role-and-acl-model.md) amendment). Aborts with a message; runs before the gate. Not transition mechanics, so it stays outside the StateModel. |
| 3 | `enforce_transitions` | `before` | `update` | 50 | The generic `evaluateTransition` enforcement rule. `filterCondition: 'stateVALCHANGES^EQ'`. Queries the active `sttrm_model`, calls `global.STTRMModel(...).evaluateTransition(previousState, current)`, and on a blocked result calls `gs.addErrorMessage(...)` + `current.setAbortAction(true)`. |
| 4 | `apply_ledger_effect` | `before` | `update` | 100 | After the gate has passed, writes **exactly one** ledger entry on balance-affecting transitions: `DEDUCT` (`delta = −days`) on `submitted→approved`, `RESTORE` (`delta = +days`) on `approved→cancelled`. The ledger `insert()` is the **last action** (validate-first, write-last). |
| 5 | `record_transition` | `after` | `insert`, `update` | — | `filterCondition: 'stateVALCHANGES^EQ'`. Inserts one `Audit Event` (`from_state = previous.state`, `to_state = current.state`, `actor`) and calls `gs.eventQueue('x_snc_brb_app.state_changed', …)`. |

Side-effect field sourcing: `actor = gs.getUserID()`; ledger `employee =
requester`, `leave_type = leave_type`, `source_request = sys_id`. `EmailNotification`
(and in-app) records subscribe to the `state_changed` event, so notification
**delivery is fully decoupled** — a failed notification never blocks the
transition (F7) and is logged by the notification engine (N5).

Two Script Includes hold reusable domain logic:
- **`WorkingDays`** — Mon–Fri inclusive count for a date range (I9). Used by
  `compute_days` and the `I9` condition.
- **`LeaveBalance`** — ledger balance, days held by the employee's other
  Submitted requests of a type, and `available = balance − held` (I6). Used by
  the `I6` conditions **and reused by the client's F2 "balance after this
  request" display**, so the gate and the preview can never disagree.

### Enforcement BR implementation constraints (from the `state-model-guide`)

- Inline rule 3's script as a template-literal **string**, not `Now.include()` —
  the build type-checks included `.js` and rejects the `global.` namespace.
- Qualify the script include as **`global.STTRMModel`** (bare `STTRMModel`
  resolves to `undefined` in a scoped app).
- Do not interpolate `Now.ID[...]` into any string/script field — it renders the
  raw key, not a sys_id; resolve records at runtime.
- The scoped app needs cross-scope privileges: `write` on the target table,
  `read` on `sttrm_model`/`sttrm_state`/`sttrm_state_transition`/
  `sttrm_transition_condition`, and `execute` on the `STTRMModel` script include.

## Considered options

- **Gate transitions in Business Rules vs in the StateModel.** The Fluent
  `state-model-guide` carries a CRITICAL RULE against BR gating (`setAbortAction`
  to block a move) for every table and model. All gate logic therefore lives in
  transition conditions; BRs are reduced to plumbing + side-effects. Rejected: a
  hand-written per-transition "prevent" BR.
- **OOTB Flow / approval engine vs a custom state machine.** Map ADR direction #2
  chose custom. The OOTB engine would couple leave to the Change/approval model
  and obscure the ledger-as-truth design; a four-state custom model is smaller
  and fully owned.
- **Ledger write in `before` (last step) vs `after`.** Chose `before` so the I6
  re-check can still *abort* the approval if balance no longer covers the days —
  an `after` write happens on an already-committed `approved` record that can no
  longer be cleanly un-approved. The cost is a tiny validate→write window
  (below).
- **A dedicated double-decision guard BR vs structural I7.** Chose structural: a
  forward-only graph with no re-decision transition plus committed-state
  evaluation refuses the second decision with no extra rule to maintain.
- **One lumped submit-validation script vs one named condition per invariant.**
  Chose one named condition per invariant for the 1:1 invariant→condition→test
  traceability the PRD mandates (tests carry IDs I1–I9).

## Consequences

- **N4 is not true two-record atomicity, and the ADR says so.** The platform
  cannot roll back an already-inserted ledger row if the outer `leave_request`
  update later fails, and the I6 re-check in rule 4 and the ledger write are two
  reads/writes with a tiny TOCTOU window. We minimize the window (validate-first,
  write-last, single `before` context) and rely on **ledger-as-truth + the
  deploy-time reconciliation** (balance = Σ delta, a PRD success metric) as the
  backstop. `addValue()` atomic increments are only relevant if a numeric balance
  cache is ever introduced (map "Not yet specified" N3 fallback).
- **Seams handed to [#7](https://github.com/jarvisrobo26/brb-app/issues/7)
  (roles/ACL).** I4 (only the assigned manager decides, never their own request)
  is a **write ACL** on the decision, not a transition condition — #6 owns
  transition *mechanics*, #7 owns *who may act*. I5 field edit-lock (only Draft
  editable) and the append-only guarantees for the Ledger and Audit tables
  (I1/F9/N2 — no update/delete path) are likewise ACL concerns on #7.
- **GRANT is out of scope.** An admin granting an annual allowance (F10) is an
  insert straight onto `ledger_entry`, not a `leave_request` transition, so it
  sits outside this state machine; its ACL is #7.
- **Unblocks the authoring tickets** [#10](https://github.com/jarvisrobo26/brb-app/issues/10),
  [#14](https://github.com/jarvisrobo26/brb-app/issues/14), and
  [#15](https://github.com/jarvisrobo26/brb-app/issues/15), which build the
  StateModel, Business Rules, and Script Includes described here.
