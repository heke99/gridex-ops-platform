-- Revalidate Ediel production readiness per tenant whenever the effective
-- tenant configuration or canonical policy identity changes.
--
-- Safety contract:
--   * configuration/policy changes remain fail-closed and stale previous evidence;
--   * a new immutable configuration snapshot queues exactly one readiness job;
--   * the worker may persist readiness only; it never creates a production dry-run
--     and never transitions production back to live;
--   * global policy changes fan out only to active companies participating in Ediel;
--   * idempotency is bound to the immutable configuration_snapshot_id.

begin;

create or replace function public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns public.ediel_configuration_snapshots
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_company public.companies%rowtype;
  v_payload jsonb;
  v_hash text;
  v_next_version bigint;
  v_snapshot public.ediel_configuration_snapshots%rowtype;
  v_existing public.ediel_configuration_snapshots%rowtype;
begin
  if p_company_id is null then raise exception 'company_id_required'; end if;
  select * into v_company from public.companies where id = p_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  v_payload := jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id,
      'actor_role', coalesce(v_company.actor_role, v_company.market_role),
      'test_ediel_id', v_company.test_ediel_id,
      'production_ediel_id', v_company.production_ediel_id,
      'brp_ediel_id', v_company.brp_ediel_id,
      'test_application_reference', v_company.test_application_reference,
      'production_application_reference', v_company.production_application_reference,
      'test_sender_sub_address', v_company.test_sender_sub_address,
      'production_sender_sub_address', v_company.production_sender_sub_address,
      'test_mailbox', v_company.test_mailbox,
      'production_mailbox', v_company.production_mailbox,
      'primary_test_route_id', v_company.ediel_primary_test_route_profile_id,
      'primary_production_route_id', v_company.ediel_primary_production_route_profile_id
    ),
    'actor_profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'environment', a.environment,
        'actor_role', coalesce(a.actor_role, a.role),
        'ediel_id', coalesce(a.actor_ediel_id, a.ediel_id),
        'sender_subaddress', coalesce(a.sender_sub_address, a.sender_subaddress),
        'receiver_subaddress', coalesce(a.receiver_sub_address, a.receiver_subaddress),
        'application_reference', coalesce(a.application_reference, a.default_application_reference),
        'mailbox', a.mailbox,
        'brp_ediel_id', a.brp_ediel_id,
        'is_active', a.is_active
      ) order by a.environment, a.id)
      from public.ediel_actor_settings a
      where a.company_id = p_company_id
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'environment', r.environment,
        'route_type', r.route_type,
        'sender_ediel_id', r.sender_ediel_id,
        'sender_subaddress', coalesce(r.sender_sub_address, r.sender_subaddress),
        'receiver_ediel_id', r.receiver_ediel_id,
        'receiver_subaddress', coalesce(r.receiver_sub_address, r.receiver_subaddress),
        'mailbox_id', r.mailbox_id,
        'transport_profile_id', r.transport_profile_id,
        'certificate_id', r.certificate_id,
        'receiver_certificate_id', r.receiver_certificate_id,
        'is_active', r.is_active,
        'is_enabled', r.is_enabled
      ) order by r.environment, r.id)
      from public.ediel_route_profiles r
      where r.company_id = p_company_id
    ), '[]'::jsonb),
    'mailboxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'environment', m.environment,
        'mailbox_name', m.mailbox_name,
        'email_address', m.email_address,
        'imap_host', m.imap_host,
        'imap_port', m.imap_port,
        'provider', m.provider,
        'mailbox_type', m.mailbox_type,
        'is_active', m.is_active,
        'is_shared_platform_mailbox', m.is_shared_platform_mailbox,
        'secret_reference_present', m.secret_reference is not null
      ) order by m.environment, m.id)
      from public.ediel_mailboxes m
      where m.company_id = p_company_id
    ), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'fingerprint', c.certificate_fingerprint,
        'valid_from', c.certificate_valid_from,
        'valid_to', c.certificate_valid_to,
        'encryption_status', c.encryption_status,
        'status', c.status
      ) order by c.id)
      from public.ediel_certificates c
      where c.company_id = p_company_id
    ), '[]'::jsonb),
    'active_test_configurations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'environment', tc.environment,
        'test_suite', tc.test_suite,
        'actor_role', tc.actor_role,
        'message_family', tc.message_family,
        'setup_package', tc.setup_package,
        'status', tc.status
      ) order by tc.environment, tc.test_suite, tc.actor_role, tc.message_family, tc.setup_package)
      from public.ediel_active_test_configurations tc
      where tc.company_id = p_company_id and tc.status = 'active'
    ), '[]'::jsonb),
    'active_rule_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id,
        'rule_key', rv.rule_key,
        'version_code', rv.version_code,
        'schema_version', rv.schema_version,
        'environment', rv.environment,
        'message_family', rv.message_family,
        'message_code', rv.message_code,
        'business_process', rv.business_process,
        'source_version', rv.source_version,
        'status', rv.status,
        'is_active', rv.is_active
      ) order by rv.rule_key, rv.version_code, rv.id)
      from public.ediel_rule_versions rv
      where coalesce(rv.is_active, false) = true
        and coalesce(rv.status, 'active') = 'active'
    ), '[]'::jsonb),
    'active_rule_packs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id,
        'market', rp.market,
        'family', rp.family,
        'guide_version', rp.guide_version,
        'guide_revision', rp.guide_revision,
        'unh_association_code', rp.unh_association_code,
        'valid_from', rp.valid_from,
        'valid_to', rp.valid_to,
        'status', rp.status,
        'source_hash', rp.source_hash,
        'field_matrix_version', rp.field_matrix_version,
        'code_list_versions', rp.code_list_versions
      ) order by rp.market, rp.family, rp.guide_version, rp.guide_revision, rp.id)
      from public.ediel_rule_packs rp
      where rp.status = 'active'
    ), '[]'::jsonb),
    'enabled_message_profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mp.id,
        'rule_pack_id', mp.rule_pack_id,
        'message_code', mp.message_code,
        'transaction_subtype', mp.transaction_subtype,
        'direction', mp.direction,
        'business_process', mp.business_process,
        'phase', mp.phase,
        'profile_key', mp.profile_key,
        'profile', mp.profile,
        'is_enabled', mp.is_enabled
      ) order by mp.rule_pack_id, mp.message_code, mp.transaction_subtype, mp.direction, mp.profile_key, mp.id)
      from public.ediel_message_profiles mp
      where mp.is_enabled = true
    ), '[]'::jsonb),
    'active_tenant_rule_profile_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rpv.id,
        'rule_profile_id', rpv.rule_profile_id,
        'profile_key', rpv.profile_key,
        'version', rpv.version,
        'status', rpv.status,
        'checksum', rpv.checksum,
        'source_revision', rpv.source_revision,
        'rules', rpv.rules
      ) order by rpv.profile_key, rpv.version, rpv.id)
      from public.ediel_rule_profile_versions rpv
      where rpv.company_id = p_company_id and rpv.status = 'active'
    ), '[]'::jsonb),
    'engine_version', 'canonical-evidence-v3'
  );

  v_hash := encode(digest(convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex');
  select * into v_existing
  from public.ediel_configuration_snapshots
  where company_id = p_company_id and configuration_hash = v_hash;
  if found then return v_existing; end if;

  select coalesce(max(snapshot_version), 0) + 1 into v_next_version
  from public.ediel_configuration_snapshots
  where company_id = p_company_id;

  insert into public.ediel_configuration_snapshots(
    company_id, snapshot_version, actor_role, test_ediel_id, production_ediel_id,
    test_brp_ediel_id, production_brp_ediel_id,
    test_application_reference, production_application_reference,
    primary_test_route_id, primary_production_route_id, payload, configuration_hash,
    reason, created_by
  ) values (
    p_company_id,
    v_next_version,
    coalesce(v_company.actor_role, v_company.market_role),
    v_company.test_ediel_id,
    v_company.production_ediel_id,
    v_company.brp_ediel_id,
    v_company.brp_ediel_id,
    v_company.test_application_reference,
    v_company.production_application_reference,
    v_company.ediel_primary_test_route_profile_id,
    v_company.ediel_primary_production_route_profile_id,
    v_payload,
    v_hash,
    coalesce(nullif(btrim(p_reason), ''), 'configuration_changed'),
    p_actor_user_id
  ) returning * into v_snapshot;

  -- Exactly one durable readiness revalidation job per immutable snapshot.
  insert into public.company_provisioning_jobs(
    company_id,
    job_key,
    status,
    idempotency_key,
    available_at,
    last_error_details
  ) values (
    p_company_id,
    'ediel_readiness_revalidate',
    'pending',
    v_snapshot.id::text,
    now(),
    '{}'::jsonb
  )
  on conflict (company_id, job_key, idempotency_key) do nothing;

  update public.ediel_test_runs
  set is_stale = true,
      stale_reason = 'configuration_changed',
      stale_at = now()
  where company_id = p_company_id
    and completed_at is not null
    and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.actor_test_results
  set is_stale = true,
      stale_reason = 'configuration_changed',
      updated_at = now()
  where company_id = p_company_id
    and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.ediel_production_readiness_checks
  set is_stale = true,
      stale_reason = 'configuration_changed'
  where company_id = p_company_id
    and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.ediel_go_live_events
  set is_stale = true,
      stale_reason = 'configuration_changed'
  where company_id = p_company_id
    and event_type = 'production_dry_run'
    and configuration_snapshot_id is distinct from v_snapshot.id;

  update public.ediel_production_state
  set configuration_snapshot_id = v_snapshot.id,
      state = case when state in ('prepared', 'live') then 'blocked' else state end,
      blocked_reason = case when state in ('prepared', 'live') then 'configuration_changed' else blocked_reason end,
      state_version = state_version + 1,
      updated_at = now()
  where company_id = p_company_id;

  if exists(
    select 1 from public.ediel_production_state
    where company_id = p_company_id and state = 'blocked'
  ) then
    update public.companies
    set production_status = 'blocked',
        ediel_production_status = 'blocked',
        live_ediel_enabled = false,
        ediel_production_enabled = false,
        live_blocked_reason = 'configuration_changed',
        updated_at = now()
    where id = p_company_id;

    insert into public.ediel_send_locks(
      company_id, environment, locked, locked_reason, locked_at, updated_at
    ) values (
      p_company_id, 'production', true, 'configuration_changed', now(), now()
    )
    on conflict (company_id, environment) do update
    set locked = true,
        locked_reason = 'configuration_changed',
        locked_at = now(),
        updated_at = now();
  end if;

  return v_snapshot;
end;
$$;

-- Existing trigger function is extended to support statement-level global policy
-- invalidation in addition to the existing row-level tenant configuration path.
create or replace function public.ediel_configuration_change_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if current_setting('gridex.skip_ediel_snapshot_trigger', true) = 'on' then
    if tg_level = 'STATEMENT' then return null; end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_level = 'STATEMENT' then
    if tg_table_name not in ('ediel_rule_versions', 'ediel_rule_packs', 'ediel_message_profiles') then
      return null;
    end if;

    for v_company_id in
      select c.id
      from public.companies c
      where c.status = 'active'
        and (
          exists(select 1 from public.ediel_production_state ps where ps.company_id = c.id)
          or exists(select 1 from public.ediel_actor_settings eas where eas.company_id = c.id)
        )
      order by c.id
    loop
      perform public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
        v_company_id,
        auth.uid(),
        tg_table_name || '_changed'
      );
    end loop;
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_company_id := old.company_id;
  else
    v_company_id := new.company_id;
  end if;

  if v_company_id is not null then
    perform public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
      v_company_id,
      auth.uid(),
      tg_table_name || '_changed'
    );
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- Tenant-scoped policy versions revalidate only their tenant.
drop trigger if exists canonical_snapshot_ediel_rule_profile_versions on public.ediel_rule_profile_versions;
create trigger canonical_snapshot_ediel_rule_profile_versions
after insert or update or delete on public.ediel_rule_profile_versions
for each row execute function public.ediel_configuration_change_snapshot_trigger();

