# Operational repair classification — 2026-09-06

Status: one bounded input disposition verified; full replay and production parity
remain open. No historical repair was executed and no production data was changed.

## Reviewed disposition

`02_db2b_apply_superadmin_and_membership.sql` is an explicit, fixed-identity
administrator/membership repair, not a reusable schema migration. Its entire DO
body selects the specified company, inserts/updates that administrator and company
membership, and records backfill/audit rows. It contains no DDL, generic role seed,
dynamic SQL, customer creation, or application function invocation. Historical
identity values are deliberately not reproduced in this report.

The relevant repository trigger bodies were reviewed directly:

- `gridex_audit_admin_users_change` inserts administrator audit records.
- `gridex_normalize_audit_context_v1` normalizes the incoming audit row only.
- `guard_last_functioning_tenant_admin` reads membership/auth/profile state and
  rejects removal of the final functioning administrator; it creates no schema
  or reference data.

The exact source and the three immutable source files containing those bodies
are pinned independently in both the selector and static provenance validator.
The JSON classification must repeat the same dependency set. Missing dependencies,
changed bytes, changed pins, or another path fail validation. This finite review
is not a general SQL-effects parser, and does not certify arbitrary later trigger
implementations. Schema-bearing dependency files retain their own classifications.

The distinct status `historical_operational_data_repair` means these operational
identity/audit writes are not canonical seed data. It makes no assertion about
whether the historical repair was deployed, and does not authorize re-execution.
The original SQL remains immutable in Git; it must not provision a historical
administrator whenever an empty database is reconstructed.

## Explicitly unresolved

`02_db2_execute_controlled_reconciliation.sql` is NOT excluded. Its DB2/DB1 helper
and customer/profile trigger chains reach additional allocation and event/queue
behavior. Those effects need their own complete disposition. The DB2 schema
definition scripts also remain independently unresolved. No blanket exclusion
is introduced for other repair scripts or similarly named files.

## Verification

- `python3 scripts/gridex-replay-input-accounting-selftest.py`: 28 tests PASS,
  including valid finite disposition, independent unresolved inputs, changed SQL
  despite refreshed JSON, unknown paths, missing/changed dependency pins and bytes.
- `python3 scripts/gridex-aud-003-clean-replay-selftest.py`: 14 tests PASS.
- `node scripts/gridex-aud-003-migration-provenance-regression.cjs`: PASS.
- Actual input accounting remains blocking: 587 files, 497 full-file selections,
  31 unresolved substitutions, 4 explicit exclusions and 55 unclassified inputs.

These checks establish input classification only, not successful execution,
schema survival, ledger provenance or production parity. No phase is closed.
