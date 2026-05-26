-- Batch 3C + 3D: fullmaktsflöde och uppgiftsbegäran.
-- Idempotent SaaS-safe migration. Den ändrar inte godkända Ediel-payloads.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customer_info_requests') is not null then
    alter table public.customer_info_requests drop constraint if exists customer_info_requests_status_check;
    alter table public.customer_info_requests add constraint customer_info_requests_status_check check (status in (
      'draft',
      'ready_to_send',
      'sent',
      'waiting_response',
      'received',
      'partially_received',
      'rejected',
      'failed',
      'cancelled',
      'missing_authorization',
      'z01_prepared',
      'route_missing',
      'sent_to_grid_owner',
      'waiting_for_contrl',
      'waiting_for_aperak',
      'waiting_for_z02',
      'z02_received',
      'negative_aperak',
      'manual_review_required',
      'missing_binding_info',
      'missing_termination_info',
      'ready_for_switch',
      'completed',
      'blocked'
    ));

    alter table public.customer_info_requests add column if not exists requested_period_start date null;
    alter table public.customer_info_requests add column if not exists requested_period_end date null;

    create index if not exists customer_info_requests_company_customer_target_idx
      on public.customer_info_requests(company_id, customer_id, target_party_type, status, created_at desc);
  end if;

  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney add column if not exists evidence_note text null;
    alter table public.powers_of_attorney add column if not exists revoked_at timestamptz null;
    alter table public.powers_of_attorney add column if not exists scope_summary jsonb not null default '{}'::jsonb;

    create index if not exists powers_of_attorney_company_customer_status_created_idx
      on public.powers_of_attorney(company_id, customer_id, status, created_at desc);
    create index if not exists powers_of_attorney_company_customer_signed_idx
      on public.powers_of_attorney(company_id, customer_id, signed_at desc)
      where status = 'signed';
  end if;

  if to_regclass('public.authorization_scopes') is not null then
    create index if not exists authorization_scopes_company_customer_active_idx
      on public.authorization_scopes(company_id, customer_id, created_at desc)
      where status = 'active' and revoked_at is null;
  end if;

  if to_regclass('public.customer_blockers') is not null then
    create index if not exists customer_blockers_company_customer_open_idx
      on public.customer_blockers(company_id, customer_id, blocker_type, created_at desc)
      where status in ('open', 'pending_review');
  end if;
end $$;
