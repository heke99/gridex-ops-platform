-- Post-migration staging assertions. Any returned row is a blocker.
select 'locked_month_missing_evidence' as blocker,id,source,price_area,billing_month
from public.spot_price_monthly_summaries
where status='locked' and (
  locked_at is null or verified_at is null or period_start is null or period_end is null
  or covered_duration_minutes is distinct from expected_duration_minutes
  or jsonb_typeof(quality_issues)<>'array' or jsonb_array_length(quality_issues)>0
)
union all
select 'verified_quote_without_resolution',id,company_id::text,offer_reference,quote_reference
from public.website_contract_quotes
where resolution_binding_status='verified' and energy_resolution_id is null
union all
select 'active_contract_without_snapshot',id,company_id::text,coalesce(status,''),coalesce(contract_name,'')
from public.customer_contracts
where status in ('signed','active') and contract_price_snapshot_id is null;
