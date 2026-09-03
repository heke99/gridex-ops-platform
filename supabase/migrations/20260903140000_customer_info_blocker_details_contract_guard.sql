-- Keep customer_info_requests.blocker_details compatible with its NOT NULL jsonb
-- contract even when older application paths explicitly send NULL while clearing
-- a blocker after a successful Z01 prepare/replay.
--
-- The column default only applies when the field is omitted; it does not protect
-- explicit NULL updates. Normalize at the database boundary so every caller has
-- the same canonical empty-object semantics and a successful Ediel prepare cannot
-- fail after the message/outbox rows have already been created.

begin;

create or replace function public.gridex_normalize_customer_info_blocker_details()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.blocker_details := coalesce(new.blocker_details, '{}'::jsonb);
  return new;
end;
$$;

revoke all on function public.gridex_normalize_customer_info_blocker_details() from public, anon, authenticated;
grant execute on function public.gridex_normalize_customer_info_blocker_details() to service_role;

drop trigger if exists customer_info_requests_normalize_blocker_details on public.customer_info_requests;
create trigger customer_info_requests_normalize_blocker_details
before insert or update of blocker_details
on public.customer_info_requests
for each row
execute function public.gridex_normalize_customer_info_blocker_details();

-- Defensive convergence for environments where the column contract may have
-- temporarily been relaxed during development. This is a no-op in production
-- while blocker_details remains NOT NULL.
update public.customer_info_requests
set blocker_details = '{}'::jsonb,
    updated_at = now()
where blocker_details is null;

commit;
