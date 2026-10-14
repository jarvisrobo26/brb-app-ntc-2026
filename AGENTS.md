# brb-app — agent guide

This is the single source of truth for AI coding agents working in this repo. `CLAUDE.md` is a symlink to this file so Claude Code reads the same content; Devin and other tools read `AGENTS.md` directly.

BRB ("Be Right Back") is a leave / time-off tracker built as a ServiceNow Fluent application with the Now SDK. Product spec: `PRD.md`. Ubiquitous language: `GLOSSARY.md`. Human setup and usage: `README.md`.

## Operating rules

The contract every session follows in this Fluent project. Each rule is the gate; its owning doc holds the detail — read the doc, don't restate it here.

1. **Orient first.** Run the `now-sdk` skill's orientation before any Fluent work — it is versioned to the installed `@servicenow/sdk`, so treat its guidance as authoritative wherever it is more specific than these docs.
2. **Read before you edit.** Consult `GLOSSARY.md` for the term, the relevant `docs/adr/` for the locked decision, and `CODING_STANDARDS.md` for how to build it, before changing tables, ACLs, Business Rules, Script Includes, the REST facade, or the React client. Use the glossary's words; if your change contradicts an ADR, surface it rather than silently overriding.
3. **Identities come from `Now.ID` / `keys.ts` only.** Never hand-write, invent, or hardcode a `sys_id`; the only raw `sys_id` strings allowed are ones a live `now-sdk query` returned. See *Record identity* in `CODING_STANDARDS.md`.
4. **Confirm before deleting a Fluent definition.** Removing a `Table()` / `BusinessRule()` / `Record()` / `Acl()` (etc.) generates an upgrade-time delete that drops it from every installed instance — confirm with the user first. See *Record identity* in `CODING_STANDARDS.md`.
5. **Keep docs honest.** When your change shifts a convention, update its owner in the same change — the *Agent-docs duty* in `CODING_STANDARDS.md` says which file owns what.
6. **Build & deploy with `pnpm`, not `npm`.** `pnpm run dev` watches the client locally; `pnpm run build` compiles + typechecks; `pnpm run deploy` (`now-sdk install`) pushes to the authenticated instance. Server modules, Fluent metadata and ACLs only take effect once deployed, so build then deploy when you need to validate on-instance, and verify after (`now-sdk query`, open the UI Page). Deploying hits a shared instance — use judgment, don't deploy half-finished work. Script list: `README.md`.

## Standards & docs

| Doc | What it owns |
| --- | --- |
| `PRD.md` | Product requirements — roles, state machine, invariants I1–I9, NFRs (frozen; changes go to a new version). |
| `GLOSSARY.md` | Ubiquitous language — the term to use for every domain concept. |
| `docs/adr/` | Architecture decisions (ADR 0001–0009) — the locked "why" behind the Fluent realization. |
| `CODING_STANDARDS.md` | How to build it — Fluent authoring conventions, change discipline (branches & PRs for maps & specs), doc ownership. |
| `docs/knowledge/learning-retro.md` | Running log of SDK/platform gotchas discovered via bugs — learnings, not standards or decisions. |
| `README.md` | Human setup and usage. |

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `jarvisrobo26/brb-app` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Subagents / background agents

Some skills say "spin up a subagent", "launch a background agent", or "a subagent that calls the Skill tool with ...". This vocabulary is runtime-agnostic: use whichever background-agent mechanism your runtime provides (Claude Code and Devin each have one). Wayfinder `research` tickets write a notes file and push a branch, so they need a write-capable agent and run in the background. See `docs/agents/subagents.md`.
