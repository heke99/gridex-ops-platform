-- Align website application contract creation with the canonical customer_contracts.status model.
-- Live customer_contracts.status accepts draft/pending_signature/signed/active/terminated/cancelled/expired.
-- Website applications must not write the legacy transient value "pending".

begin;

alter table public.customer_contracts add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Normalize any historical rows if they were inserted before the strict check existed.
update public.customer_contracts
set status = 'pending_signature',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_status', 'pending'),
    updated_at = now()
where status = 'pending';

alter table public.customer_contracts
  drop constraint if exists customer_contracts_status_check;

alter table public.customer_contracts
  add constraint customer_contracts_status_check check (
    status in (
      'draft',
      'pending_signature',
      'signed',
      'active',
      'terminated',
      'cancelled',
      'expired'
    )
  );

comment on constraint customer_contracts_status_check on public.customer_contracts is
  'Canonical customer contract lifecycle. Website applications create draft or pending_signature contracts, never pending.';

commit;
