-- Canonical contract-channel grants, publication and external availability.
-- Forward-only. Historical migrations remain immutable.
begin;

select pg_advisory_xact_lock(
  hashtextextended('gridex:contract-channel-publication:20260728190000', 0)
);

do $preflight$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.tenant_contract_assignments') is null then
    v_missing := array_append(v_missing, 'table tenant_contract_assignments');
  end if;
  if to_regclass('public.tenant_contract_channels') is null then
    v_missing := array_append(v_missing, 'table tenant_contract_channels');
  end if;
  if to_regclass('public.contract_publications') is null then
    v_missing := array_append(v_missing, 'table contract_publications');
  end if;
  if to_regclass('public.contract_publication_versions') is null then
    v_missing := array_append(v_missing, 'table contract_publication_versions');
  end if;
  if to_regclass('public.public_contract_offers') is null then
    v_missing := array_append(v_missing, 'table public_contract_offers');
  end if;
  if to_regclass('public.integration_api_clients') is null then
    v_missing := array_append(v_missing, 'table integration_api_clients');
  end if;
  if to_regclass('public.permissions') is null then
    v_missing := array_append(v_missing, 'table permissions');
  end if;
  if to_regclass('public.audit_logs') is null then
    v_missing := array_append(v_missing, 'table audit_logs');
  end if;
  if to_regclass('public.admin_users') is null then
    v_missing := array_append(v_missing, 'table admin_users');
  end if;
  if to_regclass('public.user_roles') is null then
    v_missing := array_append(v_missing, 'table user_roles');
  end if;
  if to_regclass('public.roles') is null then
    v_missing := array_append(v_missing, 'table roles');
  end if;
  if to_regclass('public.company_memberships') is null then
    v_missing := array_append(v_missing, 'table company_memberships');
  end if;
  if to_regprocedure(
    'public.gridex_assert_contract_permission(uuid,text)'
  ) is null then
    v_missing := array_append(
      v_missing,
      'function gridex_assert_contract_permission'
    );
  end if;
  if to_regprocedure(
    'public.gridex_validate_contract_readiness_v2(uuid,uuid,text,text)'
  ) is null then
    v_missing := array_append(
      v_missing,
      'function gridex_validate_contract_readiness_v2'
    );
  end if;
  if to_regprocedure(
    'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'
  ) is null then
    v_missing := array_append(
      v_missing,
      'function gridex_publish_contract_channel'
    );
  end if;
  if cardinality(v_missing) > 0 then
    raise exception using
      errcode = '55000',
      message = 'contract_channel_publication_preflight_failed',
      detail = array_to_string(v_missing, ', ');
  end if;
end
$preflight$;

alter table public.tenant_contract_assignments
  add column if not exists api_publication_allowed boolean not null default false;

do $publication_version_preflight$
declare
  v_duplicate_count bigint;
begin
  select count(*)
  into v_duplicate_count
  from (
    select publication_version.contract_publication_id
    from public.contract_publication_versions publication_version
    where publication_version.status='published'
    group by publication_version.contract_publication_id
    having count(*)>1
  ) duplicates;
  if v_duplicate_count>0 then
    raise exception using
      errcode='23505',
      message='duplicate_active_contract_publication_versions',
      detail=format(
        '%s publication graph(s) have more than one published version',
        v_duplicate_count
      ),
      hint='Resolve the duplicate published versions explicitly before applying this migration.';
  end if;
end
$publication_version_preflight$;

create unique index if not exists
  contract_publication_versions_one_published_per_publication_uidx
  on public.contract_publication_versions(contract_publication_id)
  where status = 'published';

create index if not exists
  tenant_contract_assignments_company_channel_permissions_idx
  on public.tenant_contract_assignments(
    company_id,
    contract_product_version_id,
    internal_sales_allowed,
    website_publication_allowed,
    api_publication_allowed
  );

-- Register the granular permissions without assuming one historical
-- permissions-table presentation shape.
do $permissions$
declare
  v_key text;
  v_label text;
  v_description text;
  v_has_name boolean;
  v_has_label boolean;
  v_has_description boolean;
  v_has_category boolean;
  v_has_area boolean;
  v_has_risk boolean;
  v_has_is_active boolean;
  v_columns text[];
  v_values text[];
  v_updates text[];
begin
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='name'
  ) into v_has_name;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='label'
  ) into v_has_label;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='description'
  ) into v_has_description;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='category'
  ) into v_has_category;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='area'
  ) into v_has_area;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='risk'
  ) into v_has_risk;
  select exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='permissions' and column_name='is_active'
  ) into v_has_is_active;

  for v_key,v_label,v_description in
    values
      (
        'contracts.permissions.manage',
        'Hantera avtalskanalbehörigheter',
        'Kan ge och återkalla ett tenant-avtals behörighet per kanal.'
      ),
      (
        'contracts.publish.internal',
        'Publicera avtal internt',
        'Kan aktivera en redan behörighetsgiven intern avtalskanal.'
      ),
      (
        'contracts.publish.website',
        'Publicera avtal på hemsida',
        'Kan aktivera en redan behörighetsgiven website-kanal.'
      ),
      (
        'contracts.publish.api',
        'Publicera avtal i API',
        'Kan aktivera en redan behörighetsgiven API-kanal.'
      )
  loop
    v_columns := array['key'];
    v_values := array[quote_literal(v_key)];
    v_updates := array[]::text[];
    if v_has_name then
      v_columns := array_append(v_columns,'name');
      v_values := array_append(v_values,quote_literal(v_label));
      v_updates := array_append(v_updates,'name=excluded.name');
    end if;
    if v_has_label then
      v_columns := array_append(v_columns,'label');
      v_values := array_append(v_values,quote_literal(v_label));
      v_updates := array_append(v_updates,'label=excluded.label');
    end if;
    if v_has_description then
      v_columns := array_append(v_columns,'description');
      v_values := array_append(v_values,quote_literal(v_description));
      v_updates := array_append(v_updates,'description=excluded.description');
    end if;
    if v_has_category then
      v_columns := array_append(v_columns,'category');
      v_values := array_append(v_values,quote_literal('contracts'));
      v_updates := array_append(v_updates,'category=excluded.category');
    end if;
    if v_has_area then
      v_columns := array_append(v_columns,'area');
      v_values := array_append(v_values,quote_literal('Avtal'));
      v_updates := array_append(v_updates,'area=excluded.area');
    end if;
    if v_has_risk then
      v_columns := array_append(v_columns,'risk');
      v_values := array_append(
        v_values,
        quote_literal(
          case when v_key='contracts.permissions.manage' then 'high' else 'normal' end
        )
      );
      v_updates := array_append(v_updates,'risk=excluded.risk');
    end if;
    if v_has_is_active then
      v_columns := array_append(v_columns,'is_active');
      v_values := array_append(v_values,'true');
      v_updates := array_append(v_updates,'is_active=true');
    end if;
    execute format(
      'insert into public.permissions(%s) values(%s) on conflict(key) do %s',
      array_to_string(v_columns,','),
      array_to_string(v_values,','),
      case
        when cardinality(v_updates)>0
          then 'update set '||array_to_string(v_updates,',')
        else 'nothing'
      end
    );
  end loop;
