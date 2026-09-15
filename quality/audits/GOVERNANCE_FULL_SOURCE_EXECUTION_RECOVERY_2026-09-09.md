# Task8 whole-source execution recovery — 2026-09-09

Status: PROPOSED / UNREVIEWED / NOT IMPLEMENTED.
This is a concise recovery summary of the design agent's draft, not the complete
contract. Its filesystem write failed with environment_offline; no agent commit
or local saved contract is asserted. Verify original source hashes/order and
recover the complete acceptance contract before independent scoped review.
Baseline:236637eb2368a7035e61a844d2a4f5963bd2390d. Root owns current status.

## Proposed bounded unit

Disposable PG17 only: exact actual first33 selected migrations → complete I →
complete F → complete D → complete6D2 → retained membership role-key bootstrap →
all three6E sources. Report later-hardening composition separately. No new
unguarded actual-prefix column prerequisite found by source inspection; this is
not SQL execution evidence.

I:20260519_customer_intake_contracts_tenant_hardening.sql
F:20260519_final_saas_hardening.sql
D:20260526_debug_step1_2f_customer_import_foundation.sql
6D2:20260519_batch_6d2_runtime_governance_completion.sql

Reuse GOVERNANCE_SYNC_IMPORT_PREREQUISITE_EFFECTS_2026-09-09.md,
GOVERNANCE_IMPORT_PREREQUISITE_CONTRACT_2026-09-09.md,
TENANT_GOVERNANCE_SOURCE_EFFECTS_2026-09-09.md and
SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md for complete effects/oracles.
Retain early company-contact/company-governance/version/offer-lifecycle extracts
with whole-source provenance. Whole originals do not heal skipped CREATE effects.
Preserve historical SQL/checksums and all identity/pair/index/role-helper repairs.

If isolated execution and scoped selection review approve all four, theoretical
593-input accounting becomes522 full/24 substituted/43 unclassified/4 excluded
(67 unresolved); focused339 becomes279/21/35/4 (56 unresolved). These are proposed
counts, NOT current results. Actual counts remain518/26/45/4 and275/23/37/4.
Task7 must still execute exactly original first33; replace future stage-specific
absence assertions with exact full-order assertions and separately pinned prefix.
Update all affected governance/operations/RBAC/runner positions and provenance
together. Do not weaken exact order/count or blocker assertions.

## Source-specific acceptance

- F reaches19/22 company-column targets on actual prefix: access_logs,
  power_of_attorneys and meter_readings are absent optional historical targets.
  Report explicit skips, never22/22 coverage.6D2 reaches29 policy/28 trigger
  targets after I/F/D. Existing membership_role comes from early auth source.
- F token index/default uses prerequisite33; preserve nullable legacy tokens and
  separate invitation_token/accept_token_hash. No invented credential backfill.
- Preserve all ten ownership join prerequisites; distinguish I powers_of_attorney
  and F billing_underlays. Require zero ownership mutation in preservation lane.
- F seeds company_admin and tenants.read/write/invite metadata and up to six
  pairs while preserving IDs/unrelated grants. Missing seed dependencies is
  reduced coverage, not acceptance.
- D aligns19 batch/19 row columns while retaining I required fields/nonnegative
  counters and array issues default; no invented equality between counter triples.
  Verify checks, seven indexes, debug view, exact surviving policies and guarded
  NOT VALID FKs. Validate synthetic references separately as disposable postflight.
- Retained seven-column versions lack stronger skipped CREATE contracts.
  possible_existing_customer_id has no FK. These remain explicit final gates.
-6D2 lifecycle updates can fire timestamp/audit triggers even on repeated values.
  Exercise six-column session journal, completion columns, RPCs and11-column
  overview. Invoke RPCs: their exception handling can mask missing prerequisites.
  Trigger existence does not prove ownership enforcement; session helper does
  not establish journal/JWT invalidation; surviving permissive policies matter.

## Required synthetic lanes

Execute checksum-pinned full originals against actual prefix; two-tenant
preservation/repeat with IDs, values and promised OIDs; complete object/default/
check/FK/index/function/view/policy/trigger deltas; output/consumer status/confidence/
RPC assertions; separately labelled six reduced I/F/D compatibility shapes.
Retain58 exact dirty categories/four final-gate variants and add6D2-specific
shape/lifecycle/signature/view/index/admission cases. Include D global conname
collisions and wrong same-name objects; admission must reject before mutation.
Use actual autocommit native early/late failures, committed-state receipts,
clean-reset replay, finite55P03 contention and writer-between-admission/invocation.
No arbitrary production URL or real Ediel/export/storage/delivery side effects.

Resume role-key/all6E and later complete selected dependency chain, including
launch-linter/performance helpers, platform/session replacements, write/read/
lifecycle policies, invitation runtime and final role-helper repair. Report
actual executed chain; reduced composition is not final security acceptance.
Test actual-role two-tenant/grant/status matrix, all surviving policies, function
body/security/search_path/ACL, RLS/force flags and view invoker options.

## Transaction and application boundary

Runner uses separate psql -X -v ON_ERROR_STOP=1 -f calls without single-transaction.
I/F/D/6D2 have no top-level BEGIN/COMMIT; statements commit individually and each
DO is atomic. Prefix33 explicitly commits and releases its lock. A wrapper around
the whole prefix cannot promise rollback. Verify finite session timeouts.
Native failures can retain earlier FKs/seeds/policies or a dropped D check;
late6D2 view failure retains prior guards. Do not blindly retry unknown state.

Existing-row application is excluded from next implementation. Future application
requires an enforced fence covering reads/writes, workers/direct SQL/DDL/roles;
drain transactions, fresh Task7 plus6D2 admission AFTER drain, per-source
revalidation, exact allowed deltas and retained exclusivity through downstream
postflight. An ignored advisory lock/app flag is insufficient; a separate session
holding conflicting table locks would block the executor. Failure/connection loss
must keep traffic closed pending reviewed recovery and fresh admission.
An atomic alternative AFTER prefix33 needs separate lock/dependency/DDL exclusion,
fresh admission after locks, rollback/contention and postflight proof. It cannot
roll back prefix33. No deployed fence or production executor is implemented.

## Open gates and resume

Retain customer/company/version retention and delete-recovery policy questions,
14 composite SET NULL mandatory-column tensions, missing relations, credential
lineage, durable delivery, real session revocation, effective ACL/RLS and runtime
database binding. No full replay/schema/types/ledger/live parity or phase closure.
Never regenerate canonical artifacts from bounded replay or add blanket exclusions.

Resume in connected environment: fetch latest PR branch, preserve/reconcile local
edits and ignored reports; reconstruct complete design using approved matrices
and this recovery; verify source hashes/order and exact fixture transitions;
independently review before implementation. Root's hosted Task7 receipt is scoped
proof; this design adds no executed SQL evidence.
