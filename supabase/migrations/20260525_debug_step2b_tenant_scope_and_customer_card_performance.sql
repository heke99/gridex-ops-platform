-- Debug Step 2B: tenant scope + customer-card performance hardening
-- Safe/additive migration. No deletes. Backfills missing company_id/customer_id from existing parent rows
-- and adds customer-card indexes used by the admin UI.

create or replace function public.gridex_debug_column_exists(p_table text, p_column text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = p_table
      and column_name = p_column
  );
$$;

do $$
begin
  -- Core customer children.
  if to_regclass('public.customer_sites') is not null
     and public.gridex_debug_column_exists('customer_sites', 'company_id')
     and public.gridex_debug_column_exists('customer_sites', 'customer_id')
     and to_regclass('public.customers') is not null
     and public.gridex_debug_column_exists('customers', 'company_id') then
    update public.customer_sites cs
       set company_id = c.company_id
      from public.customers c
     where cs.customer_id = c.id
       and cs.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.metering_points') is not null
     and to_regclass('public.customer_sites') is not null
     and public.gridex_debug_column_exists('metering_points', 'company_id')
     and public.gridex_debug_column_exists('metering_points', 'customer_id')
     and public.gridex_debug_column_exists('metering_points', 'site_id')
     and public.gridex_debug_column_exists('customer_sites', 'company_id')
     and public.gridex_debug_column_exists('customer_sites', 'customer_id') then
    update public.metering_points mp
       set company_id = coalesce(mp.company_id, cs.company_id),
           customer_id = coalesce(mp.customer_id, cs.customer_id)
      from public.customer_sites cs
     where mp.site_id = cs.id
       and (mp.company_id is null or mp.customer_id is null);
  end if;

  if to_regclass('public.customer_internal_notes') is not null
     and public.gridex_debug_column_exists('customer_internal_notes', 'company_id')
     and public.gridex_debug_column_exists('customer_internal_notes', 'customer_id')
     and to_regclass('public.customers') is not null
     and public.gridex_debug_column_exists('customers', 'company_id') then
    update public.customer_internal_notes n
       set company_id = c.company_id
      from public.customers c
     where n.customer_id = c.id
       and n.company_id is null
       and c.company_id is not null;
  end if;

  -- Customer card related tables with customer_id + company_id.
  if to_regclass('public.customer_authorization_documents') is not null
     and public.gridex_debug_column_exists('customer_authorization_documents', 'company_id')
     and public.gridex_debug_column_exists('customer_authorization_documents', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.customer_authorization_documents d
       set company_id = c.company_id
      from public.customers c
     where d.customer_id = c.id
       and d.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.powers_of_attorney') is not null
     and public.gridex_debug_column_exists('powers_of_attorney', 'company_id')
     and public.gridex_debug_column_exists('powers_of_attorney', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.powers_of_attorney p
       set company_id = c.company_id
      from public.customers c
     where p.customer_id = c.id
       and p.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.power_of_attorney_scopes') is not null
     and public.gridex_debug_column_exists('power_of_attorney_scopes', 'company_id')
     and public.gridex_debug_column_exists('power_of_attorney_scopes', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.power_of_attorney_scopes s
       set company_id = c.company_id
      from public.customers c
     where s.customer_id = c.id
       and s.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.customer_portal_accounts') is not null
     and public.gridex_debug_column_exists('customer_portal_accounts', 'company_id')
     and public.gridex_debug_column_exists('customer_portal_accounts', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.customer_portal_accounts a
       set company_id = c.company_id
      from public.customers c
     where a.customer_id = c.id
       and a.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.customer_portal_claims') is not null
     and public.gridex_debug_column_exists('customer_portal_claims', 'company_id')
     and public.gridex_debug_column_exists('customer_portal_claims', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.customer_portal_claims cl
       set company_id = c.company_id
      from public.customers c
     where cl.customer_id = c.id
       and cl.company_id is null
       and c.company_id is not null;
  end if;

  -- Operational/billing/export tables.
  if to_regclass('public.grid_owner_data_requests') is not null
     and public.gridex_debug_column_exists('grid_owner_data_requests', 'company_id')
     and public.gridex_debug_column_exists('grid_owner_data_requests', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.grid_owner_data_requests r
       set company_id = c.company_id
      from public.customers c
     where r.customer_id = c.id
       and r.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.metering_values') is not null
     and public.gridex_debug_column_exists('metering_values', 'company_id')
     and public.gridex_debug_column_exists('metering_values', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.metering_values mv
       set company_id = c.company_id
      from public.customers c
     where mv.customer_id = c.id
       and mv.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.billing_underlays') is not null
     and public.gridex_debug_column_exists('billing_underlays', 'company_id')
     and public.gridex_debug_column_exists('billing_underlays', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.billing_underlays b
       set company_id = c.company_id
      from public.customers c
     where b.customer_id = c.id
       and b.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.partner_exports') is not null
     and public.gridex_debug_column_exists('partner_exports', 'company_id')
     and public.gridex_debug_column_exists('partner_exports', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.partner_exports pe
       set company_id = c.company_id
      from public.customers c
     where pe.customer_id = c.id
       and pe.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.outbound_requests') is not null
     and public.gridex_debug_column_exists('outbound_requests', 'company_id')
     and public.gridex_debug_column_exists('outbound_requests', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.outbound_requests o
       set company_id = c.company_id
      from public.customers c
     where o.customer_id = c.id
       and o.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.supplier_switch_requests') is not null
     and public.gridex_debug_column_exists('supplier_switch_requests', 'company_id')
     and public.gridex_debug_column_exists('supplier_switch_requests', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.supplier_switch_requests r
       set company_id = c.company_id
      from public.customers c
     where r.customer_id = c.id
       and r.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.supplier_switch_events') is not null
     and to_regclass('public.supplier_switch_requests') is not null
     and public.gridex_debug_column_exists('supplier_switch_events', 'company_id')
     and public.gridex_debug_column_exists('supplier_switch_events', 'switch_request_id')
     and public.gridex_debug_column_exists('supplier_switch_requests', 'company_id') then
    update public.supplier_switch_events e
       set company_id = r.company_id
      from public.supplier_switch_requests r
     where e.switch_request_id = r.id
       and e.company_id is null
       and r.company_id is not null;
  end if;

  if to_regclass('public.ediel_messages') is not null
     and public.gridex_debug_column_exists('ediel_messages', 'company_id')
     and public.gridex_debug_column_exists('ediel_messages', 'customer_id')
     and to_regclass('public.customers') is not null then
    update public.ediel_messages em
       set company_id = c.company_id
      from public.customers c
     where em.customer_id = c.id
       and em.company_id is null
       and c.company_id is not null;
  end if;
end $$;

-- Indexes used by customer card and operational lists. Each block checks columns first.
do $$
begin
  if to_regclass('public.customer_sites') is not null and public.gridex_debug_column_exists('customer_sites', 'customer_id') and public.gridex_debug_column_exists('customer_sites', 'company_id') then
    create index if not exists customer_sites_customer_company_created_idx on public.customer_sites(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.metering_points') is not null and public.gridex_debug_column_exists('metering_points', 'site_id') and public.gridex_debug_column_exists('metering_points', 'company_id') then
    create index if not exists metering_points_site_company_created_idx on public.metering_points(site_id, company_id, created_at desc);
  end if;
  if to_regclass('public.customer_internal_notes') is not null and public.gridex_debug_column_exists('customer_internal_notes', 'customer_id') and public.gridex_debug_column_exists('customer_internal_notes', 'company_id') then
    create index if not exists customer_internal_notes_customer_company_created_idx on public.customer_internal_notes(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.customer_authorization_documents') is not null and public.gridex_debug_column_exists('customer_authorization_documents', 'customer_id') and public.gridex_debug_column_exists('customer_authorization_documents', 'company_id') then
    create index if not exists customer_authorization_documents_customer_company_uploaded_idx on public.customer_authorization_documents(customer_id, company_id, uploaded_at desc);
  end if;
  if to_regclass('public.powers_of_attorney') is not null and public.gridex_debug_column_exists('powers_of_attorney', 'customer_id') and public.gridex_debug_column_exists('powers_of_attorney', 'company_id') then
    create index if not exists powers_of_attorney_customer_company_created_idx on public.powers_of_attorney(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.power_of_attorney_scopes') is not null and public.gridex_debug_column_exists('power_of_attorney_scopes', 'customer_id') and public.gridex_debug_column_exists('power_of_attorney_scopes', 'company_id') then
    create index if not exists power_of_attorney_scopes_customer_company_created_idx on public.power_of_attorney_scopes(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.grid_owner_data_requests') is not null and public.gridex_debug_column_exists('grid_owner_data_requests', 'customer_id') and public.gridex_debug_column_exists('grid_owner_data_requests', 'company_id') then
    create index if not exists grid_owner_data_requests_customer_company_created_idx on public.grid_owner_data_requests(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.metering_values') is not null and public.gridex_debug_column_exists('metering_values', 'customer_id') and public.gridex_debug_column_exists('metering_values', 'company_id') then
    if public.gridex_debug_column_exists('metering_values', 'read_at') then
      create index if not exists metering_values_customer_company_read_idx on public.metering_values(customer_id, company_id, read_at desc);
    else
      create index if not exists metering_values_customer_company_created_idx on public.metering_values(customer_id, company_id, created_at desc);
    end if;
  end if;
  if to_regclass('public.billing_underlays') is not null and public.gridex_debug_column_exists('billing_underlays', 'customer_id') and public.gridex_debug_column_exists('billing_underlays', 'company_id') then
    create index if not exists billing_underlays_customer_company_created_idx on public.billing_underlays(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.partner_exports') is not null and public.gridex_debug_column_exists('partner_exports', 'customer_id') and public.gridex_debug_column_exists('partner_exports', 'company_id') then
    create index if not exists partner_exports_customer_company_created_idx on public.partner_exports(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.outbound_requests') is not null and public.gridex_debug_column_exists('outbound_requests', 'customer_id') and public.gridex_debug_column_exists('outbound_requests', 'company_id') then
    create index if not exists outbound_requests_customer_company_created_idx on public.outbound_requests(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.supplier_switch_requests') is not null and public.gridex_debug_column_exists('supplier_switch_requests', 'customer_id') and public.gridex_debug_column_exists('supplier_switch_requests', 'company_id') then
    create index if not exists supplier_switch_requests_customer_company_created_idx on public.supplier_switch_requests(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.supplier_switch_events') is not null and public.gridex_debug_column_exists('supplier_switch_events', 'switch_request_id') and public.gridex_debug_column_exists('supplier_switch_events', 'company_id') then
    create index if not exists supplier_switch_events_request_company_created_idx on public.supplier_switch_events(switch_request_id, company_id, created_at desc);
  end if;
  if to_regclass('public.customer_portal_accounts') is not null and public.gridex_debug_column_exists('customer_portal_accounts', 'customer_id') and public.gridex_debug_column_exists('customer_portal_accounts', 'company_id') then
    create index if not exists customer_portal_accounts_customer_company_created_idx on public.customer_portal_accounts(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.customer_portal_claims') is not null and public.gridex_debug_column_exists('customer_portal_claims', 'customer_id') and public.gridex_debug_column_exists('customer_portal_claims', 'company_id') then
    create index if not exists customer_portal_claims_customer_company_created_idx on public.customer_portal_claims(customer_id, company_id, created_at desc);
  end if;
  if to_regclass('public.ediel_messages') is not null and public.gridex_debug_column_exists('ediel_messages', 'customer_id') and public.gridex_debug_column_exists('ediel_messages', 'company_id') then
    create index if not exists ediel_messages_customer_company_created_idx on public.ediel_messages(customer_id, company_id, created_at desc);
  end if;
end $$;

-- Keep helper available for future repair migrations; safe to leave.
