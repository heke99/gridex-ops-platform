-- Complete advanced customer-register reads before range; no writer or healing.
-- Existing server guards retain selected-company/platform authority ownership.
create function public.gridex_customer_registry_page_v1(
  p_company_id uuid,
  p_query text,
  p_status text,
  p_contract_filter text,
  p_customer_type text,
  p_flag text,
  p_exclude_test_data boolean,
  p_page integer,
  p_page_size integer
) returns jsonb
language plpgsql stable security invoker
set search_path = pg_catalog, public
as $registry$
declare
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_status text := coalesce(p_status, 'all');
  v_contract text := coalesce(p_contract_filter, 'all');
  v_type text := coalesce(p_customer_type, 'all');
  v_flag text := coalesce(p_flag, 'all');
  v_page integer := coalesce(p_page, 1);
  v_size integer := coalesce(p_page_size, 100);
  v_result jsonb;
  v_bad_graph boolean;
begin
  if v_page < 1 or v_size < 1 or v_size > 100
     or v_status not in ('all','draft','pending_verification','active','inactive','moved','terminated','blocked','archived')
     or v_contract not in ('all','none','pending_signature','signed','active','closed')
     or v_type not in ('all','private','business','association')
     or v_flag not in ('all','possible_duplicate','multi_site','multi_contract','consolidated_invoice',
       'missing_authorization','missing_grid_owner','ready_for_switch','billing_ready','test_customers') then
    raise exception using errcode='22023', message='Invalid customer registry read parameters';
  end if;
  if v_flag in ('possible_duplicate','consolidated_invoice') then
    raise exception using errcode='55000', message='Customer registry filter fact unavailable';
  end if;

  -- Every fact, count and output row below belongs to this one statement snapshot.
  with base as materialized (
    select c.id,c.company_id,
      coalesce(nullif(c.customer_type,''),'private') as customer_type,
      coalesce(nullif(c.status,''),'draft') as status,
      c.billing_profile_revision,c.intake_status,c.intake_missing_fields,
      c.first_name,c.last_name,
      coalesce(nullif(c.full_name,''),nullif(btrim(concat_ws(' ',nullif(c.first_name,''),nullif(c.last_name,''))),'')) as full_name,
      c.company_name,c.email,c.phone,c.personal_number,c.org_number,c.customer_number,
      c.apartment_number,c.source,c.is_test_data,c.created_at
    from public.customers c
    where c.company_id is not null
      and (p_company_id is null or c.company_id=p_company_id)
      and (c.source is null or c.source<>'ediel_portal_test')
      and (v_status='archived' or c.status is null or c.status not in ('archived','deleted','deleted_test_only','pending_deletion'))
      and (not coalesce(p_exclude_test_data,false) or v_flag='test_customers'
        or ((c.is_test_data is null or not c.is_test_data) and (c.source is null or c.source not ilike '%test%')))
      and (v_type='all' or (v_type='private' and (c.customer_type is null or c.customer_type='private')) or c.customer_type=v_type)
      and (v_query='' or exists (
        select 1 from unnest(array[
          coalesce(nullif(c.full_name,''),nullif(btrim(concat_ws(' ',nullif(c.first_name,''),nullif(c.last_name,''))),'')),
          c.company_name,c.email,c.phone,c.personal_number,c.org_number,c.customer_number,c.first_name,c.last_name
        ]) value where strpos(lower(value),v_query)>0
      ))
  ), owned_sites as materialized (
    select s.id,s.company_id,s.customer_id,s.status,s.grid_owner_id,s.customer_site_id
    from public.customer_sites s join base b on b.company_id=s.company_id and b.id=s.customer_id
  ), owned_contracts as materialized (
    select k.id,k.company_id,k.customer_id,k.site_id,k.customer_site_id,k.metering_point_id,k.status,k.created_at
    from public.customer_contracts k join base b on b.company_id=k.company_id and b.id=k.customer_id
  ), owned_poa as materialized (
    select a.id,a.company_id,a.customer_id,a.site_id,a.customer_site_id,a.metering_point_id,
      a.contract_id,a.customer_contract_id,a.status
    from public.powers_of_attorney a join base b on b.company_id=a.company_id and b.id=a.customer_id
  ), owned_points as materialized (
    select m.id,m.company_id,m.customer_id,m.site_id,m.customer_site_id,m.status,
      s.customer_id as parent_customer_id
    from public.metering_points m join owned_sites s
      on s.company_id=m.company_id and (s.id=m.site_id or s.id=m.customer_site_id)
  ), bad_graph as (
    select id from owned_sites where customer_site_id is not null and customer_site_id<>id
    union all
    select id from owned_points where
      (site_id is not null and customer_site_id is not null and site_id<>customer_site_id)
      or (customer_id is not null and customer_id<>parent_customer_id)
    union all
    select k.id from owned_contracts k where
      (k.site_id is not null and k.customer_site_id is not null and k.site_id<>k.customer_site_id)
      or (coalesce(k.site_id,k.customer_site_id) is not null and not exists (
        select 1 from owned_sites s where s.company_id=k.company_id and s.customer_id=k.customer_id
          and s.id=coalesce(k.site_id,k.customer_site_id)))
      or (k.metering_point_id is not null and not exists (
        select 1 from owned_points m where m.id=k.metering_point_id and m.company_id=k.company_id
          and m.parent_customer_id=k.customer_id
          and (coalesce(k.site_id,k.customer_site_id) is null or coalesce(m.site_id,m.customer_site_id)=coalesce(k.site_id,k.customer_site_id))))
    union all
    select a.id from owned_poa a where
      (a.site_id is not null and a.customer_site_id is not null and a.site_id<>a.customer_site_id)
      or (a.contract_id is not null and a.customer_contract_id is not null and a.contract_id<>a.customer_contract_id)
      or (coalesce(a.site_id,a.customer_site_id) is not null and not exists (
        select 1 from owned_sites s where s.company_id=a.company_id and s.customer_id=a.customer_id
          and s.id=coalesce(a.site_id,a.customer_site_id)))
      or (a.metering_point_id is not null and not exists (
        select 1 from owned_points m where m.id=a.metering_point_id and m.company_id=a.company_id
          and m.parent_customer_id=a.customer_id
          and (coalesce(a.site_id,a.customer_site_id) is null or coalesce(m.site_id,m.customer_site_id)=coalesce(a.site_id,a.customer_site_id))))
      or (coalesce(a.contract_id,a.customer_contract_id) is not null and not exists (
        select 1 from owned_contracts k where k.company_id=a.company_id and k.customer_id=a.customer_id
          and k.id=coalesce(a.contract_id,a.customer_contract_id)
          and (coalesce(a.site_id,a.customer_site_id) is null or coalesce(k.site_id,k.customer_site_id) is null
            or coalesce(k.site_id,k.customer_site_id)=coalesce(a.site_id,a.customer_site_id))
          and (a.metering_point_id is null or k.metering_point_id is null or k.metering_point_id=a.metering_point_id)))
  ), site_facts as (
    select company_id,customer_id,count(*) as site_count,
      count(*) filter(where status='active') as active_site_count,
      bool_or(grid_owner_id is null) as has_missing_grid_owner
    from owned_sites group by company_id,customer_id
  ), point_facts as (
    select company_id,parent_customer_id as customer_id,count(*) as metering_point_count,
      count(*) filter(where status='active') as active_metering_point_count
    from owned_points group by company_id,parent_customer_id
  ), contract_facts as (
    select company_id,customer_id,count(*) as contract_count
    from owned_contracts group by company_id,customer_id
  ), latest_contract as (
    select distinct on (company_id,customer_id) company_id,customer_id,status
    from owned_contracts order by company_id,customer_id,created_at desc,id desc
  ), poa_facts as (
    select company_id,customer_id,bool_or(status='signed') as has_signed_power_of_attorney
    from owned_poa group by company_id,customer_id
  ), facts as materialized (
    select b.*,coalesce(s.site_count,0) as site_count,coalesce(s.active_site_count,0) as active_site_count,
      coalesce(s.has_missing_grid_owner,false) as has_missing_grid_owner,
      coalesce(m.metering_point_count,0) as metering_point_count,
      coalesce(m.active_metering_point_count,0) as active_metering_point_count,
      coalesce(k.contract_count,0) as contract_count,
      coalesce(a.has_signed_power_of_attorney,false) as has_signed_power_of_attorney,
      l.status as latest_contract_status
    from base b
      left join site_facts s on s.company_id=b.company_id and s.customer_id=b.id
      left join point_facts m on m.company_id=b.company_id and m.customer_id=b.id
      left join contract_facts k on k.company_id=b.company_id and k.customer_id=b.id
      left join latest_contract l on l.company_id=b.company_id and l.customer_id=b.id
      left join poa_facts a on a.company_id=b.company_id and a.customer_id=b.id
  ), count_set as materialized (
    select * from facts where case v_flag
      when 'all' then true
      when 'multi_site' then site_count>1
      when 'multi_contract' then contract_count>1
      when 'missing_grid_owner' then has_missing_grid_owner
      when 'missing_authorization' then not has_signed_power_of_attorney
      when 'ready_for_switch' then site_count>0 and metering_point_count>0 and has_signed_power_of_attorney and not has_missing_grid_owner
      when 'billing_ready' then site_count>0 and metering_point_count>0 and contract_count>0 and not has_missing_grid_owner
      when 'test_customers' then is_test_data is true or strpos(lower(coalesce(source,'')),'test')>0
      else false end
  ), filtered as materialized (
    select * from count_set where (v_status='all' or status=v_status)
      and case v_contract
        when 'all' then true
        when 'none' then contract_count=0
        when 'closed' then latest_contract_status in ('terminated','cancelled','expired')
        else latest_contract_status=v_contract end
  ), page_rows as (
    select * from filtered order by created_at desc,id desc
      limit v_size offset ((v_page::bigint-1)*v_size::bigint)
  ), totals as (select count(*) as total from filtered)
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg((to_jsonb(r)-'latest_contract_status') || jsonb_build_object(
      'possible_duplicate',null,'duplicate_review_status',null,'consolidated_invoice',null,'billing_level',null)
      order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total',t.total,'page',v_page,'pageSize',v_size,
    'totalPages',greatest(1,ceil(t.total::numeric/v_size)::bigint),
    'counts',(select jsonb_build_object('all',count(*),'draft',count(*) filter(where status='draft'),
      'pending_verification',count(*) filter(where status='pending_verification'),
      'active',count(*) filter(where status='active'),'inactive',count(*) filter(where status='inactive'),
      'moved',count(*) filter(where status='moved'),'terminated',count(*) filter(where status='terminated'),
      'blocked',count(*) filter(where status='blocked'),'archived',count(*) filter(where status='archived')) from count_set)
  ),exists(select 1 from bad_graph) into v_result,v_bad_graph from totals t;

  if v_bad_graph then
    raise exception using errcode='55000', message='Customer registry resource graph unavailable';
  end if;
  return v_result;
end;
$registry$;

revoke all on function public.gridex_customer_registry_page_v1(uuid,text,text,text,text,text,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.gridex_customer_registry_page_v1(uuid,text,text,text,text,text,boolean,integer,integer) to service_role;
comment on function public.gridex_customer_registry_page_v1(uuid,text,text,text,text,text,boolean,integer,integer)
is 'Read-only advanced customer-register snapshot: current stored facts, literal query and latest contract before bounded range. Existing server guards own selected-company/platform authority.';

notify pgrst, 'reload schema';
