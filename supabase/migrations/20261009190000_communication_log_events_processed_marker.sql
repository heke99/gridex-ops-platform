-- Resend webhook events are stored before their status effects are applied.
-- processed_at marks an event whose effects were fully applied, so a provider
-- retry after a failed delivery re-processes a stored-but-unprocessed event
-- instead of short-circuiting on the stored row (inbound review #2).
alter table public.communication_log_events
  add column if not exists processed_at timestamptz;

-- Every event stored before this migration was handled by the previous
-- at-most-once code path; treat it as processed so nothing is replayed.
update public.communication_log_events
set processed_at = coalesce(created_at, now())
where processed_at is null;

comment on column public.communication_log_events.processed_at is
  'Set when all status effects of the provider event were applied. NULL means stored but not yet fully processed; a provider retry re-processes it.';
