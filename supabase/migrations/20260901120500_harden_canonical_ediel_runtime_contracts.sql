-- Keep the persisted canonical EDIEL contract aligned with runtime producers.
-- This migration does not relax fail-closed behavior; it adds missing evidence
-- storage and registers machine event types already emitted by the runtime.

alter table public.ediel_messages
  add column if not exists execution_context_snapshot jsonb not null default '{}'::jsonb;

alter table public.ediel_message_events
  drop constraint if exists ediel_message_events_event_type_check;

alter table public.ediel_message_events
  add constraint ediel_message_events_event_type_check
  check (event_type = any (array[
    'created'::text,
    'prepared'::text,
    'queued'::text,
    'sent'::text,
    'received'::text,
    'parsed'::text,
    'validated'::text,
    'acknowledged'::text,
    'linked'::text,
    'retry'::text,
    'contrl_sent'::text,
    'contrl_received'::text,
    'aperak_sent'::text,
    'aperak_received'::text,
    'utilts_err_sent'::text,
    'utilts_err_received'::text,
    'inbound_mail_processed'::text,
    'ack_received_via_inbound_mail'::text,
    'ack_sla_breached'::text,
    'failed'::text,
    'cancelled'::text,
    'manual_note'::text
  ]));

alter table public.communication_routes
  drop constraint if exists communication_routes_ediel_ack_environment_required;

alter table public.communication_routes
  add constraint communication_routes_ediel_ack_environment_required
  check (route_scope <> 'ediel_ack' or environment_type is not null);
