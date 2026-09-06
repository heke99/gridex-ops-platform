# Ediel environment source effects — in progress

Routing continues the active systematic-debugging, test-driven-development,
Supabase and verification-before-completion workflow. No UI, performance,
skill creation or production deployment changes are involved.

The original 20260602143000 source is suppressed by two bootstrap declarations.
Both must preserve the source before it can be selected at its original time.
No selector change is made in this test-first batch.

Direct source review confirms three omitted tables: ediel_test_run_locks,
ediel_agt_readiness and ediel_unlinked_test_messages. The complete 20260602152000
successor conditionally adds columns, company FKs and service-role RLS policies
when those tables exist. Its four deadline seeds are generic reference data.
The earlier route-history trigger also runs during environment backfill.

The new isolated PostgreSQL 17 CI job executes the two complete original files
twice, including pgcrypto, using scoped predecessor DDL statements and synthetic
rows. It tests environment mapping, preserved explicit environments, history
side effects, uniqueness, successor columns/FKs/RLS and non-owner policy reads.
Predecessor files are not replayed in full: this is a dependency fixture, not
canonical provenance or full tenant/JWT/provider verification. Other historical
triggers and the complete replay order still require authoritative replay.

Local verification: SQL composition and git diff --check pass. Real PostgreSQL
execution is pending the new CI job. PGlite without pgcrypto is insufficient.
No production writes, canonical artifacts, types hashes or gates were changed.

## Ediel source restoration — 2026-09-06

PostgreSQL 17 job 101502920151 in OPS run 34039266103 passed on published
revision d6967d21c4f7985c0f2a452ddaf8ae0cef8b3c60. Complete original source and
successor ran twice, including pgcrypto; synthetic backfill/history, uniqueness,
FK/column/RLS and non-owner policy assertions passed. This is isolated source
evidence, not canonical provenance or production parity.

Both bootstrap declarations now preserve source 20260602143000 at its original
timestamp. Selection regression failed SUBSTITUTED before the fix, passed after,
and rejects either declaration reverting independently. Accounting selftest now
passes 29 tests. Inventory integrity/readiness pass (587 files). Accounting now
498 FULL_FILE_SELECTED, 30 unresolved SUBSTITUTED, 4 exclusions, 55 UNCLASSIFIED;
full-effects gate correctly remains exit 1. Original SQL/checksums are unchanged.

Next: inspect CI for the restoration revision, then review the remaining source
substitutions and unclassified SQL. Authoritative canonical replay, schema/types
regeneration and bidirectional ledger/live parity remain open. No phase closed.

## Verified code-head checkpoint — 2026-09-06

Published code head 29dc94974825b329b9b822c2219b077d8679bb33, draft PR #310.
OPS run 34039976860: Ediel PostgreSQL 17 job 101504839380 PASS. Verify job
101504839441 passes all isolated SQL fixtures, including complete customer-flow
and actor-testing sources, then FAILS generated-types tail 20260906081839.
Clean replay job 101504839286 FAILS; complete input accounting remains unresolved.
Quality job 101504839408 is still running and is not certified. PR body records
these exact code-head results. No phase closed, production writes or manual
canonical/type hash changes. Next: inspect quality result and continue remaining
29 partial/54 unclassified sources; full authoritative replay/ledger/live parity
is still required. These are internal remediation items, not permission blockers.
