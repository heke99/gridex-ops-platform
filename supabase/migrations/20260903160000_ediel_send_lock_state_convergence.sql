begin;

create or replace function private.ediel_send_lock_state_convergence_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  -- `locked` is the canonical production-state projection. The legacy
  -- operational `status` column must never contradict it, because runtime
  -- workers still read both fields for backward compatibility.
  new.status := case when coalesce(new.locked, true) then 'active' else 'released' end;
  return new;
end;
$$;

revoke all on function private.ediel_send_lock_state_convergence_trigger()
  from public, anon, authenticated;

drop trigger if exists ediel_send_lock_state_convergence
  on public.ediel_send_locks;

create trigger ediel_send_lock_state_convergence
before insert or update on public.ediel_send_locks
for each row
execute function private.ediel_send_lock_state_convergence_trigger();

-- Repair only contradictory legacy projections. This does not choose or
-- change lock state; it derives status from the existing canonical `locked`
-- boolean for every tenant.
update public.ediel_send_locks
set status = case when locked then 'active' else 'released' end,
    updated_at = now()
where status is distinct from case when locked then 'active' else 'released' end;

commit;
