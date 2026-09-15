# Billing completion source effects

Active workflow: systematic debugging, test-driven development, Supabase,
verification before completion. No UI/runtime API or production mutation.

Full source 20260520_batch_3_4_final_completion.sql (1,167 bytes) was UNCLASSIFIED.
Direct review confirms four regular indexes plus guarded metadata/updated_at
additions on billing_export_runs. No DML, grants, business seeds or function/trigger
definitions. Original SQL and checksum pins remain unchanged.

The core billing_export_run_items table has export_run_id. The source requires
billing_export_run_id, added by the onboarding/billing auxiliary bootstrap.
The entire source fails before that prerequisite, as demonstrated inside a
rolled-back isolated transaction. It succeeds after the actual auxiliary DDL.
The complete file is therefore selected in foundation immediately after that
bootstrap, which follows core operations table creation.

The PGlite 0.3.14 fixture uses actual core table definitions, actual request and
permission-site definitions and the auxiliary item reconciliation statements.
Only unrelated parent entities are minimal synthetic fixture tables. It executes
the whole original source twice, compares four complete index definitions
(including column order and DESC), and compares existing rows in all five affected
tables. Existing billing metadata and timestamps are preserved. Selection was
red UNCLASSIFIED before the manifest change and green FULL_FILE_SELECTED after.

Local checks: full-source SQL, bad prerequisite ordering, row preservation,
selection ordering, 29 accounting tests, static provenance and migration integrity
pass. Accounting: 501 full selected, 29 partial, 53 unknown, four exclusions.
Hosted SQL validation is pending publication. Global full-effects still fails;
this is not canonical replay provenance or production parity. No phase closed.

Nearby review: 20260521_final_customer_info_request_status_check.sql uses a broad
ILIKE '%status%' scan to drop check constraints; it cannot be restored blindly.
20260520_user_profiles_auth_action_constraint_hardfix.sql updates existing profile
values and needs trigger/dependency review. Both remain unclassified, not excluded.
