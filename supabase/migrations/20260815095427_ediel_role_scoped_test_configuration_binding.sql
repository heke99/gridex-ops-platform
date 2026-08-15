begin;

alter table public.ediel_active_test_configurations
  add column if not exists actor_profile_id uuid references public.ediel_actor_settings(id) on delete restrict,
  add column if not exists route_profile_id uuid references public.ediel_route_profiles(id) on delete restrict,
  add column if not exists system_test_settings_id uuid references public.ediel_system_test_settings(id) on delete restrict;

create index if not exists ediel_active_test_configurations_actor_profile_idx
  on public.ediel_active_test_configurations(company_id, actor_profile_id, status);
create index if not exists ediel_active_test_configurations_route_profile_idx
  on public.ediel_active_test_configurations(company_id, route_profile_id, status);
create index if not exists ediel_active_test_configurations_settings_idx
  on public.ediel_active_test_configurations(company_id, system_test_settings_id, status);

alter table public.ediel_active_test_configurations
  drop constraint if exists ediel_active_test_configurations_active_binding_required;
alter table public.ediel_active_test_configurations
  add constraint ediel_active_test_configurations_active_binding_required
  check (
    status <> 'active'
    or (
      actor_profile_id is not null
      and route_profile_id is not null
      and configuration_snapshot_id is not null
      and environment_type is not null
    )
  ) not valid;

create or replace function public.canonical_capture_ediel_test_configuration_snapshot(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_actor_profile_id uuid,
  p_route_profile_id uuid,
  p_reason text
)
returns public.ediel_configuration_snapshots
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_company public.companies%rowtype;
  v_actor public.ediel_actor_settings%rowtype;
  v_route public.ediel_route_profiles%rowtype;
  v_payload jsonb;
  v_hash text;
  v_next_version bigint;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_existing public.ediel_configuration_snapshots%rowtype;
  v_actor_role text;
  v_actor_ediel_id text;
  v_route_sender text;
  v_route_receiver text;