end
$permissions$;

create or replace function public.gridex_contract_channel_permission_allowed(
  p_assignment public.tenant_contract_assignments,
  p_channel text
) returns boolean
language sql
immutable
set search_path = public, pg_catalog, pg_temp
as $$
  select case lower(coalesce(p_channel,''))
    when 'internal' then p_assignment.internal_sales_allowed
    when 'website' then p_assignment.website_publication_allowed
    when 'api' then p_assignment.api_publication_allowed
    else false
  end
$$;

create or replace function public.gridex_contract_actor_can_operate_company(
  p_actor_user_id uuid,
  p_company_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
  select p_actor_user_id is not null
    and p_company_id is not null
    and (coalesce(auth.role(),'')='service_role' or p_actor_user_id=auth.uid())
    and (
      exists(
        select 1
        from public.admin_users admin_user
        where admin_user.user_id=p_actor_user_id
          and coalesce(admin_user.is_active,true)
          and lower(coalesce(admin_user.role,'')) in (
            'super_admin','superadmin','platform_superadmin'
          )
      )
      or exists(
        select 1
        from public.user_roles user_role
        left join public.roles role on role.id=user_role.role_id
        where user_role.user_id=p_actor_user_id
          and coalesce(user_role.status,'active')='active'
          and coalesce(user_role.is_active,true)
          and lower(coalesce(user_role.role,role.key,role.name,'')) in (
            'super_admin','superadmin','platform_superadmin'
          )
      )
      or exists(
        select 1
        from public.company_memberships membership
        where membership.user_id=p_actor_user_id
          and membership.company_id=p_company_id
          and coalesce(membership.status,'active')='active'
          and coalesce(membership.is_active,true)
      )
    )
$$;

create or replace function public.gridex_assert_contract_channel_permission(
  p_company_id uuid,
  p_contract_product_version_id uuid,
  p_channel text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
  v_assignment public.tenant_contract_assignments%rowtype;
  v_channel text := lower(coalesce(p_channel,''));
begin
  if v_channel not in ('internal','website','api') then
    raise exception using
      errcode='22023',
      message='invalid_contract_channel';
  end if;
  perform public.gridex_assert_contract_permission(
    p_actor_user_id,
    'contracts.publish.'||v_channel
  );
  if not public.gridex_contract_actor_can_operate_company(
    p_actor_user_id,
    p_company_id
  ) then
    raise exception using
      errcode='42501',
      message='contract_company_scope_denied';
  end if;
  select *
  into v_assignment
  from public.tenant_contract_assignments assignment
  where assignment.company_id=p_company_id
    and assignment.contract_product_version_id=p_contract_product_version_id
  for update;
  if not found then
    raise exception using
      errcode='P0002',
      message='contract_assignment_not_found';
  end if;
  if not public.gridex_contract_channel_permission_allowed(
    v_assignment,
    v_channel
  ) then
    raise exception using
      errcode='42501',
      message='contract_channel_permission_missing',
      detail=v_channel;
  end if;
  return v_assignment.id;
end
$$;

create or replace function public.gridex_set_contract_channel_permission(
  p_company_id uuid,
  p_assignment_id uuid,
  p_channel text,
  p_allowed boolean,
  p_actor_user_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
  v_assignment public.tenant_contract_assignments%rowtype;
  v_channel text := lower(coalesce(p_channel,''));
  v_before boolean;
  v_action text;
begin
  if v_channel not in ('internal','website','api') then
    raise exception using errcode='22023',message='invalid_contract_channel';
  end if;
  if p_allowed is null then
    raise exception using
      errcode='22004',
      message='contract_channel_permission_value_required';
  end if;
  perform public.gridex_assert_contract_permission(
    p_actor_user_id,
    'contracts.permissions.manage'
  );
  if not public.gridex_contract_actor_can_operate_company(
    p_actor_user_id,
    p_company_id
  ) then
    raise exception using
      errcode='42501',
      message='contract_company_scope_denied';
  end if;

  select *
  into v_assignment
  from public.tenant_contract_assignments assignment
  where assignment.id=p_assignment_id
    and assignment.company_id=p_company_id
  for update;
  if not found then
    raise exception using
      errcode='P0002',
      message='contract_assignment_not_found';
  end if;

  v_before := public.gridex_contract_channel_permission_allowed(
    v_assignment,
    v_channel
  );
  if v_before is not distinct from p_allowed then
    return jsonb_build_object(
      'ok',true,
      'changed',false,
      'code','contract_channel_permission_unchanged',
      'company_id',p_company_id,
      'assignment_id',p_assignment_id,
      'channel',v_channel,
      'publication_allowed',p_allowed
    );
  end if;

  update public.tenant_contract_assignments assignment
  set internal_sales_allowed=case
        when v_channel='internal' then p_allowed
        else assignment.internal_sales_allowed
      end,
      website_publication_allowed=case
        when v_channel='website' then p_allowed
        else assignment.website_publication_allowed
      end,
      api_publication_allowed=case
        when v_channel='api' then p_allowed
        else assignment.api_publication_allowed
      end,
      updated_at=now()
  where assignment.id=p_assignment_id
    and assignment.company_id=p_company_id;

  v_action := case
    when p_allowed
      then 'contract_channel_permission_granted'
    else 'contract_channel_permission_revoked'
  end;
  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,
    old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'tenant_contract_assignment',
    p_assignment_id::text,v_action,
    jsonb_build_object('publication_allowed',v_before),
    jsonb_build_object('publication_allowed',p_allowed),
    jsonb_build_object(
      'assignment_id',p_assignment_id,
      'contract_product_version_id',v_assignment.contract_product_version_id,
      'channel',v_channel,
      'reason',nullif(btrim(coalesce(p_reason,'')),'')
    )
  );

  return jsonb_build_object(
    'ok',true,
    'changed',true,
    'code',v_action,
    'company_id',p_company_id,
    'assignment_id',p_assignment_id,
    'channel',v_channel,
    'publication_allowed',p_allowed
  );
end
$$;

create or replace function public.gridex_validate_contract_channel_readiness(
  p_company_id uuid,
  p_assignment_id uuid,
  p_channel text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
  v_assignment public.tenant_contract_assignments%rowtype;
  v_offer_id uuid;
  v_channel text := lower(coalesce(p_channel,''));
  v_base jsonb := '{}'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_external_blockers jsonb := '[]'::jsonb;
  v_permission boolean := false;
  v_tenant_status text;
  v_external_ready boolean := true;
begin
  if coalesce(auth.role(),'')<>'service_role'
    and not public.gridex_can_read_company(p_company_id) then
    return jsonb_build_object(
      'ready',false,
      'channel',v_channel,
      'blockers',jsonb_build_array(jsonb_build_object(
        'code','contract_company_scope_denied',
        'message','Användaren saknar åtkomst till valt bolag.'
      )),
      'external_access_ready',false,
      'external_blockers','[]'::jsonb
    );
  end if;
  if v_channel not in ('internal','website','api') then
    return jsonb_build_object(
      'ready',false,
      'channel',v_channel,
      'blockers',jsonb_build_array(jsonb_build_object(
        'code','invalid_contract_channel',
        'message','Kanalen måste vara internal, website eller api.'
      )),
      'external_access_ready',false,
      'external_blockers','[]'::jsonb
    );
  end if;

  select *
  into v_assignment
  from public.tenant_contract_assignments assignment
  where assignment.id=p_assignment_id
    and assignment.company_id=p_company_id;
  if not found then
    return jsonb_build_object(
      'ready',false,
      'channel',v_channel,
      'blockers',jsonb_build_array(jsonb_build_object(
        'code','contract_assignment_not_found',
        'message','Avtalstilldelningen hittades inte för valt bolag.'
      )),
      'external_access_ready',false,
      'external_blockers','[]'::jsonb
    );
  end if;

  select offer.id
  into v_offer_id
  from public.contract_offers offer
  where offer.company_id=p_company_id
    and offer.contract_product_version_id=v_assignment.contract_product_version_id
    and offer.lifecycle_status in ('published','paused')
  order by offer.version_number desc,offer.updated_at desc nulls last,offer.id
  limit 1;
  if v_offer_id is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','contract_offer_not_channel_activatable',
      'message','En publicerad eller pausad canonical avtalsversion saknas.'
    ));
  else
    v_base := public.gridex_validate_contract_readiness_v2(
      p_company_id,
      v_offer_id,
      'activate_channel',
      v_channel
    );
    v_blockers := v_blockers || coalesce(v_base->'blockers','[]'::jsonb);
  end if;

  v_permission := public.gridex_contract_channel_permission_allowed(
    v_assignment,
    v_channel
  );
  if not v_permission then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code',v_channel||'_publication_permission_missing',
      'message',case v_channel
        when 'internal' then 'Avtalet saknar behörighet för intern försäljning.'
        when 'website' then 'Avtalet saknar behörighet för hemsidepublicering.'
        else 'Avtalet saknar behörighet för API-publicering.'
      end
    ));
  end if;

  select company.status
  into v_tenant_status
  from public.companies company
  where company.id=p_company_id;
  if v_tenant_status is distinct from 'active' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','tenant_not_operational',
      'message','Bolaget måste vara aktivt för att publicera avtal.',
      'current_status',v_tenant_status
    ));
  end if;

  if v_channel='api' and not exists(
    select 1
    from public.integration_api_clients client
    where client.company_id=p_company_id
      and client.status='active'
      and (client.expires_at is null or client.expires_at>now())
      and coalesce(client.scopes,'{}'::text[]) @> array['api_contracts.read']::text[]
  ) then
    v_external_ready := false;
    v_external_blockers := jsonb_build_array(jsonb_build_object(
      'code','api_scope_missing',
      'message','API-kanalen kan publiceras, men ingen aktiv API-klient har api_contracts.read.'
    ));
  end if;

  return jsonb_build_object(
    'ready',jsonb_array_length(v_blockers)=0,
    'channel',v_channel,
    'assignment_id',p_assignment_id,
    'contract_offer_id',v_offer_id,
    'publication_allowed',v_permission,
    'blockers',v_blockers,
    'external_access_ready',
      jsonb_array_length(v_blockers)=0 and v_external_ready,
    'external_blockers',v_external_blockers,
    'base_readiness',v_base,
    'evaluated_at',now()
  );
