-- OPS forward-only reconciliation. Created by official Supabase CLI.
-- Applies only function definitions/guards; no business RPC or grid-owner backfill is invoked.
-- Existing migration history and existing function identity/ownership/ACL are preserved.

-- OPS-only reviewed forward function correction; not yet applied.
-- Baseline body md5: 039fc7992277f59cb3ee4bf720c58840; patched body md5: fe16df3f663abb5e7fec9dad7741c862.
-- Exactly two branch-entry validation additions. Role/direct-grant/company flows,
-- platform authorization, per-user locking and successful historical replay remain.
-- No business function invocation, customer mutation, role grant or GEN is executed.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $platform_global_deny_forward$
DECLARE original_function pg_catalog.pg_proc%rowtype;
 patched_function pg_catalog.pg_proc%rowtype;
BEGIN
 SELECT * INTO STRICT original_function FROM pg_catalog.pg_proc
 WHERE oid=to_regprocedure('public.canonical_manage_platform_user_access(jsonb)');
 IF md5(original_function.prosrc)<>'039fc7992277f59cb3ee4bf720c58840' THEN
  RAISE EXCEPTION 'canonical_platform_access_source_changed_requires_review';
 END IF;
 IF pg_get_userbyid(original_function.proowner)<>'postgres'
  OR original_function.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
  RAISE EXCEPTION 'canonical_platform_access_owner_acl_changed_requires_review';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_constraint
  WHERE conrelid='public.user_permission_overrides'::regclass
   AND conname='user_permission_overrides_global_deny_only' AND convalidated
   AND pg_get_constraintdef(oid)='CHECK (((company_id IS NOT NULL) OR (effect = ''deny''::text)))') THEN
  RAISE EXCEPTION 'canonical_global_deny_only_constraint_required';
 END IF;
 IF to_regprocedure('public.canonical_actor_is_platform_admin(uuid)') IS NULL
  OR to_regprocedure('public.canonical_json_sha256(jsonb)') IS NULL
  OR to_regclass('public.canonical_platform_access_command_results') IS NULL
  OR to_regclass('public.canonical_platform_access_audit_events') IS NULL THEN
  RAISE EXCEPTION 'canonical_platform_access_formal_prerequisite_required';
 END IF;
 EXECUTE $platform_access_definition$
CREATE OR REPLACE FUNCTION public.canonical_manage_platform_user_access(p_command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_target_user_id uuid := nullif(p_command->>'target_user_id','')::uuid;
  v_action text := lower(coalesce(p_command->>'action',''));
  v_role_id uuid := nullif(p_command->>'role_id','')::uuid;
  v_user_role_id uuid := nullif(p_command->>'user_role_id','')::uuid;
  v_permission_key text := nullif(btrim(p_command->>'permission_key'),'');
  v_effect text := lower(coalesce(nullif(btrim(p_command->>'effect'),''),'allow'));
  v_reason text := nullif(btrim(p_command->>'reason'),'');
  v_preserve_overrides boolean := coalesce((p_command->>'preserve_overrides')::boolean,false);
  v_idempotency_key text := nullif(btrim(p_command->>'idempotency_key'),'');
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_platform_access_command_results%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_missing_permissions text[];
  v_overlap text[];
  v_allow text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_command->'allow_permissions','[]'::jsonb))),array[]::text[]);
  v_deny text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_command->'deny_permissions','[]'::jsonb))),array[]::text[]);
  v_existing_role_id uuid;
