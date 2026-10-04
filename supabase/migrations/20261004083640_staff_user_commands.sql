-- S2 shared staff commands: exact permission profiles, company lock and durable audit.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Deterministic snapshot of lib/admin/accessModel.ts. Unit parity test prevents drift.
CREATE FUNCTION public.gridex_staff_role_profile_v1(p_role_key text) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $profile$
SELECT coalesce(array_agg(value ORDER BY value), ARRAY[]::text[])
FROM jsonb_array_elements_text(coalesce(('{"super_admin":["audit.read","billing_underlay.export","billing_underlay.read","cases.read","cases.write","communication.read","communication.send","contracts.read","contracts.write","customers.read","customers.write","documents.read","documents.write","integrations.read","integrations.write","masterdata.read","masterdata.write","metering.read","metering.write","metering_points.read","metering_points.write","partner_exports.read","partner_exports.write","permissions.manage","poa.read","poa.write","pricing.publish","pricing.read","pricing.write","reports.read","roles.manage","sites.read","sites.write","switching.read","switching.write","tenants.invite","tenants.read","tenants.write","users.read","users.write","whitelabel.read","whitelabel.write"],"white_label_platform_admin":["audit.read","communication.read","communication.send","reports.read","tenants.invite","tenants.read","users.read","users.write","whitelabel.read","whitelabel.write"],"company_admin":["audit.read","billing_underlay.export","billing_underlay.read","cases.read","cases.write","communication.read","communication.send","contracts.read","contracts.write","customers.read","customers.write","documents.read","documents.write","integrations.read","integrations.write","masterdata.read","masterdata.write","metering.read","metering.write","metering_points.read","metering_points.write","partner_exports.read","partner_exports.write","poa.read","poa.write","pricing.read","pricing.write","reports.read","sites.read","sites.write","switching.read","switching.write","tenants.invite","users.read","users.write"],"admin":["audit.read","billing_underlay.export","billing_underlay.read","cases.read","cases.write","communication.read","communication.send","contracts.read","contracts.write","customers.read","customers.write","documents.read","documents.write","integrations.read","integrations.write","masterdata.read","masterdata.write","metering.read","metering.write","metering_points.read","metering_points.write","partner_exports.read","partner_exports.write","poa.read","poa.write","pricing.read","pricing.write","reports.read","sites.read","sites.write","switching.read","switching.write","users.read"],"operations_manager":["audit.read","billing_underlay.export","billing_underlay.read","communication.read","communication.send","customers.read","customers.write","documents.read","documents.write","masterdata.read","masterdata.write","metering.read","metering.write","metering_points.read","metering_points.write","partner_exports.read","partner_exports.write","poa.read","poa.write","reports.read","sites.read","sites.write","switching.read","switching.write"],"operations_agent":["billing_underlay.export","billing_underlay.read","communication.read","customers.read","customers.write","documents.read","documents.write","masterdata.read","masterdata.write","metering.read","metering.write","metering_points.read","metering_points.write","partner_exports.read","partner_exports.write","poa.read","poa.write","reports.read","sites.read","sites.write","switching.read","switching.write"],"customer_service_manager":["audit.read","billing_underlay.read","cases.read","cases.write","communication.read","communication.send","contracts.read","customers.read","customers.write","documents.read","documents.write","masterdata.read","metering.read","metering_points.read","partner_exports.read","poa.read","reports.read","sites.read","switching.read","users.read"],"customer_service_agent":["billing_underlay.read","cases.read","cases.write","communication.read","contracts.read","customers.read","documents.read","documents.write","masterdata.read","metering.read","metering_points.read","poa.read","reports.read","sites.read","switching.read"],"pricing_manager":["audit.read","contracts.read","contracts.write","customers.read","pricing.read","pricing.write","reports.read"],"pricing_approver":["audit.read","contracts.read","pricing.publish","pricing.read","reports.read"],"compliance_manager":["audit.read","billing_underlay.read","cases.read","communication.read","contracts.read","customers.read","documents.read","masterdata.read","metering.read","metering_points.read","partner_exports.read","poa.read","pricing.read","reports.read","sites.read","switching.read","users.read"],"sales_manager":["cases.read","cases.write","communication.read","communication.send","contracts.read","customers.read","customers.write","documents.read","documents.write","poa.read","reports.read","users.read"],"partner_manager":["audit.read","billing_underlay.read","communication.read","customers.read","documents.read","integrations.read","integrations.write","masterdata.read","metering.read","partner_exports.read","partner_exports.write","reports.read","sites.read","switching.read"],"finance_readonly":["audit.read","billing_underlay.read","contracts.read","customers.read","partner_exports.read","pricing.read","reports.read"],"executive_readonly":["audit.read","billing_underlay.read","communication.read","contracts.read","customers.read","metering.read","partner_exports.read","pricing.read","reports.read","switching.read","users.read"],"partner_api_user":["partner_exports.read"]}'::jsonb)->p_role_key, '[]'::jsonb)) AS value;
$profile$;
REVOKE ALL ON FUNCTION public.gridex_staff_role_profile_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_role_profile_v1(text) TO service_role;