end
$$;

-- Repair the session guard as one complete function definition. This avoids
-- compiling invalid intermediate bodies while handling schemas both with and
-- without user_profiles.disabled_at.
create or replace function public.gridex_is_current_session_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_disabled_at timestamptz;
begin
  if v_user_id is null then
    return false;
  end if;
  if to_regclass('public.user_profiles') is null then
    return true;
  end if;
  if exists(
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='user_profiles'
      and column_name='disabled_at'
  ) then
    execute
      'select profile.user_status,profile.disabled_at
       from public.user_profiles profile where profile.id=$1'
    into v_status,v_disabled_at
    using v_user_id;
  else
    select profile.user_status
    into v_status
    from public.user_profiles profile
    where profile.id=v_user_id;
  end if;
  if coalesce(v_status,'active') in (
    'disabled','locked_security','removed_from_company','invitation_revoked'
  ) then
    return false;
  end if;
  return v_disabled_at is null;
end
$$;

-- Patch the effective publish/unpublish functions. The patch fails closed if
-- production does not match either the audited before or intended after body.
create or replace function public.gridex__patch_contract_function(
  p_signature text,
  p_old text,
  p_new text
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_oid regprocedure;
  v_definition text;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then
    raise exception using
      errcode='55000',
      message='contract_function_missing:'||p_signature;
  end if;
  v_definition := pg_get_functiondef(v_oid);
  if strpos(v_definition,p_old)>0 then
    execute replace(v_definition,p_old,p_new);
  elsif strpos(v_definition,p_new)=0 then
    raise exception using
      errcode='55000',
      message='contract_function_definition_mismatch:'||p_signature,
      detail=p_old;
  end if;
end
$$;

select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  $$perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');$$,
  $$perform public.gridex_assert_contract_permission(
    p_actor_user_id,'contracts.publish.'||v_channel
  );$$
);

