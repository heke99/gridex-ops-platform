# GRIDEX-AUD-003 clean replay progress

This file records only evidence from isolated empty-database replay attempts. It is not a closure claim.

## Confirmed prerequisites discovered by replay

1. `public.companies` and core tenant/RBAC/customer schema are provided by the immutable DB1 trilogy beginning with `01_db1_schema_repair_core_helpers_and_canonical_tables.sql`.
2. `ediel_rules.sql` requires `public.metering_permissions`. Replaying the entire historical source migration after DB1 conflicts with newer billing-export schema, so the narrow derived bootstrap `supabase/bootstrap/20260520_metering_permissions_foundation.sql` contains only the evidenced prerequisite DDL.
3. `20260528_batch_2_ediel_rulebook_system_tests.sql` requires `public.ediel_test_runs`. The source is the immutable `20260521_actor_testing_go_live_module.sql`; the narrow derived bootstrap `supabase/bootstrap/20260521_ediel_test_runs_foundation.sql` avoids unrelated white-label/go-live state.
4. The 20260528 rulebook migration creates `ediel_field_rules` and `ediel_code_rules`; the checksum-pinned 20260529 v4 compatibility migration supplies the list/metadata columns consumed by `ediel_rules.sql`.

All source migrations remain immutable and checksum-pinned. No remote migration-ledger row was edited.
