begin;

-- The reconstructed legacy foundation omits a company BRP projection that the
-- canonical evidence-v3 snapshot consumes. Production already has this field.
alter table public.companies
  add column if not exists brp_ediel_id text;

-- Reconstruct the canonical production send-lock projection when replaying from
-- the older operational lock table. Production already has these columns and
-- constraints, so every statement below is idempotent there.
alter table public.ediel_send_locks
  add column if not exists environment text not null default 'production',
  add column if not exists locked boolean not null default true,
  add column if not exists locked_reason text,
  add column if not exists unlocked_by uuid references auth.users(id) on delete set null,
  add column if not exists unlocked_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ediel_send_locks'::regclass
      and conname = 'ediel_send_locks_environment_check'
  ) then
    alter table public.ediel_send_locks
      add constraint ediel_send_locks_environment_check
      check (environment in ('test', 'production'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ediel_send_locks'::regclass
      and conname = 'ediel_send_locks_company_environment_key'
  ) then
    if exists (
      select 1
      from public.ediel_send_locks
      group by company_id, environment
      having count(*) > 1
    ) then
      raise exception 'ediel_send_locks_company_environment_duplicates';
    end if;

    alter table public.ediel_send_locks
      add constraint ediel_send_locks_company_environment_key
      unique (company_id, environment);
  end if;
end;
$$;

create index if not exists ediel_send_locks_company_env_locked_idx
  on public.ediel_send_locks(company_id, environment, locked);

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