select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  $$if v_channel not in ('internal','website','api','partner','phone') then$$,
  $$if v_channel not in ('internal','website','api') then$$
);

select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  $$'Kanalen måste vara internal, website, api, partner eller phone.'$$,
  $$'Kanalen måste vara internal, website eller api.'$$
);

select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  $old$
  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,p_offer_id,
    case when o.lifecycle_status='paused' then 'resume_channel' else 'activate_channel' end,
    v_channel
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_channel_not_ready',
      'channel',v_channel,'lifecycle_status',o.lifecycle_status,
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;$old$,
  $new$
  v_assignment_id:=public.gridex_assert_contract_channel_permission(
    p_company_id,o.contract_product_version_id,v_channel,p_actor_user_id
  );
  v_readiness:=public.gridex_validate_contract_channel_readiness(
    p_company_id,v_assignment_id,v_channel
  );
  if not coalesce((v_readiness->>'ready')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_channel_not_ready',
      'channel',v_channel,'lifecycle_status',o.lifecycle_status,
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;$new$
);

select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  $old$
  update public.tenant_contract_assignments
  set website_publication_allowed=website_publication_allowed or v_channel='website',
      internal_sales_allowed=internal_sales_allowed or v_channel='internal',
      status='active',valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
  where id=v_assignment_id;$old$,
  $new$
  update public.tenant_contract_assignments assignment
  set status='active',valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
  where assignment.id=v_assignment_id;$new$
);

select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  'o.valid_from::timestamptz',
  $$o.valid_from::timestamp at time zone 'Europe/Stockholm'$$
);
select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  'o.valid_to::timestamptz',
  $$case
      when o.valid_to is null then null
      else (o.valid_to + 1)::timestamp at time zone 'Europe/Stockholm'
    end$$
);
select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  $old$    ) returning id into v_publication_version_id;
  else$old$,
  $new$    ) returning id into v_publication_version_id;
    insert into public.audit_logs(
      company_id,actor_user_id,entity_type,entity_id,action,
      old_values,new_values,metadata
    ) values(
      p_company_id,p_actor_user_id,'contract_publication_version',
      v_publication_version_id::text,'contract_publication_version_created',
      null,v_snapshot,
      jsonb_build_object(
        'offer_id',o.id,
        'channel',v_channel,
        'offer_reference',v_offer_reference
      )
    );
  else$new$
);
select public.gridex__patch_contract_function(
  'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
  $old$'contract.channel.published'$old$,
  $new$'contract_channel_published'$new$
);
select public.gridex__patch_contract_function(
  'public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid)',
  $old$'contract.channel.unpublished'$old$,
  $new$'contract_channel_unpublished'$new$
);

drop function public.gridex__patch_contract_function(text,text,text);

-- API feed: explicit API grant, active tenant and one canonical publication
-- source. The application boundary applies the final DTO allowlist.
create or replace function public.gridex_list_external_api_contracts(
  p_company_id uuid,
  p_customer_type text default null
) returns table(data jsonb)
language sql
stable
security definer
set search_path=public,pg_catalog,pg_temp
as $$
  select jsonb_build_object(
    'offer_reference',cpv.offer_reference,
    'name',coalesce(
      cpv.publication_snapshot->'commercial_snapshot'->>'name',
      cpv.publication_snapshot->'commercial_snapshot'->>'public_name',
      'Elavtal'
    ),
    'description',coalesce(
      cpv.publication_snapshot->'commercial_snapshot'->>'description',
      cpv.publication_snapshot->'commercial_snapshot'->>'public_description'
    ),
    'contract_type',coalesce(
      cpv.publication_snapshot->'commercial_snapshot'->>'contract_type',
      product_version.contract_type
    ),
    'energy_direction',coalesce(
      nullif(cpv.energy_direction,''),
      nullif(product_version.energy_direction,''),
      'consumption'
    ),
    'customer_type',cpv.customer_type,
    'pricing',coalesce(
      cpv.publication_snapshot->'commercial_snapshot'->'pricing',
      cpv.publication_snapshot->'commercial_snapshot',
      '{}'::jsonb
    ),
    'valid_from',cpv.valid_from,
    'valid_to',cpv.valid_to,
    'channel','api'
  ) as data
  from public.contract_publication_versions cpv
  join public.contract_publications publication
    on publication.id=cpv.contract_publication_id
  join public.tenant_contract_assignments assignment
    on assignment.id=publication.assignment_id
  join public.tenant_contract_channels channel
    on channel.assignment_id=assignment.id and channel.channel='api'
  join public.contract_product_versions product_version
    on product_version.id=cpv.contract_product_version_id
  join public.companies company
    on company.id=assignment.company_id
  where assignment.company_id=p_company_id
    and company.status='active'
    and assignment.status='active'
    and assignment.api_publication_allowed
    and publication.channel='api'
    and publication.status='published'
    and cpv.channel='api'
    and cpv.status='published'
    and cpv.locked_at is not null
    and cpv.contract_product_version_id=assignment.contract_product_version_id
    and cpv.content_sha256=encode(
      extensions.digest(cpv.publication_snapshot::text,'sha256'),
      'hex'
    )
    and channel.status='active'
    and (
      assignment.valid_from is null
      or assignment.valid_from<=(now() at time zone 'Europe/Stockholm')::date
    )
    and (
      assignment.valid_to is null
      or assignment.valid_to>=(now() at time zone 'Europe/Stockholm')::date
    )
    and (channel.valid_from is null or channel.valid_from<=now())
    and (channel.valid_to is null or channel.valid_to>now())
    and (cpv.valid_from is null or cpv.valid_from<=now())
    and (cpv.valid_to is null or cpv.valid_to>now())
    and (
      p_customer_type is null
      or cpv.customer_type='both'
      or cpv.customer_type=p_customer_type
    )
  order by cpv.published_at desc nulls last,cpv.created_at desc
