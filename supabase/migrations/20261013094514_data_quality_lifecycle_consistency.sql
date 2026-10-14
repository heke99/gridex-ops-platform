-- Central, tenant-scoped operational data-quality lifecycle. Legacy/manual rows
-- remain untouched; managed findings and alerts have one open identity and retain
-- every resolved cycle. Root's explicitly authorized reset is a separate action.
alter table public.data_quality_issues
  add column if not exists source text,
  add column if not exists period_month date,
  add column if not exists resolution_reason text;
alter table public.dashboard_alerts
  add column if not exists source text,
  add column if not exists resolution_reason text;

-- Fixed text/UUID and extracted numeric date fields have deterministic JSON
-- serialization. The wrapper avoids delimiter ambiguity in generated keys.
create or replace function public.gridex_quality_open_key_v1(
  p_company uuid,p_source text,p_entity_type text,p_entity_id uuid,p_kind text,p_period date default null
) returns text language sql immutable set search_path=public,pg_temp as $$
  select case when p_source is null then null else md5(jsonb_build_array(
    p_company::text,p_source,p_entity_type,p_entity_id::text,p_kind,
    extract(year from p_period)::integer,extract(month from p_period)::integer
  )::text) end
$$;

alter table public.data_quality_issues drop constraint if exists data_quality_issues_company_id_entity_type_entity_id_issue__key;
alter table public.dashboard_alerts drop constraint if exists dashboard_alerts_company_id_alert_type_entity_type_entity_i_key;
alter table public.data_quality_issues add column if not exists open_key text generated always as
  (case when status='open' then public.gridex_quality_open_key_v1(company_id,source,entity_type,entity_id,issue_type,period_month) end) stored;
alter table public.dashboard_alerts add column if not exists open_key text generated always as
  (case when status='open' then public.gridex_quality_open_key_v1(company_id,source,entity_type,entity_id,alert_type,null) end) stored;
create unique index if not exists data_quality_issues_open_key_uidx on public.data_quality_issues(open_key);
create unique index if not exists dashboard_alerts_open_key_uidx on public.dashboard_alerts(open_key);

create or replace function public.gridex_data_quality_active_status_v1(p_status text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_status,''))=any(array['active','live','ongoing'])
$$;

-- Authoritative registry for ownership, source validity, periods and aggregation.
create or replace view public.gridex_data_quality_rule_catalog_v with(security_invoker=true) as
select * from (values
 ('missing_bidding_zone','metering_point',true,false,true,'warning','Mätpunkt saknar SE-område.','missing_bidding_zone','mätpunkter saknar SE-område','Komplettera SE-område eller lägg till en säker nätområdesmappning.'),
 ('missing_grid_owner','metering_point',true,false,true,'warning','Mätpunkt saknar nätägare.','missing_grid_owner','mätpunkter saknar nätägare','Komplettera nätägare innan prognos och mätvärdesuppföljning används.'),
 ('missing_start_date','metering_point',true,false,true,'warning','Mätpunkt saknar startdatum.',null,null,null),
 ('missing_estimated_annual_consumption','metering_point',true,false,true,'warning','Mätpunkt saknar både uppskattad årsförbrukning och historiska mätvärden.',null,null,null),
 ('active_metering_point_without_active_customer','metering_point',true,false,true,'warning','Mätpunkt är aktiv men kunden är inte aktiv.',null,null,null),
 ('missing_metering_values','metering_point',true,true,true,'critical','Mätvärden saknas för perioden.','missing_metering_values','mätpunkter saknar mätvärden','Följ upp saknade mätvärden för vald period.'),
 ('invalid_metering_value','metering_value',false,false,true,'critical','Mätvärde är negativt och behöver kontrolleras.',null,null,null),
 ('missing_customer_contract','customer',true,false,true,'warning','Aktiv kund saknar aktiv mätpunkt.',null,null,null),
 ('incomplete_customer_onboarding','customer',true,false,true,'warning','Kunddata är ofullständig för aktiv kund.','incomplete_customer_onboarding','kunder har ofullständig kunddata','Komplettera kunddata innan statistik, prognos och drift används fullt ut.'),
 ('failed_ediel_message','ediel_message',false,false,true,'critical','Ediel-meddelande misslyckades.','failed_ediel_message','Ediel-meddelanden har misslyckats','Följ upp misslyckade PRODAT, UTILTS, CONTRL eller APERAK-meddelanden.'),
 ('slow_grid_owner_response','grid_owner_data_request',false,false,true,'warning','Nätägarsvar har inte kommit inom 72 timmar.','slow_grid_owner_response','nätägarsvar är försenade','Följ upp uppgifts- eller mätvärdesbegäran som väntar på svar.'),
 ('forecast_deviation','metering_point',true,true,true,'warning','Prognosen avviker mot faktiskt utfall.','forecast_deviation','prognoser avviker mot faktiskt utfall','Granska prognosavvikelser per mätpunkt och kund.'),
 ('forecast_basis_missing','metering_point',true,true,false,'warning','Prognosunderlag saknas för mätpunkten.',null,null,null)
) as r(issue_type,entity_type,requires_active,period_dependent,scanner,severity,message,alert_type,alert_title,alert_message);

