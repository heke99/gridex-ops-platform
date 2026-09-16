# Native final SQL diagnosis — 2026-09-15

Status: **BLOCKED / diagnostics implemented and offline verified**. Actual replay rerun remains required. No migration, schema reference, type manifest, SQL gate or acceptance requirement is changed.

## Actual hosted evidence

[Run 34989328503, job 104450130810](https://github.com/heke99/gridex-ops-platform/actions/runs/34989328503/job/104450130810) reports 144 foundations, 514 timestamp inputs and native ledger verification, with the six admitted forwards. The first four pinned final SQL checks pass with catalog/rows preserved and ledger unchanged. `scripts/sql/tenant-isolation-invariants.sql` fails; `nativeFinalSql.verified`, schema acceptance and generated-type acceptance remain false. Runtime cleanup is recorded by the hosted receipt.

The published receipt lacks the invariant's exact failing rules. Its generic SQL failure cannot establish which invariant failed, or even distinguish an invariant assertion from another SQL error at that gate. Do not infer the actual root cause from the existence of the synthetic probe or other schema findings. Historical stderr is not recoverable from this sanitized receipt.

## Bounded change

`canonical_native_final_sql.py` now retains the current closed SQL diagnostic on the failing final-check receipt. It clears stale diagnostics before each invocation and still rethrows the original failure. The report copy survives later cleanup diagnostics. Earlier successful checks remain recorded; the failed check never receives preservation or acceptance claims.

The timestamp transport calls a bounded parser only on the fifth final SQL stage. Detailed invariant classification additionally requires the exact pinned original SQL SHA256, success expectation, exactly one primary P0001 error, and psql script-error exit 3. The SQL command still uses the owned container, `-X`, `ON_ERROR_STOP=1`, verbose diagnostics, stdin script and a single transaction. No subprocess output is newly persisted.

Only a complete matching pinned assertion message produces `RECOGNIZED`. The projection contains finite rule IDs, finite role/command labels, bounded aggregate counts, and SHA256 hashes of exact PostgreSQL-rendered object tokens. Names/signatures, row data, stdout, context, location and stderr are never exported. Hashes permit source-catalog correlation without printing dynamic identifiers. Unknown, injected, truncated, prefixed or oversized message shapes produce `UNRECOGNIZED`; no partial inventory is reported. Wrong SQL, SQLSTATE, stage, multiple primary errors or exit status do not receive an invariant classification. Every case preserves failure.

Rule IDs distinguish unclassified tables, missing restrictive company guards, disabled RLS, tenant-null rows, unscoped unique indexes, non-invoker views, inert policies, client-executable permission resolvers, anonymous-executable definer functions and inconsistent role scope.

## Skill routing and verification

Continued repository systematic-debugging/full-E2E-verification scope; activated test-driven-development for the diagnostic change and verification-before-completion for results. This is a narrow native harness diagnostic, not an application/database remediation or broad security audit. Browser, migrations, schema/type regeneration and external DB operations are outside this subtask.

- Parser tests first failed because the projection did not exist.
- `python3 -B scripts/test-canonical-native-final-sql.py`: **10 tests PASS**.
- `python3 -B scripts/test-canonical-native-timestamp-proof.py`: **36 tests PASS**.
- Tests cover every rule template, privacy projection, changed source/stage/state/exit, oversized numeric input, unknown/injected/truncated stderr, unrelated preceding stderr, multiple errors, and unchanged rejection behavior.
- A composed transport test exercises real `_execute_sql` rejection and parser through `execute()` into `nativeFinalSql.checks[4].nativeSqlFailure`; four checks remain true and the fifth false. Replacing the target's recent diagnostic afterward does not overwrite recorded evidence.
- `git diff --check`: PASS.

These tests inject subprocess responses and do not prove actual PostgreSQL invariant outcomes. Next action: publish the reviewed harness on the workflow-bound branch and run the complete owned native replay. Read the fifth-check diagnostic, correlate hashed object identities against trusted source/catalog evidence, and fix only an independently verified invariant defect. Preserve all merge gates until their actual final-head evidence is green.