$$;

-- Canonical admin read model. Missing assignments are represented explicitly;
-- mandatory booleans never disappear from the schema.
drop view if exists public.canonical_internal_contract_offers_v;
create view public.canonical_internal_contract_offers_v
with (security_invoker=true)
as
with source as (
  select
    offer.*,
    product.product_code as canonical_product_code,
    product.status as canonical_product_status,
    product_version.version_number as canonical_version_number,
    product_version.status as canonical_version_status,
    product_version.content_sha256 as canonical_content_sha256,
    assignment.id as assignment_id,
    coalesce(assignment.status,'missing') as assignment_status,
    assignment.valid_from as assignment_valid_from,
    assignment.valid_to as assignment_valid_to,
    coalesce(assignment.internal_sales_allowed,false)
      as internal_sales_allowed,
    coalesce(assignment.website_publication_allowed,false)
      as website_publication_allowed,
    coalesce(assignment.api_publication_allowed,false)
      as api_publication_allowed,
    company.status as tenant_status,
    internal_channel.status as internal_channel_status_raw,
    internal_channel.valid_from as internal_channel_valid_from,
    internal_channel.valid_to as internal_channel_valid_to,
    website_channel.status as website_channel_status_raw,
    website_channel.valid_from as website_channel_valid_from,
    website_channel.valid_to as website_channel_valid_to,
    api_channel.status as api_channel_status_raw,
    api_channel.valid_from as api_channel_valid_from,
    api_channel.valid_to as api_channel_valid_to,
    coalesce(publication_counts.active_count,0)::integer
      as active_publication_version_count,
    coalesce(
      channel_readiness.internal,
      jsonb_build_object(
        'ready',false,
        'blockers',jsonb_build_array(jsonb_build_object(
          'code','contract_assignment_not_found',
          'message','Avtalstilldelningen saknas.'
        ))
      )
    ) as internal_readiness_source,
    coalesce(
      channel_readiness.website,
      jsonb_build_object(
        'ready',false,
        'blockers',jsonb_build_array(jsonb_build_object(
          'code','contract_assignment_not_found',
          'message','Avtalstilldelningen saknas.'
        ))
      )
    ) as website_readiness_source,
    coalesce(
      channel_readiness.api,
      jsonb_build_object(
        'ready',false,
        'blockers',jsonb_build_array(jsonb_build_object(
          'code','contract_assignment_not_found',
          'message','Avtalstilldelningen saknas.'
        ))
      )
    ) as api_readiness_source,
    (
      company.status='active'
      and offer.lifecycle_status in ('published','paused')
      and assignment.id is not null
      and assignment.status in ('active','paused')
      and (
        assignment.valid_from is null
        or assignment.valid_from<=(now() at time zone 'Europe/Stockholm')::date
      )
      and (
        assignment.valid_to is null
        or assignment.valid_to>=(now() at time zone 'Europe/Stockholm')::date
      )
      and product_version.status='approved'
      and product_version.locked_at is not null
      and offer.price_plan_version_id is not null
      and offer.legal_bundle_version_id is not null
      and (
        offer.valid_from is null
        or offer.valid_from<=(now() at time zone 'Europe/Stockholm')::date
      )
      and (
        offer.valid_to is null
        or offer.valid_to>=(now() at time zone 'Europe/Stockholm')::date
      )
    ) as common_channel_ready,
    case
      when offer.contract_product_version_id is null
        then 'missing_product_version'
      when product_version.id is null
        then 'broken_product_version'
      when product.id is null
        then 'missing_product'
      else 'ok'
    end as relation_status
  from public.contract_offers offer
  left join public.contract_product_versions product_version
    on product_version.id=offer.contract_product_version_id
   and product_version.contract_product_id=offer.contract_product_id
  left join public.contract_products product
    on product.id=offer.contract_product_id
  left join public.tenant_contract_assignments assignment
    on assignment.company_id=offer.company_id
   and assignment.contract_product_version_id=offer.contract_product_version_id
  left join public.companies company
    on company.id=offer.company_id
  left join public.tenant_contract_channels internal_channel
    on internal_channel.assignment_id=assignment.id
   and internal_channel.channel='internal'
  left join public.tenant_contract_channels website_channel
    on website_channel.assignment_id=assignment.id
   and website_channel.channel='website'
  left join public.tenant_contract_channels api_channel
    on api_channel.assignment_id=assignment.id
   and api_channel.channel='api'
  left join lateral (
    select count(*) as active_count
    from public.contract_publications publication
    join public.contract_publication_versions publication_version
      on publication_version.contract_publication_id=publication.id
    where publication.assignment_id=assignment.id
      and publication.status='published'
      and publication_version.status='published'
  ) publication_counts on true
  left join lateral (
    select
      public.gridex_validate_contract_channel_readiness(
        offer.company_id,assignment.id,'internal'
      ) as internal,
      public.gridex_validate_contract_channel_readiness(
        offer.company_id,assignment.id,'website'
      ) as website,
      public.gridex_validate_contract_channel_readiness(
        offer.company_id,assignment.id,'api'
      ) as api
  ) channel_readiness on assignment.id is not null
)
select
  source.*,
  source.id as contract_offer_id,
  source.status as offer_status,
  null::jsonb as readiness,
  null::jsonb as deletion_preview,
  coalesce(source.internal_channel_status_raw,'missing')
    as internal_channel_status,
  coalesce(source.website_channel_status_raw,'missing')
    as website_channel_status,
  coalesce(source.api_channel_status_raw,'missing')
    as api_channel_status,
  (
    source.common_channel_ready
    and source.internal_sales_allowed
    and source.assignment_status='active'
    and source.internal_channel_status_raw='active'
    and (
      source.internal_channel_valid_from is null
      or source.internal_channel_valid_from<=now()
    )
    and (
      source.internal_channel_valid_to is null
      or source.internal_channel_valid_to>now()
    )
    and exists(
      select 1
      from public.contract_publications publication
      join public.contract_publication_versions publication_version
        on publication_version.contract_publication_id=publication.id
      where publication.assignment_id=source.assignment_id
        and publication.channel='internal'
        and publication.status='published'
        and publication_version.status='published'
        and publication_version.contract_product_version_id
          =source.contract_product_version_id
        and publication_version.content_sha256=encode(
          extensions.digest(
            publication_version.publication_snapshot::text,
            'sha256'
          ),
          'hex'
        )
        and (
          publication_version.valid_from is null
          or publication_version.valid_from<=now()
        )
        and (
          publication_version.valid_to is null
          or publication_version.valid_to>now()
        )
    )
  ) as internally_sellable_now,
  (
    source.common_channel_ready
    and source.website_publication_allowed
    and source.assignment_status='active'
    and source.website_channel_status_raw='active'
    and (
      source.website_channel_valid_from is null
      or source.website_channel_valid_from<=now()
    )
    and (
      source.website_channel_valid_to is null
      or source.website_channel_valid_to>now()
    )
    and exists(
      select 1
      from public.contract_publications publication
      join public.contract_publication_versions publication_version
        on publication_version.contract_publication_id=publication.id
      join public.public_contract_offers public_offer
        on public_offer.contract_publication_version_id=publication_version.id
      where publication.assignment_id=source.assignment_id
        and publication.channel='website'
        and publication.status='published'
        and publication_version.status='published'
        and public_offer.company_id=source.company_id
        and public_offer.source_contract_offer_id=source.id
        and public_offer.lifecycle_status='published'
        and public_offer.publication_status='published'
        and public_offer.is_public
        and public_offer.website_enabled
        and public_offer.website_cta_enabled
        and exists(
          select 1
          from public.contract_publication_graph_integrity_v graph
          where graph.public_contract_offer_id=public_offer.id
            and graph.canonical_graph_consistent
        )
    )
  ) as website_available_now,
  (
    source.common_channel_ready
    and source.api_publication_allowed
    and source.assignment_status='active'
    and source.api_channel_status_raw='active'
    and (
      source.api_channel_valid_from is null
      or source.api_channel_valid_from<=now()
    )
    and (
      source.api_channel_valid_to is null
      or source.api_channel_valid_to>now()
    )
    and exists(
      select 1
      from public.contract_publications publication
      join public.contract_publication_versions publication_version
        on publication_version.contract_publication_id=publication.id
      where publication.assignment_id=source.assignment_id
        and publication.channel='api'
        and publication.status='published'
        and publication_version.status='published'
        and publication_version.contract_product_version_id
          =source.contract_product_version_id
        and publication_version.content_sha256=encode(
          extensions.digest(
            publication_version.publication_snapshot::text,
            'sha256'
          ),
          'hex'
        )
        and (
          publication_version.valid_from is null
          or publication_version.valid_from<=now()
        )
        and (
          publication_version.valid_to is null
          or publication_version.valid_to>now()
        )
    )
    and exists(
      select 1
      from public.integration_api_clients client
      where client.company_id=source.company_id
        and client.status='active'
        and (client.expires_at is null or client.expires_at>now())
        and coalesce(client.scopes,'{}'::text[])
          @> array['api_contracts.read']::text[]
    )
  ) as api_available_now,
  (
    source.common_channel_ready
    and source.internal_sales_allowed
  ) as internal_publication_ready,
  jsonb_build_object(
    'ready',coalesce((source.internal_readiness_source->>'ready')::boolean,false),
    'blockers',coalesce(source.internal_readiness_source->'blockers','[]'::jsonb)
  ) as internal_readiness,
  jsonb_build_object(
    'ready',coalesce((source.website_readiness_source->>'ready')::boolean,false),
    'blockers',coalesce(source.website_readiness_source->'blockers','[]'::jsonb)
  ) as website_readiness,
  jsonb_build_object(
    'ready',coalesce((source.api_readiness_source->>'ready')::boolean,false),
    'blockers',coalesce(source.api_readiness_source->'blockers','[]'::jsonb)
  ) as api_readiness,
  (
    source.common_channel_ready
    and source.internal_sales_allowed
    and source.assignment_status='active'
    and source.internal_channel_status_raw='active'
    and (
      source.internal_channel_valid_from is null
      or source.internal_channel_valid_from<=now()
    )
    and (
      source.internal_channel_valid_to is null
      or source.internal_channel_valid_to>now()
    )
    and exists(
      select 1
      from public.contract_publications publication
      join public.contract_publication_versions publication_version
        on publication_version.contract_publication_id=publication.id
      where publication.assignment_id=source.assignment_id
        and publication.channel='internal'
        and publication.status='published'
        and publication_version.status='published'
        and publication_version.contract_product_version_id
          =source.contract_product_version_id
        and publication_version.content_sha256=encode(
          extensions.digest(
            publication_version.publication_snapshot::text,
            'sha256'
          ),
          'hex'
        )
        and (
          publication_version.valid_from is null
          or publication_version.valid_from<=now()
        )
        and (
          publication_version.valid_to is null
          or publication_version.valid_to>now()
        )
    )
  ) as currently_sellable
