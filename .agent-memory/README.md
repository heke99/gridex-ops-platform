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
9. `masterplan-agent-workflow.md`, `masterplan-reservations.md` and your own checkpoint
10. `masterplan-legacy-pr-register.json`, relevant dated status evidence, latest
    #673 receipts and linked historical #530 evidence, actual main/coverage,
    current PR heads/checks and live remote refs; read `masterplan-work-queue.md`
    for dated owner actions, exact dependency/handoff criteria and chat resumption

Read active startup sections and your checkpoint first; consult relevant dated
history as needed. Current code, coverage, head-bound checks and remote refs
override old current/paused/next-action labels. #673 is the active board; #530
preserves historical evidence.

Before implementation or another work item, every agent must save ownership, actual
completed work, verification, blockers and the exact next action. Technical
agents update their own checkpoints; the current memory-role holder maintains
shared status only within its exact file custody. PLANAGENT selects and atomically
reserves its own eligible rule packet or acceptance-only packet, with the existing
final-single-eligible exception; BLOCKERARAGENT stays on sequential, evidenced
blockers; GRANSKARE keeps its independent read-only role. New agents get a role,
not rule assignments. Direct GitData and the already owner-authorized Claude
proxy both require verified actual refs before code; proxy success does not
prove direct tag capability.

Use `masterplan-next-wave-prompt.md` for plan agents and
`masterplan-blocker-agent-prompt.md` for blocker agents. After documented actual
delivery or explicit handoff/release, refresh state and choose the next eligible
work item within that role. Legacy CLOSED_UNMERGED requirements remain resumable
through their preserved branches; evaluate them before selecting new work.

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

Current continuation: follow the role-specific instructions in `AGENTS.md`,
the active sections of current-state.md/current-task.md/work-plan.md,
masterplan-agent-workflow.md, masterplan-reservations.md and the legacy register.
Older integration/freeze/pre-dispatch snapshots are historical. Specific HOLD,
external decisions, ownership and delivery gates remain in force. If no task is
READY, record the responsible owner and exact resumption event; a blocked state
does not imply the plan is complete.