begin
  if v_actor_user_id is null or v_target_user_id is null or v_idempotency_key is null then
    raise exception using errcode='22023', message='actor_target_and_idempotency_required';
  end if;
  if not public.canonical_actor_is_platform_admin(v_actor_user_id) then
    raise exception using errcode='42501', message='platform_admin_required';
  end if;
  if not exists(select 1 from auth.users where id=v_target_user_id and deleted_at is null) then
    raise exception using errcode='P0002', message='target_auth_user_not_found';
  end if;
  if v_action not in (
    'set_primary_role','add_role','remove_role','replace_overrides',
    'clear_overrides','upsert_override','remove_override','disable_platform_access'
  ) then
    raise exception using errcode='22023', message='invalid_platform_access_action';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform-access:'||v_target_user_id::text,0));
  v_hash := public.canonical_json_sha256(v_request);

  select * into v_existing
  from public.canonical_platform_access_command_results
  where target_user_id=v_target_user_id
    and command_type='platform.user_access.'||v_action
    and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='23505', message='IDEMPOTENCY_KEY_REUSE_MISMATCH';
    end if;
    return v_existing.result_payload;
  end if;

  select jsonb_build_object(
    'roles',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ur.id,'role_id',ur.role_id,'role',ur.role,
        'status',ur.status,'is_active',ur.is_active
      ) order by ur.created_at,ur.id)
      from public.user_roles ur
      where ur.user_id=v_target_user_id and ur.company_id is null
    ),'[]'::jsonb),
    'overrides',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',upo.id,'permission_key',upo.permission_key,'effect',upo.effect,
        'reason',upo.reason,'is_active',upo.is_active
      ) order by upo.permission_key,upo.id)
      from public.user_permission_overrides upo
      where upo.user_id=v_target_user_id and upo.company_id is null
    ),'[]'::jsonb)
  ) into v_before;

  if v_action in ('set_primary_role','add_role') then
    if v_role_id is null or not exists(select 1 from public.roles where id=v_role_id) then
      raise exception using errcode='22023', message='platform_role_not_found';
    end if;
  end if;

  if v_action='set_primary_role' then
    update public.user_roles
    set status='disabled',is_active=false,updated_at=now()
    where user_id=v_target_user_id and company_id is null and coalesce(is_active,true);

    select id into v_existing_role_id
    from public.user_roles
    where user_id=v_target_user_id and company_id is null and role_id=v_role_id
    order by created_at asc,id asc
    limit 1
    for update;

    if v_existing_role_id is null then
      insert into public.user_roles(user_id,company_id,role_id,status,is_active,created_at,updated_at)
      values(v_target_user_id,null,v_role_id,'active',true,now(),now());
    else
      update public.user_roles
      set status='active',is_active=true,updated_at=now()
      where id=v_existing_role_id;
    end if;

    if not v_preserve_overrides then
      delete from public.user_permission_overrides
      where user_id=v_target_user_id and company_id is null;
    end if;

  elsif v_action='add_role' then
    select id into v_existing_role_id
    from public.user_roles
    where user_id=v_target_user_id and company_id is null and role_id=v_role_id
    order by created_at asc,id asc
    limit 1
    for update;
    if v_existing_role_id is null then
      insert into public.user_roles(user_id,company_id,role_id,status,is_active,created_at,updated_at)
      values(v_target_user_id,null,v_role_id,'active',true,now(),now());
    else
      update public.user_roles set status='active',is_active=true,updated_at=now()
      where id=v_existing_role_id;
    end if;

  elsif v_action='remove_role' then
    if v_user_role_id is not null then
      update public.user_roles set status='disabled',is_active=false,updated_at=now()
      where id=v_user_role_id and user_id=v_target_user_id and company_id is null;
    elsif v_role_id is not null then
      update public.user_roles set status='disabled',is_active=false,updated_at=now()
      where user_id=v_target_user_id and company_id is null and role_id=v_role_id;
    else
      raise exception using errcode='22023', message='role_identifier_required';
    end if;

  elsif v_action='replace_overrides' then
    if coalesce(array_length(v_allow,1),0)>0 then
      raise exception using errcode='22023', message='global_permission_override_deny_only';
    end if;
    select array_agg(value) into v_overlap
    from (
      select unnest(v_allow) value
      intersect
      select unnest(v_deny) value
    ) q;
    if coalesce(array_length(v_overlap,1),0)>0 then
      raise exception using errcode='23514', message='permission_allow_deny_overlap';
    end if;

    select array_agg(requested.permission_key order by requested.permission_key)
      into v_missing_permissions
    from (
      select distinct unnest(v_allow||v_deny) permission_key
    ) requested
    left join public.permissions p on p.key=requested.permission_key
    where p.id is null;
    if coalesce(array_length(v_missing_permissions,1),0)>0 then
      raise exception using errcode='22023', message='permission_not_found';
    end if;

    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null;

    insert into public.user_permission_overrides(
      company_id,user_id,permission_key,effect,reason,is_active,created_by,updated_by,created_at,updated_at
    )
    select null,v_target_user_id,permission_key,'allow',v_reason,true,v_actor_user_id,v_actor_user_id,now(),now()
    from unnest(v_allow) permission_key
    union all
    select null,v_target_user_id,permission_key,'deny',v_reason,true,v_actor_user_id,v_actor_user_id,now(),now()
    from unnest(v_deny) permission_key;

  elsif v_action='clear_overrides' then
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null;

  elsif v_action='upsert_override' then
    if v_effect is distinct from 'deny' then
      raise exception using errcode='22023', message='global_permission_override_deny_only';
    end if;
    if v_permission_key is null or v_effect not in ('allow','deny') then
      raise exception using errcode='22023', message='permission_key_and_valid_effect_required';
    end if;
    if not exists(select 1 from public.permissions where key=v_permission_key) then
      raise exception using errcode='22023', message='permission_not_found';
    end if;
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null and permission_key=v_permission_key;
    insert into public.user_permission_overrides(
      company_id,user_id,permission_key,effect,reason,is_active,created_by,updated_by,created_at,updated_at
    ) values(
      null,v_target_user_id,v_permission_key,v_effect,v_reason,true,v_actor_user_id,v_actor_user_id,now(),now()
    );

  elsif v_action='remove_override' then
    if v_permission_key is null then
      raise exception using errcode='22023', message='permission_key_required';
    end if;
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null and permission_key=v_permission_key;

  elsif v_action='disable_platform_access' then
    update public.user_roles
    set status='disabled',is_active=false,updated_at=now()
    where user_id=v_target_user_id and company_id is null and coalesce(is_active,true);
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null;
  end if;

  select jsonb_build_object(
    'roles',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ur.id,'role_id',ur.role_id,'role',ur.role,
        'status',ur.status,'is_active',ur.is_active
      ) order by ur.created_at,ur.id)
      from public.user_roles ur
      where ur.user_id=v_target_user_id and ur.company_id is null
    ),'[]'::jsonb),
    'overrides',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',upo.id,'permission_key',upo.permission_key,'effect',upo.effect,
        'reason',upo.reason,'is_active',upo.is_active
      ) order by upo.permission_key,upo.id)
      from public.user_permission_overrides upo
      where upo.user_id=v_target_user_id and upo.company_id is null
    ),'[]'::jsonb)
  ) into v_after;

  v_result := jsonb_build_object(
    'changed',v_before is distinct from v_after,
    'target_user_id',v_target_user_id,
    'action',v_action,
    'state',v_after
  );

  insert into public.canonical_platform_access_audit_events(
    target_user_id,event_type,actor_user_id,idempotency_key,reason,before_state,after_state
  ) values(
    v_target_user_id,'PLATFORM_USER_ACCESS_CHANGED',v_actor_user_id,v_idempotency_key,v_reason,v_before,v_after
  );

  insert into public.canonical_platform_access_command_results(
    target_user_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id
  ) values(
    v_target_user_id,'platform.user_access.'||v_action,v_idempotency_key,v_hash,v_request,v_result,v_actor_user_id
  );

  return v_result;
