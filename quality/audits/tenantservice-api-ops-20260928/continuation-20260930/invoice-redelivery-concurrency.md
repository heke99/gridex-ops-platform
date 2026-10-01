# T17 additional native concurrency proof — 2026-09-30

This is an additional proof package. The accepted twelve-file redelivery package is unchanged. It prepares seven genuine PostgreSQL connection cases against the complete disposable native migration replay; it does not claim a native PASS from this workspace.

## Owned files and scope

- `scripts/invoice-redelivery-concurrency-20260930-native.config.ts`
- `scripts/invoice-redelivery-concurrency-20260930-native.test.ts`
- This report.

The configuration requires a native status receipt whose API URL is exactly `http://127.0.0.1:54321`; seeding additionally requires `CI=true`. The database connection is fixed to disposable PostgreSQL at `127.0.0.1:54322`. No hosted URL, caller-selected database, provider, invoice purchase, storage fetch or external email is used.

The test reuses the authentic seed/profile-change prefix of the frozen `invoice-redelivery-decision-20260930-native.sql`, stopping before its first decision command. It commits only these random synthetic fixtures so two worker connections can see them. The disposable stack owns teardown; this package does not attempt to delete immutable financial history. It does not duplicate the frozen single-connection denial and whole-history assertions.

Every waiting case observes `pg_stat_activity.wait_event_type='Lock'` and the exact blocking PID from `pg_blocking_pids`. Generated application names are checked to stay below PostgreSQL's 63-byte limit, preventing a wait check from silently using a truncated name. A third, read-only observer connection checks waiting and outcomes.

## Prepared cases

| Case | Actual command/interleaving | Required receipt |
| --- | --- | --- |
| Same key, two sessions | First real RPC retains transaction locks after writing its decision; second real RPC waits for that specific connection, then resumes after commit. | First `replayed=false`, second `replayed=true`, same decision ID, exactly one decision and one linked audit event. |
| Fresh decision, session revoked while waiting | Separate connection holds the actual key advisory lock; waiting writer is observed; the blocker deletes the current Auth session and commits. | `redelivery_actor_forbidden`, zero new decision/audit. |
| Completed replay, session revoked while waiting | Same sequence with an already completed decision. | Current authority is still required; prior decision/audit remain byte-for-byte equal. |
| Fresh decision, Auth proof withdrawn | Separate connection changes the existing owner Auth row's `email_confirmed_at` to null and retains its lock while the writer waits. | `redelivery_destination_unverified`, zero new decision/audit. |
| Completed replay, Auth proof withdrawn | Same interleaving with an existing decision. | Replay rechecks current proof and preserves the prior decision/audit. |
| Real profile edit while waiting | Separate connection holds the current customer row; after observing the writer's wait, it calls the canonical billing profile command and commits revision 2. | Waiting revision-1 decision returns `redelivery_revision_conflict`, zero new decision/audit. |
| Final live clock after late audit wait | Separate transaction occupies only the real audit idempotency key. Writer passes initial session checks and blocks on the audit unique key; the observer verifies the session deadline expires; the blocker rolls back. | Final clock rejects `redelivery_actor_forbidden`; both decision and audit writes roll back together. |

Every case compares the complete original invoice, export item, underlay, pricing run, ordered invoice lines and ordered document-reference rows before and after. It requires exact equality including original provider GUID/request and stored financial/document evidence. Success remains `blocked_provider_adapter`; this proof never marks or sends a delivery.

## Local validation receipt

- TypeScript transpilation of the two new files: PASS.
- Focused TypeScript check, extending `tsconfig.scripts.json` and including only these two files: PASS.
- ESLint for both new files with `--max-warnings=0`: PASS.
- `git diff --check` for these paths: PASS.
- Starting the config without `GRIDEX_NATIVE_STATUS`: rejected before test collection with `redelivery_concurrency_disposable_replay_required`, exit 1 as expected.
- Seven native cases: **NOT EXECUTED HERE**. No disposable Docker/PostgreSQL native stack is available in this workspace. Root owns workflow wiring and the actual full-schema run.

Required CI command after the complete disposable migration replay is `CI=true GRIDEX_NATIVE_STATUS=<local-status-json> node node_modules/vitest/vitest.mjs run --config scripts/invoice-redelivery-concurrency-20260930-native.config.ts`. The existing frozen SQL fixture remains a separate command/gate.

## Independent pricing review outcome

Read-only review of root's market-source policy action, page, shared action form and actual-function tests identified three concrete gaps: ordinary policy save replaced existing metadata; the page lacked the same nonplatform selected-company equality enforced by the action; and cache refresh failure converted confirmed persisted results into generic failure. Root integrated scoped metadata merge, pre-query page scope rejection, and a refresh helper preserving the qualified result with a reload notice. Actual exported-function/page regressions for these findings are present. Their integrated runtime receipt is owned by root. No additional concrete shared pending/read-only/draft/result-label bypass was found in this bounded review; no native page/browser claim is made.

## Original requirement boundary

This package strengthens T17 local decision authority, revision, proof, replay and final-clock serialization evidence, and supports the issued-history preservation boundary in T16/T18. Until its native CI execution, the seven interleavings remain explicitly prepared, not verified. Existing successful local PGlite and action/UI tests remain described in `invoice-redelivery-decision.md`; they are not promoted to genuine two-session or whole-schema proof here. Remote document bytes, agency ownership, an actual partner redelivery adapter and partner delivery acknowledgement remain separate unavailable components. No global T17 completion claim follows from creating a local delivery decision.
