# Historical PR #310 description

Superseded snapshot captured on 2026-09-07 before consolidated group reporting.
This is historical text, not current verification evidence.

Canonical replay omitted historical effects, and verification tooling could report false success. This draft repairs that chain and reconstructs missing effects. Production convergence is not established.

Changes:
- Read all five checksum manifests with conflict detection; protect migration/seed restoration and avoid stopping Supabase before startup is attempted.
- Require exhaustive historical input accounting before replay. Three reviewed diagnostic/operational exclusions are immutable and narrowly bound; unresolved schema effects remain blocking.
- Reject incomplete schema documents and compare relation security options and ACL grant options bidirectionally.
- Reconstruct seven tenant relationship triggers and eleven invitation fields/constraints/indexes through forward migrations.
- Preserve the complete portal/API-origin and Ediel environment sources. The latter restores three omitted tables and allows successor columns, FKs and RLS to execute.
- Select the complete pre-ledger customer-flow source after its foundation dependencies, including five supplier fields omitted by the narrow bootstrap.
- Select the previously unclassified actor-testing automation source after its four required tables. Complete SQL runs twice; five exact index definitions and unchanged evidence/messages are checked.

Verification:
- Migration integrity/readiness: 587 files; accounting: 29 regression tests; recovery: 14 tests; parity semantics: 26 isolated checks.
- Ediel full original source and successor executed twice on PostgreSQL 17 with pgcrypto, actual route-history trigger, synthetic data, uniqueness, FK/RLS and non-owner policy assertions. Passed both d6967d21 and 69d51ee2 CI jobs.
- Customer-flow complete SQL executes twice in PGlite 0.3.14, preserving existing values. Selection test was red before the fix and green after, with prerequisite ordering checked.
- Current published code head: 4df526a8f73228ecb1f41c672db98cebbc7bf108. OPS run https://github.com/heke99/gridex-ops-platform/actions/runs/34055573705: Ediel PostgreSQL17 PASS; all isolated SQL fixtures including billing completion, request status and profile normalization PASS. Verify subsequently FAILS generated-types migration tail; clean replay FAILS. Quality remains in progress.

Merge blockers:
- 587 SQL inputs: 503 FULL_FILE_SELECTED, 29 unresolved SUBSTITUTED, 51 UNCLASSIFIED, 4 EXPLICITLY_EXCLUDED. Selection is not execution or surviving-effect proof.
- Full clean replay, authoritative generated schema/types, migration ledger reconciliation and bidirectional production parity remain open. Existing types correctly fail the new migration tail; canonical hashes are not manually adjusted.
- Existing local-stack ownership after reaching startup remains unresolved. Runtime environment-to-production DB binding is not independently verified.
- No production mutations in this campaign. No masterplan phase is complete. Isolated SQL tests are not canonical provenance or complete tenant/provider E2E verification.

Evidence: .agent-memory and quality/audits/{EDIEL_ENVIRONMENT_REPLAY_EFFECTS_2026-09-06,CUSTOMER_FLOW_REPLAY_EFFECTS_2026-09-06,INVITATION_REPLAY_EFFECTS_2026-09-06,PORTAL_ORIGIN_REPLAY_EFFECTS_2026-09-06,OPERATIONAL_REPAIR_CLASSIFICATION_2026-09-06}.md.

Next: finish inspecting the current quality job, continue the remaining historical source reviews, then regenerate canonical artifacts from authoritative replay and verify ledger/live parity.

Continuation 2026-09-06:
- Restored complete billing completion source after the required billing_export_run_id prerequisite. Tests prove wrong ordering fails; four exact indexes and existing data are checked.
- Restored request-status source immediately after its first table definition, before later CHECK constraints. Tests cover 19 states, validated CHECK, unchanged rows/PK/FKs and dirty-data rollback.
- Restored profile metadata normalization at the reviewed trigger-free foundation boundary. Tests cover valid and legacy values, deterministic normalization and unchanged identity/status/timestamps/auth FKs.
- These three original SQL files and checksum pins are unchanged. No production repair or phase closure is authorized by isolated tests.
- Next: verify the remaining quality result, then test complete auth-callback/email-event source on PostgreSQL17 before restoring it ahead of profile normalization; continue remaining historical accounting and canonical/ledger/live parity.


### 2026-09-07: POA/request source restoration

Published revision `aed588c0c9c40b221eeff5ccf81812736507ab67` restores the complete original POA/request source after its four table prerequisites. Test-first PG17 job 101641683544 passed before restoration; restoration-head job 101642417324 in OPS run 34090366696 passes selection order and the complete source twice (24 states, exact indexes, preserved rows/keys/policies). Reversing the prerequisite order is rejected. Accounting regressions: 29 PASS; migration integrity: 587 files PASS; static provenance PASS.

Accounting now: 505 FULL_FILE_SELECTED, 28 unresolved SUBSTITUTED, 50 UNCLASSIFIED, four exclusions. This does not prove whole canonical execution. Verify fails the generated-types migration tail; clean replay fails its required completeness gate. Quality job 101642417302 was still running at inspection. No production mutation, generated artifact edits, merge, or phase closure.

Next source review: auth email templates/invite reset and its unclassified temporary-password/delete successors. Template SQL changes membership constraints and event read policy; later SQL changes event status grammar and deletes orphan metadata. They require combined dependency/data/policy verification before restoration; no blanket replay or exclusion is justified.

### 2026-09-07: auth template and actor FK verification

Code head `6d9e579c8af1c7f4509cb7bbb13750711e3be4fc`: OPS 34121661358, job 101740868281 PASS. Complete auth/template/POA and five-source characterization pass. New forward migration `20260907121951_canonical_membership_actor_fk_reconstruction.sql` passes existing-column, missing-column, invalid-actor rollback and incompatible-constraint rollback cases, with two applies and SET NULL behavior verified. Source/template selection was red before restoration and rejects reversed prerequisite order. Both reconstructed actor FKs were confirmed in the production catalog read-only; no production mutations.

Integrity/readiness PASS: 588 files, 492 groups, 495 ledger-eligible versions. Accounting 29 tests PASS: 507 FULL_FILE_SELECTED, 28 unresolved SUBSTITUTED, 49 UNCLASSIFIED, four exclusions. Whole-effects/replay gate and generated-types migration-tail gate remain red. This is scoped evidence only, not canonical provenance, final live parity, merge approval or phase closure.

Next: continue effectful invitation/account/governance historical classification; only the DDL template is restored, and the actor FK repair does not close the full source effects. Then authoritative full replay, generated types/schema, ledger/live parity and the remaining masterplan gates.
