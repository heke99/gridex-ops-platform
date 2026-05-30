-- Gridex DB2 v4 / 02 of 03
-- Execute controlled reconciliation.
-- This run is intentionally conservative:
--   - it does not create missing companies such as "Test bolaget" unless already present in data
--   - it writes memberships only from explicit company_id sources
--   - it does not create customers from customer_profiles without customer/facility/contract signal

select public.gridex_db2_v4_assert_ready();

update public.gridex_schema_repair_runs
set status = 'running',
    summary = jsonb_build_object(
      'phase', 'db2',
      'revision', 'v4_safe_full_view',
      'safe', true,
      'delete_operations', false,
      'aggressive_merge', false,
      'blind_profile_to_customer_backfill', false,
      'auto_create_missing_company', false,
      'mode', 'execute_controlled_reconciliation'
    )
where repair_key = 'db2_controlled_backfill_20260523_v4';

select public.gridex_db2_v4_run_membership_reconciliation(true) as db2_v4_membership_execute;
select public.gridex_db2_v4_run_customer_profile_backfill(true) as db2_v4_customer_profile_execute;

select * from public.gridex_db2_v4_company_reconciliation_v order by check_key;
select * from public.gridex_db2_v4_source_inventory_v order by table_name;
select * from public.gridex_db2_v4_membership_candidates_v order by should_insert desc, source_table, source_id;
select * from public.gridex_db2_v4_profile_review_v order by email nulls last, source_id;
select * from public.gridex_db2_v4_current_backfill_items_v order by created_at desc;
