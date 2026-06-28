-- Gridex post-live fixes: POA event-type semantics and manual outbox dispatch
-- status backfill. Forward-only, idempotent, tenant-safe. No destructive ops.

-- ---------------------------------------------------------------------------
-- 1) power_of_attorney_events: allow the internal JSON snapshot event type.
--    The website application stores an immutable JSON snapshot in
--    customer_documents (mime_type application/json). That is NOT a generated
--    PDF, so it must be recorded as `snapshot_created` (a real `pdf_generated`
--    event is only emitted when an actual PDF is rendered for external grid
--    owner communication).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.power_of_attorney_events') is not null then
    alter table public.power_of_attorney_events
      drop constraint if exists power_of_attorney_events_event_type_check;
    alter table public.power_of_attorney_events
      add constraint power_of_attorney_events_event_type_check
      check (event_type in (
        'created','accepted','snapshot_created','document_snapshot_created',
        'pdf_generated','attached_to_email','revoked','expired'
      ));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Non-destructive backfill: a manual_email_outbox row that has already been
--    sent must never leave its linked grid_owner_information_requests row with
--    dispatch_status = 'not_started'. Repair historical rows where the email
--    was sent but the request dispatch_status was never advanced.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.manual_email_outbox') is not null
     and to_regclass('public.grid_owner_information_requests') is not null then
    update public.grid_owner_information_requests r
       set dispatch_status = 'waiting_response',
           sent_at = coalesce(r.sent_at, o.sent_at, now()),
           updated_at = now()
      from public.manual_email_outbox o
     where o.request_id = r.id
       and o.status = 'sent'
       and coalesce(r.dispatch_status, 'not_started') = 'not_started';
  end if;
end $$;
