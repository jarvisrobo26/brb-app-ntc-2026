# BRB — Product Requirements Document

| | |
|---|---|
| Version | v0.2 (resolves the open gaps in v0.1) |
| Status | Frozen: first pass. Changes go to v0.3. |
| Owner | Hemanth Chakravartula |

**One-liner:** BRB is where you ask for time off, your manager approves it, and your balance and team calendar stay right.

## 1. Problem

Leave runs on email and spreadsheets. Balances drift, requests get lost, and nobody knows who is out until they are out. Employees cannot see what they have left. Managers approve without context.

## 2. Users and roles

| Role | Can do | Cannot do |
|---|---|---|
| Employee | Create, submit and cancel own requests. View own balance, ledger and request history. | See other people's requests or the team calendar. |
| Manager | Decide requests from direct reports. View direct reports' requests and who is out in a request's window. | Decide own requests. See employees who are not direct reports. |
| Admin (v1 minimal) | Define leave types. Grant annual allowances. | View or decide requests. |

Every employee has exactly one manager. An employee with no manager cannot submit.

## 3. Goals and non-goals

**Goals**
- G1. A request takes under a minute to submit.
- G2. Every request reaches a decision with no manual chasing.
- G3. The balance is always correct and explainable from the ledger.
- G4. A manager sees team overlap before deciding.

**Non-goals (v1):** payroll integration, accrual engines, carry-over, calendar sync, public-holiday calendars and multi-country rules, half-days and hourly leave, delegation chains and out-of-office approvers, mobile app, team calendar for employees.

## 4. Core flow and states

`Draft → Submitted → Approved | Rejected`, and `Cancelled` from Draft, Submitted or Approved.

| From | To | Actor | Conditions | Ledger effect |
|---|---|---|---|---|
| Draft | Submitted | Employee | Passes all rules in section 6 | None. The days become a pending hold. |
| Draft | Cancelled | Employee | None | None |
| Submitted | Approved | Assigned manager | Request is still Submitted. Balance still covers the days. | `DEDUCT` |
| Submitted | Rejected | Assigned manager | A reason is provided. | None. The hold is released. |
| Submitted | Cancelled | Employee | None | None. The hold is released. |
| Approved | Cancelled | Employee | Today is before the start date. | `RESTORE` |

Rejected and Cancelled are terminal. Only Draft is editable. To change a Submitted or Approved request, cancel it and submit a new one.

## 5. Functional requirements

| ID | Requirement | Acceptance criteria |
|---|---|---|
| F1 | Employee submits a request: leave type, start date, end date, optional note (max 500 chars). | Given valid input, the request moves to Submitted and is routed to the manager. Invalid input shows a field-level error and creates nothing. |
| F2 | The form shows the current balance, the days requested and the balance after this request, before submit. | Shown values match the ledger-derived balance and the working-day count (section 6, I9). |
| F3 | A submitted request routes to the employee's manager. | The manager sees it in their queue. No one else does. |
| F4 | Manager approves or rejects. Rejection requires a reason (1–500 chars). | A rejection without a reason is refused. The decision records the manager, time and reason. |
| F5 | Approval writes a `DEDUCT` ledger entry. Cancelling an approved request writes a `RESTORE` entry. Rejection or cancelling a pending request releases the hold. | Balance after each transition equals the sum of ledger entries. |
| F6 | When deciding, the manager sees direct reports who have Approved or Submitted requests overlapping the window. | Overlaps show name and dates only, never leave type or note. |
| F7 | Employee and manager are notified at each state change (submit, approve, reject, cancel). | One notification per transition per recipient. A failed delivery never blocks the transition and is logged. |
| F8 | Employee cancels before the start date. | Cancelling on or after the start date is refused. |
| F9 | Every balance change is an append-only ledger entry. | No update or delete path exists for ledger entries. |
| F10 | Admin defines leave types and grants each employee an annual allowance as a `GRANT` ledger entry. | Granting writes a ledger entry and never overwrites a number. |

## 6. Business rules (invariants)

| ID | Rule |
|---|---|
| I1 | A balance never changes without a ledger entry. |
| I2 | A request cannot end before it starts. |
| I3 | An employee cannot have two active requests that overlap. Active means Submitted or Approved. |
| I4 | Only the assigned manager can decide a request, and never their own. |
| I5 | A decided request cannot be edited, only cancelled. |
| I6 | A request cannot be submitted if its days exceed available balance, where available = ledger balance − days held by the employee's other Submitted requests of that type. Balance never goes negative. |
| I7 | A decision applies once. A second decision on the same request is refused. |
| I8 | A request must start today or later and fall within one calendar year. |
| I9 | Days requested are the working days (Mon–Fri) in the range, start and end inclusive. A range with zero working days is refused. |

Test names carry the invariant ID (I1–I9), so each rule traces to at least one automated test.

## 7. Data model (logical)

- **Leave Type:** id, name, annual allowance (days).
- **Employee:** id, name, manager, role.
- **Leave Request:** id, requester, type, start, end, days, note, status, approver, decision reason, decided at, created at.
- **Ledger Entry** (append-only): id, employee, type, entry kind (`GRANT`, `DEDUCT`, `RESTORE`), delta (days), source request (nullable for `GRANT`), actor, timestamp.
- **Audit Event:** id, request, actor, from status, to status, timestamp.

Dates are calendar dates with no time zone. Leave year is the calendar year.

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| N1 | Access control is role-based and enforced server-side. A direct call to the API for another employee's data is denied. |
| N2 | Audit: every state change records who, what and when. Audit and ledger records cannot be modified. |
| N3 | Performance: p95 API response under 200 ms at 500 employees. Page load under 2.5 s (LCP). |
| N4 | Reliability: balance-affecting transitions are atomic. A failure leaves no partial ledger write. Concurrent decisions on one request resolve to a single outcome (I7). |
| N5 | Observability: structured logs with a request ID. Errors are never swallowed. Notification failures are logged. |
| N6 | Accessibility: WCAG 2.1 AA for all screens. Keyboard operable. |
| N7 | Privacy: leave type and note are visible only to the requester and their manager. Overlap views omit them. |
| N8 | Deployable from a clean scaffold with a single command, with seed data for one admin, one manager and two employees. |

## 9. Success metrics

| Metric | Target |
|---|---|
| Submit-to-decision time (median) | Under 1 business day |
| Requests decided without a reminder | At least 95% |
| Time to submit a request | Under 60 seconds |
| Balance discrepancies reported | 0. A reconciliation check (balance equals ledger sum) runs on every deploy. |

## 10. Release criteria (v1)

- All F-requirements meet their acceptance criteria.
- Each of I1–I9 has an automated test that fails when the rule is broken.
- Role access (N1) is tested for all three roles.
- The single-command deploy (N8) works on a clean machine.

## 11. Assumptions to confirm

1. Pending requests hold days without a ledger entry. Only approval deducts. This refines F5 in v0.1, which implied rejection restores a deduction.
2. Days are whole working days, Mon–Fri. Public holidays are not modelled.
3. Overlap blocks only against the same employee's own active requests (I3). Team overlap is informational (F6).
4. A manager who is away cannot be bypassed in v1. Admin reassignment of the approver is deferred.
5. Notification channel is in-app, with email behind a replaceable interface.