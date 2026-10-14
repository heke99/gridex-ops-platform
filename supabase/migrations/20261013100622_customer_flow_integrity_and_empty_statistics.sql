-- The four aliases with one verified domain now enforce tenant ownership and
-- clear only the removed object ID. Polymorphic case/info aliases remain typed
-- and verified by the shared application reader rather than a false single FK.
do $$
declare r record;
begin
 for r in select * from (values
  ('created_customer_id','customers','external_intake_created_customer_fk'),
  ('created_site_id','customer_sites','external_intake_created_site_fk'),
  ('created_metering_point_id','metering_points','external_intake_created_meter_fk'),
  ('created_contract_id','customer_contracts','external_intake_created_contract_fk')
 ) as refs(column_name,target_table,constraint_name)
 loop
  if not exists(select 1 from pg_constraint where conrelid='public.external_contract_intakes'::regclass and conname=r.constraint_name) then
   execute format('alter table public.external_contract_intakes add constraint %I foreign key(company_id,%I) references public.%I(company_id,id) on delete set null(%I)',r.constraint_name,r.column_name,r.target_table,r.column_name);
  end if;
 end loop;
end $$;

create or replace function public.gridex_company_has_customer_data(p_company_id uuid)
returns boolean language sql stable security invoker set search_path=public,pg_temp
as $$
 select exists(select 1 from public.customers c where c.company_id=p_company_id
   and coalesce(c.source,'')<>'ediel_portal_test'
   and coalesce(c.status,'') not in ('deleted','deleted_test_only','pending_deletion'))
$$;
revoke all on function public.gridex_company_has_customer_data(uuid) from public,anon;
grant execute on function public.gridex_company_has_customer_data(uuid) to authenticated,service_role;

-- Reuse the existing mature builders, preserving signatures, transaction logic
-- and grants. Their common empty-source guard prevents nightly zero snapshots
-- from repopulating a system explicitly reset before its first real customer.
do $$
declare
 r record;v_definition text;v_body text;v_original_body text;v_guard text;
 v_company_pattern text := $rx$select count\(\*\) from public\.data_quality_issues q[[:space:]]+where q\.company_id = p_company_id and q\.status = 'open' and q\.issue_type = 'missing_metering_values'$rx$;
 v_owner_pattern text := $rx$missing as \([[:space:]]+select count\(\*\) as cnt from public\.data_quality_issues q[[:space:]]+where q\.company_id = p_company_id and q\.status = 'open' and q\.issue_type = 'missing_metering_values'[[:space:]]+\)$rx$;
begin
 for r in select * from (values
  ('gridex_snapshot_customer_portfolio_month','return null;'),
  ('gridex_rebuild_company_analytics_month','return jsonb_build_object(''month'',date_trunc(''month'',p_month)::date,''forecast_run_id'',null,''customers'',0,''bidding_zones'',0,''grid_owners'',0,''skipped'',''no_customer_data'');')
 ) as builders(name,empty_return)
 loop
  if to_regprocedure(format('public.%I(uuid,date)',r.name)) is null then continue;end if;
  select pg_get_functiondef(to_regprocedure(format('public.%I(uuid,date)',r.name))) into v_definition;
  v_body:=substring(v_definition from 'AS \$function\$([\s\S]*)\$function\$');
  if v_body is null then raise exception 'Unsupported analytics builder body: %',r.name;end if;
  v_original_body:=v_body;

  -- Repair the mature monthly body independently of the empty guard. Missing
  -- points are a selected-period physical fact, not a count of stale findings.
  if r.name='gridex_rebuild_company_analytics_month' then
   if position('gridex_missing_metering_points_v1' in v_body)=0 then
    if (select count(*) from regexp_matches(v_body,v_company_pattern,'g'))<>1
       or (select count(*) from regexp_matches(v_body,v_owner_pattern,'g'))<>1
       or (select count(*) from regexp_matches(v_body,'\(select cnt from missing\)','g'))<>1
       or (select count(*) from regexp_matches(v_body,'left join fc f on f\.grid_owner_id = o\.id','g'))<>1 then
     raise exception 'Unsupported monthly analytics missing-count body; preserve original function';
    end if;
    v_body:=regexp_replace(v_body,v_company_pattern,'select count(*) from public.gridex_missing_metering_points_v1(p_company_id,v_month)');
    v_body:=regexp_replace(v_body,v_owner_pattern,'missing as (
     select m.grid_owner_id,count(*) as cnt
     from public.gridex_missing_metering_points_v1(p_company_id,v_month) m
     where m.grid_owner_id is not null group by m.grid_owner_id
    )');
    v_body:=replace(v_body,'(select cnt from missing)','coalesce(missing_counts.cnt,0)');
    v_body:=regexp_replace(v_body,'left join fc f on f\.grid_owner_id = o\.id','left join fc f on f.grid_owner_id = o.id
    left join missing missing_counts on missing_counts.grid_owner_id = o.id');
   elsif (select count(*) from regexp_matches(v_body,'gridex_missing_metering_points_v1','g'))<>2
      or position('left join missing missing_counts on missing_counts.grid_owner_id = o.id' in v_body)=0 then
    raise exception 'Unsupported partially repaired monthly analytics body; preserve original function';
   end if;
  end if;

  if position('gridex_company_has_customer_data' in v_body)=0 then
   v_guard:=format('begin
    if p_company_id is null or p_month is null then raise exception ''company_id and month are required'' using errcode=''22023'';end if;
    if not public.gridex_company_has_customer_data(p_company_id) then %s end if;',r.empty_return);
   v_body:=regexp_replace(v_body,'\mbegin\M',v_guard,'i');
  end if;
  v_definition:=replace(v_definition,v_original_body,v_body);
  execute v_definition;
 end loop;
end $$;
