# Current state — database reconstruction, 2026-09-14

Status: PARTIAL

Native foundation1–52 and its actual CLI ledger: VERIFIED on603e68a5.
The old42501/P5244 mismatch from run34868620937 is SUPERSEDED.
Active work: integrate foundation53–56 as the next native atomic unit.
Full replay, generated types, release and plan85/86 are NOT accepted.

## Current verified evidence

Runtime603e68a52f223a7fcfb65fc8ec33a3ed529ff4da; source tree
872908e717f961bde8a6f78952b8114b67e2f455.
Ordinary OPS34873361878 / clean job104074455772 / artifact10359689961.
The actual report is NATIVE_HISTORICAL_THROUGH52_VERIFIED:43 prefix inputs
plus all9 inputs44–52 in one additional CLI migration unit. Actual ledger
statements, earlier entries, no-op repeat and owned/private cleanup pass.
Zero timestamp inputs execute. No original applied version is fabricated.

The initial42501 is now reproduced only as an expected negative control.
The exact original lock denial is bound to auth.schema_migrations. Native
postgres also lacks SHARE privileges on storage.migrations,
storage.buckets_vectors and storage.vector_indexes. Only these four exact
provider-owned, read-only identities use ACCESS SHARE in the isolated db-only
fixture. Domain exclusive locks and migration roles remain unchanged. This is
not equivalent protection from concurrent provider DML in a production system.

The later source-comment false positive is corrected in603e68a5. Actual
references, quoted SQL and dynamic SQL remain checked; only comments are
ignored. All source hashes and source ordering are still required.
The five native failures42501/P5244/57014/P5252/P5253 each preserve the prior
ledger and restore scoped catalog/rows. The last verifies locks, temp context
and local deadlines at the CLI's own ledger INSERT. Helpers are disposed.

## Fresh scoped verification and publication boundary

Revalidated the original native ZIP against GitHub's published SHA256, then
matched52 source hashes,43 prefix program hashes and4 support hashes to the
exact runtime tree. Fresh local tests:22 envelope,31 prefix/integration and9
lock tests PASS (62 total);601 immutable files/505 version groups PASS.
Local tests simulate native calls; native evidence is the existing CI run above,
not a new locally executed database. This change publishes documentation only.
No runtime, SQL source, workflow, RLS/grant, type or reference baseline changes.

## Exact remaining action

Implement foundation53–56 using scripts/canonical-user-rbac-repair-batch.py,
then remaining foundation57–144 and514 timestamp stages with truthful CLI
ledger and atomic failure controls. Do not rebuild44–52 or retry the old run
as a repair. The ordinary job intentionally ends AFTER52 with
NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED. This is not42501.
Full schema semantics, the auth-email failure, generated types and every
mandatory OPS/E2E gate still require resolution before merge.

Evidence: quality/audits/DB_NATIVE52_VERIFIED_2026-09-14.md.
Main remained eb9a25bc at read-back. No hosted Supabase calls/mutations/reset,
ledger repair, main merge or deployment in this verification/publication.
Preserve all601 original migrations, real company fields/white-label FK,
existing app/API work and quality/paused/2026-09-12-partner-price-wip.patch.
The older279-row hosted ledger observation is historical, not fresh evidence.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
