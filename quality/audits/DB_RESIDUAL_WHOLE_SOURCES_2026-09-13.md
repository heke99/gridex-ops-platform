# Database residual-source remediation — 2026-09-13

Status: **PARTIAL**. Four of the eleven outstanding source dispositions at the
start of this batch have been restored and natively verified. Seven remain.
A green selected-chain diagnostic is not approval of the normal canonical
clean-replay, ledger, schema, generated types, all RLS, or release gates.

## Scope and skill routing

Continued PR310 on `codex/gridex-parity-remediation-20260905`; no application/API
changes, production SQL mutations, main merge or Vercel API operation. Activated
repository understanding, systematic debugging, source-differential review,
test-driven negative controls, Supabase/PostgreSQL schema review and
verification-before-completion. SQL prerequisites, role attributes, RLS,
trigger timing, source retention and restoration were reviewed. UI/design,
React performance and hook installation were not activated: there is no UI,
React or hook change. No separate subagent/independent reviewer or full security
scan is claimed. ggshield is unavailable; automated secret scanning remains open.

## Published and tested work

First code commit `775d58171737ed2bd4bde779db0e18da7182280a` restores three
complete historical sources. Code commit
`85149c49108e24884d82e92df9f70c6302d89c5b`, tree
`0485f1c435f2f374b6209013c2a47035b510063a`, additionally fixes the rulebook
completion order. All historical SQL and historical checksum manifests retain
exact bytes. The input inventory still has 600 files: **588 whole-file selected,
2 substituted, 5 unclassified, 5 explicitly excluded**. Selection alone is not
SQL or surviving-effect evidence.

| Complete original | Current position | Verified boundary |
|---|---:|---|
| `20260528_batch_7a1_inbound_hardening.sql` | foundation142 | 11 checks: source columns, indexes and private Storage bucket/policies; removing the open-job uniqueness index fails the checker. |
| `20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql` | foundation144 | 30 checks: 21 RLS-enabled tables, source columns/defaults, indexes and normalization. Disabling one table's RLS fails the checker. |
| `20260615_multitenant_integrity_and_claim_locks.sql` | timestamp69 | 19 checks including all seven enabled company-attribution guard triggers. Disabling one guard fails the checker. |
| `20260528_batch_2_completion_rulebook_actions_regression.sql` | foundation87, before V4 at88 | 13 checks including all authored field/ack/build seed matrices. Deleting a seed fails. V4 conversion preserves all13 field rules as text arrays; a corrupted converted array fails separately. |

The June15 source previously appeared to execute successfully at an earlier
checkpoint but silently skipped two guards because their tables did not exist.
It now runs after both the pricing and legal-acceptance prerequisites. The May29
source receives only its own authored `negative_aperak_on_error` boolean
prerequisite; no invented business rows or catch-all column stubs are added.
The May28 completion source now runs before V4 changes allowed_values from jsonb
to text[]. Source literals, not just row counts, are checked before and after.

The source-bound Supabase-compatible bootstrap was also re-pinned in the two
independent proof oracles after the prior addition of the real managed
`supabase_privileged_role`; the added role has no login, create-role,
create-database, replication or RLS-bypass capability.

## Native evidence and limits

Run34754897290/job103717510264 passed143 foundation plus513 timestamp stages
and145 constructor/source tests for the first increment. The fourth-source
candidate passed run34755559678/job103719212176: **144 foundation plus513
continuation stages and150 constructor/source tests**. Artifact10318065451 has
SHA256 `8f0193deffda28354feb9a3ead4f3ff00eefa729d3348b8e8770a32cc9119bf9`.
Its exact tree and uploaded file hashes were verified before publishing.
The published code85149c4 repeated the selected-chain PASS in regular
run34755799372/job103719840158. Owned cleanup passed.

The runtime was owned, network-disabled PostgreSQL170005/PostGIS3.5.2, pinned
image ID `sha256:2ed748fc602dd3031c6724db8cb289e1578c2deb552a4f6e291f6f7e5e6e4f69`.
The existing six session-reconstruction proof cases and four earlier restored
timestamp sources remained in the successful chain. The session source is still
explicitly reconstructed, not represented as raw unchanged SQL execution.

On code85149c4, regular OPS run34755799360 passed the application-quality/build
job103719840231 and the dedicated permission/private-Storage proof103719840272.
Tenant-integrity run34755799381 and browser-quality run34755799452 passed.
**Normal clean replay/types job103719840293 and full E2E34755799382 failed.**
Other old standalone proof jobs failed stale count assertions; they are not
silently treated as passed because the aggregate diagnostic succeeded.

## Additional integration defect corrected in this tree

