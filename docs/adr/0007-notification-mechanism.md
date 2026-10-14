# Notification mechanism: one platform event, consumer-side delivery, in-app first

Status: accepted

## Decision

Per-transition notifications (F7) are delivered as **consumers of a single
registered platform event**, never by hand-wiring delivery into the state
machine or the Scripted REST handlers. This realizes the map's locked
"decoupled notification event" and PRD assumption 5 ("in-app, with email behind
a replaceable interface").

ADR 0002 already commits the `record_transition` **after** Business Rule to fire
`gs.eventQueue('x_snc_brb_app.state_changed', …)` once per transition, in the
same context that inserts the one-per-transition Audit Event. This ADR formalizes
that event as the notification trigger and decides what consumes it.

### The event (the replaceable interface)

One registered event is the seam every channel hangs off:

- Register `x_snc_brb_app.state_changed` in the Event Registry
  (`Record({ table: 'sysevent_register', … })` — there is no Fluent plugin for
  `sysevent_register`). `suffix: 'state_changed'`, `event_name:
  'x_snc_brb_app.state_changed'` (27 chars, under the 40-char cap), `table:
  'x_snc_brb_app_leave_request'`, `fired_by` documenting the `record_transition`
  BR.
- The event is fired from the **after**-commit BR, so the transition is already
  committed before any consumer runs. **A notification can therefore never block
  or roll back a transition** (F7, N4) — the transition always wins.
- The event carries both sys_ids as parms: **parm1 = `leave_request` sys_id**,
  **parm2 = `audit_event` sys_id**. The Audit Event is the canonical
  one-per-transition record, so its sys_id is the idempotency key (below).

**Email is a future, additive consumer of this same event.** v1 ships **in-app
only**; adding email later is a new event-based `EmailNotification` on
`x_snc_brb_app.state_changed` with **zero change to the state machine**. The map
lists the concrete email channel as deferred past v1 — this ADR decides only the
interface.

### The in-app channel

A dedicated **fifth table `x_snc_brb_app_notification`** stores in-app
notifications, written by a single **`ScriptAction`** subscribed to
`x_snc_brb_app.state_changed`. The React UI Page is the only surface and the
Scripted REST API the only path (ADR 0004), so the platform bell / Connect is
unreachable — the in-app feed must be data our own API returns.

Fields (minimal, self-contained, privacy-safe):

| Field | Type | Purpose |
|---|---|---|
| `recipient` | ref `sys_user` | Who sees it. Row-scoping key. |
| `leave_request` | ref `x_snc_brb_app_leave_request` | The subject request. |
| `source_audit_event` | ref `x_snc_brb_app_audit_event` | Provenance + idempotency key. |
| `to_state` | String (mirrors request states) | Renders the message without dot-walking. |
| `read` | Boolean (default false) | Read/unread. |
| `read_at` | Glide Date Time (nullable) | When marked read. |

Actor and timestamp come from OOTB `sys_created_by` / `sys_created_on`. The row
carries **no `leave_type` / `note`** (N7) — the recipient is always entitled, but
the row stays clean and the request's own ACLs govern any detail the client
dot-walks.

### Recipients and "one per transition per recipient" (F7)

For every **routed** transition the recipients are the **requester and their
manager** (`requester` + `requester.manager`) — one notification row apiece. Of
ADR 0002's six transitions, five are routed; **`draft → cancelled` emits no
notification** — a Draft is never routed to the manager (F3 routes only on
submit), so it is the employee's private workspace and notifying a manager about
a Draft they never saw is noise (and cuts against the N7 privacy intent).

| Transition | Notifies |
|---|---|
| `draft → submitted` (submit) | requester + manager |
| `submitted → approved` (approve) | requester + manager |
| `submitted → rejected` (reject) | requester + manager |
| `submitted → cancelled` (cancel) | requester + manager |
| `approved → cancelled` (cancel) | requester + manager |
| `draft → cancelled` | — (none) |

**Idempotency:** the consumer dedups by querying `(source_audit_event,
recipient)` before inserting, so a redelivered event or a re-run consumer is a
no-op. This — not a DB uniqueness constraint — guarantees exactly one
notification per transition per recipient.

### ACLs (ADR 0003 style)

- **read** = `recipient == me` (N1 — you only ever see your own notifications).
- **create** = none from the client. Rows are written server-side by the
  ScriptAction with plain `GlideRecord`, the same consumer/BR write exception
  ADR 0003/0004 already carve out of the `GlideRecordSecure` rule.
- **update** = limited to `read` / `read_at` only. Mark-as-read is a new
  **intent-named action endpoint** on the Scripted REST API (consistent with ADR
  0004's write pattern), writing via `GlideRecordSecure` so a `read`-only field
  write ACL scoped to `recipient == me` enforces.
- **delete** = none in v1 (dismiss/delete deferred).

Unlike the Ledger and Audit tables, the notification table is **not** append-only
— the `read` flag is a legitimate mutation.

### Delivery, failures, and N5

The consumer runs **asynchronously on the default event queue** — at 500
employees transitions are tens-per-hour, not thousands, and the dedup above makes
parallel processing race-safe, so no custom `sysevent_queue` is warranted. The
consumer **logs failures with the request-id structured-log convention** from ADR
0004 and **swallows them** (N5: notification failures are logged; errors are
never swallowed *silently*) — a failed in-app write never propagates back to the
already-committed transition. The future email consumer inherits the same
non-blocking guarantee by construction, and the platform email engine logs its
own delivery failures in `sys_email`.

## Considered options

- **OOTB platform event + notification engine vs a hand-rolled notifier.** Chose
  OOTB: `sysevent_register` + `ScriptAction` + event-based `EmailNotification`
  are all first-class Fluent metadata (map research #3), ADR 0002 already fires
  the event, and consumer-side delivery is what makes the channel replaceable.
  Hand-wiring delivery into the BR or REST handlers would couple delivery to the
  transition and defeat assumption 5.
- **A fifth `notification` table vs deriving the feed from Audit Events.**
  Deriving (no new table; "unread" as a `sys_user_preference` last-seen marker)
  keeps the map's four-table lock pristine and matches ADR 0005's compute-on-read
  philosophy — but it cannot cleanly model a **per-recipient** notification with
  **delivery semantics** (a row that is delivered, can fail, is logged, and
  carries its own read state), and it conflates the notification concern with the
  immutable audit record. F7 is explicit about "one per transition per recipient"
  with logged delivery failures, which is a push-to-a-store model. Chose the
  fifth table, and **flag the deviation**: the map's "four standalone tables"
  lock is about the *domain / ledger* model (Leave Type, Leave Request, Ledger
  Entry, Audit Event); the notification table is delivery **infrastructure**, not
  a domain-truth table, so it sits outside that lock rather than breaking it.
- **Per-transition events vs one `state_changed` event.** Chose one: ADR 0002
  already fires it, one registration is simpler, and consumers filter on the
  `to_state` parm. Separate events would multiply registry entries and risk the
  40-char cap.
- **ScriptAction vs Flow Designer as the in-app consumer.** Chose ScriptAction:
  a few lines of server script writing one-to-two rows, no Flow runtime, and it
  reads the event parms directly (`event.parm1`/`parm2`).
- **Notifying on `draft → cancelled` vs skipping it.** Chose skip: the Draft was
  never routed, so there is no manager audience and no employee expectation.
- **Custom event queue vs default.** Chose default: volume is low and the dedup
  makes ordering irrelevant.

## Consequences

- **A fifth table enters the schema.** `x_snc_brb_app_notification` is additive
  delivery infrastructure, owned here, outside the four-table domain lock. Tickets
  building the schema/ACLs must account for it; GLOSSARY gains **Notification**.
- **The state machine is untouched by channels.** ADR 0002's `record_transition`
  BR and its event fire are the only coupling point; in-app today and email
  tomorrow are pure consumers. The one new obligation on #6's BR is to pass the
  `audit_event` sys_id as a second parm.
- **New Scripted REST surface.** A `mark-as-read` action endpoint joins ADR
  0004's intent-named writes, and the screen-shaped reads gain a notifications
  list + unread count (`recipient == me`), computed on read.
- **Non-blocking is structural.** Because delivery is an after-commit, async
  consumer of a queued event, F7/N4's "a failed delivery never blocks the
  transition" holds for every channel by construction, not by careful coding.
- **Deferred:** the concrete email `EmailNotification` consumer (map out of
  scope for v1), notification dismiss/delete, and any digest/batching.
- **Cross-scope privileges:** the app must register and fire the event in scope;
  the ScriptAction consumer needs `write` on `x_snc_brb_app_notification` and
  `read` on `x_snc_brb_app_leave_request` / `sys_user` to resolve recipients.
- **Builds on** [#6](https://github.com/jarvisrobo26/brb-app/issues/6) /
  [ADR 0002](0002-custom-state-machine.md) (the event + Audit Event),
  [#7](https://github.com/jarvisrobo26/brb-app/issues/7) /
  [ADR 0003](0003-role-and-acl-model.md) (ACL style, the server-write
  exception), and [#8](https://github.com/jarvisrobo26/brb-app/issues/8) /
  [ADR 0004](0004-client-server-data-access-pattern.md) (the REST action-endpoint
  pattern, N5 observability). Informs the authoring tickets that build the table,
  ScriptAction, event registration, and REST endpoint.


## Amendment — registration and parms as built (task/bug-fixes, 2026-10-14)

- **The event was never registered.** This ADR (and ADR 0002) required registering
  `x_snc_brb_app.state_changed`, but the authoring slice did not, so a scoped
  `gs.eventQueue` call refused with "Access to event … has been refused. The event is
  not defined." It is now registered in `src/fluent/events/state-changed-event.now.ts`
  (`Record` on `sysevent_register`, `suffix` + `event_name`, `fired_by` documented).
  The message still appears on insert after registration; the cause is unexplained and
  harmless today (nothing consumes the event yet) but must be resolved before T7.
- **Parms differ from this ADR.** The `record_transition` Business Rule currently
  queues `eventQueue(name, current, toState, fromState)` (parm1 = new state, parm2 =
  old state). This ADR specifies parm1 = request sys_id and parm2 = **audit_event
  sys_id** (the idempotency key). The BR must be changed to match before the T7
  consumer relies on it; until then this ADR remains the target.