end
$function$
$platform_access_definition$;
 SELECT * INTO STRICT patched_function FROM pg_catalog.pg_proc
 WHERE oid=to_regprocedure('public.canonical_manage_platform_user_access(jsonb)');
 IF patched_function.oid<>original_function.oid
  OR patched_function.proowner<>original_function.proowner
  OR patched_function.proacl IS DISTINCT FROM original_function.proacl
  OR patched_function.proargtypes IS DISTINCT FROM original_function.proargtypes
  OR patched_function.proargnames IS DISTINCT FROM original_function.proargnames
  OR patched_function.prorettype<>original_function.prorettype
  OR patched_function.prosecdef<>original_function.prosecdef
  OR patched_function.proconfig IS DISTINCT FROM original_function.proconfig
  OR patched_function.pronargdefaults<>original_function.pronargdefaults
  OR md5(patched_function.prosrc)<>'fe16df3f663abb5e7fec9dad7741c862' THEN
  RAISE EXCEPTION 'canonical_platform_access_function_identity_preservation_required';
 END IF;
END
$platform_global_deny_forward$;
NOTIFY pgrst,'reload schema';

-- NEW unapplied OPS forward proposal; no historical migration edit or backfill execution.
-- Authority: byte-exact canonical safe-match/no-op source from
-- 20260830012000_grid_owner_backfill_unique_match_guard_v2.sql.
-- That latest source already uses eight one-backslash whitespace regex strings;
-- the actual older installed body mixes one/two backslashes and lacks its uniqueness guards.
-- Actual OPS prerequisite/ACL read: 2026-10-13T00:02:34.891942Z,
-- function OID67927, signature(text) returns jsonb, postgres owner,
-- SECURITY DEFINER, volatility v, search_path=public,
-- ACL postgres/service_role only; CREATE OR REPLACE preserves its OID/owner.
-- Native verified view has218rows and zero current duplicate grid_owner_id groups.
-- Zero current ambiguity does not guarantee future UPDATE FROM determinism.
-- This SQL replaces the callable body only; it does not call it or change grid-owner rows.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $grid_owner_backfill_prerequisites$
DECLARE v_relation text;
BEGIN
 IF to_regprocedure('public.gridex_backfill_grid_owner_verification(text)') IS NULL THEN
  RAISE EXCEPTION 'ops_grid_owner_backfill_signature_prerequisite_missing';
 END IF;
 FOREACH v_relation IN ARRAY ARRAY[
  'public.platform_grid_owners','public.platform_market_actors',
  'public.platform_actor_roles','public.platform_actor_identifiers',
  'public.platform_actor_routes','public.grid_owners',
  'public.gridex_verified_grid_owners_v','public.grid_owner_verification_reviews'
 ] LOOP
  IF to_regclass(v_relation) IS NULL THEN
   RAISE EXCEPTION 'ops_grid_owner_backfill_relation_prerequisite_missing:%',v_relation;
  END IF;
 END LOOP;
