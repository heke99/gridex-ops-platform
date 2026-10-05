create or replace view public.tenant_integrity_latest_findings_v
with (security_invoker=true)
as
select f.*,r.category,r.enforcement_mode,r.description,r.remediation_hint,ar.scope,ar.started_at as audit_started_at,ar.finished_at as audit_finished_at
from public.tenant_integrity_findings f
join public.tenant_integrity_audit_runs ar on ar.id=f.run_id
join public.tenant_integrity_rule_registry r on r.rule_key=f.rule_key
where ar.status='completed'
  and ar.id = (
    select ar2.id
    from public.tenant_integrity_audit_runs ar2
    where ar2.status='completed'
      and ar2.scope=ar.scope
      and (
        (f.company_id is null and ar2.company_id is null)
        or (f.company_id is not null and (ar2.company_id=f.company_id or ar2.company_id is null))
      )
    order by ar2.started_at desc, (ar2.company_id is not null) desc, ar2.id desc
    limit 1
  );

create or replace view public.tenant_integrity_company_summary_v
with (security_invoker=true)
as
select c.id as company_id,c.name as company_name,c.status as company_status,
       chosen.id as latest_run_id,chosen.started_at as audited_at,
       coalesce(counts.finding_count,0)::integer as finding_count,
       coalesce(counts.critical_count,0)::integer as critical_count,
       coalesce(counts.high_count,0)::integer as high_count,
       coalesce(counts.medium_count,0)::integer as medium_count,
       coalesce(counts.low_count,0)::integer as low_count,
       coalesce(counts.info_count,0)::integer as info_count,
       case when chosen.id is null then 'not_audited'
            when chosen.status<>'completed' then chosen.status
            when coalesce(counts.critical_count,0)>0 then 'critical'
            when coalesce(counts.high_count,0)>0 then 'attention'
            when coalesce(counts.finding_count,0)>0 then 'warning'
            else 'healthy' end as integrity_status
from public.companies c
left join lateral (
  select ar.*
  from public.tenant_integrity_audit_runs ar
  where ar.scope='all'
    and ar.status='completed'
    and (ar.company_id=c.id or ar.company_id is null)
  order by ar.started_at desc, (ar.company_id is not null) desc, ar.id desc
  limit 1
) chosen on true
left join lateral (
  select count(*)::bigint as finding_count,
         count(*) filter(where f.severity='critical')::bigint as critical_count,
         count(*) filter(where f.severity='high')::bigint as high_count,
         count(*) filter(where f.severity='medium')::bigint as medium_count,
         count(*) filter(where f.severity='low')::bigint as low_count,
         count(*) filter(where f.severity='info')::bigint as info_count
  from public.tenant_integrity_findings f
  where f.run_id=chosen.id and f.company_id=c.id
) counts on true
where c.status<>'deleted_test_only';

revoke all on public.tenant_integrity_latest_findings_v from public, anon, authenticated;
revoke all on public.tenant_integrity_company_summary_v from public, anon, authenticated;
grant select on public.tenant_integrity_latest_findings_v to service_role;
grant select on public.tenant_integrity_company_summary_v to service_role;
