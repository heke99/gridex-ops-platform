-- GRIDEX-AUD-003 derived bootstrap prerequisite.
-- Source of truth: pg_get_functiondef(public.set_updated_at_timestamp()) from
-- gridex-ops-dev on 2026-08-07. The historical 20260522 lint migration
-- confirms this helper pre-dates later tracked migrations.
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
set search_path = public, auth, extensions
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