END
$grid_owner_backfill_prerequisites$;

-- Forward-only hardening of grid-owner verification backfill.
-- Prevent ambiguous verified-view fan-out and ambiguous platform↔OPS matches
-- from persisting nondeterministic links or readiness state.

CREATE OR REPLACE FUNCTION public.gridex_backfill_grid_owner_verification(p_source text DEFAULT 'manual'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_inserted_grid_owners int := 0;
  v_inserted_platform_grid_owners int := 0;
  v_updated_grid_owners int := 0;
  v_review_items int := 0;
begin
  if to_regclass('public.platform_grid_owners') is not null then
    insert into public.platform_grid_owners(name, org_number, ediel_id, communication_email, source, metadata, market_actor_id, updated_at)
    select distinct
      a.name,
      a.org_number,
      ai.ediel_id,
      nullif(coalesce(r.communication_address, ''), ''),
      'actor_registry_backfill',
      jsonb_build_object('backfill_source', p_source, 'platform_actor_id', a.id),
      a.id,
      now()
    from public.platform_market_actors a
    join public.platform_actor_roles ar on ar.actor_id = a.id and coalesce(ar.is_active, true) = true
    left join lateral (
      select max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id
      from public.platform_actor_identifiers i where i.actor_id = a.id
    ) ai on true
    left join lateral (
      select communication_address
      from public.platform_actor_routes r
      where r.actor_id = a.id and nullif(btrim(coalesce(r.communication_address,'')), '') is not null
      order by case when r.environment = 'production' then 0 else 1 end, updated_at desc nulls last
      limit 1
    ) r on true
    where lower(ar.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')
      and not exists (
        select 1 from public.platform_grid_owners pgo
        where ai.ediel_id is not null and pgo.ediel_id = ai.ediel_id
      )
      and not exists (
        select 1 from public.platform_grid_owners pgo
        where lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g'))
            = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
      );
    get diagnostics v_inserted_platform_grid_owners = row_count;
  end if;

  insert into public.grid_owners(name, owner_code, ediel_id, org_number, communication_email, email, contact_name, country, environment, lifecycle_status, platform_market_actor_id, platform_grid_owner_id, is_active, notes, verification_metadata, created_at, updated_at)
  select distinct
    a.name,
    coalesce(ai.ediel_id, regexp_replace(lower(a.name), '[^a-z0-9]+', '_', 'g')),
    ai.ediel_id,
    coalesce(ai.registry_org_number, a.org_number),
    route.communication_address,
    route.communication_address,
    null,
    'SE',
    coalesce(route.environment, 'production'),
    'active',
    a.id,
    pgo.id,
    true,
    'Importerad/synkad från platform actor registry.',
    jsonb_build_object('backfill_source', p_source, 'platform_actor_id', a.id, 'platform_grid_owner_id', pgo.id),
    now(),
    now()
  from public.platform_market_actors a
  join public.platform_actor_roles ar on ar.actor_id = a.id and coalesce(ar.is_active, true) = true
  left join lateral (
    select
      max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id,
      max(identifier_value) filter (where lower(identifier_type) in ('orgno','org_number','orgnr')) as registry_org_number
    from public.platform_actor_identifiers i where i.actor_id = a.id
  ) ai on true
  left join lateral (
    select environment, communication_address
    from public.platform_actor_routes r
    where r.actor_id = a.id
    order by case when r.environment = 'production' then 0 else 1 end, updated_at desc nulls last
    limit 1
  ) route on true
  left join public.platform_grid_owners pgo
    on pgo.market_actor_id = a.id
    or (ai.ediel_id is not null and pgo.ediel_id = ai.ediel_id)
    or lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
  where lower(ar.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')
    and not exists (select 1 from public.grid_owners g where ai.ediel_id is not null and g.ediel_id = ai.ediel_id)
    and not exists (select 1 from public.grid_owners g where a.org_number is not null and g.org_number = a.org_number)
    and not exists (
      select 1 from public.grid_owners g
      where lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'))
          = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
    );
  get diagnostics v_inserted_grid_owners = row_count;

  with unique_verified as (
    select v.*
    from public.gridex_verified_grid_owners_v v
    join (
      select grid_owner_id
      from public.gridex_verified_grid_owners_v
      group by grid_owner_id
      having count(*) = 1
    ) u on u.grid_owner_id = v.grid_owner_id
  )
  update public.grid_owners g
  set platform_market_actor_id = coalesce(g.platform_market_actor_id, uv.platform_market_actor_id),
      platform_grid_owner_id = coalesce(g.platform_grid_owner_id, uv.platform_grid_owner_id),
      ediel_id = coalesce(nullif(g.ediel_id, ''), uv.ediel_id),
      org_number = coalesce(nullif(g.org_number, ''), uv.org_number),
      updated_at = now()
  from unique_verified uv
  where uv.grid_owner_id = g.id
    and (
      g.platform_market_actor_id is distinct from coalesce(g.platform_market_actor_id, uv.platform_market_actor_id)
      or g.platform_grid_owner_id is distinct from coalesce(g.platform_grid_owner_id, uv.platform_grid_owner_id)
      or g.ediel_id is distinct from coalesce(nullif(g.ediel_id, ''), uv.ediel_id)
      or g.org_number is distinct from coalesce(nullif(g.org_number, ''), uv.org_number)
    );

  if to_regclass('public.platform_grid_owners') is not null then
    with matched as materialized (
      select pgo.id as pgo_id, g.id as grid_owner_id
      from public.platform_grid_owners pgo
      join public.grid_owners g on pgo.id = g.platform_grid_owner_id
      union
      select pgo.id, g.id
      from public.platform_grid_owners pgo
      join public.grid_owners g on g.ediel_id is not null and pgo.ediel_id = g.ediel_id
      union
      select pgo.id, g.id
      from public.platform_grid_owners pgo
      join public.grid_owners g
        on lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g'))
         = lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'))
    ),
    classified as (
      select
        m.pgo_id,
        count(distinct m.grid_owner_id)::integer as match_count,
        case when count(distinct m.grid_owner_id) = 1 then min(m.grid_owner_id::text)::uuid else null::uuid end as grid_owner_id
      from matched m
      group by m.pgo_id
    ),
    target_counts as (
      select c.grid_owner_id, count(*)::integer as target_count
      from classified c
      where c.match_count = 1 and c.grid_owner_id is not null
      group by c.grid_owner_id
    ),
    unique_matched as (
      select c.pgo_id, c.grid_owner_id
      from classified c
      join target_counts tc on tc.grid_owner_id = c.grid_owner_id
      where c.match_count = 1 and c.grid_owner_id is not null and tc.target_count = 1
    )
    update public.platform_grid_owners pgo
    set ops_grid_owner_id = g.id,
        updated_at = now(),
        metadata = coalesce(pgo.metadata, '{}'::jsonb) || jsonb_build_object('ops_grid_owner_linked_at', now())
    from unique_matched m
    join public.grid_owners g on g.id = m.grid_owner_id
    where pgo.id = m.pgo_id
      and (
        pgo.ops_grid_owner_id is distinct from g.id
        or not (coalesce(pgo.metadata, '{}'::jsonb) ? 'ops_grid_owner_linked_at')
      );
  end if;

  with unique_verified as (
    select v.*
    from public.gridex_verified_grid_owners_v v
    join (
      select grid_owner_id
      from public.gridex_verified_grid_owners_v
      group by grid_owner_id
      having count(*) = 1
    ) u on u.grid_owner_id = v.grid_owner_id
  )
  update public.grid_owners g
  set verification_status = uv.verification_status,
      verification_reasons = uv.verification_reasons,
      certificate_status = uv.certificate_status,
      certificate_environment = uv.certificate_environment,
      certificate_fingerprint_sha256 = uv.certificate_fingerprint_sha256,
      route_status = uv.route_status,
      route_count = uv.route_count,
      prodat_route_count = uv.prodat_route_count,
      utilts_route_count = uv.utilts_route_count,
      duplicate_group_key = uv.duplicate_key,
      duplicate_count = uv.duplicate_count,
      verified_for_customer_flow = uv.verified_for_customer_flow,
      actor_registry_status = uv.actor_registry_status,
      verified_at = case when uv.verified_for_customer_flow and g.verified_at is null then now() else g.verified_at end,
      verification_checked_at = now(),
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb) || jsonb_build_object(
        'last_backfill_source', p_source,
        'last_backfill_at', now(),
        'next_action', uv.next_action,
        'platform_market_actor_id', uv.platform_market_actor_id,
        'actor_roles', uv.actor_roles
      ),
      updated_at = now()
  from unique_verified uv
  where uv.grid_owner_id = g.id;
  get diagnostics v_updated_grid_owners = row_count;

  with unique_verified as (
    select v.*
    from public.gridex_verified_grid_owners_v v
    join (
      select grid_owner_id
      from public.gridex_verified_grid_owners_v
      group by grid_owner_id
      having count(*) = 1
    ) u on u.grid_owner_id = v.grid_owner_id
  )
  insert into public.grid_owner_verification_reviews(grid_owner_id, platform_market_actor_id, issue_type, severity, status, message, metadata)
  select uv.grid_owner_id, uv.platform_market_actor_id, uv.verification_status,
         case when uv.verification_status in ('unresolved_duplicate','needs_ediel_id','needs_route','needs_subaddress','needs_certificate') then 'blocking' else 'warning' end,
         'open', uv.next_action,
         jsonb_build_object('verification_reasons', uv.verification_reasons, 'certificate_status', uv.certificate_status, 'route_count', uv.route_count, 'duplicate_count', uv.duplicate_count, 'backfill_source', p_source)
  from unique_verified uv
  where uv.verification_status <> 'verified'
    and not exists (
      select 1 from public.grid_owner_verification_reviews r
      where r.grid_owner_id = uv.grid_owner_id and r.issue_type = uv.verification_status and r.status = 'open'
    );
  get diagnostics v_review_items = row_count;

  return jsonb_build_object(
    'ok', true,
    'inserted_platform_grid_owners', v_inserted_platform_grid_owners,
    'inserted_grid_owners', v_inserted_grid_owners,
    'updated_grid_owners', v_updated_grid_owners,
    'created_review_items', v_review_items
  );
end;
$function$;

revoke execute on function public.gridex_backfill_grid_owner_verification(text) from public;
revoke execute on function public.gridex_backfill_grid_owner_verification(text) from anon;
revoke execute on function public.gridex_backfill_grid_owner_verification(text) from authenticated;
grant execute on function public.gridex_backfill_grid_owner_verification(text) to service_role;

NOTIFY pgrst, 'reload schema';
