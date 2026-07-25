# Gridex OPS project memory

This directory is the single canonical progress system for long-running agent
work. It records current state and resumability; code, live schema, forward
migrations, executed tests, runtime evidence, OpenAPI and active architecture
decisions remain higher-authority sources.

## Read order

1. `current-state.md`
2. `current-task.md`
3. `checkpoint.json`
4. `handover.md`
5. `open-blockers.md`
6. active item in `work-plan.md`
7. relevant domain files
8. `decisions.md` and `known-failures.md`

## Update rules

- Maintain exactly one active work item and subtask.
- Update the checkpoint after implementation, verification, failure or blocker.
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
