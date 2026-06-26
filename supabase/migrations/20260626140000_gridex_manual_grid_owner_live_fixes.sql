-- Gridex manual grid-owner live fixes: webhook delivery tracking, inbound queue
-- FOR UPDATE outer-join fix, and grid-owner contact-channel backfill.
-- Forward-only, idempotent, tenant-safe. No destructive data operations.

-- ---------------------------------------------------------------------------
-- 1) manual_email_outbox: Resend delivery tracking from webhooks.
--    `status` stays the worker lifecycle (queued/sending/sent/failed).
--    `delivery_status` holds the provider delivery outcome from webhooks.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.manual_email_outbox') is not null then
    alter table public.manual_email_outbox
      add column if not exists delivery_status text,
      add column if not exists last_error_code text,
      add column if not exists delivered_at timestamptz,
      add column if not exists bounced_at timestamptz,
      add column if not exists complained_at timestamptz,
      add column if not exists failed_at timestamptz;

    alter table public.manual_email_outbox
      drop constraint if exists manual_email_outbox_delivery_status_check;
    alter table public.manual_email_outbox
      add constraint manual_email_outbox_delivery_status_check
      check (
        delivery_status is null
        or delivery_status in (
          'queued','sent','delivered','delivery_delayed','bounced','complained','failed','suppressed'
        )
      );

    create index if not exists manual_email_outbox_provider_message_idx
      on public.manual_email_outbox (provider_message_id)
      where provider_message_id is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Inbound queue claim: fix "FOR UPDATE cannot be applied to the nullable
--    side of an outer join". Lock only inbound_processing_jobs (alias j).
--    Preserves environment filtering via the LEFT JOIN on inbound_email_messages.
-- ---------------------------------------------------------------------------
create or replace function public.claim_inbound_processing_jobs(
  p_environment text default null,
  p_limit integer default 50,
  p_worker_id text default 'inbound-mail-engine',
  p_stale_after interval default interval '10 minutes'
)
returns setof public.inbound_processing_jobs
language plpgsql
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.inbound_processing_jobs j
    left join public.inbound_email_messages m on m.id = j.inbound_email_message_id
    where (
      j.status in ('queued', 'retry', 'received')
      or (j.status = 'processing' and j.locked_at < now() - p_stale_after)
    )
      and (j.locked_at is null or j.locked_at < now() - p_stale_after)
      and (p_environment is null or coalesce(m.environment, 'test') = p_environment)
    order by j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    -- FOR UPDATE OF j: never lock the nullable side of the LEFT JOIN.
    for update of j skip locked
  ), updated as (
    update public.inbound_processing_jobs j
       set status = 'processing',
           step = 'processor_claimed',
           locked_at = now(),
           locked_by = p_worker_id,
           started_at = now(),
           finished_at = null,
           attempts_count = coalesce(j.attempts_count, 0) + 1,
           error_message = case when j.status = 'processing' then coalesce(j.error_message, 'stale_inbound_lock_reclaimed') else null end,
           updated_at = now()
     where j.id in (select id from candidates)
     returning j.*
  )
  select * from updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) grid_owner_contact_channels backfill (Task J): if a grid owner has a
--    supplier_switch_manual (preferred) or power_of_attorney contact email but
--    no facility_information_request channel in the same scope, create it with
--    the same email. NEVER overwrite an existing facility_information_request.
--    Handles both platform defaults (company_id null) and tenant overrides.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.grid_owner_contact_channels') is not null then
    insert into public.grid_owner_contact_channels (
      grid_owner_id, company_id, channel_type, email, phone, label, is_enabled, is_verified, source
    )
    select
      src.grid_owner_id,
      src.company_id,
      'facility_information_request',
      src.email,
      src.phone,
      src.label,
      src.is_enabled,
      false,
      'manual_admin'
    from (
      select distinct on (grid_owner_id, company_id)
        grid_owner_id, company_id, email, phone, label, is_enabled
      from public.grid_owner_contact_channels
      where channel_type in ('supplier_switch_manual', 'power_of_attorney')
        and email is not null
      order by
        grid_owner_id,
        company_id,
        case channel_type
          when 'supplier_switch_manual' then 0
          when 'power_of_attorney' then 1
          else 2
        end,
        updated_at desc
    ) src
    where not exists (
      select 1
      from public.grid_owner_contact_channels existing
      where existing.grid_owner_id = src.grid_owner_id
        and existing.channel_type = 'facility_information_request'
        and existing.company_id is not distinct from src.company_id
    );
  end if;
end $$;
