# RBAC and tenant source characterization

Status: IN_PROGRESS. This advances the auth group after the reviewed tooling
publication at 1824d69d8b31be97096dd0eecaf7fd719db40970.

## Global Constraints

- No production writes, deployment, merge, migration/source-selection changes,
  or generated schema/types edits in this characterization batch.
- Run SQL only on fixed disposable localhost PostgreSQL 17 databases through
  the existing auth CI service. Use synthetic identities and company data only.
- Execute the complete immutable sources, never edited copies presented as full
  source execution. Derive prerequisite definitions from existing source where
  possible; label reduced fixture schema and absent branches explicitly.
- Preserve existing fixtures and gates. Characterization is not authorization,
  safe replay, surviving-effect proof, canonical parity or phase approval.
- No phase closes without verified code/replay/types/ledger/production parity.

### Task 1: Complete RBAC group fixture

Implement a focused fixture for these complete originals in their reviewed order:
20260520_batch_6e_rbac_tenant_stats_whitelabel.sql,
20260520_batch_6e_fix_rbac_backfill_security.sql,
20260520_batch_6e_hard_platform_roles_only.sql.
Inspect their real table/function prerequisites first. Assert PostgreSQL 17.
Use a separate fixed disposable database so existing group fixtures remain
independent. Add a SQL composition/emit option without database calls for local
review; no target or arbitrary-command options.

Verify exact synthetic before/after attribution for existing memberships/roles,
missing memberships derived from active_company_id, null active_company_id,
disabled/suspended states, multiple companies, and second application. Treat
historical admin or unscoped role backfill as characterization requiring review,
not desired modern authorization. Assert the hard platform-role boundary's
catalog/data effects and preserve unrelated rows/identities.

Provide all eight domain-table prerequisites for company_billing_volume_overview,
and assert its existence, full output shape, per-company counts and invoker
option. Prove the incomplete prerequisite variant silently omits that view,
rather than declaring its successful SQL exit complete. Inventory the 29 dynamic
policy targets and explicitly state fixture coverage versus missing branches.
Test the invalid operating_environment predecessor CHECK and transaction rollback
before successor normalization. Run complete original files twice where valid.
Do not catch unexpected errors as passing characterization.

Integrate the fixture into the fixed group runner and its ordering/failure tests.
Run local composition and focused regressions. Real PG17 execution remains pending
hosted CI; review and publish one combined batch, then inspect exact-head results
and fix concrete failures. No source may be reclassified by this task.

## Placement evidence retained for the next restoration review

The first two selected foundation sources contain CREATE TABLE candidates for
25 of the predecessor's 29 dynamic policy targets. The four without definitions
in those two sources are `attachments`, `files`, `meter_readings`, and
`power_of_attorneys`. This lexical check does not establish executed definitions,
column compatibility, or surviving policies. The reduced fixture covers eight
present domain targets and explicitly inventories the other 21 as absent.

The 2026-09-08 production catalog observation records both historical views with
`security_invoker=true`. A later source candidate,
`20260611190000_launch_linter_hardening_security_definer_rls.sql`, loops over all
public views, sets that option and revokes public/anon access. Its handler catches
all exceptions and emits a notice. Full replay must therefore establish that the
view existed at that point and that the hardening actually succeeded. This
candidate does not prove the live view's provenance or authorize restoration.
