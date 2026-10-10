-- OPS API review F27 (2026-10-07): durable signed-contract confirmation delivery.
--
-- Online signing finalizes the contract before archiving the PDF and queueing
-- the confirmation mail. A failure in between left no retry. A pending
-- continuation is now created in the same transaction that marks the
-- signature request used, so every signed contract has a tenant-bound delivery
-- record that a worker retries until the confirmation is queued.

create table if not exists public.customer_contract_confirmation_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_contract_id uuid not null,
  signature_request_id uuid not null references public.customer_contract_signature_requests(id) on delete restrict,
  state text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  queued_at timestamptz,
  document_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contract_confirmation_deliveries_state_chk
    check (state in ('pending', 'queued', 'failed')),
  constraint customer_contract_confirmation_deliveries_attempts_chk check (attempts >= 0),
  constraint customer_contract_confirmation_deliveries_queued_chk
    check ((state = 'queued') = (queued_at is not null)),
  constraint customer_contract_confirmation_deliveries_request_key unique (signature_request_id)
);

comment on table public.customer_contract_confirmation_deliveries is
  'Durable continuation for the signed-contract confirmation mail (F27). Service-role only.';

create index if not exists customer_contract_confirmation_deliveries_due_idx
  on public.customer_contract_confirmation_deliveries (next_attempt_at)
  where state = 'pending';
create index if not exists customer_contract_confirmation_deliveries_company_contract_idx
  on public.customer_contract_confirmation_deliveries (company_id, customer_contract_id);

alter table public.customer_contract_confirmation_deliveries enable row level security;
revoke all on table public.customer_contract_confirmation_deliveries from public, anon, authenticated;
grant select, insert, update on table public.customer_contract_confirmation_deliveries to service_role;

create or replace function public.gridex_enqueue_contract_confirmation_delivery()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.customer_contract_confirmation_deliveries(
    company_id, customer_contract_id, signature_request_id
  ) values (
    new.company_id, new.customer_contract_id, new.id
  )
  on conflict (signature_request_id) do nothing;
  return new;
end;
$$;

revoke all on function public.gridex_enqueue_contract_confirmation_delivery() from public, anon, authenticated;

drop trigger if exists customer_contract_signature_requests_confirmation_delivery_tg
  on public.customer_contract_signature_requests;
create trigger customer_contract_signature_requests_confirmation_delivery_tg
  after update of used_at on public.customer_contract_signature_requests
  for each row
  when (old.used_at is null and new.used_at is not null)
  execute function public.gridex_enqueue_contract_confirmation_delivery();