create or replace function public.gridex_data_quality_source_exists_v1(
 p_company uuid,p_entity_type text,p_entity_id uuid,p_requires_active boolean default false
) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select case p_entity_type
  when 'metering_point' then exists(select 1 from public.metering_points p where p.company_id=p_company and p.id=p_entity_id and (not p_requires_active or public.gridex_data_quality_active_status_v1(p.status)))
  when 'customer' then exists(select 1 from public.customers p where p.company_id=p_company and p.id=p_entity_id and (not p_requires_active or public.gridex_data_quality_active_status_v1(p.status)))
  when 'metering_value' then exists(select 1 from public.metering_values p where p.company_id=p_company and p.id=p_entity_id)
  when 'ediel_message' then exists(select 1 from public.ediel_messages p where p.company_id=p_company and p.id=p_entity_id)
  when 'grid_owner_data_request' then exists(select 1 from public.grid_owner_data_requests p where p.company_id=p_company and p.id=p_entity_id)
  else null end
$$;

-- Shared selected-period fact used by scans and company/grid-owner rollups.
-- The invoker's source-table RLS remains in force for direct reads.
create or replace function public.gridex_missing_metering_points_v1(p_company uuid,p_month date)
returns table(metering_point_id uuid,grid_owner_id uuid)
language sql stable security invoker set search_path=public,pg_temp as $$
 with bounds as(select date_trunc('month',p_month)::date as month_start)
 select p.id,p.grid_owner_id from public.metering_points p cross join bounds b
 where p.company_id=p_company and b.month_start is not null
  and public.gridex_data_quality_active_status_v1(p.status)
  and not exists(select 1 from public.metering_values v
   where v.company_id=p_company and v.metering_point_id=p.id
    and v.period_start>=(b.month_start::timestamp at time zone 'UTC')
    and v.period_start<((b.month_start+interval '1 month')::timestamp at time zone 'UTC'))
$$;

-- Historical and unfinished runs cannot keep a repaired monthly deviation open.
-- Company equality on both sides also rejects wrongly attributed legacy items.
create or replace function public.gridex_current_point_forecasts_v1(p_company uuid,p_month date)
returns table(metering_point_id uuid,forecast_run_id uuid,diff_percent numeric)
language sql stable security invoker set search_path=public,pg_temp as $$
 select distinct on(i.metering_point_id) i.metering_point_id,i.forecast_run_id,i.diff_percent
 from public.forecast_run_items i join public.forecast_runs r
  on r.id=i.forecast_run_id and r.company_id=i.company_id
 where i.company_id=p_company and r.status='completed' and r.forecast_type='consumption'
  and i.period_start>=date_trunc('month',p_month)::date
  and i.period_start<(date_trunc('month',p_month)+interval '1 month')::date
 order by i.metering_point_id,coalesce(r.completed_at,r.created_at) desc nulls last,
  r.created_at desc nulls last,r.id desc,i.created_at desc nulls last,i.id desc