CREATE FUNCTION public.gridex_staff_normalize_role_v1(p_role_key text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $normalize$
WITH normalized AS (SELECT nullif(trim(both '_' from regexp_replace(translate(lower(btrim(p_role_key)),'åäö','aao'),'[^a-z0-9]+','_','g')),'') AS role_key)
SELECT coalesce(('{"superadmin":"super_admin","super_admin":"super_admin","platform_superadmin":"super_admin","platformsuperadmin":"super_admin","platformadmin":"platform_admin","platform_admin":"platform_admin","companyadmin":"company_admin","company_admin":"company_admin","company_owner":"company_admin","tenant_admin":"company_admin","bolagsansvarig":"company_admin","compliance_officer":"compliance_manager","kundservice":"customer_service_agent","customer_service":"customer_service_agent","support":"customer_service_agent","ekonomi":"finance_readonly","finance":"finance_readonly","finance_readonly":"finance_readonly"}'::jsonb)->>role_key,role_key) FROM normalized;
$normalize$;
REVOKE ALL ON FUNCTION public.gridex_staff_normalize_role_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_normalize_role_v1(text) TO service_role;

CREATE FUNCTION public.gridex_staff_actor_permissions_v1(p_company_id uuid, p_actor_user_id uuid, p_allow_platform boolean DEFAULT false)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $permissions$
DECLARE
  v_role_key text;
  v_permissions text[];
BEGIN
  IF p_allow_platform AND public.canonical_actor_is_platform_admin(p_actor_user_id) THEN
    RETURN public.gridex_staff_role_profile_v1('super_admin');
  END IF;
  SELECT public.gridex_staff_normalize_role_v1(cm.role_key) INTO v_role_key
  FROM public.company_memberships cm
  JOIN public.user_profiles profile ON profile.id=cm.user_id AND profile.user_status='active'
  JOIN auth.users auth_user ON auth_user.id=cm.user_id
  WHERE cm.company_id=p_company_id AND cm.user_id=p_actor_user_id
    AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until<=now());
  IF v_role_key IS NULL OR v_role_key IN ('super_admin','platform_admin','white_label_platform_admin','customer') THEN
    RETURN ARRAY[]::text[];
  END IF;
  v_permissions := public.gridex_staff_role_profile_v1(v_role_key);
  IF cardinality(v_permissions)=0 THEN RETURN ARRAY[]::text[]; END IF;
  SELECT coalesce(array_agg(DISTINCT granted.permission ORDER BY granted.permission),ARRAY[]::text[])
  INTO v_permissions
  FROM (
    SELECT unnest(v_permissions) AS permission
    UNION
    SELECT coalesce(nullif(up.permission_key,''),catalog.key,catalog.name)
    FROM public.user_permissions up
    LEFT JOIN public.permissions catalog ON catalog.id=up.permission_id AND catalog.is_active
    WHERE up.company_id=p_company_id AND up.user_id=p_actor_user_id
      AND up.status='active' AND up.is_active AND up.effect='allow'
  ) granted
  WHERE granted.permission IS NOT NULL
    AND NOT EXISTS (
      SELECT FROM public.user_permissions up
      LEFT JOIN public.permissions catalog ON catalog.id=up.permission_id AND catalog.is_active
      WHERE up.company_id=p_company_id AND up.user_id=p_actor_user_id
        AND up.status='active' AND up.is_active AND up.effect='deny'
        AND coalesce(nullif(up.permission_key,''),catalog.key,catalog.name)=granted.permission
    );
  RETURN v_permissions;
