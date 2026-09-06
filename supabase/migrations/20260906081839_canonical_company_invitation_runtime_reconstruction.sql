-- Reconstruct invitation columns omitted by the legacy membership-only substitute.
-- Sources: 20260519_final_saas_hardening, 20260519_company_invite_temp_password_sync,
-- 20260527_fix_company_user_invite_runtime_columns; active canonical invitation RPCs.
-- Verified against the read-only live catalog on 2026-09-06. This is deliberately
-- not a complete classification of those historical migrations' effects.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Existing columns/data are preserved. In particular, no legacy role/email/token
-- is guessed or mapped, no invitation is accepted, and no delivery is enqueued.
-- A newly added token gets the source-defined UUID default; acceptance still
-- requires its independently stored hash and the verified-user RPC checks.
alter table public.company_invitations
  add column if not exists full_name text,
  add column if not exists membership_role text not null default 'member',
  add column if not exists role_key text,
  add column if not exists token uuid not null default gen_random_uuid(),
  add column if not exists invited_by uuid,
  add column if not exists invited_user_id uuid,
  add column if not exists invited_email text,
  add column if not exists revoked_at timestamptz,
  add column if not exists accept_token_hash text,
  add column if not exists temporary_password_issued_at timestamptz,
  add column if not exists temporary_password_expires_at timestamptz;

-- Add missing historical constraints with full validation. Invalid existing rows
-- must abort this transaction, rather than being rewritten to pass validation.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.company_invitations'::regclass and conname='company_invitations_membership_role_check') then
    alter table public.company_invitations add constraint company_invitations_membership_role_check
      check (membership_role in ('owner','admin','company_admin','operations','support','member','viewer'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.company_invitations'::regclass and conname='company_invitations_invited_by_fkey') then
    alter table public.company_invitations add constraint company_invitations_invited_by_fkey
      foreign key (invited_by) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.company_invitations'::regclass and conname='company_invitations_invited_user_id_fkey') then
    alter table public.company_invitations add constraint company_invitations_invited_user_id_fkey
      foreign key (invited_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create unique index if not exists company_invitations_token_key
  on public.company_invitations(token);
create unique index if not exists company_invitations_accept_token_hash_uidx
  on public.company_invitations(accept_token_hash) where accept_token_hash is not null;

-- Keep the newer delivery-status CHECK, company deletion RESTRICT, grants,
-- policies and triggers intact. Remaining live/canonical differences need their
-- own reviewed decisions and authoritative replay/type/schema regeneration.
commit;
