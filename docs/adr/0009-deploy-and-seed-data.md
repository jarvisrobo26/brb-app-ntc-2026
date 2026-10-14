# Single-command deploy and seed data

Status: accepted

## Decision

A clean scaffold deploys and seeds in **one command** using the platform's own
build/install pipeline, and all demo seed data is authored as **Fluent `Record()`
fixtures** — not an install script, not a post-install Business Rule. Realizes
**N8** ("deployable from a clean scaffold with a single command, with seed data
for one admin, one manager and two employees").

### The single command

`now-sdk install` deploys the most recent build, so a true one-command path
chains build then install. We add one wrapper npm script and leave the existing
`build` / `deploy` scripts untouched for the normal inner loop:

```jsonc
// package.json
"setup": "now-sdk build && now-sdk install"
```

`now-sdk install` loads demo data by default (`--demoData` defaults to `true`),
so `npm run setup` on a freshly authenticated clean scaffold produces a fully
seeded, demoable app in one command. A production-style install opts out with
`now-sdk install --demoData false`.

### Seed mechanism — fixture `Record()`

Every seed record is a Fluent `Record()` definition under `src/fluent/` with a
stable `$id: Now.ID['...']` and `$meta: { installMethod: 'demo' }`. The
`installMethod: 'demo'` tag routes the records to the `unload.demo` output so
they load with the default `--demoData true` install yet stay separable from the
app's own metadata.

Cross-record and cross-table references follow the SDK rules: same-app records
(Leave Types, roles from ADR 0003) are passed as the **exported record / role
variable**, never `Now.ID[...]` inside `data`; OOTB records are referenced with
`Now.ref('table', { coalesceKey: value })`. Because the seed writes to OOTB
tables (`sys_user`, `sys_user_has_role`) and sets their reference fields
(`manager`, `user`, `role`), those schemas must be pulled first so `Record()`
resolves the references by name across instances:

```bash
now-sdk dependencies --add tables sys_user sys_user_has_role --scope x_snc_brb_app
```

### The fixture set

The seed is deliberately minimal — the identities, the catalog, and the one
ledger kind that is itself an admin action (`GRANT`, F10):

| Records | Table | Notes |
|---|---|---|
| 1 admin, 1 manager, 4 employees | `sys_user` | **Existing OOTB users, referenced by `Now.ref('sys_user', '<sys_id>')`, not authored** (admin → System Administrator, manager → Abraham Lincoln, employees → the first real users A–Z starting at Abel Tuter). The seed only sets each employee's `manager` → the manager user |
| role grants | `sys_user_has_role` | admin → `x_snc_brb_app.admin`; manager → `.manager`; employees → `.employee` (per ADR 0003) |
| the leave types | `x_snc_brb_app_leave_type` | a small catalog with `annual_allowance` set |
| one `GRANT` per employee per type | `x_snc_brb_app_ledger_entry` | `entry_kind: 'grant'`, positive `delta`, `actor` = admin, `source_request` null (ADR 0001) |

**Explicitly not seeded:** Leave Requests, `DEDUCT` / `RESTORE` ledger entries,
Audit Events, Notifications. Those are produced by exercising the live state
machine (ADR 0002) during the demo — seeding them would bake in state the state
machine is meant to own and would make the reconciliation check (below)
meaningless.

### Idempotency

Idempotency is **structural**, not scripted. Each `Record()` is keyed to a
sys_id in `keys.ts` (committed, `--frozenKeys` in CI), so every re-deploy
**updates the same row in place** instead of inserting a duplicate — a
re-`setup` never double-grants. The append-only Ledger ACLs (ADR 0003) do not
block this: a Fluent install runs as a system upgrade and bypasses ACLs, and
the keyed-update path is an update, not a new append.

### Reconciliation

Because balance is computed-on-read from the Ledger (ADR 0005), there is no
stored balance that can drift; the PRD's "reconciliation check (balance equals
ledger sum) runs on every deploy" is therefore a **post-deploy smoke check**,
not on-instance metadata. It reuses the ADR 0005 `LeaveBalance` logic to assert,
for each seeded employee, that `balance = SUM(delta)` and
`available = max(0, balance − held) ≥ 0`. It lives in the build/CI pipeline, not
as a fix script or Business Rule shipped in the app scope. **Implementation is
flagged to [#15](https://github.com/jarvisrobo26/brb-app/issues/15)** (Fluent
authoring + test conventions).

## Considered options

- **Fixture `Record()` vs install script vs post-install BR.** Chose fixtures.
  Fixtures are idempotent by construction via `keys.ts`; an install script or a
  post-install Business Rule would each have to hand-roll "already exists?"
  coalescing, re-introducing the drift this map exists to prevent, and would add
  a second execution surface outside the build/deploy pipeline. Research
  [#3](https://github.com/jarvisrobo26/brb-app/issues/3) already confirmed
  record-seed is a first-class Fluent API, so no gap forces leaving Fluent.
- **`installMethod: 'demo'` vs untagged records.** Chose `demo`. Untagged seed
  would ship the demo admin/manager/employees as permanent app metadata into
  every environment; `demo` loads them by default (satisfying N8) while letting a
  real tenant opt out with `--demoData false`.
- **A combined `setup` script vs overloading `deploy`.** Chose a new script.
  `deploy` stays a thin alias for `now-sdk install` (the inner-loop meaning);
  `setup` is the clean-scaffold one-command path that also builds.
- **Seeding Leave Requests / downstream records vs grants only.** Chose
  grants-only. `GRANT` is an admin seed action (F10); requests and their ledger
  effects belong to the state machine and are exercised live.
- **Reconciliation as a shipped fix script / BR vs a pipeline smoke check.**
  Chose the pipeline. Ledger-as-truth means there is no stored value to
  reconcile on-instance; a pipeline check keeps demo-only verification code out
  of the app scope.

## Consequences

- `package.json` gains a `setup` script; `README.md` can point a new user at
  `npm run setup` for a one-command demoable install.
- The seed writes to OOTB `sys_user` / `sys_user_has_role`; those table schemas
  must be added via `now-sdk dependencies` before the fixtures compile, and the
  seeded users are demo data (login/password provisioning for an interactive
  demo is a build concern, not fixed here).
- New `Now.ID` keys for every seed record land in `keys.ts`; they must be
  committed (CI `--frozenKeys`) so the demo users/types/grants keep stable
  sys_ids across machines and re-deploys stay idempotent.
- The reconciliation smoke check and the actual fixture authoring are build-time
  work owned by #15, not this decision.
- `installMethod: 'demo'` is the agreed tag for all brb-app seed data; a future
  "first install" seed (e.g. non-demo reference data) would use a different
  `installMethod` and is out of scope here.
