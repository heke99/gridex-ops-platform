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

## Parallel side track: tenantservice

The active Ediel campaign owns `checkpoint.json`, `current-task.md` and
`handover.md`. The user-approved tenantservice side track (customer support
API + tenant OPS UI) keeps its single resumable checkpoint in
`tenantservice-checkpoint.md` and its evidence in `quality/tenantservice/`.
Do not mix the two: an Ediel agent must not resume tenantservice items from the
Ediel checkpoint, and the tenantservice agent must not edit the Ediel files.

## Parallel side track: customer portfolio

Customer portfolio / white-label analytics (user-approved 2026-10-03) keeps its
checkpoint in `customer-portfolio-checkpoint.md` and its evidence in
`quality/customer-portfolio/`. It does not edit the Ediel files either.

## Update rules

Customer and daily admin UI simplification (user-approved 2026-10-05) keeps its checkpoint in
`customer-ui-checkpoint.md` and local verification evidence in
`quality/customer-ui/`, preserving the Ediel campaign's global progress files.

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
