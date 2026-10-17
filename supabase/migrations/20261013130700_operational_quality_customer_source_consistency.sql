-- Normal admin masterdata edits can activate an Ediel portal-test point. Its
-- customer remains excluded by portfolio/customer-source reads; use the same
-- confirmed source exclusion for operational quality without hiding real points
-- whose customer is missing or inactive. Physical/history validation stays intact.
create schema if not exists gridex_quality;
revoke all on schema gridex_quality from public,anon;
grant usage on schema gridex_quality to authenticated,service_role;
create or replace function gridex_quality.operational_customer_source_v1(
 p_company uuid,p_entity_type text,p_entity_id uuid
) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select not exists(
  select 1 from public.customers c where p_entity_type='customer'
   and c.company_id=p_company and c.id=p_entity_id and c.source='ediel_portal_test'
  union all
  select 1 from public.metering_points p join public.customers c
   on c.id=p.customer_id and c.company_id=p.company_id
   where p_entity_type='metering_point' and p.company_id=p_company and p.id=p_entity_id and c.source='ediel_portal_test'
  union all
  select 1 from public.metering_values v join public.metering_points p
   on p.id=v.metering_point_id and p.company_id=v.company_id
   join public.customers c on c.id=p.customer_id and c.company_id=p.company_id
   where p_entity_type='metering_value' and v.company_id=p_company and v.id=p_entity_id and c.source='ediel_portal_test'
 )
$$;
revoke all on function gridex_quality.operational_customer_source_v1(uuid,text,uuid) from public,anon;
grant execute on function gridex_quality.operational_customer_source_v1(uuid,text,uuid) to authenticated,service_role;

create or replace function public.gridex_data_quality_source_exists_v1(
 p_company uuid,p_entity_type text,p_entity_id uuid,p_requires_active boolean default false
) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select case p_entity_type
  when 'metering_point' then exists(select 1 from public.metering_points p
   where p.company_id=p_company and p.id=p_entity_id and (not p_requires_active or (
    public.gridex_data_quality_active_status_v1(p.status)
    and gridex_quality.operational_customer_source_v1(p_company,p_entity_type,p_entity_id))))
  when 'customer' then exists(select 1 from public.customers p where p.company_id=p_company and p.id=p_entity_id
   and (not p_requires_active or (public.gridex_data_quality_active_status_v1(p.status)
    and gridex_quality.operational_customer_source_v1(p_company,p_entity_type,p_entity_id))))
  when 'metering_value' then exists(select 1 from public.metering_values p where p.company_id=p_company and p.id=p_entity_id)
  when 'ediel_message' then exists(select 1 from public.ediel_messages p where p.company_id=p_company and p.id=p_entity_id)
  when 'grid_owner_data_request' then exists(select 1 from public.grid_owner_data_requests p where p.company_id=p_company and p.id=p_entity_id)
  else null end
$$;

-- Known operational rules use the same source exclusion even when their physical
-- evidence remains valid for an inactive point (negative-value diagnostics).
-- Unknown/manual rule kinds retain the existing physical-source read policy.
create or replace view public.gridex_actionable_data_quality_issues_v with(security_invoker=true) as
select q.* from public.data_quality_issues q
left join public.gridex_data_quality_rule_catalog_v r on r.issue_type=q.issue_type and r.entity_type=q.entity_type
where q.status='open'
 and coalesce(public.gridex_data_quality_source_exists_v1(q.company_id,q.entity_type,q.entity_id,coalesce(r.requires_active,false)),true)
 and (r.issue_type is null or gridex_quality.operational_customer_source_v1(q.company_id,q.entity_type,q.entity_id))
 and (q.period_month is null or q.period_month=date_trunc('month',current_date)::date);

create or replace function public.gridex_missing_metering_points_v1(p_company uuid,p_month date)
returns table(metering_point_id uuid,grid_owner_id uuid)
language sql stable security invoker set search_path=public,pg_temp as $$
 with bounds as(select date_trunc('month',p_month)::date as month_start)
 select p.id,p.grid_owner_id from public.metering_points p cross join bounds b
 where p.company_id=p_company and b.month_start is not null
  and public.gridex_data_quality_source_exists_v1(p_company,'metering_point',p.id,true)
  and not exists(select 1 from public.metering_values v
   where v.company_id=p_company and v.metering_point_id=p.id
    and v.period_start>=(b.month_start::timestamp at time zone 'UTC')
    and v.period_start<((b.month_start+interval '1 month')::timestamp at time zone 'UTC'))
$$;

-- Change only the four source-selection clauses of the installed scanner.
-- Signatures, rule conditions, period scopes, writes, locks, grants and history
-- remain installed. Refuse a changed predecessor instead of guessing its body.
do $$declare d text;b text;original text;old_point text;old_customer text;old_value text;new_value text;begin
 select pg_get_functiondef('public.gridex_scan_data_quality_v1(uuid,date,uuid)'::regprocedure) into d;
 b:=substring(d from 'AS \$function\$([\s\S]*)\$function\$');
 if b is null then raise exception 'quality_source_scanner_body_unrecognized';end if;
 original:=b;
 old_point:='where p.company_id=p_company and public.gridex_data_quality_active_status_v1(p.status) and (p_point is null or p.id=p_point)';
 old_customer:='c.company_id=p_company and public.gridex_data_quality_active_status_v1(c.status)';
 old_value:='v.company_id=p_company and coalesce(v.value_kwh,v.quantity_kwh)<0';
 new_value:='v.company_id=p_company and gridex_quality.operational_customer_source_v1(p_company,''metering_value'',v.id) and coalesce(v.value_kwh,v.quantity_kwh)<0';
 if position('gridex_data_quality_source_exists_v1(p_company,''metering_point'',p.id,true)' in b)>0 then
  if (select count(*) from regexp_matches(b,'gridex_data_quality_source_exists_v1\(p_company,''customer'',c.id,true\)','g'))<>2 then
   raise exception 'quality_source_scanner_partial_repair';end if;
 else
  if position(old_point in b)=0 or (length(b)-length(replace(b,old_customer,'')))/length(old_customer)<>2 then
   raise exception 'quality_source_scanner_predecessor_changed';end if;
  b:=replace(b,old_point,'where p.company_id=p_company and public.gridex_data_quality_source_exists_v1(p_company,''metering_point'',p.id,true) and (p_point is null or p.id=p_point)');
  b:=replace(b,old_customer,'c.company_id=p_company and public.gridex_data_quality_source_exists_v1(p_company,''customer'',c.id,true)');
 end if;
 if position(new_value in b)=0 then
  if (length(b)-length(replace(b,old_value,'')))/length(old_value)<>1 then
   raise exception 'quality_source_value_scanner_predecessor_changed';end if;
  b:=replace(b,old_value,new_value);
 elsif (length(b)-length(replace(b,new_value,'')))/length(new_value)<>1 then
  raise exception 'quality_source_value_scanner_partial_repair';
 end if;
 if b is distinct from original then execute replace(d,original,b);end if;
end $$;