from source;

-- Website source: the same assignment/publication graph and permission model.
create or replace view public.canonical_public_contract_offers_v
with (security_invoker = true) as
select
  public_offer.id,
  public_offer.company_id,
  public_offer.price_plan_id,
  public_offer.price_plan_version_id,
  public_offer.campaign_version_id,
  public_offer.product_code,
  public_offer.public_name,
  public_offer.public_description,
  public_offer.contract_type,
  public_offer.billing_model,
  public_offer.customer_type,
  public_offer.monthly_fee_sek,
  public_offer.invoice_fee_sek,
  public_offer.markup_ore_per_kwh,
  public_offer.spot_markup_ore_per_kwh,
  public_offer.variable_fee_ore_per_kwh,
  public_offer.fixed_price_ore_per_kwh,
  public_offer.green_fee_mode,
  public_offer.green_fee_value,
  public_offer.terms_version,
  public_offer.valid_from,
  public_offer.valid_to,
  public_offer.is_public,
  public_offer.is_archived,
  public_offer.sort_order,
  public_offer.metadata,
  public_offer.created_by,
  public_offer.updated_by,
  public_offer.created_at,
  public_offer.updated_at,
  public_offer.offer_code,
  public_offer.publication_status,
  public_offer.website_enabled,
  public_offer.website_cta_enabled,
  public_offer.public_price_text,
  public_offer.terms_url,
  public_offer.binding_months,
  public_offer.notice_months,
  public_offer.spot_weight_percent,
  public_offer.portfolio_weight_percent,
  public_offer.fixed_weight_percent,
  public_offer.price_area,
  public_offer.published_at,
  public_offer.archived_at,
  public_offer.readiness_issues,
  public_offer.publication_notes,
  public_offer.legal_bundle_id,
  public_offer.price_book_id,
  public_offer.readiness_status,
  public_offer.readiness_blockers,
  public_offer.electricity_certificate_ore_per_kwh,
  public_offer.start_fee_sek,
  public_offer.administration_fee_sek,
  public_offer.break_fee_sek,
  public_offer.portfolio_management_fee_ore_per_kwh,
  public_offer.discount_value,
  public_offer.discount_unit,
  public_offer.discount_months,
  public_offer.vat_rate,
  public_offer.price_areas,
  public_offer.automatic_renewal,
  public_offer.power_of_attorney_required,
  public_offer.version_series_id,
  public_offer.version_number,
  public_offer.supersedes_offer_id,
  public_offer.contract_product_id,
  public_offer.contract_product_version_id,
  public_offer.legal_bundle_version_id,
  public_offer.contract_publication_version_id,
  publication_version.offer_reference as canonical_offer_reference,
  publication_version.locked_at as publication_locked_at,
  publication_version.content_sha256 as publication_content_sha256,
  price_plan_version.snapshot_json as canonical_pricing_snapshot,
  coalesce(public_offer.metadata,'{}'::jsonb) || jsonb_build_object(
    'canonical_offer_reference',publication_version.offer_reference,
    'publication_content_sha256',publication_version.content_sha256,
    'source_of_truth','contract_publication_versions'
  ) as canonical_metadata,
  public_offer.source_contract_offer_id,
  public_offer.lifecycle_status,
  public_offer.closed_at,
  public_offer.closed_by,
  public_offer.close_reason,
  coalesce(
    nullif(lower(public_offer.energy_direction),''),
    nullif(lower(publication_version.energy_direction),''),
    'consumption'
  ) as energy_direction,
  assignment.website_publication_allowed,
  true as website_available_now