-- Global canonical policy changes fan out once per SQL statement. The snapshot hash
-- determines whether the change materially affects active policy; unchanged hashes
-- create no new snapshot and therefore no readiness job.
drop trigger if exists canonical_snapshot_ediel_rule_versions_global on public.ediel_rule_versions;
create trigger canonical_snapshot_ediel_rule_versions_global
after insert or update or delete on public.ediel_rule_versions
for each statement execute function public.ediel_configuration_change_snapshot_trigger();

drop trigger if exists canonical_snapshot_ediel_rule_packs_global on public.ediel_rule_packs;
create trigger canonical_snapshot_ediel_rule_packs_global
after insert or update or delete on public.ediel_rule_packs
for each statement execute function public.ediel_configuration_change_snapshot_trigger();

drop trigger if exists canonical_snapshot_ediel_message_profiles_global on public.ediel_message_profiles;
create trigger canonical_snapshot_ediel_message_profiles_global
after insert or update or delete on public.ediel_message_profiles
for each statement execute function public.ediel_configuration_change_snapshot_trigger();

-- Forward-converge all active Ediel tenants onto the richer policy identity. This
-- creates a new snapshot only if the effective v3 payload differs, and queues a
-- readiness revalidation job for that snapshot.
do $$
declare
  v_company_id uuid;
