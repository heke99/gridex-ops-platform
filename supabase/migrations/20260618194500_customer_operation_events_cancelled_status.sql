alter table public.customer_operation_events
  drop constraint if exists customer_operation_events_status_check;

alter table public.customer_operation_events
  add constraint customer_operation_events_status_check
  check (
    status in (
      'queued',
      'in_progress',
      'waiting_response',
      'response_received',
      'completed',
      'needs_review',
      'failed',
      'blocked',
      'skipped',
      'cancelled'
    )
  );
