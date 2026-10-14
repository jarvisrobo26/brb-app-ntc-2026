# BRB — Be Right Back

> Ask for time off, have your manager approve it, and keep your balance and the team calendar right.

**BRB** is a leave / time-off tracker built as a **ServiceNow Fluent** application with the **Now SDK**. Employees submit leave requests, managers approve or reject them, and every balance change is recorded as an append-only ledger entry so the balance is always explainable.

This README is written for humans setting up and working on the repo. AI coding agents should start from [`AGENTS.md`](./AGENTS.md).

## Status

Early development. The product is specified in [`PRD.md`](./PRD.md) (v1 leave-tracking flow) and the domain language in [`GLOSSARY.md`](./GLOSSARY.md). The current source tree still contains scaffold UI (a sample "incident manager" UI page) that is being replaced by the BRB screens — expect names in `src/` to change as the leave-request UI lands.

## Tech stack

- **ServiceNow Fluent / Now SDK** (`@servicenow/sdk`) — app metadata (tables, ACLs, business rules, UI pages) defined in TypeScript `.now.ts` files.
- **React 19 + TypeScript** — the client, delivered through a ServiceNow UI Page.
- **Rollup** (`@servicenow/isomorphic-rollup`) — bundles the client assets (see `now.prebuild.mjs` and `now.dev.mjs`).
- App scope: `x_snc_brb_app`.

## Prerequisites

- **Node.js** (LTS; see `.nvmrc`) and **pnpm** — this repo is pnpm-based (`pnpm-lock.yaml`), so use `pnpm`, not `npm` (`corepack enable` gives you pnpm without a global install).
- A **ServiceNow instance** you can deploy to (e.g. a Personal Developer Instance) with admin rights.
- Recommended: VS Code with the **ServiceNow Fluent** extension (`servicenow.fluent-language-extension`, already in `.vscode/extensions.json`).

The Now SDK CLI ships as a dev dependency, so you can invoke it with `npx now-sdk` / `npx @servicenow/sdk` after installing — no global install required.

## Setup

```bash
# 1. Clone and install
git clone https://github.com/jarvisrobo26/brb-app.git
cd brb-app
pnpm install

# 2. Authenticate the Now SDK against your instance
#    (see `npx @servicenow/sdk explain auth --format=raw` for the exact flow/flags)
npx now-sdk auth

# 3. Generate dependency types for the configured scope
pnpm run types

# 4. Build the app (runs the client prebuild, then the Fluent build)
pnpm run build

# 5. Deploy / install the app onto your authenticated instance
pnpm run deploy
```

### One command: build, deploy and seed the demo

Steps 4–5 are also available as a single command that builds and installs in one
go, loading the **demo seed** by default (`now-sdk install` defaults `--demoData`
to `true`):

```bash
pnpm run setup
```

On a freshly authenticated clean scaffold this produces a fully demoable BRB: one
admin, one manager and two employees (reporting to that manager), their role
grants, a small leave-type catalog, and one GRANT allowance per employee per type
so every seeded employee starts with a reconciling balance.

A production-style install opts out of the demo data:

```bash
pnpm run build && npx now-sdk install --demoData false
```

The seed is authored as idempotent Fluent `Record()` fixtures (`src/fluent/seed/`),
so re-running `pnpm run setup` updates the same rows in place and never
double-grants.

Once deployed, the app's UI Page is served from your instance at the endpoint defined in `src/fluent/ui-pages/` (currently `x_snc_brb_app_incident_manager.do`; this endpoint will be renamed as the BRB UI replaces the scaffold).

## pnpm scripts

| Script | Command | What it does | When |
|---|---|---|---|
| `pnpm run dev` | `now-sdk run dev` | Watch mode: rebuilds client assets as you edit (`now.dev.mjs`). | Iterating on the client UI locally. |
| `pnpm run build` | `now-sdk build` | Builds the app (client prebuild via `now.prebuild.mjs`, then Fluent metadata) and typechecks. | Quick compile/typecheck check after any change. |
| `pnpm run deploy` | `now-sdk install` | Installs/deploys the built app to your authenticated instance. | To validate on-instance — server modules, Fluent metadata and ACLs only take effect once deployed. Requires a prior `build`. |
| `pnpm run setup` | `now-sdk build && now-sdk install` | One-command build + install; loads the demo seed by default (`--demoData true`). | First demoable install from a clean scaffold. Add `--demoData false` to `now-sdk install` to opt out of the seed. |
| `pnpm run transform` | `now-sdk transform` | Transforms existing instance metadata into Fluent source. | Pulling instance-side changes back into Fluent. |
| `pnpm run types` | `now-sdk dependencies` | Fetches dependency type definitions for the scope. | After adding a new table/scope dependency. |

Run `npx @servicenow/sdk <subcommand> --help` for flags, and `npx @servicenow/sdk explain --list --format=raw` for the SDK's built-in documentation topics.

## Project structure

```
.
├── AGENTS.md                # Single source of truth for AI agents (CLAUDE.md symlinks here)
├── PRD.md                   # Product requirements (v1 leave-tracking spec)
├── GLOSSARY.md              # Ubiquitous language for the domain
├── now.config.json          # App scope + build config (scope: x_snc_brb_app)
├── now.prebuild.mjs         # Client asset build (Rollup) run before the Fluent build
├── now.dev.mjs              # Client watch build for `pnpm run dev`
├── package.json             # Scripts + dependencies
├── src/
│   ├── client/              # React + TypeScript client (delivered via a UI Page)
│   │   ├── components/       # UI components
│   │   └── services/         # Client-side data access
│   ├── fluent/              # Fluent (.now.ts) metadata definitions
│   │   └── ui-pages/         # UI Page definitions that host the client
│   └── server/              # Server-side TypeScript config
├── scripts/manual/          # Hand-run curl checks against a deployed facade (credentials via env vars)
└── docs/
    ├── adr/                 # Architecture decision records
    └── agents/              # Agent operations docs (issue tracker, triage, subagents)
```

## Learn more

- [`PRD.md`](./PRD.md) — what BRB does: roles, states, business rules (I1–I9), data model.
- [`GLOSSARY.md`](./GLOSSARY.md) — the terms to use (Employee, Manager, Leave Request, Ledger…).
- [`docs/`](./docs) — ADRs and agent-facing operational docs.
- [`AGENTS.md`](./AGENTS.md) — conventions for AI coding agents.
