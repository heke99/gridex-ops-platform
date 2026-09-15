-- Recover actor constraints lost when earlier ADD COLUMN IF NOT EXISTS statements
-- created the UUID columns without REFERENCES. Sources: 20260519 Batch 6D tenant
-- governance and 20260520 direct-account provisioning. Names, targets and delete
-- behavior verified against the read-only production catalog on 2026-09-07.
-- This does not replay legacy account activation or status-normalization DML.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

alter table public.company_memberships
  add column if not exists disabled_by uuid,
  add column if not exists removed_by uuid;

do $$
declare
  actor_column text;
  constraint_name text;
  actor_attnum smallint;
  user_attnum smallint;
begin
  select attnum into strict user_attnum from pg_attribute
    where attrelid='auth.users'::regclass and attname='id' and not attisdropped;
  foreach actor_column in array array['disabled_by','removed_by'] loop
    constraint_name := 'company_memberships_' || actor_column || '_fkey';
    select attnum into strict actor_attnum from pg_attribute
      where attrelid='public.company_memberships'::regclass
        and attname=actor_column and not attisdropped;
    if exists (select 1 from pg_constraint
               where conrelid='public.company_memberships'::regclass and conname=constraint_name) then
      -- A matching name is not proof of an equivalent or validated constraint.
      if not exists (
        select 1 from pg_constraint
        where conrelid='public.company_memberships'::regclass
          and conname=constraint_name and contype='f'
          and conkey=array[actor_attnum] and confkey=array[user_attnum]
          and confrelid='auth.users'::regclass
          and confdeltype='n' and confupdtype='a' and confmatchtype='s'
          and convalidated and not condeferrable
      ) then
        raise exception 'MEMBERSHIP_ACTOR_FK_DEFINITION_MISMATCH: %', constraint_name;
      end if;
    else
      execute format(
        'alter table public.company_memberships add constraint %I foreign key (%I) references auth.users(id) on delete set null',
        constraint_name, actor_column
      );
    end if;
  end loop;
end $$;

-- Invalid existing actor references abort the transaction. No identities are
-- guessed, memberships reactivated, history deleted, or policies/grants altered.
commit;
