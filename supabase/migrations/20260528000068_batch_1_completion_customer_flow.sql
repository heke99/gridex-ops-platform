-- Batch 1 completion: supplier response/preflight + route decision current supplier trace

alter table if exists public.route_decision_logs
  add column if not exists current_supplier_id uuid;

create index if not exists route_decision_logs_current_supplier_idx
  on public.route_decision_logs(company_id, current_supplier_id, created_at desc)
  where current_supplier_id is not null;

alter table if exists public.customer_sites
  add column if not exists current_supplier_response_status text,
  add column if not exists current_supplier_contract_status text,
  add column if not exists current_supplier_contract_end_date date,
  add column if not exists current_supplier_notice_period text,
  add column if not exists current_supplier_termination_fee numeric;

alter table if exists public.customer_info_requests
  add column if not exists received_at timestamptz,
  add column if not exists blocker_reason text;