begin
  if p_company_id is null or p_actor_profile_id is null or p_route_profile_id is null then
    raise exception 'company_actor_profile_and_route_required';
  end if;
  if not public.canonical_actor_is_authorized(p_company_id, p_actor_user_id, 'ediel.profile.write', false) then
    raise exception 'actor_not_authorized_for_test_configuration_snapshot';
  end if;

  select * into v_company
  from public.companies
  where id=p_company_id
  for update;
  if not found then raise exception 'tenant_not_found'; end if;

  select * into v_actor
  from public.ediel_actor_settings
  where id=p_actor_profile_id and company_id=p_company_id
  for share;
  if not found then raise exception 'tenant_scoped_test_actor_profile_not_found'; end if;
  if lower(coalesce(v_actor.environment,'')) <> 'test' or coalesce(v_actor.is_active,false) <> true then
    raise exception 'test_actor_profile_must_be_active_test_profile';
  end if;

  v_actor_role := case lower(coalesce(nullif(v_actor.actor_role,''),v_actor.role))
    when 'supplier' then 'supplier'
    when 'electricity_supplier' then 'supplier'
    when 'esco' then 'energy_service_company'
    when 'energy_service_company' then 'energy_service_company'
    else lower(coalesce(nullif(v_actor.actor_role,''),v_actor.role))
  end;
  v_actor_ediel_id := nullif(btrim(coalesce(v_actor.actor_ediel_id,v_actor.ediel_id)), '');
  if v_actor_role is null or v_actor_ediel_id is null then
    raise exception 'test_actor_profile_identity_incomplete';
  end if;

  select * into v_route
  from public.ediel_route_profiles
  where id=p_route_profile_id and company_id=p_company_id
  for share;
  if not found then raise exception 'tenant_scoped_test_route_profile_not_found'; end if;
  if lower(coalesce(v_route.environment,'')) <> 'test'
     or coalesce(v_route.is_active,true) <> true
     or coalesce(v_route.is_enabled,true) <> true then
    raise exception 'test_route_profile_must_be_active_test_route';
  end if;

  v_route_sender := nullif(btrim(coalesce(v_route.sender_ediel_id,v_route.own_ediel_id)), '');
  v_route_receiver := nullif(btrim(coalesce(v_route.receiver_ediel_id,v_route.counterparty_ediel_id)), '');
  if v_route_sender is null or upper(v_route_sender) <> upper(v_actor_ediel_id) then
    raise exception 'test_route_sender_must_match_actor_profile';
  end if;
  if v_route_receiver is null then
    raise exception 'test_route_receiver_required';
  end if;
  if v_route.actor_setting_id is not null and v_route.actor_setting_id <> v_actor.id then
    raise exception 'test_route_actor_binding_mismatch';
  end if;

  v_payload := jsonb_build_object(
    'test_context', jsonb_build_object(
      'actor_profile_id', v_actor.id,
      'route_profile_id', v_route.id,
      'actor_role', v_actor_role,
      'test_ediel_id', v_actor_ediel_id,
      'counterparty_ediel_id', v_route_receiver,
      'message_family', upper(coalesce(v_route.message_family,'')),
      'application_reference', v_route.application_reference,
      'environment_type', v_route.environment_type
    ),
    'company', jsonb_build_object(
      'id', v_company.id,
      'actor_role', v_actor_role,
      'test_ediel_id', v_actor_ediel_id,
      'production_ediel_id', v_company.production_ediel_id,
      'brp_ediel_id', coalesce(v_actor.brp_ediel_id,v_company.brp_ediel_id),
      'test_application_reference', v_route.application_reference,
      'production_application_reference', v_company.production_application_reference,
      'primary_test_route_id', v_route.id,
      'primary_production_route_id', v_company.ediel_primary_production_route_profile_id
    ),
    'actor_profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'environment',a.environment,'actor_role',coalesce(a.actor_role,a.role),
        'ediel_id',coalesce(a.actor_ediel_id,a.ediel_id),
        'sender_subaddress',coalesce(a.sender_sub_address,a.sender_subaddress),
        'receiver_subaddress',coalesce(a.receiver_sub_address,a.receiver_subaddress),
        'application_reference',coalesce(a.application_reference,a.default_application_reference),
        'mailbox',a.mailbox,'brp_ediel_id',a.brp_ediel_id,'is_active',a.is_active
      ) order by a.environment,a.id)
      from public.ediel_actor_settings a
      where a.company_id=p_company_id
    ),'[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'environment',r.environment,'route_type',r.route_type,
        'actor_setting_id',r.actor_setting_id,
        'sender_ediel_id',r.sender_ediel_id,
        'sender_subaddress',coalesce(r.sender_sub_address,r.sender_subaddress),
        'receiver_ediel_id',r.receiver_ediel_id,
        'receiver_subaddress',coalesce(r.receiver_sub_address,r.receiver_subaddress),
        'application_reference',r.application_reference,
        'message_family',r.message_family,
        'environment_type',r.environment_type,
        'mailbox_id',r.mailbox_id,'transport_profile_id',r.transport_profile_id,
        'certificate_id',r.certificate_id,'receiver_certificate_id',r.receiver_certificate_id,
        'transport_security_mode',r.transport_security_mode,
        'is_active',r.is_active,'is_enabled',r.is_enabled
      ) order by r.environment,r.id)
      from public.ediel_route_profiles r
      where r.company_id=p_company_id
    ),'[]'::jsonb),
    'mailboxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'environment',m.environment,'mailbox_name',m.mailbox_name,
        'email_address',m.email_address,'provider',m.provider,'mailbox_type',m.mailbox_type,
        'transport_mode',m.transport_mode,'tls_required',m.tls_required,
        'signing_mode',m.signing_mode,'encryption_mode',m.encryption_mode,
        'is_active',m.is_active,'is_shared_platform_mailbox',m.is_shared_platform_mailbox
      ) order by m.environment,m.id)
      from public.ediel_mailboxes m
      where m.company_id=p_company_id or m.id=v_route.mailbox_id
    ),'[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'fingerprint',coalesce(c.fingerprint_sha256,c.certificate_fingerprint),
        'owner_ediel_id',c.owner_ediel_id,'owner_subaddress',c.owner_subaddress,
        'message_family',c.message_family,'purpose',c.purpose,'usage',c.usage,
        'valid_from',coalesce(c.valid_from,c.certificate_valid_from),
        'valid_to',coalesce(c.valid_to,c.certificate_valid_to),
        'encryption_status',c.encryption_status,'status',c.status
      ) order by c.id)
      from public.ediel_certificates c
      where c.id in (v_route.certificate_id,v_route.receiver_certificate_id)
    ),'[]'::jsonb),
    'active_rule_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rule_key',rv.rule_key,'version_code',rv.version_code,'schema_version',rv.schema_version,
        'environment',rv.environment,'status',rv.status,'is_active',rv.is_active
      ) order by rv.rule_key,rv.version_code)
      from public.ediel_rule_versions rv
      where coalesce(rv.is_active,false)=true and coalesce(rv.status,'active')='active'
    ),'[]'::jsonb),
    'engine_version','canonical-evidence-v3-role-scoped'
  );

  v_hash := encode(digest(convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  select * into v_existing
  from public.ediel_configuration_snapshots
  where company_id=p_company_id and configuration_hash=v_hash;
  if found then return v_existing; end if;

  select coalesce(max(snapshot_version),0)+1 into v_next_version
  from public.ediel_configuration_snapshots
  where company_id=p_company_id;

  insert into public.ediel_configuration_snapshots(
    company_id,snapshot_version,actor_role,test_ediel_id,production_ediel_id,
    test_brp_ediel_id,production_brp_ediel_id,
    test_application_reference,production_application_reference,
    primary_test_route_id,primary_production_route_id,payload,configuration_hash,
    reason,created_by
  ) values (
    p_company_id,v_next_version,v_actor_role,v_actor_ediel_id,v_company.production_ediel_id,
    coalesce(v_actor.brp_ediel_id,v_company.brp_ediel_id),v_company.brp_ediel_id,
    v_route.application_reference,v_company.production_application_reference,
    v_route.id,v_company.ediel_primary_production_route_profile_id,
    v_payload,v_hash,coalesce(nullif(btrim(p_reason),''),'test_configuration_changed'),p_actor_user_id
  ) returning * into v_snapshot;

  update public.ediel_test_runs r
  set is_stale=true,stale_reason='role_scoped_test_configuration_changed',stale_at=now()
  where r.company_id=p_company_id
    and r.completed_at is not null
    and r.configuration_snapshot_id is distinct from v_snapshot.id
    and case lower(coalesce(nullif(r.actor_role,''),r.role_code))
      when 'supplier' then 'supplier'
      when 'electricity_supplier' then 'supplier'
      when 'esco' then 'energy_service_company'
      when 'energy_service_company' then 'energy_service_company'
      else lower(coalesce(nullif(r.actor_role,''),r.role_code))
    end = v_actor_role
    and upper(coalesce(r.message_family,r.test_suite,'')) = upper(coalesce(v_route.message_family,r.test_suite,''));

  update public.actor_test_results ar
  set is_stale=true,stale_reason='role_scoped_test_configuration_changed',updated_at=now()
  from public.ediel_test_runs r
  where ar.company_id=p_company_id
    and ar.ediel_test_run_id=r.id
    and r.company_id=p_company_id
    and r.configuration_snapshot_id is distinct from v_snapshot.id
    and case lower(coalesce(nullif(r.actor_role,''),r.role_code))
      when 'supplier' then 'supplier'
      when 'electricity_supplier' then 'supplier'
      when 'esco' then 'energy_service_company'
      when 'energy_service_company' then 'energy_service_company'
      else lower(coalesce(nullif(r.actor_role,''),r.role_code))
    end = v_actor_role
    and upper(coalesce(r.message_family,r.test_suite,'')) = upper(coalesce(v_route.message_family,r.test_suite,''));

  return v_snapshot;
end;
$function$;

revoke all on function public.canonical_capture_ediel_test_configuration_snapshot(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.canonical_capture_ediel_test_configuration_snapshot(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.canonical_bind_test_run_active_configuration()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_actor_role text;
  v_environment_type public.ediel_environment_type;
  v_message_family text;
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

  select count(*) into v_config_count
  from public.ediel_active_test_configurations c
  where c.company_id=new.company_id
    and c.environment='test'
    and c.status='active'
    and c.environment_type=v_environment_type
    and upper(c.test_suite)=upper(new.test_suite)
    and lower(c.actor_role)=v_actor_role
    and upper(c.message_family)=v_message_family
    and (
      nullif(btrim(new.setup_package),'') is null
      or upper(new.setup_package)=upper(new.test_suite)
      or c.setup_package=new.setup_package
    );

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
    and (
      nullif(btrim(new.setup_package),'') is null
      or upper(new.setup_package)=upper(new.test_suite)
      or c.setup_package=new.setup_package
    );

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

drop trigger if exists ediel_test_runs_bind_active_configuration on public.ediel_test_runs;
create trigger ediel_test_runs_bind_active_configuration
before insert or update of company_id,environment_type,actor_role,role_code,test_suite,test_case_code,message_family,setup_package,status
on public.ediel_test_runs
for each row execute function public.canonical_bind_test_run_active_configuration();

commit;
