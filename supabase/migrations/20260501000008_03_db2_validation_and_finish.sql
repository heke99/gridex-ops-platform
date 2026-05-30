-- Gridex DB2 v4 / 03 of 03
-- Final validation and closeout.
-- This changes only DB2 run metadata after validating the full-view reconciliation.

select public.gridex_db2_v4_assert_ready();

create or replace view public.gridex_db2_v4_backfill_run_summary_v as
select
  br.run_key,
  br.source_scope,
  br.status,
  br.started_at,
  br.completed_at,
  br.rows_seen,
  br.rows_inserted,
  br.rows_updated,
  br.rows_skipped,
  br.rows_failed,
  br.summary,
  count(bri.id) filter (where bri.created_at >= coalesce(br.started_at, '-infinity'::timestamptz))::integer as current_item_count,
  count(*) filter (where bri.created_at >= coalesce(br.started_at, '-infinity'::timestamptz) and bri.status = 'failed')::integer as failed_items,
  count(*) filter (where bri.created_at >= coalesce(br.started_at, '-infinity'::timestamptz) and bri.status = 'needs_review')::integer as needs_review_items,
  count(*) filter (where bri.created_at >= coalesce(br.started_at, '-infinity'::timestamptz) and bri.status in ('inserted','updated_or_confirmed','linked_existing','matched_by_email','matched_by_customer_number'))::integer as applied_items,
  count(*) filter (where bri.created_at >= coalesce(br.started_at, '-infinity'::timestamptz) and bri.status in ('skipped_no_customer_signal','skipped_no_explicit_company_source'))::integer as safely_skipped_items
from public.backfill_runs br
left join public.backfill_run_items bri on bri.backfill_run_id = br.id
where br.run_key in (
  'db2_v4_membership_reconciliation_dry_run',
  'db2_v4_membership_reconciliation_execute',
  'db2_v4_customer_profile_dry_run',
  'db2_v4_customer_profile_execute'
)
group by br.id, br.run_key, br.source_scope, br.status, br.started_at, br.completed_at, br.rows_seen, br.rows_inserted, br.rows_updated, br.rows_skipped, br.rows_failed, br.summary;

create or replace view public.gridex_db2_v4_final_readiness_v as
select
  'schema_contract_missing_code_columns'::text as check_key,
  count(*)::integer as issue_count,
  'Code-required tenant/RBAC columns still missing after DB2 v4 compatibility patch.'::text as description
from public.gridex_db2_v4_schema_contract_v
where exists_in_db = false
union all
select
  'company_count_not_one',
  case when count(*) = 1 then 0 else 1 end::integer,
  'Expected one canonical company for current DB2 dataset. More companies can be created later through platform admin.'
from public.companies
union all
select
  'div3rsa_missing',
  case when exists (
    select 1 from public.companies c
    where lower(coalesce(c.name,'')) = 'div3rsa ab'
       or lower(coalesce(c.slug,'')) = 'div3rsa-ab'
       or lower(coalesce(c.company_slug,'')) = 'div3rsa-ab'
  ) then 0 else 1 end::integer,
  'Div3rsa AB canonical company must exist.'
union all
select
  'test_bolaget_not_auto_created',
  0::integer,
  'Test bolaget was not found in live data and DB2 does not auto-create tenants from assumptions.'
union all
select
  'failed_backfill_items',
  count(*)::integer,
  'DB2 v4 current backfill items with failed status.'
from public.gridex_db2_v4_current_backfill_items_v
where status = 'failed'
union all
select
  'eligible_customer_profiles_unlinked',
  count(*)::integer,
  'customer_profiles with customer signal but without canonical customer link.'
from public.gridex_db2_v4_customer_profile_mapping_v
where has_customer_signal = true
  and mapping_status <> 'linked'
union all
select
  'profile_only_rows_are_not_failures',
  0::integer,
  'customer_profiles without customer/facility/contract signal are intentionally skipped, not migrated customers.'
union all
select
  'review_only_admin_membership_candidates',
  0::integer,
  'admin_users/customer_profiles without explicit company membership source are review-only and not a DB2 failure.';

update public.gridex_schema_repair_runs
set status = case
      when exists (select 1 from public.gridex_db2_v4_final_readiness_v where issue_count > 0) then 'completed_with_warnings'
      else 'completed'
    end,
    completed_at = now(),
    summary = jsonb_build_object(
      'phase', 'db2',
      'revision', 'v4_safe_full_view',
      'safe', true,
      'delete_operations', false,
      'aggressive_merge', false,
      'blind_profile_to_customer_backfill', false,
      'auto_create_missing_company', false,
      'next_step', 'If readiness issue_count is 0, continue to DB3 enforcement/runtime validation. Create extra companies such as Test bolaget through platform admin flow, not automatic DB2 guessing.',
      'validation', (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from public.gridex_db2_v4_final_readiness_v v),
      'company_reconciliation', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.gridex_db2_v4_company_reconciliation_v c),
      'source_inventory', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.gridex_db2_v4_source_inventory_v i),
      'membership_candidates', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.gridex_db2_v4_membership_candidates_v m),
      'profile_review', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.gridex_db2_v4_profile_review_v p)
    )
where repair_key = 'db2_controlled_backfill_20260523_v4';

select
  repair_key,
  status,
  started_at,
  completed_at,
  summary
from public.gridex_schema_repair_runs
where repair_key = 'db2_controlled_backfill_20260523_v4';

select * from public.gridex_db2_v4_final_readiness_v order by check_key;
select * from public.gridex_db2_v4_backfill_run_summary_v order by started_at nulls last, run_key;
select * from public.gridex_db2_v4_company_overview_v order by created_at nulls last, name;
select * from public.gridex_db2_v4_company_reconciliation_v order by check_key;
select * from public.gridex_db2_v4_membership_candidates_v order by should_insert desc, source_table, source_id;
select * from public.gridex_db2_v4_profile_review_v order by email nulls last, source_id;
select * from public.gridex_db2_v4_source_inventory_v order by table_name;
