-- B4: computed test configuration admission, never production/certification evidence.
BEGIN;
-- AV-B4-F2: the qualified installed body is the exact f23 preimage. Refuse
-- unknown overlays in this same transaction instead of overwriting them.
DO $preimage$
begin
 if not exists(select 1 from pg_catalog.pg_proc p
  join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
  join pg_catalog.pg_language language on language.oid=p.prolang
  where p.oid='public.canonical_tenant_operation_decision(uuid,text)'::regprocedure
   and encode(pg_catalog.sha256(convert_to(p.prosrc,'UTF8')),'hex')='9ec4b938a8fa9187b5583c332fec3d947b72d8ae81ce5a0b5ec34fe84a94cec9'
   and owner_role.rolname='postgres' and language.lanname='plpgsql'
   and p.prosecdef and p.provolatile='s'
   and p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
 ) then raise exception 'b4_installed_operation_decision_preimage_mismatch'; end if;
end;
$preimage$;
CREATE SCHEMA gridex_ediel_test_capability AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gridex_ediel_test_capability FROM PUBLIC, anon, authenticated, service_role;

-- Same payload construction and preconditions as the canonical role-scoped capture.
-- Read-only: no new snapshot, activation, job or evidence is created by a decision.
CREATE FUNCTION gridex_ediel_test_capability.current_snapshot_payload_v1(
 p_company_id uuid, p_actor_profile_id uuid, p_route_profile_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, extensions, pg_temp AS $b4$
declare
  v_company public.companies%rowtype;
  v_actor public.ediel_actor_settings%rowtype;
  v_route public.ediel_route_profiles%rowtype;
  v_communication_route public.communication_routes%rowtype;
  v_payload jsonb;
  v_actor_role text;
  v_actor_ediel_id text;
  v_route_sender text;
  v_route_receiver text;
begin
  if p_company_id is null or p_actor_profile_id is null or p_route_profile_id is null then
    raise exception 'company_actor_profile_and_route_required';
  end if;


  select * into v_company
  from public.companies
  where id=p_company_id;
  if not found then raise exception 'tenant_not_found'; end if;

  select * into v_actor
  from public.ediel_actor_settings
  where id=p_actor_profile_id and company_id=p_company_id;
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
  where id=p_route_profile_id and company_id=p_company_id;
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

  select * into v_communication_route
  from public.communication_routes
  where id=v_route.communication_route_id and company_id=p_company_id;
  if not found or v_communication_route.is_active is distinct from true
     or v_communication_route.environment_type is null
     or v_communication_route.environment_type not in ('agt_test','tgt_test','bilateral_test') then
    raise exception 'test_route_communication_source_required';
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
      'environment_type', v_communication_route.environment_type
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
        'environment_type',cr.environment_type,
        'mailbox_id',r.mailbox_id,'transport_profile_id',r.transport_profile_id,
        'certificate_id',r.certificate_id,'receiver_certificate_id',r.receiver_certificate_id,
        'transport_security_mode',r.transport_security_mode,
        'is_active',r.is_active,'is_enabled',r.is_enabled
      ) order by r.environment,r.id)
      from public.ediel_route_profiles r
      left join public.communication_routes cr
        on cr.id=r.communication_route_id and cr.company_id=r.company_id
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

  return v_payload;
exception when raise_exception then return null;
end;
$b4$;

