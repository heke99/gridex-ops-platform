-- The analytics scanner and report month selector use Stockholm's calendar.
create or replace view public.gridex_actionable_data_quality_issues_v
with (security_invoker = true) as
select
  q.id,
  q.company_id,
  q.entity_type,
  q.entity_id,
  q.issue_type,
  q.severity,
  q.message,
  q.status,
  q.detected_at,
  q.resolved_at,
  q.created_at,
  q.updated_at,
  q.source,
  q.period_month,
  q.resolution_reason,
  q.open_key
from public.data_quality_issues q
left join public.gridex_data_quality_rule_catalog_v r
  on r.issue_type = q.issue_type and r.entity_type = q.entity_type
where q.status = 'open'
  and coalesce(
    public.gridex_data_quality_source_exists_v1(
      q.company_id, q.entity_type, q.entity_id, coalesce(r.requires_active, false)
    ),
    true
  )
  and (r.issue_type is null or gridex_quality.operational_customer_source_v1(q.company_id, q.entity_type, q.entity_id))
  and (
    q.period_month is null
    or q.period_month = date_trunc('month', current_timestamp at time zone 'Europe/Stockholm')::date
  );
