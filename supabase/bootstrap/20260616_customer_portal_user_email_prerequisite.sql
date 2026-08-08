-- Derived clean-replay prerequisite from checksum-pinned pre-ledger source.
-- Restores only customer_portal_accounts.user_email before the 20260616223000
-- canonical bundle resolver creates its company/email index.
do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null then
    alter table public.customer_portal_accounts
      add column if not exists user_email text;

    update public.customer_portal_accounts
       set user_email = coalesce(user_email, email)
     where user_email is null
       and email is not null;
  end if;
end $$;
