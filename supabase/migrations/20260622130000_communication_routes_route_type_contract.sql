-- Codify the communication_routes.route_type contract in source control and
-- repair any legacy drift. Safe/idempotent.
--
-- The communication_routes_route_type_check constraint exists in the live DB but
-- was not present in repo migrations, so environments built from migrations
-- alone lacked it — and the old route materializer wrote the invalid
-- route_type='ediel' there. This migration:
--   1) repairs any communication_routes still set to 'ediel' (EDIEL counterparty
--      operational routes are 'ediel_partner'),
--   2) (re)creates the check constraint with the canonical allowed values.
-- Allowed: partner_api | ediel_partner | file_export | email_manual.

do $$
declare
  constraint_row record;
begin
  if to_regclass('public.communication_routes') is not null then
    -- 1) Data repair: fix rows written before the route_type fix.
    update public.communication_routes
    set route_type = 'ediel_partner', updated_at = now()
    where route_type = 'ediel';

    -- 2) Replace any existing route_type check with the canonical contract.
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.communication_routes'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%route_type%'
    loop
      execute format('alter table public.communication_routes drop constraint if exists %I', constraint_row.conname);
    end loop;

    alter table public.communication_routes
      add constraint communication_routes_route_type_check
      check (route_type in ('partner_api', 'ediel_partner', 'file_export', 'email_manual'))
      not valid;

    -- Existing rows now comply after the repair above, so validate immediately.
    alter table public.communication_routes validate constraint communication_routes_route_type_check;
  end if;
end $$;
