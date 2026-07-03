-- Production readiness hardening: query-matched indexes + single-pass Ediel
-- dashboard summary. Forward-only, idempotent, additive. No destructive
-- operations, no data mutation.
--
-- Motivating queries (audited 2026-07-03, docs/production-readiness-audit.md):
--   * app/admin/customers/** and lib/customers/getCustomers.ts list tenant
--     sites/metering points/contracts filtered by (company_id, status) ordered
--     by created_at desc. customer_sites and metering_points only had
--     (company_id, customer_id, ...) composites; customer_contracts only had a
--     starts_at variant.
--   * lib/customer-portal/db.ts and admin billing views read
--     customer_invoice_lines; the table had no company_id index at all
--     (join-through-invoice only), so tenant-wide line reads were seq scans.

-- 1) customer_sites: tenant queue/list reads by status, newest first.
do $$
begin
  if to_regclass('public.customer_sites') is not null then
    create index if not exists customer_sites_company_status_created_idx
      on public.customer_sites (company_id, status, created_at desc);
  end if;
end $$;

-- 2) metering_points: tenant queue/list reads by status, newest first.
do $$
begin
  if to_regclass('public.metering_points') is not null then
    create index if not exists metering_points_company_status_created_idx
      on public.metering_points (company_id, status, created_at desc);
  end if;
end $$;

-- 3) customer_contracts: tenant status tabs / segment counts, newest first.
do $$
begin
  if to_regclass('public.customer_contracts') is not null then
    create index if not exists customer_contracts_company_status_created_idx
      on public.customer_contracts (company_id, status, created_at desc);
  end if;
end $$;

-- 4) customer_invoice_lines: tenant scoping for admin billing exports and
--    governance counts (previously only (invoice_id, sort_order, created_at)).
do $$
begin
  if to_regclass('public.customer_invoice_lines') is not null then
    create index if not exists customer_invoice_lines_company_idx
      on public.customer_invoice_lines (company_id);
  end if;
end $$;

-- 5) Single-pass Ediel dashboard summary. Replaces 10 separate
--    count(*) queries on ediel_messages fired by lib/ediel/summary.ts on every
--    /admin and /admin/ediel load. SECURITY INVOKER: runs with the calling
--    user's RLS policies, so tenant isolation is unchanged. The application
--    falls back to the legacy per-count path when this function is absent.
do $$
begin
  if to_regclass('public.ediel_messages') is null then
    return;
  end if;

  create or replace function public.gridex_ediel_message_summary(p_company_id uuid default null)
  returns table (
    total_messages bigint,
    inbound_messages bigint,
    outbound_messages bigint,
    draft_messages bigint,
    failed_messages bigint,
    queued_messages bigint,
    prepared_messages bigint,
    sent_messages bigint,
    ack_pending_messages bigint,
    ack_overdue_messages bigint
  )
  language sql
  stable
  security invoker
  set search_path = public
  as $fn$
    select
      count(*) as total_messages,
      count(*) filter (where direction = 'inbound') as inbound_messages,
      count(*) filter (where direction = 'outbound') as outbound_messages,
      count(*) filter (where status = 'draft') as draft_messages,
      count(*) filter (where status = 'failed') as failed_messages,
      count(*) filter (where status = 'queued') as queued_messages,
      count(*) filter (where status = 'prepared') as prepared_messages,
      count(*) filter (where status = 'sent') as sent_messages,
      count(*) filter (
        where contrl_status = 'pending' or aperak_status = 'pending'
      ) as ack_pending_messages,
      count(*) filter (
        where (contrl_status = 'pending' or aperak_status = 'pending')
          and ack_due_at < now()
      ) as ack_overdue_messages
    from public.ediel_messages
    where p_company_id is null or company_id = p_company_id
  $fn$;

  grant execute on function public.gridex_ediel_message_summary(uuid) to authenticated;
  grant execute on function public.gridex_ediel_message_summary(uuid) to service_role;
end $$;
