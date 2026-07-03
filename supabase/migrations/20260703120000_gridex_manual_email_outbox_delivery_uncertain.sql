-- Manual grid-owner email outbox: add the delivery_uncertain status so a
-- worker crash between claiming a row (status='sending') and recording the
-- provider result no longer leaves the row stuck forever (audit finding H5,
-- docs/production-readiness-audit.md).
--
-- Mirrors the tenant email outbox semantics: stale 'sending' rows are moved to
-- 'delivery_uncertain' by the worker and are NEVER auto-resent (the provider
-- may already have accepted the message). Additive CHECK widening only —
-- existing statuses remain valid; no data mutation.

do $$
begin
  if to_regclass('public.manual_email_outbox') is null then
    return;
  end if;

  alter table public.manual_email_outbox
    drop constraint if exists manual_email_outbox_status_check;
  alter table public.manual_email_outbox
    add constraint manual_email_outbox_status_check
    check (status in ('queued','sending','sent','failed','delivery_uncertain'));

  alter table public.manual_email_outbox
    add column if not exists delivery_uncertain_at timestamptz;
end $$;