-- Poll leases/results are operational state, not configuration. Keep this exact
-- projection shared by read-side witness and the mailbox UPDATE invalidator.
CREATE FUNCTION gridex_ediel_test_capability.mailbox_configuration_v1(p_row jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT
SET search_path TO pg_catalog AS $b4$
 SELECT p_row - ARRAY['last_polled_at','last_successful_poll_at','locked_at','locked_by','last_error','updated_at']::text[];
$b4$;

-- The selected TGT's file-ready identity uses getEdielTransportReadinessSummary's
-- existing enabled/sender/receiver/mailbox criterion. It is NOT an SMTP, portal,
-- S/MIME or market-acceptance attestation; those send/start guards remain in force.
CREATE FUNCTION gridex_ediel_test_capability.witness_v1(p_company uuid,p_configuration uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, extensions, pg_temp AS $b4$
declare
 c public.ediel_active_test_configurations%rowtype;
 s public.ediel_system_test_settings%rowtype;
 a public.ediel_actor_settings%rowtype;
 r public.ediel_route_profiles%rowtype;
 cr public.communication_routes%rowtype;
 snap public.ediel_configuration_snapshots%rowtype;
 portal public.ediel_counterparties%rowtype; brp public.ediel_counterparties%rowtype;
 live_payload jsonb; fingerprint text; mailbox_json jsonb; rules_json jsonb;
begin
 select * into c from public.ediel_active_test_configurations
 where id=p_configuration and company_id=p_company and status='active'
 and environment='test' and environment_type='tgt_test';
 if not found then return null; end if;
 select * into s from public.ediel_system_test_settings where id=c.system_test_settings_id
 and company_id=p_company and is_active and environment='test' and environment_type='tgt_test'
 and route_profile_id=c.route_profile_id and sender_actor_setting_id=c.actor_profile_id
 and actor_role=(case c.actor_role when 'energy_service_company' then 'esco' when 'electricity_supplier' then 'supplier' else c.actor_role end)
 and message_family=c.message_family and setup_package=c.setup_package;
 if not found or nullif(btrim(s.setup_package),'') is null then return null; end if;
 select * into a from public.ediel_actor_settings where id=c.actor_profile_id and company_id=p_company;
 if not found then return null; end if;
 select * into r from public.ediel_route_profiles where id=c.route_profile_id and company_id=p_company;
 if not found or nullif(btrim(r.mailbox),'') is null
 or (r.valid_from is not null and r.valid_from>statement_timestamp())
 or (r.valid_to is not null and r.valid_to<=statement_timestamp())
 or r.message_family is distinct from c.message_family then return null; end if;
 select * into cr from public.communication_routes where id=r.communication_route_id and company_id=p_company;
 if not found or cr.environment_type is distinct from c.environment_type then return null; end if;
 select * into portal from public.ediel_counterparties where id=s.test_portal_counterparty_id
 and company_id=p_company and environment='test' and is_active and counterparty_role='test_portal';
 if not found or upper(coalesce(portal.counterparty_ediel_id,portal.ediel_id,''))
 <> upper(coalesce(r.receiver_ediel_id,r.counterparty_ediel_id,'')) then return null; end if;
 if s.test_brp_counterparty_id is not null then
  select * into brp from public.ediel_counterparties where id=s.test_brp_counterparty_id
   and company_id=p_company and environment='test' and is_active and counterparty_role='brp';
  if not found then return null; end if;
 end if;
 select * into snap from public.ediel_configuration_snapshots where id=c.configuration_snapshot_id and company_id=p_company;
 if not found then return null; end if;
 live_payload:=gridex_ediel_test_capability.current_snapshot_payload_v1(p_company,c.actor_profile_id,c.route_profile_id);
 -- Match the actual runtime selector's OR over both legacy/current role columns.
 if (select count(*) from public.ediel_actor_settings other where other.company_id=p_company
  and other.environment='test' and other.is_active and
  (case when c.actor_role in ('supplier','electricity_supplier') then
    other.role in ('supplier','electricity_supplier') or other.actor_role in ('supplier','electricity_supplier')
   when c.actor_role in ('esco','energy_service_company') then
    other.role in ('esco','energy_service_company') or other.actor_role in ('esco','energy_service_company')
   else false end))<>1 then return null; end if;
 if (select count(*) from public.ediel_system_test_settings other where other.company_id=p_company
  and other.is_active and other.environment='test' and other.environment_type=s.environment_type
  and other.test_suite=s.test_suite and other.actor_role=s.actor_role and other.message_family=s.message_family
  and other.setup_package=s.setup_package)<>1 then return null; end if;
 if (live_payload#>>'{test_context,actor_role}') is distinct from (case c.actor_role when 'esco' then 'energy_service_company' when 'electricity_supplier' then 'supplier' else c.actor_role end) then return null; end if;
 if live_payload is null or live_payload is distinct from snap.payload
 or snap.configuration_hash is distinct from encode(digest(convert_to(snap.payload::text,'utf8'),'sha256'),'hex') then return null; end if;
 if r.mailbox_id is not null then
  select gridex_ediel_test_capability.mailbox_configuration_v1(to_jsonb(m)) into mailbox_json
  from public.ediel_mailboxes m where m.id=r.mailbox_id and m.is_active and m.environment='test'
  and (m.company_id=p_company or (m.company_id is null and m.is_shared_platform_mailbox));
  if mailbox_json is null then return null; end if;
 end if;
 -- Time validity must be checked on read even when no writer fires a trigger.
 if exists(select 1 from public.ediel_certificates cert
   where cert.id in(r.certificate_id,r.receiver_certificate_id)
   and ((coalesce(cert.valid_from,cert.certificate_valid_from) is not null
         and coalesce(cert.valid_from,cert.certificate_valid_from)>statement_timestamp())
     or (coalesce(cert.valid_to,cert.certificate_valid_to) is not null
         and coalesce(cert.valid_to,cert.certificate_valid_to)<=statement_timestamp()))) then return null; end if;
 select jsonb_build_object(
  'packs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ediel_rule_packs t where status='active'),
  'profiles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ediel_message_profiles t where is_enabled),
  'tenantProfiles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.ediel_rule_profile_versions t where company_id=p_company and status='active')
 ) into rules_json;
 fingerprint:=encode(digest(convert_to(jsonb_build_object(
  'configuration',to_jsonb(c),'settings',to_jsonb(s),'actor',to_jsonb(a),
  'route',to_jsonb(r),'communicationRoute',to_jsonb(cr),'portal',to_jsonb(portal),
  'brp',to_jsonb(brp),'mailbox',mailbox_json,'rules',rules_json,'snapshot',snap.payload,'snapshotHash',snap.configuration_hash)::text,'utf8'),'sha256'),'hex');
 return jsonb_build_object('configurationId',c.id,'snapshotId',snap.id,'fingerprint',fingerprint,'basis','canonical_tgt_configuration_v1');
end;
$b4$;

CREATE FUNCTION public.canonical_reconcile_ediel_test_capability_v1(
 p_company_id uuid,p_actor_user_id uuid,p_configuration_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp AS $b4$
declare witness jsonb; allowed boolean;
begin
 if public.canonical_actor_is_authorized(p_company_id,p_actor_user_id,'ediel.profile.write',false) is not true then
  raise exception 'ediel_test_capability_actor_denied' using errcode='42501';
 end if;
 -- Serialize publication with invalidators. Dependencies are read, not locked:
 -- a concurrent dependency writer publishes invalidation after this lock releases.
 perform 1 from public.company_capabilities where company_id=p_company_id and capability_code='ediel_test' for update;
 if not found then raise exception 'ediel_test_capability_seed_missing'; end if;
 witness:=gridex_ediel_test_capability.witness_v1(p_company_id,p_configuration_id);
 allowed:=witness is not null;
 update public.company_capabilities set enabled=allowed,
  readiness_status=case when allowed then 'ready' else 'blocked' end,
  configuration=coalesce(witness,'{}'::jsonb),
  blockers=case when allowed then '{}'::text[] else array['current_canonical_tgt_configuration_required']::text[] end,
  last_verified_at=clock_timestamp(),last_verified_by=p_actor_user_id,updated_by=p_actor_user_id,updated_at=clock_timestamp()
 where company_id=p_company_id and capability_code='ediel_test';
 return jsonb_build_object('allowed',allowed,'companyId',p_company_id,'configurationId',p_configuration_id);
end;
$b4$;
REVOKE ALL ON FUNCTION public.canonical_reconcile_ediel_test_capability_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_reconcile_ediel_test_capability_v1(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION gridex_ediel_test_capability.invalidate_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $b4$
declare old_company uuid; new_company uuid; row_company uuid; global_change boolean;
begin
 if TG_TABLE_NAME='ediel_mailboxes' and TG_OP='UPDATE' then
  if gridex_ediel_test_capability.mailbox_configuration_v1(to_jsonb(OLD))
     is not distinct from gridex_ediel_test_capability.mailbox_configuration_v1(to_jsonb(NEW)) then
   return NEW;
  end if;
 end if;
 if TG_OP<>'INSERT' then old_company:=nullif(to_jsonb(OLD)->>'company_id','')::uuid; end if;
 if TG_OP<>'DELETE' then new_company:=nullif(to_jsonb(NEW)->>'company_id','')::uuid; end if;
 -- Null-company shared dependencies and global rule tables invalidate all.
 global_change:=(TG_OP<>'INSERT' and old_company is null) or (TG_OP<>'DELETE' and new_company is null);
 for row_company in select company_id from public.company_capabilities
  where capability_code='ediel_test' and (company_id=old_company or company_id=new_company
   or (global_change and (TG_TABLE_NAME<>'ediel_mailboxes' or exists(
     select 1 from public.ediel_active_test_configurations selected
     join public.ediel_route_profiles route on route.id=selected.route_profile_id and route.company_id=selected.company_id
     where selected.company_id=public.company_capabilities.company_id
       and selected.id::text=public.company_capabilities.configuration->>'configurationId'
       and (route.mailbox_id::text=to_jsonb(OLD)->>'id' or route.mailbox_id::text=to_jsonb(NEW)->>'id')
   ))))
  order by company_id
 loop
  update public.company_capabilities set enabled=false,readiness_status='blocked',configuration='{}'::jsonb,
   blockers=array['test_configuration_changed_requires_reconciliation']::text[],updated_at=clock_timestamp()
  where company_id=row_company and capability_code='ediel_test';
 end loop;
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end;
$b4$;

CREATE OR REPLACE FUNCTION public.canonical_tenant_operation_decision(p_company_id uuid, p_operation text) RETURNS TABLE(allowed boolean, reason_code text, company_status text, capability_status text, production_status text, state_version bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_company public.companies%rowtype;
  v_capability text;
  v_capability_row public.company_capabilities%rowtype;
  v_production_status text;
  v_base_allowed boolean := false;
  v_evidence jsonb;
  v_api_bundle_active boolean := false;
  v_capability_ready boolean := false;
  v_effective_capability_status text;
begin
  select * into v_company
  from public.companies
  where id = p_company_id;

  if not found then
    return query select false, 'tenant_not_found', null::text, 'missing'::text, null::text, 0::bigint;
    return;
  end if;

  if to_regclass('public.ediel_production_state') is not null then
    execute 'select state from public.ediel_production_state where company_id = $1'
      into v_production_status using p_company_id;
  end if;

  v_production_status := coalesce(
    v_production_status,
    v_company.ediel_production_status,
    v_company.production_status,
    'disabled'
  );

  v_capability := case p_operation
    when 'email.send' then 'email_outbound'
    when 'webhook.deliver' then 'webhooks'
    when 'ediel.production.send' then 'ediel_production'
    when 'ediel.test.process' then 'ediel_test'
    when 'customer_automation.execute' then 'customer_automation'
    when 'facility_lookup.execute' then 'facility_lookup'
    when 'contract_channel.sell' then 'website_sales'
    when 'api_client.execute' then 'api_sales'
    else null
  end;

  if v_capability is not null then
    select * into v_capability_row
    from public.company_capabilities
    where company_id = p_company_id
      and capability_code = v_capability;

    v_capability_ready :=
      coalesce(v_capability_row.enabled, false)
      and coalesce(v_capability_row.readiness_status, 'missing') = 'ready';
  end if;

  -- B4 currentness: historical/manual capability flags cannot grant test admission.
  if p_operation='ediel.test.process' and v_capability_ready then
    v_capability_ready := exists (
      select 1 from public.ediel_active_test_configurations test_configuration
      where test_configuration.company_id=p_company_id
        and v_capability_row.configuration = gridex_ediel_test_capability.witness_v1(p_company_id,test_configuration.id)
    );
  end if;

  if p_operation in (
    'api_client.execute',
    'contract_channel.sell',
    'customer_automation.execute',
    'facility_lookup.execute',
    'email.send',
    'webhook.deliver'
  ) then
    select exists (
      select 1
      from public.integration_api_clients c
      where c.company_id = p_company_id
        and c.status = 'active'
        and c.profile_key = 'tenant_website'
    ) into v_api_bundle_active;
  end if;

  v_effective_capability_status := case
    when v_capability is null then 'not_required'
    when v_capability_ready then coalesce(v_capability_row.readiness_status, 'ready')
    when v_api_bundle_active then 'api_bundle'
    else coalesce(v_capability_row.readiness_status, 'missing')
  end;

  v_base_allowed := case coalesce(v_company.status, '__unknown__')
    when 'onboarding' then p_operation in (
      'tenant.provisioning.execute',
      'ediel.test.process',
      'invitation.accept',
      'company_user.manage',
      'production.prepare',
      'production.pause'
    )
    when 'active' then p_operation in (
      'tenant.provisioning.execute',
      'email.send',
      'webhook.deliver',
      'ediel.production.send',
      'ediel.test.process',
      'customer_automation.execute',
      'facility_lookup.execute',
      'invitation.accept',
      'company_user.manage',
      'production.prepare',
      'production.activate',
      'production.pause',
      'production.resume',
      'contract_channel.sell',
      'api_client.execute'
    )
    else false
  end;

  if not v_base_allowed then
    return query select false,
      case coalesce(v_company.status, '__unknown__')
        when 'paused' then 'tenant_paused'
        when 'suspended' then 'tenant_suspended'
        when 'archived' then 'tenant_archived'
        when 'pending_deletion' then 'tenant_pending_deletion'
        when 'closed' then 'tenant_closed'
        when 'deleted_test_only' then 'tenant_deleted_test_only'
        when 'onboarding' then 'operation_not_allowed_during_onboarding'
        else 'tenant_status_unknown'
      end,
      v_company.status,
      v_effective_capability_status,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if v_capability is not null
     and not v_capability_ready
     and not v_api_bundle_active then
    return query select false,
      'capability_not_ready',
      v_company.status,
      v_effective_capability_status,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  -- Customer/contract intake is deliberately decoupled from the Ediel send
  -- lock. A tenant may accept a valid contract while a production transport
  -- change is being revalidated. The downstream Ediel send remains fail-closed
  -- and will not leave the platform until its own gate is live again.
  if p_operation = 'ediel.production.send'
     and v_production_status <> 'live' then
    return query select false,
      'ediel_production_not_live',
      v_company.status,
      v_effective_capability_status,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if p_operation = 'ediel.production.send' then
    v_evidence := public.canonical_ediel_production_evidence_readiness(p_company_id);
    if coalesce((v_evidence->>'ready')::boolean, false) is not true then
      return query select false,
        'ediel_production_evidence_not_ready',
        v_company.status,
        v_effective_capability_status,
        v_production_status,
        v_company.lifecycle_state_version;
      return;
    end if;
  end if;

  return query select true,
    case when v_api_bundle_active and not v_capability_ready then 'allowed_by_tenant_api_bundle' else 'allowed' end,
    v_company.status,
    v_effective_capability_status,
    v_production_status,
    v_company.lifecycle_state_version;
end;
$_$;
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_active_test_configurations FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_system_test_settings FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_actor_settings FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_route_profiles FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.communication_routes FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_mailboxes FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_certificates FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_counterparties FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_configuration_snapshots FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_rule_versions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_rule_packs FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_message_profiles FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
CREATE TRIGGER b4_test_capability_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.ediel_rule_profile_versions FOR EACH ROW EXECUTE FUNCTION gridex_ediel_test_capability.invalidate_v1();
ALTER FUNCTION gridex_ediel_test_capability.mailbox_configuration_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION gridex_ediel_test_capability.current_snapshot_payload_v1(uuid,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION gridex_ediel_test_capability.witness_v1(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION gridex_ediel_test_capability.invalidate_v1() OWNER TO postgres;
ALTER FUNCTION public.canonical_reconcile_ediel_test_capability_v1(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_test_capability FROM PUBLIC, anon, authenticated, service_role;
-- No existing configuration is retrospectively blessed by installation.
UPDATE public.company_capabilities SET enabled=false,readiness_status='blocked',configuration='{}'::jsonb,
 blockers=ARRAY['test_configuration_requires_computed_reconciliation']::text[],updated_at=clock_timestamp()
 WHERE capability_code='ediel_test';
COMMIT;
