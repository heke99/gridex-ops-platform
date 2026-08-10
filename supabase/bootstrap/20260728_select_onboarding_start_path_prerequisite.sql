-- Replay-only prerequisite for 20260728170000_live_schema_code_canonical_sync.sql.
-- The historical live database already contained select_onboarding_start_path(uuid,text),
-- while the repository history did not. Recreate that exact semantic routine with the
-- pre-repair tenant guard so the checksum-pinned live repair can replay deterministically.

create or replace function public.select_onboarding_start_path(
  p_company_id uuid,
  p_preferred_module text default null
)
returns table(
  next_step text,
  recommended_module text,
  session_id uuid,
  profile_summary jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions', 'private'
as $function$
declare
  v_status text;
  v_profile_complete boolean := false;
  v_account_ready boolean := false;
  v_legal_ready boolean := false;
  v_tech_ready boolean := false;
  v_team_ready boolean := false;
  v_module text;
  v_session_id uuid;
  v_profile jsonb := '{}'::jsonb;
  v_next_step text;
begin
  if p_company_id is null then
    raise exception 'company_id required';
  end if;
  if not public.user_can_access_company_v2(p_company_id) then
    raise exception 'Insufficient tenant context for onboarding';
  end if;

  select c.status
    into v_status
  from public.companies c
  where c.id = p_company_id;

  if not found then
    raise exception 'company not found';
  end if;

  if v_status = 'closed' then
    raise exception 'Closed company cannot be onboarded';
  end if;

  select os.id
    into v_session_id
  from public.onboarding_sessions os
  where os.company_id = p_company_id
  order by os.updated_at desc
  limit 1;

  select to_jsonb(op)
    into v_profile
  from public.onboarding_profiles op
  where op.company_id = p_company_id;

  v_profile := coalesce(v_profile, '{}'::jsonb);
  v_profile_complete :=
    coalesce(nullif(v_profile->>'legal_name', ''), '') <> ''
    and coalesce(nullif(v_profile->>'invoice_email', ''), '') <> '';

  select exists (
    select 1
    from public.website_tenant_settings wts
    where wts.company_id = p_company_id
  )
  into v_tech_ready;

  select count(*) > 0
    into v_team_ready
  from public.company_memberships cm
  where cm.company_id = p_company_id
    and cm.status = 'active';

  select exists (
    select 1
    from public.legal_active_bundle_versions labv
    where labv.company_id = p_company_id
  )
  into v_legal_ready;

  v_account_ready := v_team_ready;

  if v_status = 'onboarding' then
    if not v_profile_complete then
      v_next_step := 'onboarding:profile';
    elsif not v_account_ready then
      v_next_step := 'onboarding:account';
    elsif not v_legal_ready then
      v_next_step := 'onboarding:legal';
    elsif not v_tech_ready then
      v_next_step := 'onboarding:technical';
    else
      v_next_step := 'onboarding:resume';
    end if;
  else
    v_next_step := 'dashboard';
  end if;

  v_module := coalesce(nullif(btrim(p_preferred_module), ''), 'dashboard');

  return query
  select
    v_next_step,
    v_module,
    v_session_id,
    v_profile;
end
$function$;

revoke all on function public.select_onboarding_start_path(uuid, text)
  from public, anon, authenticated;
grant execute on function public.select_onboarding_start_path(uuid, text)
  to service_role;
