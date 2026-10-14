# Balance and available-days computation

Status: accepted

## Decision

Leave balance and available days are **computed on read from the ledger** (map
ADR direction #5) by one Script Include, **`LeaveBalance`**, which is the single
home for this arithmetic and is reused by both the I6 transition gates (#6) and
the F2 pre-submit preview (#8), so the gate and the preview can never disagree.
This formalizes what ADR 0001 (`balance = SUM(delta)`, signed `delta`), ADR 0002
(the `LeaveBalance` Script Include; the I6 submit gate and approve re-check), and
ADR 0004 (`LeaveBalance` is a named plain-`GlideRecord` cross-row aggregation
exception, reused by the `balance-preview` read) each left to this ticket.

A balance is always scoped to one **(employee, leave_type)** pair.

### The aggregation

For a given `(employee, type)`:

```
balance   = SUM(ledger_entry.delta)                      -- GlideAggregate
held      = SUM(leave_request.days)                       -- GlideAggregate
            WHERE state = 'submitted' AND sys_id != thisRequest
available = max(0, balance - held)
```

- **`balance`** is a single `GlideAggregate` on `x_snc_brb_app_ledger_entry`:
  `addQuery('employee', …)`, `addQuery('leave_type', …)`,
  `addAggregate('SUM','delta')`. `delta` is signed (ADR 0001), so this is a plain
  sum with no per-`entry_kind` branching. `GlideAggregate` is the aggregating form
  of the plain-`GlideRecord` exception ADR 0004 carved out — it bypasses row ACLs
  server-side the same way, and pushes the sum into the DB (N3). It is **not**
  `GlideRecordSecure`.
- **All-time, no leave-year filter (v1).** The ledger has no year dimension, and
  accrual / carry-over are explicit PRD v1 non-goals, so the sum spans every row
  for the pair. See Consequences for the deferred annual-reset concern.
- **`held`** is the days reserved by the employee's **other** Submitted requests
  of that type — a `GlideAggregate SUM(days)` on `x_snc_brb_app_leave_request`
  filtered `requester = employee`, `leave_type = type`, `state = 'submitted'`, and
  `sys_id != thisRequest` (the "other" in I6). Approved requests are **never**
  held — their DEDUCT already lives in the ledger, so counting them would
  double-subtract. The sum uses the request's frozen `days` field (set at Draft by
  the #6 `compute_days` BR), not a recomputation.
- **`available = max(0, balance − held)`.** Balance itself never goes negative
  (I6 guarantees a DEDUCT never exceeds balance); `available` is clamped at 0 so no
  reader ever sees a negative usable figure.

### `annual_allowance` is not balance

`leave_type.annual_allowance` is only the admin's **default grant amount** (the
number F10's GRANT writes). It never feeds this computation: balance is derived
**solely** from `ledger_entry` deltas, so an employee with no GRANT for a type has
balance 0 regardless of that type's `annual_allowance`. Ledger is the single
source of truth.

### Return shape — one object, two callers

`LeaveBalance` exposes a method that, for a `(employee, type)`, returns the
structured object `{ balance, held, available }` — not a bare number. A thin
`availableFor(employee, type)` convenience may wrap it.

| Caller | Uses |
|---|---|
| I6 submit gate (`draft → submitted`, #6 condition) | refuses submit when `daysRequested > available` |
| I6 approve re-check (`submitted → approved`, #6 condition) | refuses approval when `daysRequested > balance` (raw ledger balance — see below) |
| F2 `balance-preview` endpoint (#8) | returns `{ balance, held, available }` + `daysRequested` + `availableAfter` |
| Manager `decision-view` endpoint (F6, #8) | shows the requester's `available` as decision context |

**F2 "balance after this request"** means **available-after**:
`availableAfter = available − daysRequested`, computed from the same object.
Submit is only a Hold (no ledger write), so this is the honest "what remains
usable" figure; it is shown as-is (may go negative to surface an over-request)
and the gate blocks the actual submit.

**The approve-time re-check compares against the raw ledger `balance`, not
`available`.** Holds already cap the *sum* of an employee's Submitted requests at
their balance (each submit passed `days ≤ available`), so the approve re-check
only needs to catch an **intervening ledger change** (another request
approved/restored between this submit and this approval). The DEDUCT is a direct
ledger operation, so `daysRequested ≤ balance` is exactly what keeps balance from
going negative (I6); it does not re-subtract other holds.

### The ACL-bypass safety boundary

Because `LeaveBalance` reads via plain `GlideRecord`/`GlideAggregate` (bypassing
row ACLs, ADR 0004), the `employee` sys_id it is given must **always be
server-derived, never raw client input** — otherwise an employee could read
another's balance:

- **I6 gates** pass the request's own `requester` (a server-side record value).
- **F2 `balance-preview`** passes `gs.getUserID()` — the authenticated caller,
  self only. No client-supplied `employee` parameter.
- **Manager `decision-view`** passes the request's `requester`, but only *after*
  the facade has authorized the manager via a `GlideRecordSecure` read of that
  request (N1).

No endpoint accepts a client-supplied `employee` to feed `LeaveBalance`.

## Considered options

- **`GlideAggregate SUM(delta)` vs iterating `GlideRecord` and summing in JS.**
  Chose `GlideAggregate`: the DB does the sum (N3), it is still the ADR-0004
  ACL-bypass aggregation (not `GlideRecordSecure`), and signed `delta` makes it a
  single branch-free sum.
- **Approve re-check against raw `balance` vs against `available`.** Chose raw
  `balance`. Holds already prevent oversubscription at submit; the DEDUCT acts on
  the ledger, so the raw balance is the quantity that must stay non-negative.
  Re-subtracting other holds would be stricter than I6 requires and conflate the
  Hold (a submit-time cap) with the ledger (the approval's actual target).
- **"Balance after" = `available − days` vs projected post-approval ledger
  balance.** Chose available-after: submit creates only a Hold, so the figure the
  employee cares about is remaining *usable* days, and it reuses the gate's object.
- **Balance from `leave_type.annual_allowance` vs from the ledger only.** Chose
  ledger-only; the allowance is just the GRANT template. Reading it directly would
  create a second, drifting source of truth.
- **One structured `{ balance, held, available }` object vs a bare `available`
  number.** Chose the object so the F2 preview can show current balance and
  balance-after without a second computation, and so gate and preview share one
  result (the ADR-0002 "can never disagree" invariant).
- **Per-leave-year filter vs all-time sum (v1).** Chose all-time: the ledger has
  no year dimension and carry-over/accrual are v1 non-goals (see Consequences).

## Consequences

- **No annual reset in v1.** All-time `SUM(delta)` means that if an admin
  re-grants in a later calendar year, deltas simply accumulate — effectively
  carrying the balance over. v1 assumes a single GRANT per employee/type and does
  not model a leave-year boundary; an annual reset / grant expiry (likely a
  dated/year-scoped ledger entry or a reset job) is a **deferred follow-on**, not
  solved here. This is consistent with the PRD v1 non-goals (accrual, carry-over).
- **Compute-on-read, no cache (v1).** Each read runs the two aggregations; map
  direction #5 forbids a cache in v1. The transactional + reconciled balance cache
  remains the documented N3 fallback (map "Not yet specified") if p95 is missed.
- **Same formula as the reconciliation check.** `balance = SUM(delta)` is exactly
  the deploy-time reconciliation the PRD lists as a success metric, so there is one
  arithmetic to trust, not two.
- **Whole days only.** `delta` and `days` are integers (half-days are a PRD v1
  non-goal), so balance, held, and available are always whole numbers.
- **Builds on #6/#8.** `LeaveBalance`'s existence, its I6 callers, and its
  plain-`GlideRecord` exception were set by ADRs 0002 and 0004; this ADR fixes the
  arithmetic, the return shape, the approve-vs-submit distinction, and the trusted-
  `employee` boundary those tickets referenced. The authoring tickets build
  `LeaveBalance` to this contract.


## Amendment — both `GlideAggregate` sums need `groupBy` (task/bug-fixes, 2026-10-14)

Found by manual validation: Abel's ledger held +25, −1 and +20 for Annual Leave, yet the
home page showed `-1 available of -1`. `LeaveBalance.getBalance` returned `-1` while an
aggregate grouped by `leave_type` over the same rows returned `44`. A `SUM` with **no
`groupBy`** returned one row's value rather than the total. The contract above is
unchanged (`balance = SUM(delta)`, `held = SUM(days)` over other Submitted requests); the
implementation of **both** sums now calls `groupBy('leave_type')` after `addAggregate`.
The ATF balance tests passed with the old code, so they did not catch it (learning-retro
#19, #17).
