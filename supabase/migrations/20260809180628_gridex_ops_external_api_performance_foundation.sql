begin;
set local search_path = public, pg_catalog;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'customer_portal_write_idempotency','customer_contracts','customer_sites',
    'customer_invoices','normalized_metering_values','customer_events',
    'customer_notifications','customer_legal_acceptances','powers_of_attorney',
    'customer_documents','customer_authorization_documents'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'external_api_remediation_required_table_missing:%', v_table;
    end if;
  end loop;
  -- Historical schemas may have the legacy table shape without the generated
  -- five-column UNIQUE constraint. The replacement indexes below are created
  -- before any legacy constraint is removed and therefore remain fail-closed:
  -- duplicate legacy rows make CREATE UNIQUE INDEX fail instead of weakening
  -- idempotency, while clean replays and already-reconciled schemas are valid.
end;
$$;

create unique index if not exists customer_portal_write_idempotency_pre_resolution_uidx
  on public.customer_portal_write_idempotency
    (company_id, api_client_id, route, idempotency_key)
  where customer_id is null;
create unique index if not exists customer_portal_write_idempotency_company_client_customer_route
  on public.customer_portal_write_idempotency
    (company_id, api_client_id, customer_id, route, idempotency_key)
  where customer_id is not null;
alter table public.customer_portal_write_idempotency
  drop constraint if exists customer_portal_write_idempot_company_id_api_client_id_rout_key;

create index if not exists customer_contracts_portal_keyset_idx
  on public.customer_contracts (company_id, customer_id, created_at desc, id desc);
create index if not exists customer_sites_portal_keyset_idx
  on public.customer_sites (company_id, customer_id, created_at desc, id desc);
create index if not exists customer_invoices_portal_keyset_idx
  on public.customer_invoices (company_id, customer_id, created_at desc, id desc)
  where status in ('issued','sent','paid','overdue','cancelled','credited');
create index if not exists normalized_metering_values_portal_keyset_idx
  on public.normalized_metering_values (company_id, customer_id, period_start desc, id desc);
create index if not exists customer_events_portal_keyset_idx
  on public.customer_events (company_id, customer_id, occurred_at desc, id desc);
create index if not exists customer_notifications_portal_keyset_idx
  on public.customer_notifications (company_id, customer_id, created_at desc, id desc);
create index if not exists customer_legal_acceptances_portal_keyset_idx
  on public.customer_legal_acceptances (company_id, customer_id, accepted_at desc, id desc);
create index if not exists powers_of_attorney_portal_keyset_idx
  on public.powers_of_attorney (company_id, customer_id, created_at desc, id desc);
create index if not exists customer_documents_portal_keyset_idx
  on public.customer_documents (company_id, customer_id, created_at desc, id desc);
create index if not exists customer_authorization_documents_portal_keyset_idx
  on public.customer_authorization_documents (company_id, customer_id, created_at desc, id desc)
  where status <> 'archived';