$$;

-- Read model validates the physical target, company, active status and period.
-- Unknown kinds remain visible when their recognized source exists; unknown
-- entity classes are left alone. No history is deleted by this view.
create or replace view public.gridex_actionable_data_quality_issues_v with(security_invoker=true) as
select q.* from public.data_quality_issues q
left join public.gridex_data_quality_rule_catalog_v r on r.issue_type=q.issue_type and r.entity_type=q.entity_type
where q.status='open'
 and coalesce(public.gridex_data_quality_source_exists_v1(q.company_id,q.entity_type,q.entity_id,coalesce(r.requires_active,false)),true)
 and (q.period_month is null or q.period_month=date_trunc('month',current_date)::date);

create or replace function public.gridex_quality_lock_company_v1(p_company uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'data_quality_service_role_required' using errcode='42501';end if;
 if p_company is null or not exists(select 1 from public.companies where id=p_company) then raise exception 'data_quality_company_required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('data_quality:'||p_company::text,0));
end$$;

create or replace function public.gridex_upsert_data_quality_issue_v1(
 p_company uuid,p_entity uuid,p_issue_type text,p_severity text,p_message text,p_period date default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;v_id uuid;v_period date;
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 select * into r from public.gridex_data_quality_rule_catalog_v where issue_type=p_issue_type;
 if not found then raise exception 'data_quality_rule_unknown' using errcode='22023';end if;
 -- Historical forecasts may evaluate an inactive but retained source. Ownership
 -- validation requires physical existence; the registry controls actionability.
 if p_entity is null or not public.gridex_data_quality_source_exists_v1(p_company,r.entity_type,p_entity,false) then
  raise exception 'data_quality_source_not_found_for_company' using errcode='23503';end if;
 if p_severity is null or p_severity not in ('warning','critical') or p_message is null then raise exception 'data_quality_payload_invalid' using errcode='22023';end if;
 v_period:=case when r.period_dependent then date_trunc('month',coalesce(p_period,current_date))::date end;
 insert into public.data_quality_issues(company_id,entity_type,entity_id,issue_type,severity,message,status,source,period_month,detected_at,updated_at)
 values(p_company,r.entity_type,p_entity,p_issue_type,p_severity,p_message,'open','gridex_data_quality',v_period,now(),now())
 on conflict(open_key) do update set severity=excluded.severity,message=excluded.message,detected_at=excluded.detected_at,updated_at=excluded.updated_at
 returning id into v_id;
 perform public.gridex_reconcile_dashboard_alerts_internal_v1(p_company);
 return v_id;
end$$;

create or replace function public.gridex_upsert_dashboard_alert_v1(
 p_company uuid,p_alert_type text,p_severity text,p_title text,p_message text,
 p_entity_type text default null,p_entity uuid default null,p_source text default 'manual'
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 if p_source is null or p_source='' or p_alert_type is null or p_title is null or p_severity is null or p_severity not in('info','warning','critical') then raise exception 'dashboard_alert_payload_invalid' using errcode='22023';end if;
 insert into public.dashboard_alerts(company_id,alert_type,severity,title,message,entity_type,entity_id,status,source,updated_at)
 values(p_company,p_alert_type,p_severity,p_title,p_message,p_entity_type,p_entity,'open',p_source,now())
 on conflict(open_key) do update set severity=excluded.severity,title=excluded.title,message=excluded.message,updated_at=excluded.updated_at
 returning id into v_id;
 return v_id;
end$$;

-- Private producer primitive: callable only by the trusted wrappers/trigger.
-- No caller-selected ownership or auth bypass is exposed by a write RPC.
create or replace function public.gridex_reconcile_dashboard_alerts_internal_v1(p_company uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('data_quality:'||p_company::text,0));
 update public.dashboard_alerts a set status='resolved',resolved_at=now(),updated_at=now(),resolution_reason='no_current_issues'
 where a.company_id=p_company and a.source='gridex_data_quality' and a.status='open' and a.entity_type is null and a.entity_id is null
 and (a.alert_type='data_quality' or exists(select 1 from public.gridex_data_quality_rule_catalog_v r where r.alert_type=a.alert_type))
 and not exists(select 1 from public.gridex_actionable_data_quality_issues_v q join public.gridex_data_quality_rule_catalog_v r on r.issue_type=q.issue_type and r.entity_type=q.entity_type
  where q.company_id=p_company and q.source='gridex_data_quality' and (a.alert_type='data_quality' or r.alert_type=a.alert_type));
 insert into public.dashboard_alerts(company_id,alert_type,severity,title,message,status,source,updated_at)
 select p_company,c.alert_type,case when bool_or(q.severity='critical') then 'critical' else 'warning' end,
  count(distinct q.entity_id)||' '||c.alert_title,c.alert_message,'open','gridex_data_quality',now()
 from public.gridex_actionable_data_quality_issues_v q join public.gridex_data_quality_rule_catalog_v c on c.issue_type=q.issue_type and c.entity_type=q.entity_type
 where q.company_id=p_company and q.source='gridex_data_quality' and c.alert_type is not null
 group by c.alert_type,c.alert_title,c.alert_message
 on conflict(open_key) do update set severity=excluded.severity,title=excluded.title,message=excluded.message,updated_at=excluded.updated_at;
 insert into public.dashboard_alerts(company_id,alert_type,severity,title,message,status,source,updated_at)
 select p_company,'data_quality','warning',count(*)||' datakvalitetsfrågor kräver uppföljning','Öppna avvikelser för detaljer och åtgärder.','open','gridex_data_quality',now()
 from public.gridex_actionable_data_quality_issues_v q join public.gridex_data_quality_rule_catalog_v c on c.issue_type=q.issue_type and c.entity_type=q.entity_type
 where q.company_id=p_company and q.source='gridex_data_quality' having count(*)>0
 on conflict(open_key) do update set title=excluded.title,message=excluded.message,updated_at=excluded.updated_at;
end$$;

create or replace function public.gridex_reconcile_dashboard_alerts_v1(p_company uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 perform public.gridex_reconcile_dashboard_alerts_internal_v1(p_company);
end$$;

create or replace function public.gridex_reconcile_data_quality_v1(p_company uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 update public.data_quality_issues q set status='resolved',resolved_at=now(),updated_at=now(),resolution_reason='source_missing_or_inactive'
 from public.gridex_data_quality_rule_catalog_v r
 where q.company_id=p_company and q.source='gridex_data_quality' and q.status='open' and r.issue_type=q.issue_type and r.entity_type=q.entity_type
 and not public.gridex_data_quality_source_exists_v1(p_company,q.entity_type,q.entity_id,r.requires_active);
 perform public.gridex_reconcile_dashboard_alerts_v1(p_company);
end$$;

create or replace function public.gridex_scan_data_quality_v1(p_company uuid,p_month date default current_date,p_point uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_scan uuid:=gen_random_uuid();v_month date:=date_trunc('month',p_month)::date;v_next date;v_issues integer;
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 if v_month is null then raise exception 'data_quality_month_required' using errcode='22023';end if;
 v_next:=(v_month+interval '1 month')::date;
 create temporary table if not exists gridex_quality_findings(scan_id uuid,entity_type text,entity_id uuid,issue_type text,period_month date,severity text,message text) on commit drop;
 insert into pg_temp.gridex_quality_findings
 with missing as materialized (
  select m.metering_point_id from public.gridex_missing_metering_points_v1(p_company,v_month) m
 ), points as (
  select p.*,c.status as customer_status,
   exists(select 1 from public.metering_values v where v.company_id=p_company and v.metering_point_id=p.id) as has_history,
   m.metering_point_id is null as has_period_values
  from public.metering_points p left join public.customers c on c.id=p.customer_id and c.company_id=p.company_id
  left join missing m on m.metering_point_id=p.id
  where p.company_id=p_company and public.gridex_data_quality_active_status_v1(p.status) and (p_point is null or p.id=p_point)
 ), detected(entity_type,entity_id,issue_type) as (
  select 'metering_point',p.id,r.kind from points p cross join lateral(values
   ('missing_bidding_zone',p.bidding_zone_code is null),('missing_grid_owner',p.grid_owner_id is null),('missing_start_date',p.start_date is null),
   ('missing_estimated_annual_consumption',coalesce(p.estimated_annual_consumption_kwh,0)=0 and not p.has_history),
   ('active_metering_point_without_active_customer',p.customer_status is not null and not public.gridex_data_quality_active_status_v1(p.customer_status)),
   ('missing_metering_values',not p.has_period_values)) r(kind,failed) where r.failed
  union all select 'metering_value',v.id,'invalid_metering_value' from public.metering_values v where p_point is null and v.company_id=p_company and coalesce(v.value_kwh,v.quantity_kwh)<0
  union all select 'customer',c.id,'missing_customer_contract' from public.customers c where p_point is null and c.company_id=p_company and public.gridex_data_quality_active_status_v1(c.status)
   and not exists(select 1 from public.metering_points p where p.company_id=p_company and p.customer_id=c.id and public.gridex_data_quality_active_status_v1(p.status))
  union all select 'customer',c.id,'incomplete_customer_onboarding' from public.customers c where p_point is null and c.company_id=p_company and public.gridex_data_quality_active_status_v1(c.status)
   and (c.email is null or c.email='' or lower(coalesce(c.onboarding_status,'')) in('draft','incomplete','pending'))
  union all select 'ediel_message',e.id,'failed_ediel_message' from public.ediel_messages e where p_point is null and e.company_id=p_company and e.status in('failed','error','rejected','blocked')
  union all select 'grid_owner_data_request',g.id,'slow_grid_owner_response' from public.grid_owner_data_requests g where p_point is null and g.company_id=p_company and g.status in('pending','queued','sent','waiting_response') and g.created_at<now()-interval '72 hours'
  union select 'metering_point',i.metering_point_id,'forecast_deviation' from public.gridex_current_point_forecasts_v1(p_company,v_month) i join points p on p.id=i.metering_point_id
   where abs(i.diff_percent)>10
 )
 select v_scan,d.entity_type,d.entity_id,d.issue_type,case when r.period_dependent then v_month end,r.severity,r.message
 from detected d join public.gridex_data_quality_rule_catalog_v r on r.issue_type=d.issue_type and r.entity_type=d.entity_type;

 -- Only rules and periods fully evaluated by THIS successful statement are
 -- resolved. A source/query/write error aborts every transition and alert update.
 update public.data_quality_issues q set status='resolved',resolved_at=now(),updated_at=now(),resolution_reason='condition_cleared'
 from public.gridex_data_quality_rule_catalog_v r
 where q.company_id=p_company and q.source='gridex_data_quality' and q.status='open' and r.scanner and r.issue_type=q.issue_type and r.entity_type=q.entity_type
 and (p_point is null or (q.entity_type='metering_point' and q.entity_id=p_point))
 and (not r.period_dependent or q.period_month=v_month)
 -- Missing numerical evidence is not a positive healthy evaluation. Source
 -- deletion/inactivity is handled independently by lifecycle reconciliation.
 and (q.issue_type<>'forecast_deviation' or exists(select 1 from public.gridex_current_point_forecasts_v1(p_company,v_month) i where i.metering_point_id=q.entity_id and i.diff_percent is not null))
 and (q.issue_type<>'invalid_metering_value' or exists(select 1 from public.metering_values v where v.company_id=p_company and v.id=q.entity_id and coalesce(v.value_kwh,v.quantity_kwh) is not null))
 and not exists(select 1 from pg_temp.gridex_quality_findings f where f.scan_id=v_scan and f.entity_type=q.entity_type and f.entity_id=q.entity_id and f.issue_type=q.issue_type and f.period_month is not distinct from q.period_month);
 insert into public.data_quality_issues(company_id,entity_type,entity_id,issue_type,severity,message,status,source,period_month,detected_at,updated_at)
 select p_company,f.entity_type,f.entity_id,f.issue_type,f.severity,f.message,'open','gridex_data_quality',f.period_month,now(),now()
 from pg_temp.gridex_quality_findings f where f.scan_id=v_scan
 on conflict(open_key) do update set severity=excluded.severity,message=excluded.message,detected_at=excluded.detected_at,updated_at=excluded.updated_at;
 select count(*)::integer into v_issues from pg_temp.gridex_quality_findings where scan_id=v_scan;
 delete from pg_temp.gridex_quality_findings where scan_id=v_scan;
 perform public.gridex_reconcile_data_quality_v1(p_company);
 return jsonb_build_object('issues',v_issues);
end$$;

create or replace function public.gridex_resolve_data_quality_issue_v1(p_company uuid,p_issue uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 update public.data_quality_issues set status='resolved',resolved_at=now(),updated_at=now(),resolution_reason='explicit_resolution'
 where company_id=p_company and id=p_issue and status='open';
 perform public.gridex_reconcile_dashboard_alerts_v1(p_company);
end$$;
-- A producer may resolve only its explicitly evaluated managed entity/rule/window.
create or replace function public.gridex_resolve_managed_quality_rule_v1(p_company uuid,p_entity uuid,p_issue_type text,p_period date default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_rule record;v_period date;
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 select * into v_rule from public.gridex_data_quality_rule_catalog_v where issue_type=p_issue_type;
 if not found or p_entity is null or (v_rule.period_dependent and p_period is null) then raise exception 'data_quality_resolution_scope_invalid' using errcode='22023';end if;
 v_period:=case when v_rule.period_dependent then date_trunc('month',p_period)::date end;
 update public.data_quality_issues q set status='resolved',resolved_at=now(),updated_at=now(),resolution_reason='condition_cleared_by_producer'
 where q.company_id=p_company and q.source='gridex_data_quality' and q.status='open' and q.entity_type=v_rule.entity_type and q.entity_id=p_entity and q.issue_type=p_issue_type
 and q.period_month is not distinct from v_period;
 perform public.gridex_reconcile_dashboard_alerts_internal_v1(p_company);
end$$;
create or replace function public.gridex_resolve_dashboard_alert_v1(p_company uuid,p_alert uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.gridex_quality_lock_company_v1(p_company);
 update public.dashboard_alerts set status='resolved',resolved_at=now(),updated_at=now(),resolution_reason='explicit_resolution'
 where company_id=p_company and id=p_alert and status='open';
end$$;

-- One set-based cleanup and aggregate refresh per deleted company batch, rather
-- than one full scan for every deleted source row. Unknown/manual rows survive.
create or replace function public.gridex_resolve_deleted_quality_sources_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company uuid;
begin
 for v_company in select distinct company_id from deleted_quality_sources where company_id is not null order by company_id loop
  perform pg_advisory_xact_lock(hashtextextended('data_quality:'||v_company::text,0));
  update public.data_quality_issues q set status='resolved',resolved_at=now(),updated_at=now(),resolution_reason='source_deleted'
  from deleted_quality_sources d
  where q.company_id=v_company and d.company_id=v_company and q.entity_id=d.id and q.entity_type=tg_argv[0] and q.source='gridex_data_quality' and q.status='open'
   and exists(select 1 from public.gridex_data_quality_rule_catalog_v r where r.issue_type=q.issue_type and r.entity_type=q.entity_type);
  -- Physical source deletion has already been authorized by its table/RPC.
  -- The private primitive also closes aggregates for owner maintenance without JWT.
  perform public.gridex_reconcile_dashboard_alerts_internal_v1(v_company);
 end loop;
 return null;
end$$;

do $$declare t text;etype text;begin
 for t,etype in select * from(values('customers','customer'),('metering_points','metering_point'),('metering_values','metering_value'),('ediel_messages','ediel_message'),('grid_owner_data_requests','grid_owner_data_request')) r(t,e) loop
  execute format('drop trigger if exists gridex_quality_source_deleted on public.%I',t);
  execute format('create trigger gridex_quality_source_deleted after delete on public.%I referencing old table as deleted_quality_sources for each statement execute function public.gridex_resolve_deleted_quality_sources_v1(%L)',t,etype);
 end loop;
end$$;

revoke all on function public.gridex_reconcile_dashboard_alerts_internal_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.gridex_quality_lock_company_v1(uuid) from public,anon,authenticated;
revoke all on function public.gridex_upsert_data_quality_issue_v1(uuid,uuid,text,text,text,date) from public,anon,authenticated;
revoke all on function public.gridex_upsert_dashboard_alert_v1(uuid,text,text,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.gridex_reconcile_dashboard_alerts_v1(uuid) from public,anon,authenticated;
revoke all on function public.gridex_reconcile_data_quality_v1(uuid) from public,anon,authenticated;
revoke all on function public.gridex_scan_data_quality_v1(uuid,date,uuid) from public,anon,authenticated;
revoke all on function public.gridex_resolve_data_quality_issue_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_resolve_managed_quality_rule_v1(uuid,uuid,text,date) from public,anon,authenticated;
revoke all on function public.gridex_resolve_dashboard_alert_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_resolve_deleted_quality_sources_v1() from public,anon,authenticated,service_role;
revoke all on function public.gridex_missing_metering_points_v1(uuid,date) from public,anon;
revoke all on function public.gridex_current_point_forecasts_v1(uuid,date) from public,anon;
grant execute on function public.gridex_missing_metering_points_v1(uuid,date) to authenticated,service_role;
grant execute on function public.gridex_current_point_forecasts_v1(uuid,date) to authenticated,service_role;
grant execute on function public.gridex_quality_lock_company_v1(uuid) to service_role;
grant execute on function public.gridex_upsert_data_quality_issue_v1(uuid,uuid,text,text,text,date) to service_role;
grant execute on function public.gridex_upsert_dashboard_alert_v1(uuid,text,text,text,text,text,uuid,text) to service_role;
grant execute on function public.gridex_reconcile_dashboard_alerts_v1(uuid) to service_role;
grant execute on function public.gridex_reconcile_data_quality_v1(uuid) to service_role;
grant execute on function public.gridex_scan_data_quality_v1(uuid,date,uuid) to service_role;
grant execute on function public.gridex_resolve_data_quality_issue_v1(uuid,uuid) to service_role;
grant execute on function public.gridex_resolve_managed_quality_rule_v1(uuid,uuid,text,date) to service_role;
grant execute on function public.gridex_resolve_dashboard_alert_v1(uuid,uuid) to service_role;
revoke all on public.gridex_data_quality_rule_catalog_v,public.gridex_actionable_data_quality_issues_v from anon;
grant select on public.gridex_data_quality_rule_catalog_v,public.gridex_actionable_data_quality_issues_v to authenticated,service_role;

-- Automated derived-state writes remain behind the scoped service RPCs.
revoke insert,update,delete,truncate,references,trigger on public.data_quality_issues,public.dashboard_alerts from anon,authenticated;
