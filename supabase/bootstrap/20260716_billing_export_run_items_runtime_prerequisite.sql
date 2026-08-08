-- Derived clean-replay prerequisite from checksum-pinned safe/idempotent 20260525 repair source.
-- Restores only the billing_export_run_items runtime field family consumed by
-- canonical contract/billing completion before 20260716010000 executes.
do $$
begin
  if to_regclass('public.billing_export_run_items') is not null then
    alter table public.billing_export_run_items
      add column if not exists contract_id uuid,
      add column if not exists readiness_status text not null default 'pending',
      add column if not exists pricing_line_items jsonb not null default '[]'::jsonb,
      add column if not exists invoice_recipient text,
      add column if not exists invoice_email text,
      add column if not exists invoice_reference text,
      add column if not exists billing_level text not null default 'customer',
      add column if not exists consolidated_invoice boolean not null default false,
      add column if not exists invoice_address_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists site_address_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists consolidated_invoice_group_key text,
      add column if not exists payload_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists export_status text not null default 'not_queued',
      add column if not exists partner_export_id uuid,
      add column if not exists idempotency_key text,
      add column if not exists queued_at timestamptz,
      add column if not exists sent_at timestamptz,
      add column if not exists acknowledged_at timestamptz,
      add column if not exists failed_at timestamptz,
      add column if not exists retry_count integer not null default 0,
      add column if not exists last_error text,
      add column if not exists blocker_case_id uuid,
      add column if not exists payload_version text not null default 'billing_export_item_v4c',
      add column if not exists adapter_key text not null default 'gridex_billing_partner_v1',
      add column if not exists adapter_payload_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists partner_response_log jsonb not null default '[]'::jsonb,
      add column if not exists last_partner_response_at timestamptz,
      add column if not exists external_reference text,
      add column if not exists sent_by uuid,
      add column if not exists updated_at timestamptz not null default now();
  end if;
end $$;
