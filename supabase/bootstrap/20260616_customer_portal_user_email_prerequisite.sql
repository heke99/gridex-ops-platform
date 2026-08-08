-- Derived clean-replay prerequisite from checksum-pinned pre-ledger source.
-- Restores only the customer_portal_accounts runtime fields consumed by the
-- 20260616223000 canonical bundle resolver before that migration executes.
do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null then
    alter table public.customer_portal_accounts
      add column if not exists user_email text,
      add column if not exists is_active boolean not null default true,
      add column if not exists activated_at timestamptz,
      add column if not exists verified_at timestamptz,
      add column if not exists match_method text;

    update public.customer_portal_accounts
       set user_email = coalesce(user_email, email)
     where user_email is null
       and email is not null;
  end if;
end $$;
