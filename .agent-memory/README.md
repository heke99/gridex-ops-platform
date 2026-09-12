# Gridex OPS project memory

This directory is the single canonical progress system for long-running agent
work. It records current state and resumability; code, live schema, forward
migrations, executed tests, runtime evidence, OpenAPI and active architecture
decisions remain higher-authority sources.

## Read order

1. `current-state.md` — the sole authoritative status, active task, blockers,
   verification boundaries and next action
2. `checkpoint.json` — continuity pointer only
3. relevant domain files
4. `decisions.md` and `known-failures.md`

`current-task.md`, `handover.md`, `open-blockers.md`, and `work-plan.md` are
pointers to `current-state.md`. Files below `archive/` are historical records,
never active evidence.

## Update rules

- Maintain exactly one active work item and subtask.
- Update `current-state.md` after implementation, verification, failure or a
  blocker; keep `checkpoint.json` limited to continuity pointers.
- Put only actually verified work in `completed-work.md`.
- Append concise evidence to `verification-matrix.md` and `session-log.md`.
- Archive superseded progress; do not run two current-task systems.
- Resolve conflicts by inspecting implementation, schema, migrations and tests,
  then mark stale memory `SUPERSEDED` and add a regression test.

Allowed statuses: `NOT_STARTED`, `IN_PROGRESS`, `PARTIAL`, `BLOCKED`,
`IMPLEMENTED_NOT_VERIFIED`, `VERIFIED`, `FAILED`, `SUPERSEDED`,
`NOT_APPLICABLE`.

Never store API keys, tokens, secrets, `.env` content, private keys, passwords,
full identity numbers, production customer data, raw webhook secrets, entire
chats, chain-of-thought or complete terminal output.