from public.public_contract_offers public_offer
join public.contract_publication_versions publication_version
  on publication_version.id=public_offer.contract_publication_version_id
 and publication_version.status='published'
 and publication_version.locked_at is not null
join public.contract_publications publication
  on publication.id=publication_version.contract_publication_id
 and publication.channel='website'
 and publication.status='published'
join public.tenant_contract_assignments assignment
  on assignment.id=publication.assignment_id
 and assignment.company_id=public_offer.company_id
 and assignment.status='active'
 and assignment.website_publication_allowed
 and assignment.contract_product_version_id
   =publication_version.contract_product_version_id
join public.tenant_contract_channels channel
  on channel.assignment_id=assignment.id
 and channel.channel='website'
 and channel.status='active'
join public.companies company
  on company.id=assignment.company_id
 and company.status='active'
join public.price_plan_versions price_plan_version
  on price_plan_version.id=publication_version.price_plan_version_id
 and price_plan_version.locked_at is not null
where public_offer.publication_status='published'
  and public_offer.lifecycle_status='published'
  and public_offer.contract_product_version_id
    =publication_version.contract_product_version_id
  and publication_version.publication_snapshot->>'source_contract_offer_id'
    =public_offer.source_contract_offer_id::text
  and publication_version.content_sha256=encode(
    extensions.digest(publication_version.publication_snapshot::text,'sha256'),
    'hex'
  )
  and public_offer.website_enabled
  and public_offer.website_cta_enabled
  and public_offer.is_public
  and not public_offer.is_archived
  and (
    public_offer.valid_from is null
    or public_offer.valid_from<=(now() at time zone 'Europe/Stockholm')::date
  )
  and (
    public_offer.valid_to is null
    or public_offer.valid_to>=(now() at time zone 'Europe/Stockholm')::date
  )
  and (channel.valid_from is null or channel.valid_from<=now())
  and (channel.valid_to is null or channel.valid_to>now())
  and (
    publication_version.valid_from is null
    or publication_version.valid_from<=now()
  )
  and (
    publication_version.valid_to is null
    or publication_version.valid_to>now()
  );