The residual verifier reopened original migration paths after FoundationLoop
had admitted and retained their bytes. That works in a non-moving diagnostic
but fails when the supported clean shell moves originals to private HOLD.
Selection and rulebook seed checks now accept only retained bytes with the same
fixed source hashes and ordinals. Unknown types, modified bytes, changed order,
missing and duplicated source identities still fail. Four new regression cases
forbid reopening originals, mutate retained content, and reject forged inputs.
The full dispatch recorder checks all four native-check callbacks at the exact
source/conversion boundaries using the retained bytes; it does not claim native
SQL results. Residual source tests:19 PASS locally. Named legacy/repair/dedupe,
fixed-target and four continuation constructors passed locally. The fixed
19-command auth-group regression passed locally, including failure stop,
environment stripping, archive hashes and current-state pointers.

Standalone tests and the governance contract now use the reviewed144-input
selection and588/2/5/5 global accounting. The focused346-input group is334/2/5/5.
The protected first77 positions are unchanged, and the revised full suffix hash
is exact. No guard, SQL validation, target ownership or rollback test is waived.
**This follow-up needs its own hosted native recheck; earlier native results are
not automatically attributed to the follow-up tree.**

## Seven unresolved originals — do not classify these as fixed

### `01_db2_full_view_preflight_schema_and_functions.sql`

UNCLASSIFIED. Historical DB2 support views refer to customer_profiles and other legacy relations without a source-backed canonical prerequisite. The file also contains generic DDL; do not silently exclude the whole file or fabricate empty legacy tables. The local checkpoint SQLSTATE was `42P01`; this is not a current-production incident claim.

### `03_db2_validation_and_finish.sql`

UNCLASSIFIED. Depends on the preceding unresolved gridex_db2_v4_assert_ready and DB2 support definitions. Its source and effects must be classified together with DB2, not relabeled as a read-only SELECT. The local checkpoint SQLSTATE was `42883`; this is not a current-production incident claim.

### `20260521_batch_1_2_live_readiness_and_automation_hardening.sql`

UNCLASSIFIED. Conflicting output-column order in ediel_active_actor_settings_v on late replay. Verify a complete early prerequisite sequence and final company-scoped definition; do not drop tenant checks to compile it. The local checkpoint SQLSTATE was `42P16`; this is not a current-production incident claim.

### `20260521_batch_customer_intake_batch2_completion.sql`

UNCLASSIFIED. Authored tenant read policies use roles.role_key while the canonical relation uses roles.key. An isolated atomic rename experiment passed, but has no implemented guarded envelope or full policy/runtime proof; remains unresolved. The local checkpoint SQLSTATE was `42703`; this is not a current-production incident claim.

### `20260522_db1_schema_repair_backfill_foundation.sql`

UNCLASSIFIED. Full DB1 source conflicts with already-redefined late views. It runs on an early source-only prefix; placement and preservation of canonical RESTRICT foreign keys require native proof. Early placement changes protected prefix contracts. The local checkpoint SQLSTATE was `42P16`; this is not a current-production incident claim.

### `20260525_debug_fix_batch_1b_schema_code_alignment.sql`

SUBSTITUTED. A function return shape conflicts with its later definition. The original runs on an early source-only prefix, but correct order, retained effects and all downstream proof boundaries are not implemented. The local checkpoint SQLSTATE was `42P13`; this is not a current-production incident claim.

### `20260601070000_ediel_production_readiness_hardening.sql`

SUBSTITUTED. Early checkpoint lacks send-lock environment; late checkpoint requires a lock_key omitted by the old seed insert. Reconcile the source-defined per-company/environment lock model without weakening the canonical uniqueness/ownership requirements. The local checkpoint SQLSTATE was `42703 / 23502`; this is not a current-production incident claim.

## Remaining acceptance and operational risk

The supported canonical entry point still needs the complete source-effect
admission, native lifecycle/ledger routing and accepted session reconstruction;
only then may schema and generated types be refreshed from its certified target.
Do not create a baseline from this partial source-only database or mark unknown
ledger versions as applied. Manifest/type tail20260911114443 remains unresolved.

Leaving these gaps does not prove today's production service is down. It means
a new environment or source-based rebuild can stop or differ in functions,
columns, policies, triggers, indexes and reference data. Bypassing the gate would
also remove evidence that code and generated types match the rebuilt database.

The two recorded runtime faults, full two-tenant CRUD/RLS/ACL, native billing
transactions, job recovery/fairness/starvation(point86), paused API remainder,
independent review, full E2E and final release remain separate open work.
The npm install log for job103719840438 additionally reports11 vulnerabilities
(6 moderate,4 high,1 critical). This batch has not established affected packages,
production applicability or a safe dependency update; do not claim a clean
security audit. No forced dependency upgrades were made.

A read-only managed-catalog check returned no customer_profiles,
customer_delivery_points, contract_agreements or gridex_db2 definitions. That
limited observation is not deployment provenance or a reason to fabricate these
legacy objects. No production/customer identities or vault values were exported.

Detailed immutable hashes, positions, native run IDs and unresolved-source
classification are in the companion JSON. All release gates remain blocking.
