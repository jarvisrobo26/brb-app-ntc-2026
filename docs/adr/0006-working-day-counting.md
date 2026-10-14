# Working-day counting (I9)

Status: accepted

## Decision

A Leave Request's **days requested** (I9) is the count of **Mon–Fri calendar
dates** in `[start_date, end_date]`, **both ends inclusive**, computed by one
**server-side `WorkingDays` Script Include** — the single source of truth map
ADR direction #6 reserved and ADR 0002 named. There is **no ServiceNow Schedule
and no holiday calendar**: weekends (Saturday/Sunday) are the only non-working
days, and public holidays are not modelled (PRD v1 non-goal). This fixes the
semantics, the home, the client/server sharing boundary, and where the
zero-day refusal lives — details ADRs 0002 and 0004 referenced but left to this
ticket.

### Semantics

For a `(start_date, end_date)` pair of timezone-less calendar dates (PRD §7):

```
days = count of dates d in [start_date, end_date]           -- both ends inclusive
       where dayOfWeek(d) is Monday..Friday
```

- **Inclusive both ends.** `Mon → Fri` = 5, `Fri → Mon` = 2, a single weekday
  `Wed → Wed` = 1, `Sat → Sun` = 0.
- **Whole days only.** The result is an integer; half-days and hourly leave are
  PRD v1 non-goals, matching the integer `days` column (ADR 0001).
- **Pure arithmetic on day-of-week.** The count derives solely from each date's
  weekday. No timezone maths (dates carry none), so there is no DST or boundary
  ambiguity.
- **`WorkingDays` is a pure counter — it may return `0` and never throws.** A
  zero-working-day range (e.g. `Sat → Sun`) is a legitimate `0`, not an error.

### No Schedule, no holiday calendar

We deliberately **reject** the OOTB ServiceNow Schedule machinery
(`cmn_schedule`, `GlideSchedule`, `DurationCalculator`) and model **no
public-holiday calendar**. Only Saturday and Sunday are non-working, hard-coded
in `WorkingDays`. Recording this as an explicit *no* stops a future reader from
"upgrading" to a Schedule or holiday calendar without a fresh decision —
public-holiday calendars and multi-country rules are named PRD v1 non-goals
(PRD §3), and a Schedule would add OOTB config state the drift-proof design is
avoiding.

### One implementation, three callers — the sharing boundary

`WorkingDays` lives **only on the server** and is the single implementation.
Everything that needs the count calls it; nothing re-derives it:

| Caller | Uses `WorkingDays` for |
|---|---|
| `compute_days` BR (ADR 0002) | sets the Leave Request `days` field at Draft from `start_date`/`end_date`; frozen past Draft |
| `I9` StateModel condition (ADR 0002) | gates `draft → submitted` on `days ≥ 1` |
| `GET /balance-preview` endpoint (ADR 0004) | returns the F2 pre-submit day count the client displays |

The React client's F2 submit preview **does not reimplement the count in
TypeScript**. On a date change it calls the `balance-preview` Scripted REST
endpoint (debounced), which returns the `WorkingDays` result alongside the
`LeaveBalance` figures (ADR 0005). "Shared between the client preview and server
validation" therefore means *one server algorithm both consume*, not two
algorithms kept in sync.

### Where the zero-day refusal lives

The **refusal** of a zero-working-day range is **not** inside `WorkingDays`; it
is the `I9` StateModel condition at `draft → submitted` (`days ≥ 1`). A Draft may
hold `days = 0` transiently (the preview shows `0`, "cannot submit"); submit is
what's blocked. This keeps ADR 0002's one-named-condition-per-invariant and
one-test-per-invariant (`I9`) traceability intact — the utility counts, the gate
decides.

## Considered options

- **Custom arithmetic vs ServiceNow Schedule / `GlideSchedule`.** Chose custom
  arithmetic. A Schedule buys holiday calendars and non-standard work weeks we
  explicitly don't want in v1, at the cost of OOTB config state and a dependency
  the drift-proof design avoids. Weekends-only is a few lines of weekday maths.
- **Server-only `WorkingDays` vs a duplicated pure-TS counter on the client.**
  Chose server-only. A client-side counter would give instant/offline feedback
  but creates two algorithms that can drift — an off-by-one on I9 between client
  preview and server gate is exactly the silent cross-surface drift this map
  exists to prevent. ADR 0004's `balance-preview` round-trip (N3: p95 < 200 ms)
  already delivers the preview, so the duplication buys little.
- **`WorkingDays` throws / returns `null` on a zero-day range vs returns `0`.**
  Chose return `0`. The utility stays a pure, reusable counter; the business
  refusal belongs to the `I9` gate so it maps 1:1 to its invariant test, and the
  preview can honestly show `0` days before the user submits.
- **Inclusive both ends vs half-open `[start, end)`.** Chose inclusive — I9 says
  "start and end inclusive", and a one-day request (`start == end` on a weekday)
  must count as 1.

## Consequences

- **No holidays means an over-count on public holidays.** A request spanning a
  public holiday counts that weekday as a working day. Accepted for v1 (holiday
  calendars are a non-goal); adding one later is a change to `WorkingDays`'
  non-working-day set plus a new calendar source, recorded as its own ADR.
- **The client always shows the server's number.** Because the preview reads
  `balance-preview`, the figure the employee sees before submit is the exact
  figure the gate and `compute_days` use — F2's "shown values match the
  working-day count" acceptance criterion is structural, not a matter of keeping
  two counters aligned.
- **One place to test I9.** The weekday arithmetic has a single home, so the
  `I9` test exercises `WorkingDays` directly (inclusive ends, `Sat→Sun = 0`,
  `Fri→Mon = 2`) and the gate refusal separately.
- **Builds on #5/#6/#8.** `WorkingDays`' existence and its `compute_days` / `I9`
  callers were set by ADR 0002; its `balance-preview` consumer by ADR 0004. This
  ADR fixes the count's semantics, the Schedule/holiday *no*, the server-only
  sharing boundary, and the zero-day refusal location those tickets referenced.
  The authoring tickets build `WorkingDays` to this contract.