create or replace view public.contract_publication_graph_integrity_v
with (security_invoker = true) as
select
  public_offer.company_id,
  public_offer.id as public_contract_offer_id,
  public_offer.source_contract_offer_id,
  public_offer.contract_product_version_id as public_offer_product_version_id,
  public_offer.contract_publication_version_id
    as canonical_publication_version_id,
  publication_version.id as publication_version_id,
  publication_version.contract_product_version_id
    as publication_product_version_id,
  publication_version.legacy_public_contract_offer_id,
  publication.channel,
  assignment.company_id as publication_company_id,
  (
    public_offer.contract_publication_version_id is not null
    and publication_version.id=public_offer.contract_publication_version_id
  ) as forward_publication_link_valid,
  (
    publication_version.legacy_public_contract_offer_id=public_offer.id
  ) as reverse_legacy_link_valid,
  (assignment.company_id=public_offer.company_id) as company_chain_valid,
  (
    assignment.contract_product_version_id
      =publication_version.contract_product_version_id
  ) as tenant_assignment_valid,
  (
    publication.channel='website'
    and publication_version.channel='website'
  ) as channel_valid,
  (
    publication_version.contract_product_version_id
      =public_offer.contract_product_version_id
  ) as product_version_valid,
  (
    publication_version.publication_snapshot->>'source_contract_offer_id'
      =public_offer.source_contract_offer_id::text
  ) as source_offer_consistent,
  (
    publication.status='published'
    and publication_version.status='published'
    and assignment.status='active'
    and channel.status='active'
  ) as publication_active,
  (
    public_offer.contract_publication_version_id is not null
    and publication_version.id=public_offer.contract_publication_version_id
    and publication_version.legacy_public_contract_offer_id=public_offer.id
    and assignment.company_id=public_offer.company_id
    and assignment.contract_product_version_id
      =publication_version.contract_product_version_id
    and assignment.website_publication_allowed
    and assignment.status='active'
    and publication.channel='website'
    and publication.status='published'
    and publication_version.channel='website'
    and publication_version.status='published'
    and channel.channel='website'
    and channel.status='active'
    and company.status='active'
    and (
      channel.valid_from is null
      or channel.valid_from<=now()
    )
    and (
      channel.valid_to is null
      or channel.valid_to>now()
    )
    and (
      publication_version.valid_from is null
      or publication_version.valid_from<=now()
    )
    and (
      publication_version.valid_to is null
      or publication_version.valid_to>now()
    )
    and publication_version.contract_product_version_id
      =public_offer.contract_product_version_id
    and publication_version.publication_snapshot->>'source_contract_offer_id'
      =public_offer.source_contract_offer_id::text
    and publication_version.content_sha256=encode(
      extensions.digest(publication_version.publication_snapshot::text,'sha256'),
      'hex'
    )
    and coalesce(
      nullif(lower(
        publication_version.publication_snapshot->>'energy_direction'
      ),''),
      nullif(lower(publication_version.energy_direction),''),
      'consumption'
    )=coalesce(nullif(lower(public_offer.energy_direction),''),'consumption')
    and coalesce(
      nullif(lower(publication_version.energy_direction),''),
      'consumption'
    )=coalesce(
      nullif(lower(product_version.energy_direction),''),
      'consumption'
    )
    and coalesce(
      nullif(lower(
        publication_version.publication_snapshot->>'contract_type'
      ),''),
      nullif(lower(product_version.contract_type),'')
    )=lower(public_offer.contract_type)
    and (
      select count(*)
      from public.contract_publication_versions active_version
      where active_version.contract_publication_id=publication.id
        and active_version.status='published'
    )=1
    and not exists(
      select 1
      from public.contract_offers successor
      where successor.supersedes_offer_id=public_offer.source_contract_offer_id
        and successor.lifecycle_status='published'
        and successor.is_active
    )
  ) as canonical_graph_consistent,
  (
    publication_version.content_sha256=encode(
      extensions.digest(publication_version.publication_snapshot::text,'sha256'),
      'hex'
    )
  ) as snapshot_hash_valid,
  (
    coalesce(
      nullif(lower(
        publication_version.publication_snapshot->>'energy_direction'
      ),''),
      nullif(lower(publication_version.energy_direction),''),
      'consumption'
    )=coalesce(nullif(lower(public_offer.energy_direction),''),'consumption')
    and coalesce(
      nullif(lower(publication_version.energy_direction),''),
      'consumption'
    )=coalesce(
      nullif(lower(product_version.energy_direction),''),
      'consumption'
    )
  ) as energy_direction_valid,
  (
    coalesce(
      nullif(lower(
        publication_version.publication_snapshot->>'contract_type'
      ),''),
      nullif(lower(product_version.contract_type),'')
    )=lower(public_offer.contract_type)
  ) as contract_type_valid,
  not exists(
    select 1
    from public.contract_offers successor
    where successor.supersedes_offer_id=public_offer.source_contract_offer_id
      and successor.lifecycle_status='published'
      and successor.is_active
  ) as successor_chain_valid,
  coalesce(assignment.website_publication_allowed,false)
    as channel_permission_granted,
  (
    assignment.status='active'
    and channel.status='active'
    and publication.status='published'
    and publication_version.status='published'
  ) as channel_graph_active,
  (
    (channel.valid_from is null or channel.valid_from<=now())
    and (channel.valid_to is null or channel.valid_to>now())
    and (
      publication_version.valid_from is null
      or publication_version.valid_from<=now()
    )
    and (
      publication_version.valid_to is null
      or publication_version.valid_to>now()
    )
  ) as date_window_valid,
  (
    select count(*)=1
    from public.contract_publication_versions active_version
    where active_version.contract_publication_id=publication.id
      and active_version.status='published'
  ) as single_active_publication_version
from public.public_contract_offers public_offer
left join public.contract_publication_versions publication_version
  on publication_version.id=public_offer.contract_publication_version_id
left join public.contract_publications publication
  on publication.id=publication_version.contract_publication_id
left join public.tenant_contract_assignments assignment
  on assignment.id=publication.assignment_id
left join public.tenant_contract_channels channel
  on channel.assignment_id=assignment.id
 and channel.channel=publication.channel
left join public.contract_product_versions product_version
  on product_version.id=publication_version.contract_product_version_id
left join public.companies company
  on company.id=assignment.company_id;

revoke all on function public.gridex_contract_channel_permission_allowed(
  public.tenant_contract_assignments,text
) from public,anon,authenticated;
revoke all on function public.gridex_contract_actor_can_operate_company(
  uuid,uuid
) from public,anon,authenticated;
revoke all on function public.gridex_assert_contract_channel_permission(
  uuid,uuid,text,uuid
) from public,anon,authenticated;
revoke all on function public.gridex_set_contract_channel_permission(
  uuid,uuid,text,boolean,uuid,text
) from public,anon,authenticated;
revoke all on function public.gridex_validate_contract_channel_readiness(
  uuid,uuid,text
) from public,anon;
revoke all on function public.gridex_list_external_api_contracts(uuid,text)
  from public,anon,authenticated;
grant execute on function public.gridex_set_contract_channel_permission(
  uuid,uuid,text,boolean,uuid,text
) to service_role;
grant execute on function public.gridex_validate_contract_channel_readiness(
  uuid,uuid,text
) to authenticated,service_role;
grant execute on function public.gridex_list_external_api_contracts(uuid,text)
  to service_role;

revoke all on public.canonical_internal_contract_offers_v from public,anon;
revoke all on public.canonical_public_contract_offers_v from public,anon;
revoke all on public.contract_publication_graph_integrity_v from public,anon;
grant select on public.canonical_internal_contract_offers_v
  to authenticated,service_role;
grant select on public.canonical_public_contract_offers_v
  to authenticated,service_role;
grant select on public.contract_publication_graph_integrity_v
  to authenticated,service_role;

comment on function public.gridex_set_contract_channel_permission(
  uuid,uuid,text,boolean,uuid,text
) is
  'Canonical idempotent channel grant command. Never publishes or unpublishes.';
comment on function public.gridex_validate_contract_channel_readiness(
  uuid,uuid,text
) is
  'One channel-specific readiness result shared by server and publish RPC.';
comment on view public.canonical_internal_contract_offers_v is
  'Strict canonical admin read model with explicit grants, channel state, validity and per-channel availability.';

commit;
