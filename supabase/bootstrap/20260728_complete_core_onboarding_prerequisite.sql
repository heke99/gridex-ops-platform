-- Replay-only prerequisite for 20260728170000_live_schema_code_canonical_sync.sql.
-- The historical live database already contained complete_core_onboarding(uuid),
-- while the repository migration ledger did not create it. Recreate the observed
-- routine with its pre-repair tenant guard so the checksum-pinned repair migration
-- can replace user_can_access_company_v2 with gridex_can_write_company itself.

create or replace function public.complete_core_onboarding(p_company_id uuid)
returns table(company_id uuid, dashboard_href text)
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_catalog', 'pg_temp'
as $function$
begin
  if auth.uid() is null or not public.user_can_access_company_v2(p_company_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.company_settings as cs
  set onboarding_complete = true,
      onboarding_step = greatest(coalesce(cs.onboarding_step, 1), 5),
      updated_at = now()
  where cs.company_id = p_company_id;

  update public.onboarding_steps as st
  set status = case
      when st.status = 'completed' then 'completed'
      else 'skipped'
    end,
    completed_at = coalesce(st.completed_at, now()),
    updated_at = now()
  where st.company_id = p_company_id
    and st.session_id in (
      select os.id
      from public.onboarding_sessions os
      where os.company_id = p_company_id
        and os.user_id = auth.uid()
        and os.status in ('draft', 'in_progress')
    );

  update public.onboarding_sessions as os
  set status = 'completed',
      current_step = 'dashboard',
      progress_percent = 100,
      completed_at = now(),
      metadata = os.metadata || jsonb_build_object('core_ready_at', now()),
      updated_at = now()
  where os.company_id = p_company_id
    and os.user_id = auth.uid()
    and os.status in ('draft', 'in_progress');

  insert into public.onboarding_choices as oc (
    session_id, company_id, choice_key, choice_value, metadata
  )
  select os.id, p_company_id, 'core_workspace_ready', 'true',
    jsonb_build_object('completed_by', auth.uid())
  from public.onboarding_sessions os
  where os.company_id = p_company_id
    and os.user_id = auth.uid()
    and os.status = 'completed'
  on conflict (session_id, choice_key) do update
    set choice_value = excluded.choice_value,
        metadata = excluded.metadata;

  return query select p_company_id, '/app'::text;
end;
$function$;

revoke all on function public.complete_core_onboarding(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_core_onboarding(uuid)
  to service_role;