END;
$permissions$;
REVOKE ALL ON FUNCTION public.gridex_staff_actor_permissions_v1(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_staff_actor_permissions_v1(uuid,uuid,boolean) TO service_role;

CREATE FUNCTION public.gridex_assert_staff_command_v1(p_command jsonb, p_replay boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_client_id uuid := nullif(p_command->>'api_client_id','')::uuid;
  v_channel text := p_command->>'channel';
  v_operation text := p_command->>'staff_operation';
  v_role_key text := p_command->>'role_key';
  v_permissions text[];
  v_membership public.company_memberships%rowtype;
  v_company_status text;
  v_target_user_id uuid := nullif(p_command->>'user_id','')::uuid;
BEGIN
  IF v_company_id IS NULL OR v_actor_user_id IS NULL OR v_channel IS NULL OR v_channel NOT IN ('ops','staff_api') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied';
  END IF;
  SELECT status INTO v_company_status FROM public.companies WHERE id=v_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied'; END IF;
  IF v_company_status NOT IN ('active','onboarding') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_company_not_operational';
  END IF;
  v_permissions := public.gridex_staff_actor_permissions_v1(v_company_id,v_actor_user_id,v_channel='ops');
  IF NOT ('users.write'=ANY(v_permissions)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied';
  END IF;
  IF v_channel='staff_api' AND NOT EXISTS (
    SELECT FROM public.integration_api_clients client
    WHERE client.id=v_client_id AND client.company_id=v_company_id AND client.status='active'
      AND 'staff_users.write'=ANY(client.scopes)
  ) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_permission_denied'; END IF;
  IF p_replay THEN RETURN; END IF;
  IF v_operation='invite' THEN
    NULL;
  ELSIF v_operation IN ('change_role','disable','enable') THEN
    SELECT * INTO v_membership FROM public.company_memberships
    WHERE company_id=v_company_id AND user_id=v_target_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='staff_user_not_found'; END IF;
    IF v_operation='enable' THEN
      IF v_membership.status<>'disabled' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_invalid_user_state'; END IF;
      v_role_key := v_membership.role_key;
    ELSIF v_membership.status<>'active' OR NOT v_membership.is_active THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_invalid_user_state';
    END IF;
    IF v_operation='disable' AND v_target_user_id=v_actor_user_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_self_disable_forbidden';
    END IF;
    IF v_operation='change_role' AND v_target_user_id=v_actor_user_id
       AND NOT (v_channel='ops' AND public.canonical_actor_is_platform_admin(v_actor_user_id)) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_self_role_change_forbidden';
    END IF;
    IF v_membership.status='active' AND v_membership.is_active
       AND v_membership.membership_role IN ('owner','admin','company_admin')
       AND (v_operation='disable' OR (v_operation='change_role' AND v_role_key NOT IN ('company_admin','admin')))
       AND NOT EXISTS (SELECT FROM public.company_memberships other
         WHERE other.company_id=v_company_id AND other.user_id<>v_target_user_id
           AND other.status='active' AND other.is_active
           AND other.membership_role IN ('owner','admin','company_admin')) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='staff_last_admin_required';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='staff_invalid_operation';
  END IF;
  IF v_operation<>'disable' THEN
    IF v_role_key IS NULL OR NOT EXISTS (
      SELECT FROM public.canonical_tenant_access_role_mapping mapping
      WHERE mapping.role_key=v_role_key AND mapping.is_assignable AND mapping.role_key<>'owner'
    ) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='staff_role_not_assignable'; END IF;
    IF NOT (public.gridex_staff_role_profile_v1(v_role_key)<@v_permissions) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_role_ceiling_exceeded';
    END IF;
  END IF;
END;
$guard$;
REVOKE ALL ON FUNCTION public.gridex_assert_staff_command_v1(jsonb,boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.canonical_change_tenant_user_access_v1_unchecked(p_command jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_temp'
    AS $$
declare
  v_company_id uuid:=(p_command->>'company_id')::uuid;
  v_user_id uuid:=(p_command->>'user_id')::uuid;
  v_actor_user_id uuid:=nullif(p_command->>'actor_user_id','')::uuid;
  v_action text:=lower(p_command->>'action');
  v_membership_role text:=lower(coalesce(nullif(p_command->>'membership_role',''),'member'));
  v_role_key text:=lower(coalesce(nullif(p_command->>'role_key',''),v_membership_role));
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_company_status text;
  v_current_role text;
  v_current_status text;
  v_actor_membership_role text;
  v_actor_is_platform_admin boolean:=false;
  v_owner_count integer;
  v_admin_count integer;
  v_target_auth_active boolean:=false;
  v_target_profile_active boolean:=false;
  v_existing jsonb;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_company_id is null or v_user_id is null or v_actor_user_id is null
     or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'company_user_actor_and_idempotency_required';
  end if;
  if v_action not in ('upsert','remove','disable') then raise exception 'invalid_access_action'; end if;
  if v_membership_role not in ('owner','admin','company_admin','operations','support','member','viewer') then raise exception 'invalid_membership_role'; end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='tenant.user_access.change' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  select status into v_company_status from public.companies where id=v_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  if v_company_status not in ('onboarding','active','paused') then
    raise exception 'tenant_state_blocks_user_management:%',coalesce(v_company_status,'unknown');
  end if;

  v_actor_is_platform_admin:=public.canonical_actor_is_platform_admin(v_actor_user_id);
  if not v_actor_is_platform_admin then
    select membership_role into v_actor_membership_role
    from public.company_memberships
    where company_id=v_company_id and user_id=v_actor_user_id
      and status='active' and coalesce(is_active,true)
    for update;
    if p_command ? 'staff_operation' then
      if not ('users.write'=any(public.gridex_staff_actor_permissions_v1(v_company_id,v_actor_user_id,false))) then
        raise exception 'staff_permission_denied';
      end if;
    elsif v_actor_membership_role not in ('owner','admin','company_admin') then
      raise exception 'actor_not_authorized_for_tenant_user_management';
    end if;
  end if;

  select membership_role,status into v_current_role,v_current_status
  from public.company_memberships
  where company_id=v_company_id and user_id=v_user_id
  for update;

  select count(*) into v_owner_count from public.company_memberships
  where company_id=v_company_id and status='active' and coalesce(is_active,true) and membership_role='owner';
  select count(*) into v_admin_count from public.company_memberships
  where company_id=v_company_id and status='active' and coalesce(is_active,true)
    and membership_role in ('owner','admin','company_admin');

  if v_current_status='active' and v_current_role='owner' and v_owner_count<=1
     and (v_action<>'upsert' or v_membership_role<>'owner') then
    raise exception 'last_active_owner_cannot_be_removed_or_downgraded';
  end if;
  if v_current_status='active' and v_current_role in ('owner','admin','company_admin') and v_admin_count<=1
     and (v_action<>'upsert' or v_membership_role not in ('owner','admin','company_admin')) then
    raise exception 'last_active_admin_cannot_be_removed_or_downgraded';
  end if;
  if not v_actor_is_platform_admin and v_membership_role='owner' and v_actor_membership_role<>'owner' then
    raise exception 'only_owner_or_platform_admin_can_assign_owner';
  end if;
  if not v_actor_is_platform_admin and v_current_role='owner' and v_actor_membership_role<>'owner' then
    raise exception 'only_owner_or_platform_admin_can_modify_owner';
  end if;

  if v_action='upsert' then
    select exists(select 1 from auth.users u where u.id=v_user_id and coalesce(u.banned_until,now()-interval '1 second')<=now())
      into v_target_auth_active;
    select exists(select 1 from public.user_profiles up where up.id=v_user_id and up.user_status='active')
      into v_target_profile_active;
    if not v_target_auth_active then raise exception 'target_auth_user_missing_or_inactive'; end if;
    if not v_target_profile_active then raise exception 'target_user_profile_missing_or_inactive'; end if;

    insert into public.company_memberships(
      company_id,user_id,membership_role,role_key,status,is_active,invited_by,accepted_at,
      suspended_at,disabled_at,removed_at,metadata
    ) values (
      v_company_id,v_user_id,v_membership_role,v_role_key,'active',true,v_actor_user_id,now(),
      null,null,null,jsonb_build_object('canonical_access_command',v_idempotency_key)
    )
    on conflict(company_id,user_id) do update set
      membership_role=excluded.membership_role,role_key=excluded.role_key,status='active',is_active=true,
      accepted_at=coalesce(public.company_memberships.accepted_at,now()),
      suspended_at=null,disabled_at=null,removed_at=null,
      metadata=coalesce(public.company_memberships.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now();

    update public.user_roles set status='disabled',is_active=false,updated_at=now()
    where company_id=v_company_id and user_id=v_user_id and is_active=true;
    insert into public.user_roles(user_id,company_id,role,status,is_active,created_at,updated_at)
    values(v_user_id,v_company_id,v_role_key,'active',true,now(),now());
  else
    update public.company_memberships
      set status=case when v_action='remove' then 'removed' else 'disabled' end,
          is_active=false,
          disabled_at=case when v_action='disable' then now() else disabled_at end,
          removed_at=case when v_action='remove' then now() else removed_at end,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('canonical_access_command',v_idempotency_key),
          updated_at=now()
      where company_id=v_company_id and user_id=v_user_id;
    update public.user_roles set status='disabled',is_active=false,updated_at=now()
      where company_id=v_company_id and user_id=v_user_id and is_active=true;
  end if;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,before_state,after_state
  ) values (
    v_company_id,'TENANT_USER_ROLE_CHANGED','tenant_user',v_user_id,v_actor_user_id,
    p_command->>'reason',v_idempotency_key,
    jsonb_build_object('membership_role',v_current_role,'status',v_current_status),
    jsonb_build_object('action',v_action,'membership_role',v_membership_role,'role_key',v_role_key)
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'TENANT_USER_ROLE_CHANGED','tenant_user',v_user_id,v_idempotency_key,
    jsonb_build_object('action',v_action,'membership_role',v_membership_role,'role_key',v_role_key),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'tenant.user.role.changed',v_idempotency_key,
    jsonb_build_object('company_id',v_company_id,'user_id',v_user_id,'action',v_action));

  v_result:=jsonb_build_object('changed',true,'company_id',v_company_id,'user_id',v_user_id,
    'action',v_action,'membership_role',v_membership_role,'role_key',v_role_key);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company_id,'tenant.user_access.change',v_idempotency_key,p_command,v_result,v_actor_user_id);
  return v_result;
end;
$$;

-- Only unambiguous active company-bound role assignments repair legacy null keys.
WITH unique_roles AS (
  SELECT ur.company_id,ur.user_id,min(mapping.role_key) AS role_key
  FROM public.user_roles ur
  LEFT JOIN public.roles role ON role.id=ur.role_id
  JOIN public.canonical_tenant_access_role_mapping mapping
    ON mapping.role_key=lower(coalesce(nullif(ur.role,''),role.key,role.name))
   AND mapping.is_assignable AND mapping.role_key<>'owner'
  WHERE ur.company_id IS NOT NULL AND ur.status='active' AND ur.is_active
  GROUP BY ur.company_id,ur.user_id HAVING count(*)=1
)
UPDATE public.company_memberships membership SET role_key=unique_roles.role_key,updated_at=now()
FROM unique_roles
WHERE membership.company_id=unique_roles.company_id AND membership.user_id=unique_roles.user_id
  AND membership.status='active' AND membership.is_active AND membership.role_key IS NULL;

CREATE OR REPLACE FUNCTION public.canonical_change_tenant_user_access_v2_unmapped(p_command jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_company_id uuid := nullif(p_command->>'company_id', '')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id', '')::uuid;
  v_idempotency_key text := p_command->>'idempotency_key';
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
begin
  if p_command ? 'staff_operation' then
    if not ('users.write'=any(public.gridex_staff_actor_permissions_v1(v_company_id,v_actor_user_id,p_command->>'channel'='ops'))) then
      raise exception 'staff_permission_denied';
    end if;
  elsif not public.canonical_actor_is_authorized(v_company_id, v_actor_user_id, 'tenant.user.manage', false) then
    raise exception 'actor_not_authorized_for_tenant_user_management';
  end if;
  if nullif(btrim(v_idempotency_key), '') is null then raise exception 'idempotency_key_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':tenant.user_access.change:' || v_idempotency_key, 0));
  v_hash := public.canonical_json_sha256(v_request);
  select * into v_existing from public.canonical_command_results
  where company_id = v_company_id and command_type = 'tenant.user_access.change'
    and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.actor_user_id is distinct from v_actor_user_id then raise exception 'idempotency_actor_mismatch'; end if;
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key_payload_mismatch'; end if;
    return v_existing.result_payload;
  end if;
  v_result := public.canonical_change_tenant_user_access_v1_unchecked(p_command);
  update public.canonical_command_results set request_payload = v_request, request_hash = v_hash
  where company_id = v_company_id and command_type = 'tenant.user_access.change'
    and idempotency_key = v_idempotency_key;
  return v_result;
end;
$$;

ALTER FUNCTION public.canonical_change_tenant_user_access(jsonb) RENAME TO canonical_change_tenant_user_access_pre_staff_v1;
REVOKE ALL ON FUNCTION public.canonical_change_tenant_user_access_pre_staff_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.canonical_change_tenant_user_access(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $access$
DECLARE
  v_command jsonb := p_command;
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_user_id uuid := nullif(p_command->>'user_id','')::uuid;
  v_actor_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_operation text := p_command->>'staff_operation';
  v_key text := p_command->>'idempotency_key';
  v_existing public.canonical_command_results%rowtype;
  v_member public.company_memberships%rowtype;
  v_result jsonb;
BEGIN
  IF v_operation IS NULL THEN RETURN public.canonical_change_tenant_user_access_pre_staff_v1(p_command); END IF;
  IF nullif(btrim(v_key),'') IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text||':tenant.user_access.change:'||v_key,0));
  PERFORM 1 FROM public.companies WHERE id=v_company_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.canonical_command_results
  WHERE company_id=v_company_id AND command_type='tenant.user_access.change' AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM v_actor_id THEN RAISE EXCEPTION 'idempotency_actor_mismatch'; END IF;
    -- Staff request stays unmodified in the outer cache (enable resolves role only inside the transaction).
    IF v_existing.request_hash IS DISTINCT FROM public.canonical_json_sha256(p_command-'actor_user_id') THEN
      RAISE EXCEPTION 'idempotency_key_payload_mismatch';
    END IF;
    PERFORM public.gridex_assert_staff_command_v1(p_command,true);
    RETURN v_existing.result_payload;
  END IF;
  PERFORM public.gridex_assert_staff_command_v1(v_command);
  SELECT * INTO v_member FROM public.company_memberships WHERE company_id=v_company_id AND user_id=v_user_id;
  IF v_operation IN ('enable','disable') THEN
    v_command := v_command || jsonb_build_object('role_key',v_member.role_key,'membership_role',v_member.membership_role);
  END IF;
  v_result := public.canonical_change_tenant_user_access_pre_staff_v1(v_command);
  UPDATE public.company_memberships SET role_key=v_command->>'role_key',
    disabled_by=CASE WHEN v_operation='disable' THEN v_actor_id ELSE NULL END,
    status_reason=CASE WHEN v_operation='disable' THEN v_command->>'reason' ELSE NULL END
  WHERE company_id=v_company_id AND user_id=v_user_id;
  SELECT * INTO v_member FROM public.company_memberships WHERE company_id=v_company_id AND user_id=v_user_id;
  v_result := jsonb_build_object('user_id',v_user_id,'role_key',v_member.role_key,'membership_role',v_member.membership_role,'status',v_member.status);
  UPDATE public.canonical_command_results
  SET request_payload=p_command-'actor_user_id', request_hash=public.canonical_json_sha256(p_command-'actor_user_id'), result_payload=v_result
  WHERE company_id=v_company_id AND command_type='tenant.user_access.change' AND idempotency_key=v_key;
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,new_values,metadata,
    actor_type,request_id,correlation_id,resource_type,resource_id)
  VALUES(v_company_id,v_actor_id,'user',v_user_id::text,'STAFF_'||upper(v_operation),v_result,
    jsonb_build_object('channel',p_command->>'channel','api_client_id',p_command->>'api_client_id'),
    'user',v_key,v_key,'staff',v_user_id::text);
  IF v_operation='disable' THEN
    UPDATE public.company_invitations SET status='invitation_revoked',revoked_at=now()
    WHERE company_id=v_company_id AND invited_user_id=v_user_id
      AND status IN ('pending','sending','sent','delivery_uncertain');
  END IF;
  RETURN v_result;
END;
$access$;
REVOKE ALL ON FUNCTION public.canonical_change_tenant_user_access(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_change_tenant_user_access(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.canonical_create_tenant_invitation(p_command jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $$
declare
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_email text := lower(btrim(p_command->>'email'));
  v_idempotency_key text := btrim(p_command->>'idempotency_key');
  v_token uuid;
  v_invitation_id uuid;
  v_existing jsonb;
  v_event_id uuid;
  v_result jsonb;
begin
  if v_company_id is null or nullif(v_email,'') is null or nullif(v_idempotency_key,'') is null then
    raise exception 'company_email_and_idempotency_key_required';
  end if;
  if p_command ? 'staff_operation' then
    if not ('users.write'=any(public.gridex_staff_actor_permissions_v1(v_company_id,v_actor_user_id,p_command->>'channel'='ops'))) then
      raise exception 'staff_permission_denied';
    end if;
  elsif not (
    public.canonical_actor_is_authorized(v_company_id,v_actor_user_id,'tenants.invite',false)
    or public.canonical_actor_is_authorized(v_company_id,v_actor_user_id,'users.write',false)
  ) then
    raise exception using errcode='42501', message='actor_not_authorized_for_tenant_invitation';
  end if;

  select result_payload into v_existing
  from public.canonical_command_results
  where company_id=v_company_id
    and command_type='tenant.invitation.create'
    and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  v_token := gen_random_uuid();
  insert into public.company_invitations(
    company_id,email,full_name,membership_role,role_key,status,token,
    invited_by,expires_at,accept_token_hash,idempotency_key,metadata
  ) values (
    v_company_id,v_email,nullif(btrim(p_command->>'full_name'),''),
    coalesce(nullif(lower(btrim(p_command->>'membership_role')),''),'member'),
    coalesce(nullif(lower(btrim(p_command->>'role_key')),''),'member'),
    'pending',v_token,v_actor_user_id,now()+interval '14 days',
    encode(digest(v_token::text,'sha256'),'hex'),v_idempotency_key,
    jsonb_build_object(
      'invite_source',coalesce(nullif(p_command->>'source',''),'canonical_invitation'),
      'access_source','verified_auth_invitation_link',
      'provider_delivery_status','pending'
    )
  )
  returning id into v_invitation_id;

  insert into public.company_provisioning_jobs(company_id,job_key,idempotency_key)
  values(v_company_id,'auth_invite',v_idempotency_key)
  on conflict(company_id,job_key,idempotency_key) do nothing;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,
    idempotency_key,after_state
  ) values (
    v_company_id,'TENANT_INVITATION_CREATED','company_invitation',v_invitation_id,
    v_actor_user_id,'Durable invitation intent created before provider delivery.',
    v_idempotency_key,jsonb_build_object('status','pending','role_key',p_command->>'role_key')
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'TENANT_INVITATION_CREATED','company_invitation',v_invitation_id,
    v_idempotency_key,jsonb_build_object('invitation_id',v_invitation_id,'status','pending'),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'tenant.invitation.created',v_idempotency_key,
    jsonb_build_object('invitation_id',v_invitation_id));

  v_result := jsonb_build_object(
    'invitation_id',v_invitation_id,
    'company_id',v_company_id,
    'token',v_token,
    'status','pending'
  );
  insert into public.canonical_command_results(
    company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id
  ) values (
    v_company_id,'tenant.invitation.create',v_idempotency_key,
    p_command - 'email',v_result,v_actor_user_id
  );
  return v_result;
end
$$;

ALTER FUNCTION public.canonical_create_tenant_invitation(jsonb) RENAME TO canonical_create_tenant_invitation_pre_staff_v1;
REVOKE ALL ON FUNCTION public.canonical_create_tenant_invitation_pre_staff_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.canonical_create_tenant_invitation(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $invitation$
DECLARE
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_actor_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_key text := p_command->>'idempotency_key';
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
BEGIN
  IF NOT (p_command ? 'staff_operation') THEN RETURN public.canonical_create_tenant_invitation_pre_staff_v1(p_command); END IF;
  IF p_command->>'staff_operation'<>'invite' THEN RAISE EXCEPTION 'staff_invalid_operation'; END IF;
  IF nullif(btrim(v_key),'') IS NULL THEN RAISE EXCEPTION 'idempotency_key_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_company_id::text||':tenant.invitation.create:'||v_key,0));
  PERFORM 1 FROM public.companies WHERE id=v_company_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.canonical_command_results
  WHERE company_id=v_company_id AND command_type='tenant.invitation.create' AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM v_actor_id THEN RAISE EXCEPTION 'idempotency_actor_mismatch'; END IF;
    IF v_existing.request_hash IS DISTINCT FROM public.canonical_json_sha256(p_command-'actor_user_id') THEN RAISE EXCEPTION 'idempotency_key_payload_mismatch'; END IF;
    PERFORM public.gridex_assert_staff_command_v1(p_command,true);
    RETURN v_existing.result_payload;
  END IF;
  PERFORM public.gridex_assert_staff_command_v1(p_command);
  v_result := public.canonical_create_tenant_invitation_pre_staff_v1(p_command);
  UPDATE public.canonical_command_results SET request_payload=p_command-'actor_user_id',request_hash=public.canonical_json_sha256(p_command-'actor_user_id')
  WHERE company_id=v_company_id AND command_type='tenant.invitation.create' AND idempotency_key=v_key;
  INSERT INTO public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,new_values,metadata,
    actor_type,request_id,correlation_id,resource_type,resource_id)
  VALUES(v_company_id,v_actor_id,'company_invitation',v_result->>'invitation_id','STAFF_INVITED',
    jsonb_build_object('status','pending','role_key',p_command->>'role_key'),
    jsonb_build_object('channel',p_command->>'channel','api_client_id',p_command->>'api_client_id'),
    'user',v_key,v_key,'staff_invitation',v_result->>'invitation_id');
  RETURN v_result;
END;
$invitation$;
REVOKE ALL ON FUNCTION public.canonical_create_tenant_invitation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_create_tenant_invitation(jsonb) TO service_role;
COMMIT;