begin
  for v_company_id in
    select c.id
    from public.companies c
    where c.status = 'active'
      and (
        exists(select 1 from public.ediel_production_state ps where ps.company_id = c.id)
        or exists(select 1 from public.ediel_actor_settings eas where eas.company_id = c.id)
      )
    order by c.id
  loop
    perform public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
      v_company_id,
      null,
      'canonical_policy_identity_v3'
    );
  end loop;
end $$;

-- Existing snapshots that are already current but lack fresh readiness (for
-- example Gridex snapshot v13 before this migration) also receive one durable job.
insert into public.company_provisioning_jobs(
  company_id,
  job_key,
  status,
  idempotency_key,
  available_at,
  last_error_details
)
select s.company_id,
       'ediel_readiness_revalidate',
       'pending',
       s.id::text,
       now(),
       '{}'::jsonb
from public.ediel_configuration_snapshots s
join (
  select company_id, max(snapshot_version) as snapshot_version
  from public.ediel_configuration_snapshots
  group by company_id
) latest
  on latest.company_id = s.company_id
 and latest.snapshot_version = s.snapshot_version
join public.companies c on c.id = s.company_id and c.status = 'active'
where (
    exists(select 1 from public.ediel_production_state ps where ps.company_id = s.company_id)
    or exists(select 1 from public.ediel_actor_settings eas where eas.company_id = s.company_id)
  )
  and not exists (
    select 1
    from public.ediel_production_readiness_checks rc
    where rc.company_id = s.company_id
      and rc.configuration_snapshot_id = s.id
      and coalesce(rc.is_stale, false) = false
  )
on conflict (company_id, job_key, idempotency_key) do nothing;

commit;
