-- Background readiness revalidation is a system operation. The canonical snapshot
-- RPC is exposed only to service_role/postgres, so a NULL actor is a deliberate
-- system identity rather than an authorization bypass. Human/admin calls continue
-- to require an explicitly authorized actor UUID.

begin;

create or replace function public.canonical_capture_ediel_configuration_snapshot(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns public.ediel_configuration_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_actor_user_id is null then
    return public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
      p_company_id,
      null,
      p_reason
    );
  end if;

  if not public.canonical_actor_is_authorized(
    p_company_id,
    p_actor_user_id,
    'ediel.profile.write',
    false
  ) then
    raise exception 'actor_not_authorized_for_configuration_snapshot';
  end if;

  return public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
    p_company_id,
    p_actor_user_id,
    p_reason
  );
end;
$$;

revoke all on function public.canonical_capture_ediel_configuration_snapshot(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.canonical_capture_ediel_configuration_snapshot(uuid, uuid, text)
to service_role;

commit;
