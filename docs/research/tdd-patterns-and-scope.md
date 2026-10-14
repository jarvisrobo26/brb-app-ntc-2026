# TDD patterns and scope for a ServiceNow Fluent app on the Now SDK

Research write-up for brb-app. Answers: *what testing is actually supported by the
Now SDK (`@servicenow/sdk` 4.13.9, the version pinned in `package.json`), what TDD
patterns are feasible given that support, and what the concrete test scope is for
this app.*

> **Scope of this doc.** It defines the *patterns and scope*, not the test code.
> Building the tests is downstream authoring work (same status as replacing the
> incident-manager scaffold — see `CODING_STANDARDS.md` "Fluent authoring
> conventions"). Where a claim rests on a primary source it is cited inline.

## Sources consulted

**Primary — Now SDK `explain` docs (local, versioned to the installed SDK; authoritative per the `now-sdk` skill):**
- `atf-guide` ("Implementing Tests Guide") — ATF categories, `Test()`/`TestSuite()` authoring, `atf.server.runServerSideScript` + Jasmine, per-namespace API.
- `ci-integration` — `now-sdk build --frozenKeys`, `now-sdk install`, `now-sdk cicd testsuite run` / `test run` / `publish` / `install` / `rollback`.
- `atf-ui-test-script-guide` (peek) — `atf.uiTestScript.runTest()` + TestingLibrary for custom UI.
- `testsuite-api` (peek) — `TestSuite()` is authoring-only; running is via UI/scheduler/CI.
- Reproduce locally: `./node_modules/.bin/now-sdk explain <topic> --format=raw` (load Node via `nvm use 24.19.0` first — see `.nvmrc`).

**Primary — ServiceNow product/developer docs (web):**
- ATF overview / "run only on non-production": https://developer.servicenow.com/print_page.do?category=learning-module&identifier=ATF_About_zurich%2Cservicenow_application_developer&module=learning+plan&release=zurich
- Platform dev "plan" guide (testability, server/REST steps, move logic into Script Includes): https://developer.servicenow.com/print_page.do?category=now-platform&identifier=pd-plan&module=guide&release=yokohama
- ATF tests & steps (Run Server Side Script / Jasmine): https://developer.servicenow.com/blog.do?p=%2Fpost%2Fautomated-testing-framework-in-detail-part-1-tests-and-steps%2F
- ATF suites, scheduling, client test runner: https://developer.servicenow.com/print_page.do?category=learning-module&identifier=app_store_learnv2_atf_xanadu_tests%2Cservicenow_application_developer&module=learning+plan&release=xanadu
- CI/CD with GitHub Actions ("Run ATF Test Suite" action): https://developer.servicenow.com/blog.do?p=%2Fpost%2Fcicd-pipeline-github-actions%2F
- Source control / CI-CD resources: https://developer.servicenow.com/blog.do?p=%2Fpost%2Fsource-control-cicd-resources%2F
- ATF testable custom-UI components / Page Inspector: https://developer.servicenow.com/blog.do?p=%2Fpost%2Fatf-testable-components%2F

**Project primary sources:** `PRD.md` (§4 state table, §6 invariants I1–I9, §10 release criteria), ADRs `0002`–`0006`/`0008`, `CODING_STANDARDS.md`, `package.json`, `now.config.json`.

---

## 1. What the Now SDK actually supports (the ground truth)

The SDK ships **exactly one** first-class testing capability: **authoring
ServiceNow Automated Test Framework (ATF) artifacts in Fluent, and running them on
an instance via the CLI.** There is **no** off-instance / local unit-test harness
shipped or documented by the SDK.

### 1a. ATF tests are Fluent metadata

ATF tests and suites are authored as normal Fluent records and installed like any
other metadata (`atf-guide`):

```ts
import { Test, TestSuite } from '@servicenow/sdk/core'
import '@servicenow/sdk/global'

Test({ $id: Now.ID['i9_working_days'], name: 'I9 — working-day count', description: '…', failOnServerError: true }, (atf) => {
  atf.server.runServerSideScript({ $id: Now.ID['i9_step'], jasmineVersion: '3.1', script: `…` })
})
```

- `Test()` → `sys_atf_test`, steps execute **sequentially**; `$id` must be globally unique per test and per step (`atf-guide`).
- Thirteen `atf.*` categories exist: `server`, `form`, `form_SP`, `rest`, `catalog`, `catalog_SP`, `email`, `applicationNavigator`, `reporting`, `responsiveDashboard`, `list`, plus `uiTestScript` for custom UI (`atf-guide` Category table).
- `TestSuite()` → `sys_atf_test_suite` (+ membership), orderable and nestable, with per-test `abortOnFailure`. **It is authoring-only** — it does not trigger or schedule a run (`testsuite-api`, `atf-guide` "Test Suites").

### 1b. Server-side "unit test" harness = `atf.server.runServerSideScript`

This is the one SDK-supported way to unit-test server-only logic (Script Includes,
Business-Rule-backed behavior) with no UI (`atf-guide` §"API Reference: atf.server"):

- Runs an arbitrary server script; supports **custom assertions** (`assertEqual({ shouldbe, value })`, `stepResult.setOutputMessage`, return `true/false`) **and Jasmine `describe/it/expect` suites**.
- **Jasmine version is pinned to `'3.1'`** (currently the only supported value).
- Pattern: instantiate the Script Include inside the script and assert its output — do **not** try to drive a Script Include through `atf.form`/`atf.catalog`.

This is corroborated by ServiceNow's own docs: ATF is primarily *functional* testing
but the Run Server Side Script step can unit-test Script Includes / Business Rules,
and the platform explicitly recommends moving reusable logic **into Script
Includes** precisely so it is testable (pd-plan guide; ATF-in-detail blog).

### 1c. Running tests from the CLI / CI

`now-sdk cicd` drives the `sn_cicd` REST API; every command exits non-zero on
failure so it gates a pipeline (`ci-integration` §"Promotion and Testing"):

```bash
now-sdk cicd testsuite run --test-suite-name "BRB Regression" -o json   # gate
now-sdk cicd test run      …                                            # single test
```

- CI auth is env-var driven (`SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL`, OAuth client-credentials preferred over basic) (`ci-integration` §Authentication).
- `now-sdk build --frozenKeys` is the pre-merge guard that `src/fluent/generated/keys.ts` was committed (`ci-integration`, and `keys.ts` is already a repo invariant per AGENTS.md rule 3).
- The documented pipeline shape: **develop on a dev instance → PR → build+install to a test instance → `cicd testsuite run` (gate) → publish → install downstream** (`ci-integration` diagram). ServiceNow's GitHub-Actions material exposes the same "Run ATF Test Suite" step.

### 1d. Hard constraints to design around

- **ATF runs on an instance, and only non-production.** ServiceNow's guidance is to run ATF on dev/test instances, never production (ATF-About learning module). So *every* SDK-supported test needs a build+install+run round-trip against a live sub-prod instance — there is no in-process runner.
- **Server scripts run on Rhino / ES2021**, not Node (`javascript-compatibility-guide` exists for exactly this). Glide APIs (`GlideRecord`, `GlideAggregate`, `gs`, `GlideRecordSecure`) exist **only** on the instance.
- **No SDK off-instance testing story.** Neither the SDK docs nor ServiceNow product docs endorse Jest/Mocha/Jasmine/React-Testing-Library for a scoped app's code. Any such setup is an **unsupported engineering add-on** (see §4), not something the SDK builds or runs for you.

---

## 2. Is TDD feasible here? (honest answer)

**Red-green-refactor is feasible, but the feedback loop is instance-bound, so
"test-first" has two very different speeds depending on the layer.**

- **Pure, Glide-free logic** can be driven test-first with a *fast* local loop (sub-second) — *if* you add an unsupported local runner (§4). This fits a classic TDD cadence.
- **Anything touching Glide / ACLs / the state machine / REST / UI** can only be red-green-refactored through the **ATF-on-instance** loop: write the `Test()`, `now-sdk build && now-sdk install`, `now-sdk cicd test run`. That is minutes, not seconds — still TDD, but an *acceptance-test-driven* cadence, not a tight unit loop.

ServiceNow publishes **no explicit "we recommend TDD"** statement; it documents ATF
as the test mechanism and recommends structuring code (logic in Script Includes)
for testability. TDD is therefore a workflow *you* impose on top of a
deployment-dependent loop — viable, with the layering below chosen to keep as much
as possible in the fast loop.

This project is unusually well-suited to it: **PRD §6 already mandates
invariant-named tests** ("Test names carry the invariant ID (I1–I9), so each rule
traces to at least one automated test") and **§10 release criteria** require "each
of I1–I9 has an automated test that fails when the rule is broken" and "role access
(N1) is tested for all three roles." The test scope is **partly fixed by the
spec** — this doc maps it to SDK mechanisms.

---

## 3. The adopted model — a 6-layer hybrid

**Chosen approach: a hybrid test stack**, from cheapest/fastest (static checks) to
most expensive (on-instance UI). This adopts the six-layer hybrid proposed for the
project and reconciles it with what the SDK actually supports (§1) and with
brb-app's specific surface (ADRs). Only **Layer 1 (local unit tests)** is not an SDK
capability — it is an optional add-on you own (§4); every other layer is first-class
Now SDK / ATF.

| # | Layer | Framework / tool | What to test in brb-app | Loop speed | SDK-supported |
|---|---|---|---|---|---|
| **L0** | Static validation | TypeScript compiler (runs inside `now-sdk build`), `--frozenKeys`, + ESLint/Biome | Type errors, Fluent metadata/build issues, `keys.ts` drift, code quality | sub-second | ✅ build / ➕ lint add-on |
| **L1** | Local unit tests | Jest **or** Vitest | **Pure, Glide-free logic only**: `WorkingDays` weekday math (ADR 0006), client `useForm`/dirty-state, `AppError`/N5 envelope parsing, submit-disable logic (ADR 0008) | sub-second | ❌ add-on (§4) |
| **L2** | Platform-side unit | ATF + **Jasmine 3.1** (`atf.server.runServerSideScript`) | Script Includes needing the ServiceNow runtime: `LeaveBalance` (GlideAggregate, ADR 0005), `WorkingDays` as installed | on-instance | ✅ |
| **L3** | Integration | ATF Fluent API — `atf.server.*` + `atf.rest.*` | Business Rules, StateModel I1–I9, GlideRecord/ledger behavior, ACLs & role access (N1), the Scripted REST facade (ADR 0004/0008) | on-instance | ✅ |
| **L4** | End-to-end | ATF Fluent API — `atf.form` / `atf.catalog` | Standard-form / catalog journeys — **mostly N/A for brb-app** (see note) | on-instance (browser) | ✅ |
| **L5** | Custom UI | **Playwright (separate repo/toolchain)** — *not* ATF `uiTestScript` | The React SPA screens & flows (ADR 0008) | out-of-band (browser) | ❌ external |

> **Decision (project):** ATF **`uiTestScript` is out of scope** for this app. All
> UI/browser testing is done with **Playwright**, introduced **separately** from the
> Fluent app's test stack (its own toolchain/config, not `now-sdk`-driven). The L5 row
> stays in the model only to name where UI coverage lives; do **not** author
> `atf.uiTestScript` tests here.

**L4 is largely not applicable to brb-app.** The product's only delivery surface is
a custom React SPA on one UI Page (ADR 0008) — there are **no standard forms and no
catalog items** for `atf.form`/`atf.catalog` to drive. So brb-app's end-to-end user
journeys are exercised at **L3 (the REST facade)** for logic/authorization and at
**L5 (Playwright, separate)** for the browser path, not at L4. Keep the layer in the
model for completeness, but expect ~zero ATF tests in it here.

**Weighting (where to put effort):**
- **L3 is the heaviest** — the ledger/state-machine/ACL invariants are the product's core guarantees (G3 "balance always correct", N1/N2, append-only).
- **L0 + L1 are the cheapest wins** — `now-sdk build` already type-checks for free; a narrow Jest/Vitest suite over pure logic gives the only sub-second red-green loop.
- **L2** is cheap and high-value for the two Script Includes.
- **L5 is a thin happy-path smoke set** — expensive and brittle, so keep it small (authorization is already asserted at L3). Delivered via **Playwright, separately** (see the L5 decision above), not ATF.

### 3a. Invariant → layer → mechanism map (the fixed scope)

Every invariant has a home. Positive **and** negative cases are required wherever a
rule has two sides (`atf-guide`: "cover a positive AND a negative case"; "cover a
rule's full trigger set" — e.g. both insert and update).

Layer labels below are the §3 hybrid (**L1** local unit, **L2** platform-side unit,
**L3** integration = `atf.server`/`atf.rest`, **L5** custom UI).

| ID / req | Rule (PRD §6 / §8) | Primary layer | Mechanism |
|---|---|---|---|
| **I1 / F9 / N2** | Balance only moves via a ledger entry; ledger & audit append-only | L3 | `recordInsert` with assert `record_not_inserted` on write/delete of ledger/audit; validate balance = Σ delta |
| **I2** | end ≥ start | L3 | StateModel `I2` condition — submit a bad-range draft, assert blocked |
| **I3** | no overlapping active request (same employee) | L3 | seed an active request, attempt overlapping submit, assert blocked + the non-overlap positive |
| **I4** | only assigned manager decides, never own | L3 | `impersonate` manager/other/self; assert approve allowed only for assigned manager (ACL, ADR 0003) |
| **I5** | only Draft editable | L3 | `recordUpdate` of `note`/dates on a Submitted request → assert `record_not_updated` |
| **I6** | days ≤ available; balance never negative | **L2** (`LeaveBalance` Jasmine) + L3 (gate) | Jasmine unit on `LeaveBalance`; submit/approve over-balance → blocked |
| **I7** | a decision applies once | L3 | decide, then second decide → assert refused (structural, ADR 0002) |
| **I8** | start today+ and within one year | L3 | `I8` condition, boundary dates |
| **I9** | working days Mon–Fri inclusive; 0 refused | **L1** (`WorkingDays` pure: `Mon→Fri=5`, `Fri→Mon=2`, `Wed→Wed=1`, `Sat→Sun=0`) + **L2** (as installed) + L3 (gate refuses 0) | Jest/Vitest + Jasmine + StateModel `I9` condition |
| **F4** | rejection requires reason | L3 | reject without reason → refused; with reason → ok (`atf.rest` + `atf.server`) |
| **F5** | approve⇒DEDUCT, approved-cancel⇒RESTORE, hold release | L3 | after transition, `recordValidation`/`recordQuery` the ledger |
| **F6 / N7** | overlap shows name+dates only | **L3** (REST) | `atf.rest` on `GET /requests/{id}/decision-view`: assert overlap payload has no `leave_type`/`note` |
| **F7** | one notification per transition; failure never blocks | L3 | `atf.email.validateOutboundEmailGeneratedByNotification` / event assertion |
| **F8** | cancel only before start | L3 | cancel on/after start → refused |
| **N1** | role-based, server-enforced; cross-employee denied | **L3** | `createUser`+`impersonate` all three roles; direct read of another's request → denied (PRD §10 mandates all three roles) |
| **G1 journeys** | submit→decide happy path (F1–F5) | **L5** (+L3) | `uiTestScript` over the SPA; underlying logic already at L3 |

**Reconciliation check (PRD §9 / ADR 0005):** `balance = SUM(delta)` is both the
I1 assertion and the deploy-time reconciliation. Author it once as an `atf.server`
Jasmine/aggregate check and include it in the suite that gates every deploy.

### 3b. What is explicitly **out of scope** (don't test)

`atf-guide` is emphatic: **cover every piece of custom logic, but not platform
defaults.**

- OOTB platform behavior, plain reference-field related lists, default CRUD with no custom rule behind it → no test (one basic CRUD test suffices only for a truly logic-free table).
- Non-goals from PRD §3 (payroll, accruals, carry-over, half-days, holiday calendars, calendar sync) → nothing to test; ADR 0006 even records "no Schedule/holiday calendar" as a deliberate *no*.
- `PATCH /requests/{id}` (edit-draft) is contract-only and unused by the v1 client (ADR 0008) — cover it at L3 REST-contract level at most, not via UI.
- Don't over-use `atf.server` for what `atf.form`/`atf.rest` test directly; don't hardcode `sys_id`s (`atf-guide` "Avoidance" — matches AGENTS.md rule 3).

---

## 4. The optional fast inner loop (off-instance) — unsupported, use with eyes open

The only brb-app code that is **pure and Glide-free** is a natural fit for a
sub-second local TDD loop:

- **Server:** the *weekday arithmetic* core of `WorkingDays` (ADR 0006 calls it "pure arithmetic on day-of-week… no timezone maths") — *if* authored as a pure function the Script Include wraps.
- **Client:** `useForm`/dirty-state compare, the `AppError`/N5 envelope parser, date formatting, submit-disable logic (ADR 0008 §Forms, §Error conventions) — ordinary TypeScript/React.

**Reality check before adopting it:**

- **Not SDK-supported.** No ServiceNow/SDK primary source endorses Jest/Vitest/RTL for scoped-app code. You own the config, and `now-sdk build` (isomorphic-rollup) will not run or know about these tests.
- **Glide must be mocked.** `GlideRecord`/`GlideAggregate`/`gs`/`GlideRecordSecure` don't exist off-instance, so `LeaveBalance` and anything DB-touching **cannot** be meaningfully unit-tested locally without hand-written mocks — and a mock that drifts from real Glide gives false green. Prefer Layer 2 (ATF Jasmine) for these.
- **Drift risk is real and the ADRs already fight it.** ADR 0006 deliberately rejects a duplicated client-side day counter so the client preview can't drift from the server gate. A local test suite that re-implements/mocks server behavior reintroduces exactly that drift. Keep local tests to genuinely pure, single-home logic; let ATF own anything with a server counterpart.

**Recommendation:** treat Layer 1 as *optional and narrow*. If adopted, scope it to
pure functions only, keep it in a clearly separate runner (e.g. `vitest` over
`src/client/**` + extracted pure server helpers), and never let a local green
substitute for the invariant's mandated ATF test (PRD §10 requires the ATF one).

---

## 5. Conventions this project should adopt

1. **Invariant-named tests.** `Test()` `name` carries `I1`…`I9` / `F4` / `N1` (PRD §6/§10). `description` states *what* behavior and *how* it's asserted (`atf-guide` "Writing the Test Description").
2. **Co-locate ATF tests with the Fluent source** they cover, under the `src/fluent/` tree, as `*.now.ts`; register the suite via `TestSuite()`. (The exact folder is a build-time `CODING_STANDARDS.md` decision; `atf-guide` only requires unique `$id`s.)
3. **One gating suite** ("BRB Regression") grouping the I1–I9 + N1 + reconciliation tests; wire `now-sdk cicd testsuite run` into CI after `install` (`ci-integration`), with `now-sdk build --frozenKeys` as the pre-merge guard.
4. **Reconcile tests on edits, don't just add** (`atf-guide`): changed logic → update its test in place; removed logic → `Now.del('sys_atf_test', …)` (deleting the `.now.ts` alone does not prune the installed record in a configuration project) — and this is a `Table()`/`Record()`-class deletion, so **confirm with the user first** (AGENTS.md rule 4).
5. **TDD cadence:** pure logic → Layer 1 red-green locally (if adopted); everything else → write the ATF `Test()` first, `build && install`, `cicd test run` to see red, implement, re-run to green. Keep Layer 5 UI tests a thin happy-path smoke set.

---

## 6. Open items to confirm (not resolvable from primary sources alone)

- **ATF enabled on the dev instance — RESOLVED.** `sn_atf.runner.enabled` must be `true` to run ATF (`now-sdk cicd test run` 400s otherwise). It is kept **`true` permanently** on the sub-prod dev instance (`empdpatel1`) by project decision — do not revert it to `false`. The default is `false` only to stop tests running on production; this is a non-prod dev box. (The **ATF Cloud Runner is not installed** there, so `--run-in-cloud` fails; server-side tests run fine via the scheduled runner.)
- **UI testing — RESOLVED: use Playwright, not ATF.** `atf.uiTestScript` is out of scope (see the L5 decision in §3). The React SPA is covered by a **separate Playwright** toolchain, introduced independently of the Fluent test stack. Nothing to verify about `uiTestScript` DOM reach here.
- **CI instance targeting.** `now-sdk cicd testsuite run` needs the auth env vars pointed at the *test* instance per step (`ci-integration`); the pipeline wiring is a separate setup task (candidate for the `wizard` skill).