create or replace function public.portal_customer_documents_page_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_source_rank integer default null,
  p_cursor_id uuid default null,
  p_limit integer default 51
)
returns table (
  id uuid,
  source_table text,
  source_rank integer,
  document_type text,
  status text,
  title text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  public_url text,
  source_system text,
  source text,
  power_of_attorney_id uuid,
  document_version text,
  uploaded_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with all_documents as (
    select
      d.id,
      'customer_documents'::text as source_table,
      2::integer as source_rank,
      d.document_type,
      d.status,
      d.title,
      d.file_name,
      d.mime_type,
      d.file_size_bytes,
      d.public_url,
      d.source_system,
      d.source,
      d.power_of_attorney_id,
      d.document_version,
      null::timestamptz as uploaded_at,
      d.created_at
    from public.customer_documents d
    where d.company_id = p_company_id
      and d.customer_id = p_customer_id
    union all
    select
      a.id,
      'customer_authorization_documents'::text as source_table,
      1::integer as source_rank,
      a.document_type,
      a.status,
      a.title,
      a.file_name,
      a.mime_type,
      a.file_size_bytes,
      null::text as public_url,
      'customer_authorization_documents'::text as source_system,
      'customer_authorization_documents'::text as source,
      a.power_of_attorney_id,
      null::text as document_version,
      a.uploaded_at,
      a.created_at
    from public.customer_authorization_documents a
    where a.company_id = p_company_id
      and a.customer_id = p_customer_id
      and a.status <> 'archived'
  ),
  deduplicated as (
    select x.*
    from (
      select
        d.*,
        row_number() over (
          partition by coalesce(
            d.power_of_attorney_id::text,
            d.source_table || ':' || d.id::text
          )
          order by d.source_rank desc, d.created_at desc, d.id desc
        ) as duplicate_rank
      from all_documents d
    ) x
    where x.duplicate_rank = 1
  )
  select
    d.id,d.source_table,d.source_rank,d.document_type,d.status,d.title,d.file_name,
    d.mime_type,d.file_size_bytes,d.public_url,d.source_system,d.source,
    d.power_of_attorney_id,d.document_version,d.uploaded_at,d.created_at
  from deduplicated d
  where p_cursor_created_at is null
     or (d.created_at, d.source_rank, d.id)
        < (p_cursor_created_at, coalesce(p_cursor_source_rank, 0), p_cursor_id)
  order by d.created_at desc, d.source_rank desc, d.id desc
  limit greatest(1, least(coalesce(p_limit, 51), 101));
$$;

revoke all on function public.portal_customer_documents_page_v1(uuid,uuid,timestamptz,integer,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.portal_customer_documents_page_v1(uuid,uuid,timestamptz,integer,uuid,integer)
  to service_role;

drop index if exists public.ux_billing_automation_runs_one_running_per_company_period;
drop index if exists public.billing_underlays_company_id_id_canonical_uidx;
drop index if exists public.billing_underlays_company_id_id_uidx;
drop index if exists public.communication_logs_contract_created_idx;
drop index if exists public.contract_price_snapshots_company_id_id_uidx;
drop index if exists public.idx_customer_application_intakes_idem;
drop index if exists public.customer_contracts_company_id_id_uidx;
drop index if exists public.mt_customer_contracts_company_id_id_uidx;
drop index if exists public.customer_documents_company_customer_idx;
drop index if exists public.customer_events_type_time_idx;
drop index if exists public.customer_invoices_company_id_id_canonical_uidx;
drop index if exists public.mt_customer_invoices_company_id_id_uidx;
drop index if exists public.customer_invoices_company_customer_period_perf_idx;
drop index if exists public.mt_customer_legal_acceptances_company_id_id_uidx;
drop index if exists public.customer_legal_acceptances_type_idx;
drop index if exists public.customer_notifications_customer_idx;
drop index if exists public.customer_portal_accounts_user_customer_v1b_uidx;
drop index if exists public.customer_sites_company_id_id_uidx;
drop index if exists public.mt_customer_sites_company_id_id_uidx;
drop index if exists public.idx_customer_sites_company_customer_created;
drop index if exists public.customers_company_id_id_uidx;
drop index if exists public.mt_customers_company_id_id_uidx;
drop index if exists public.ediel_messages_company_id_id_uidx;
drop index if exists public.integration_api_clients_company_id_id_canonical_uidx;
drop index if exists public.manual_email_outbox_idempotency_uidx;
drop index if exists public.metering_points_company_id_id_uidx;
drop index if exists public.mt_metering_points_company_id_id_uidx;
drop index if exists public.normalized_metering_values_company_id_id_uidx;
drop index if exists public.normalized_metering_values_company_customer_period_perf_idx;
drop index if exists public.mt_powers_of_attorney_company_id_id_uidx;
drop index if exists public.mt_supplier_switch_requests_company_id_id_uidx;
drop index if exists public.webhook_deliveries_due_idx;
drop index if exists public.website_customer_applications_customer_idx;

do $$
begin
  if to_regclass('public.customer_portal_write_idempotency_pre_resolution_uidx') is null then
    raise exception 'portal_idempotency_pre_resolution_index_missing';
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid='public.customer_portal_write_idempotency'::regclass
      and conname='customer_portal_write_idempot_company_id_api_client_id_rout_key'
  ) then
    raise exception 'portal_idempotency_legacy_constraint_still_present';
  end if;
  if to_regprocedure('public.portal_customer_documents_page_v1(uuid,uuid,timestamp with time zone,integer,uuid,integer)') is null then
    raise exception 'portal_customer_documents_page_v1_missing';
  end if;
end;
$$;
commit;
