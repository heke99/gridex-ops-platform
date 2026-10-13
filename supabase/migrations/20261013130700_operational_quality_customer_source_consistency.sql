-- Normal admin masterdata edits can activate an Ediel portal-test point. Its
-- customer remains excluded by portfolio/customer-source reads; use the same
-- confirmed source exclusion for operational quality without hiding real points
-- whose customer is missing or inactive. Physical/history validation stays intact.
create or replace function public.gridex_data_quality_source_exists_v1(
 p_company uuid,p_entity_type text,p_entity_id uuid,p_requires_active boolean default false
) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select case p_entity_type
  when 'metering_point' then exists(select 1 from public.metering_points p
   where p.company_id=p_company and p.id=p_entity_id and (not p_requires_active or (
    public.gridex_data_quality_active_status_v1(p.status)
    and not exists(select 1 from public.customers c where c.company_id=p.company_id
     and c.id=p.customer_id and c.source='ediel_portal_test'))))
  when 'customer' then exists(select 1 from public.customers p where p.company_id=p_company and p.id=p_entity_id
   and (not p_requires_active or (public.gridex_data_quality_active_status_v1(p.status)
    and p.source is distinct from 'ediel_portal_test')))
  when 'metering_value' then exists(select 1 from public.metering_values p where p.company_id=p_company and p.id=p_entity_id)
  when 'ediel_message' then exists(select 1 from public.ediel_messages p where p.company_id=p_company and p.id=p_entity_id)
  when 'grid_owner_data_request' then exists(select 1 from public.grid_owner_data_requests p where p.company_id=p_company and p.id=p_entity_id)
  else null end
$$;

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

-- Change only the three source-selection clauses of the installed scanner.
-- Signatures, rule conditions, period scopes, writes, locks, grants and history
-- remain installed. Refuse a changed predecessor instead of guessing its body.
do $$declare d text;b text;original text;old_point text;old_customer text;begin
 select pg_get_functiondef('public.gridex_scan_data_quality_v1(uuid,date,uuid)'::regprocedure) into d;
 b:=substring(d from 'AS \$function\$([\s\S]*)\$function\$');
 if b is null then raise exception 'quality_source_scanner_body_unrecognized';end if;
 original:=b;
 old_point:='where p.company_id=p_company and public.gridex_data_quality_active_status_v1(p.status) and (p_point is null or p.id=p_point)';
 old_customer:='c.company_id=p_company and public.gridex_data_quality_active_status_v1(c.status)';
 if position('gridex_data_quality_source_exists_v1(p_company,''metering_point'',p.id,true)' in b)>0 then
  if (select count(*) from regexp_matches(b,'gridex_data_quality_source_exists_v1\(p_company,''customer'',c.id,true\)','g'))<>2 then
   raise exception 'quality_source_scanner_partial_repair';end if;
 else
  if position(old_point in b)=0 or (length(b)-length(replace(b,old_customer,'')))/length(old_customer)<>2 then
   raise exception 'quality_source_scanner_predecessor_changed';end if;
  b:=replace(b,old_point,'where p.company_id=p_company and public.gridex_data_quality_source_exists_v1(p_company,''metering_point'',p.id,true) and (p_point is null or p.id=p_point)');
  b:=replace(b,old_customer,'c.company_id=p_company and public.gridex_data_quality_source_exists_v1(p_company,''customer'',c.id,true)');
  execute replace(d,original,b);
 end if;
end $$;
