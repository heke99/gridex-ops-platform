-- Z01 production route profile -> actor setting backfill (guarded, idempotent)
--
-- Links the live production PRODAT/Z01 route profile to its production actor
-- setting so the route decision engine can deterministically resolve the sender
-- identity (21660 / Div3rsa AB) instead of failing with "ambiguous sender
-- settings" between two unrelated TEST actor settings.
--
-- HARD SAFETY: this only touches the single known profile and only when EVERY
-- attribute (company, production environment, Ediel id, compatible application
-- reference, active production actor setting) matches. On ANY mismatch it is a
-- no-op. It never creates duplicates and never crosses the test/production
-- boundary.

do $$
declare
  v_profile_id    constant uuid := '600a8023-bb8c-4eb5-9781-111178b5ff31';
  v_actor_id      constant uuid := '3844d428-03b4-4875-a6e3-fadba31dde6a';
  v_company_id    constant uuid := 'b3ad1bf6-fa45-41a6-8054-2e0862e82aca';
  v_ediel_id      constant text := '21660';
  v_updated       integer := 0;
begin
  -- Only proceed if the table actually has an actor_setting_id column.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ediel_route_profiles'
      and column_name = 'actor_setting_id'
  ) then
    raise notice 'ediel_route_profiles.actor_setting_id missing; skipping backfill.';
    return;
  end if;

  update public.ediel_route_profiles p
     set actor_setting_id = v_actor_id,
         updated_at = now()
   where p.id = v_profile_id
     and p.actor_setting_id is null               -- idempotent: never overwrite
     and p.company_id = v_company_id
     and lower(coalesce(p.environment, '')) = 'production'
     and coalesce(p.sender_ediel_id, '') = v_ediel_id
     and exists (
       select 1
         from public.ediel_actor_settings a
        where a.id = v_actor_id
          and a.company_id = v_company_id
          and lower(coalesce(a.environment, '')) = 'production'
          and coalesce(a.ediel_id, a.actor_ediel_id, '') = v_ediel_id
          and a.is_active is true
          -- application reference must be compatible (either side may be null)
          and (
            p.application_reference is null
            or coalesce(a.application_reference, a.default_application_reference) is null
            or upper(p.application_reference)
               = upper(coalesce(a.application_reference, a.default_application_reference))
          )
     );

  get diagnostics v_updated = row_count;
  raise notice 'z01 route profile actor_setting backfill updated % row(s).', v_updated;
end $$;
