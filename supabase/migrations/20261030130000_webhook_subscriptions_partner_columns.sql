-- Finding 20261029-3f1a8ab1/claude-track5/002.
--
-- 20260609162000:290-295 adds these partner/health columns with
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, but that migration belongs to the
-- reconstructed legacy foundation (scripts/gridex-aud-003-legacy-foundation*.json)
-- and its ALTER is not carried into the canonical schema: a clean replay and the
-- captured supabase/schema.sql both lack them, and 20260821103000 already notes
-- api_client_id "is absent in reconstructed legacy replay". On that schema
-- gridex_create_partner_webhook_subscription_v1 fails with 42703, the
-- dispatcher's success/failure projection is a silent no-op (no auto-pause) and
-- isPartnerSubscription() never sees metadata.source.
--
-- Forward-only and idempotent: every statement is a no-op where the column,
-- constraint or index already exists. No existing row is rewritten.

alter table public.webhook_subscriptions add column if not exists api_client_id uuid;
alter table public.webhook_subscriptions add column if not exists description text;
alter table public.webhook_subscriptions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.webhook_subscriptions add column if not exists last_success_at timestamptz;
alter table public.webhook_subscriptions add column if not exists last_failure_at timestamptz;

-- The API client must belong to the subscription's own tenant. Deleting the
-- client keeps the subscription (and its delivery history) but clears the link.
-- Where the legacy 20260609162000 column FK (api_client_id -> id, not
-- tenant-bound) exists, it is replaced: two FKs to the same table would also
-- make unhinted PostgREST embeds ambiguous (PGRST201).
do $$
declare
  v_legacy record;
begin
  for v_legacy in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.webhook_subscriptions'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.integration_api_clients'::regclass
      and c.conname <> 'webhook_subscriptions_company_api_client_fkey'
      and c.conkey = array[(
        select a.attnum from pg_attribute a
        where a.attrelid = 'public.webhook_subscriptions'::regclass and a.attname = 'api_client_id'
      )]::smallint[]
  loop
    execute format('alter table public.webhook_subscriptions drop constraint %I', v_legacy.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.webhook_subscriptions'::regclass
      and conname = 'webhook_subscriptions_company_api_client_fkey'
  ) then
    alter table public.webhook_subscriptions
      add constraint webhook_subscriptions_company_api_client_fkey
      foreign key (company_id, api_client_id)
      references public.integration_api_clients(company_id, id)
      on delete set null (api_client_id)
      not valid;
  end if;
end
$$;

-- Validated separately (SHARE UPDATE EXCLUSIVE): an existing cross-tenant link
-- fails the migration instead of staying undetected.
alter table public.webhook_subscriptions
  validate constraint webhook_subscriptions_company_api_client_fkey;

-- Same definition as 20260609162000, so both kinds of database converge.
create index if not exists webhook_subscriptions_api_client_idx
  on public.webhook_subscriptions(api_client_id, status, created_at desc)
  where api_client_id is not null;

-- Same canonical uniqueness as 20260821103000, which skipped it while the
-- column was absent. Refuse rather than guess when duplicates already exist.
do $$
begin
  if exists (
    select 1
    from public.webhook_subscriptions
    where api_client_id is not null
      and status <> 'revoked'
    group by company_id, api_client_id, endpoint_url
    having count(*) > 1
  ) then
    raise exception 'tenant_webhook_consistency_blocked: duplicate non-revoked canonical subscriptions exist';
  end if;
end
$$;

create unique index if not exists webhook_subscriptions_company_client_endpoint_uidx
  on public.webhook_subscriptions (company_id, api_client_id, endpoint_url)
  where api_client_id is not null
    and status <> 'revoked';
