-- Require exact setup_package when binding a test run to an active role-scoped
-- configuration. Treating setup_package = message family (UTILTS/PRODAT) as a
-- wildcard made concurrent supplier AGT UTILTS packages ambiguous.

begin;

create or replace function public.canonical_bind_test_run_active_configuration()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_actor_role text;
  v_environment_type public.ediel_environment_type;
  v_message_family text;
  v_setup_package text;
  v_definition_count integer;
  v_definition public.ediel_test_cases%rowtype;
  v_config_count integer;
  v_config public.ediel_active_test_configurations%rowtype;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_actor public.ediel_actor_settings%rowtype;
  v_route public.ediel_route_profiles%rowtype;
begin
  if lower(coalesce(new.environment,'test')) <> 'test' then return new; end if;
  if new.company_id is null then return new; end if;

  v_actor_role := case lower(coalesce(nullif(new.actor_role,''),new.role_code))
    when 'supplier' then 'supplier'
    when 'electricity_supplier' then 'supplier'
    when 'esco' then 'energy_service_company'
    when 'energy_service_company' then 'energy_service_company'
    else null
  end;
  if v_actor_role is null then return new; end if;

  v_message_family := upper(coalesce(nullif(new.message_family,''),new.test_suite));
  v_environment_type := new.environment_type;
  v_setup_package := nullif(btrim(coalesce(new.setup_package,'')),'');
  if v_setup_package is not null
     and upper(v_setup_package) in ('PRODAT','UTILTS','AGT','TGT') then
    -- Message-family / suite tokens are not package identities.
    v_setup_package := null;
  end if;

  select count(*) into v_definition_count
  from public.ediel_test_cases tc
  where tc.is_active
    and upper(tc.test_case_code)=upper(new.test_case_code)
    and lower(tc.actor_role)=v_actor_role
    and upper(tc.message_family)=v_message_family;

  if v_definition_count=1 then
    select * into strict v_definition
    from public.ediel_test_cases tc
    where tc.is_active
      and upper(tc.test_case_code)=upper(new.test_case_code)
      and lower(tc.actor_role)=v_actor_role
      and upper(tc.message_family)=v_message_family;

    v_environment_type := case
      when upper(v_definition.suite_key) like 'AGT\_%' escape '\' then 'agt_test'::public.ediel_environment_type
      when upper(v_definition.suite_key) like 'TGT\_%' escape '\' then 'tgt_test'::public.ediel_environment_type
      else coalesce(v_environment_type,'bilateral_test'::public.ediel_environment_type)
    end;
    v_message_family := upper(v_definition.message_family);
  elsif v_definition_count>1 then
    raise exception 'canonical_test_definition_ambiguous_for_run';
  end if;

  if v_setup_package is null then
    if coalesce(new.engine_version,'')='actor-testing-evidence-v2'
       or lower(coalesce(new.status,'')) in ('running','passed') then
      raise exception 'active_role_scoped_test_configuration_setup_package_required';
    end if;
    return new;
  end if;

  select count(*) into v_config_count
  from public.ediel_active_test_configurations c
  where c.company_id=new.company_id
    and c.environment='test'
    and c.status='active'
    and c.environment_type=v_environment_type
    and upper(c.test_suite)=upper(new.test_suite)
    and lower(c.actor_role)=v_actor_role
    and upper(c.message_family)=v_message_family
    and c.setup_package=v_setup_package;

  if v_config_count=0 then
    if coalesce(new.engine_version,'')='actor-testing-evidence-v2'
       or lower(coalesce(new.status,'')) in ('running','passed') then
      raise exception 'active_role_scoped_test_configuration_required';
    end if;
    return new;
  end if;
  if v_config_count>1 then
    raise exception 'active_role_scoped_test_configuration_ambiguous';
  end if;

  select * into strict v_config
  from public.ediel_active_test_configurations c
  where c.company_id=new.company_id
    and c.environment='test'
    and c.status='active'
    and c.environment_type=v_environment_type
    and upper(c.test_suite)=upper(new.test_suite)
    and lower(c.actor_role)=v_actor_role
    and upper(c.message_family)=v_message_family
    and c.setup_package=v_setup_package;

  if v_config.actor_profile_id is null or v_config.route_profile_id is null then
    raise exception 'active_test_configuration_actor_and_route_binding_required';
  end if;

  select * into v_snapshot
  from public.ediel_configuration_snapshots
  where id=v_config.configuration_snapshot_id and company_id=new.company_id;
  if not found then raise exception 'active_test_configuration_snapshot_not_found'; end if;

  select * into v_actor
  from public.ediel_actor_settings
  where id=v_config.actor_profile_id and company_id=new.company_id;
  if not found or lower(coalesce(v_actor.environment,''))<>'test' or coalesce(v_actor.is_active,false)<>true then
    raise exception 'active_test_configuration_actor_invalid';
  end if;

  select * into v_route
  from public.ediel_route_profiles
  where id=v_config.route_profile_id and company_id=new.company_id;
  if not found or lower(coalesce(v_route.environment,''))<>'test'
     or coalesce(v_route.is_active,true)<>true or coalesce(v_route.is_enabled,true)<>true then
    raise exception 'active_test_configuration_route_invalid';
  end if;

  if upper(coalesce(v_route.sender_ediel_id,v_route.own_ediel_id,''))
     <> upper(coalesce(v_actor.actor_ediel_id,v_actor.ediel_id,'')) then
    raise exception 'active_test_configuration_route_sender_actor_mismatch';
  end if;

  new.actor_role := v_actor_role;
  new.message_family := v_message_family;
  new.environment_type := v_environment_type;
  new.setup_package := v_config.setup_package;
  new.actor_profile_id := v_config.actor_profile_id;
  new.route_profile_id := v_config.route_profile_id;
  new.configuration_snapshot_id := v_config.configuration_snapshot_id;
  new.configuration_hash := v_snapshot.configuration_hash;
  return new;
end;
$function$;

commit;
