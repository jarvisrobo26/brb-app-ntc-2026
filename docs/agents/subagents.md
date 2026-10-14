# Subagents / background agents

Several skills (e.g. `wayfinder`, `research`, `chief-of-staff`, `improve-codebase-architecture`, `claude-handoff`) tell the agent to "spin up a subagent" or "launch a background agent" without naming a concrete tool. That vocabulary is **runtime-agnostic**. This file records how to honour it in the two runtimes this repo uses, so those skills fire a real subagent instead of being silently skipped — without favouring one tool over the other.

## The mapping

Whenever a skill says "spin up a subagent", "spawn a sub-agent", "launch a background agent", or "a subagent that calls the Skill tool with '<name>'", use your runtime's native mechanism:

| Runtime | How to launch a (background) subagent |
| --- | --- |
| **Claude Code** | Its subagent / Task mechanism, e.g. `claude --bg --name "<name>" -- "<task>"` as `claude-handoff` describes, or the Task tool for in-session subagents. |
| **Devin** | The `run_subagent` tool (`is_background=true` for background work). |

Both runtimes support this; pick the one you're running in. Don't translate a skill's instruction into the *other* runtime's command.

## Write-capable vs read-only

A research/handoff subagent that must **write a notes file and push a branch** needs a write-capable agent. A pure exploration subagent can be read-only.

- **Claude Code:** the Task/subagent inherits your session tools; ensure write and `git` are permitted (see Permissions below).
- **Devin:** use the **`subagent_general`** profile for write/commit/push work (full tools in foreground, pre-approved tools only in background). Use **`subagent_explore`** (read-only) only for pure investigation. Wayfinder `research` tickets must use `subagent_general` — on the read-only profile they run but produce no notes and no branch.

## Background vs foreground

Background subagents return immediately and notify the parent on completion — this is what `research` ("so you keep working while it reads") and `wayfinder` step 5 ("resolve them in parallel") want. A background subagent can only use tools **already approved for the session**; anything not pre-approved is auto-denied and it cannot prompt. If a write-capable research run hasn't had its tools pre-approved, run it in the **foreground** (or, in Devin, resume the failed background subagent in the foreground to approve).

## Inline the instructions

A subagent only receives the `task` prompt you hand it. Don't assume it will auto-invoke a skill just because the parent skill says "a subagent that calls the Skill tool with 'research'". When launching a research subagent, paste the `research` skill's job into the task: investigate **primary sources**, write findings to a single Markdown file (matching where this repo keeps notes), cite each claim, and push the throwaway `research/<name>` branch **without opening a PR**. Include the specific question and any context from the ticket.

## Permissions

Background subagents can only use tools pre-approved for the session. Pre-approve the writes and `git` a research run needs:

- **Devin:** this repo ships `.devin/config.json` with the required `permissions.allow` entries, so background research works without interactive approval. Extend that list if a subagent needs other tools.
- **Claude Code:** configure the equivalent auto-approve in your Claude settings (e.g. `.claude/settings.json` permissions or your global settings) for `Write` and `git`. This is intentionally left to each developer's Claude setup rather than committed here.
