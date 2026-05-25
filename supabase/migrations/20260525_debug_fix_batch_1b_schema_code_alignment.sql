-- Debug Fix Batch 1B: live schema/code alignment for customer intake, billing export, Ediel registry and portal support.
-- Safe/idempotent repair migration. Does not delete business data.

-- -----------------------------------------------------------------------------
-- 1. Billing export run items: align old DB1 export_run_id shape with current code
-- -----------------------------------------------------------------------------

-- Guard: some environments have not applied the foundational billing-export table yet.
-- Create the minimal compatible table first so the repair ALTERs and indexes below cannot fail.
create table if not exists public.billing_export_run_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  export_run_id uuid,
  billing_export_run_id uuid,
  customer_id uuid,
  site_id uuid,
  metering_point_id uuid,
  billing_underlay_id uuid,
  source_type text,
  source_id uuid,
  period_start date,
  period_end date,
  status text not null default 'pending',
  blocker_reasons jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_export_run_items enable row level security;

do $$
begin
  if to_regclass('public.billing_export_run_items') is not null then
    alter table public.billing_export_run_items add column if not exists billing_export_run_id uuid;
    alter table public.billing_export_run_items add column if not exists contract_id uuid;
    alter table public.billing_export_run_items add column if not exists readiness_status text not null default 'pending';
    alter table public.billing_export_run_items add column if not exists pricing_line_items jsonb not null default '[]'::jsonb;
    alter table public.billing_export_run_items add column if not exists invoice_recipient text;
    alter table public.billing_export_run_items add column if not exists invoice_email text;
    alter table public.billing_export_run_items add column if not exists invoice_reference text;
    alter table public.billing_export_run_items add column if not exists billing_level text not null default 'customer';
    alter table public.billing_export_run_items add column if not exists consolidated_invoice boolean not null default false;
    alter table public.billing_export_run_items add column if not exists invoice_address_snapshot jsonb not null default '{}'::jsonb;
    alter table public.billing_export_run_items add column if not exists site_address_snapshot jsonb not null default '{}'::jsonb;
    alter table public.billing_export_run_items add column if not exists consolidated_invoice_group_key text;
    alter table public.billing_export_run_items add column if not exists payload_snapshot jsonb not null default '{}'::jsonb;
    alter table public.billing_export_run_items add column if not exists export_status text not null default 'not_queued';
    alter table public.billing_export_run_items add column if not exists partner_export_id uuid;
    alter table public.billing_export_run_items add column if not exists idempotency_key text;
    alter table public.billing_export_run_items add column if not exists queued_at timestamptz;
    alter table public.billing_export_run_items add column if not exists sent_at timestamptz;
    alter table public.billing_export_run_items add column if not exists acknowledged_at timestamptz;
    alter table public.billing_export_run_items add column if not exists failed_at timestamptz;
    alter table public.billing_export_run_items add column if not exists retry_count integer not null default 0;
    alter table public.billing_export_run_items add column if not exists last_error text;
    alter table public.billing_export_run_items add column if not exists blocker_case_id uuid;
    alter table public.billing_export_run_items add column if not exists payload_version text not null default 'billing_export_item_v4c';
    alter table public.billing_export_run_items add column if not exists adapter_key text not null default 'gridex_billing_partner_v1';
    alter table public.billing_export_run_items add column if not exists adapter_payload_snapshot jsonb not null default '{}'::jsonb;
    alter table public.billing_export_run_items add column if not exists partner_response_log jsonb not null default '[]'::jsonb;
    alter table public.billing_export_run_items add column if not exists last_partner_response_at timestamptz;
    alter table public.billing_export_run_items add column if not exists external_reference text;
    alter table public.billing_export_run_items add column if not exists sent_by uuid;
    alter table public.billing_export_run_items add column if not exists updated_at timestamptz not null default now();

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'billing_export_run_items' and column_name = 'export_run_id'
    ) then
      update public.billing_export_run_items
         set billing_export_run_id = export_run_id
       where billing_export_run_id is null
         and export_run_id is not null;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'billing_export_run_items' and column_name = 'payload'
    ) then
      update public.billing_export_run_items
         set payload_snapshot = payload
       where payload_snapshot = '{}'::jsonb
         and payload is not null
         and payload <> '{}'::jsonb;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.billing_export_run_items') is not null then
    create index if not exists billing_export_run_items_company_run_status_v1b_idx
      on public.billing_export_run_items(company_id, billing_export_run_id, status)
      where billing_export_run_id is not null;

    create index if not exists billing_export_run_items_company_export_status_v1b_idx
      on public.billing_export_run_items(company_id, export_status, updated_at desc);

    create index if not exists billing_export_run_items_company_blocker_case_v1b_idx
      on public.billing_export_run_items(company_id, blocker_case_id)
      where blocker_case_id is not null;

    create unique index if not exists billing_export_run_items_company_idempotency_v1b_uidx
      on public.billing_export_run_items(company_id, idempotency_key)
      where idempotency_key is not null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Ediel message/version registry: align settings UI and runtime RPCs
-- -----------------------------------------------------------------------------

-- Create minimal Ediel foundation tables if live DB is behind the code/migration chain.
-- These are intentionally dependency-light: foreign keys can be added by the normal migrations later,
-- but the repair RPCs below must not fail just because a table is missing.
create table if not exists public.ediel_message_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  message_family text not null,
  message_code text not null,
  message_standard text not null default 'edifact',
  version_code text not null,
  direction text not null default 'both',
  requires_contrl boolean not null default true,
  requires_aperak boolean not null default false,
  supports_negative_response boolean not null default true,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table public.ediel_message_rules enable row level security;

do $$
begin
  if to_regclass('public.ediel_message_rules') is not null then
    alter table public.ediel_message_rules add column if not exists created_by uuid;
    alter table public.ediel_message_rules add column if not exists updated_by uuid;
    alter table public.ediel_message_rules add column if not exists metadata jsonb not null default '{}'::jsonb;
  end if;
end $$;

do $$
begin
  if to_regclass('public.ediel_message_rules') is not null then
    create index if not exists ediel_message_rules_runtime_v1b_idx
      on public.ediel_message_rules(message_family, message_code, message_standard, direction, is_active, valid_from desc, valid_to)
      where is_active = true;
  end if;
end $$;

create or replace function public.ediel_resolve_message_rule(
  p_message_family text,
  p_message_code text,
  p_message_standard text default 'edifact',
  p_direction text default 'outbound',
  p_reference_date date default current_date
)
returns table(
  id uuid,
  message_family text,
  message_code text,
  message_standard text,
  version_code text,
  direction text,
  requires_contrl boolean,
  requires_aperak boolean,
  supports_negative_response boolean,
  is_active boolean,
  valid_from date,
  valid_to date,
  notes text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.message_family,
    r.message_code,
    r.message_standard,
    r.version_code,
    r.direction,
    r.requires_contrl,
    r.requires_aperak,
    r.supports_negative_response,
    r.is_active,
    r.valid_from,
    r.valid_to,
    r.notes
  from public.ediel_message_rules r
  where upper(r.message_family) = upper(p_message_family)
    and upper(coalesce(r.message_code, '*')) in (upper(p_message_code), '*')
    and lower(coalesce(r.message_standard, 'edifact')) = lower(coalesce(p_message_standard, 'edifact'))
    and lower(coalesce(r.direction, 'both')) in (lower(coalesce(p_direction, 'outbound')), 'both')
    and coalesce(r.is_active, true) = true
    and (r.valid_from is null or r.valid_from <= coalesce(p_reference_date, current_date))
    and (r.valid_to is null or r.valid_to >= coalesce(p_reference_date, current_date))
  order by
    case when upper(coalesce(r.message_code, '*')) = upper(p_message_code) then 0 else 1 end,
    case when lower(coalesce(r.direction, 'both')) = lower(coalesce(p_direction, 'outbound')) then 0 else 1 end,
    r.valid_from desc nulls last,
    r.updated_at desc nulls last,
    r.created_at desc nulls last
  limit 1;
$$;

create or replace function public.ediel_resolve_inbound_message_rules(
  p_message_family text,
  p_message_code text,
  p_message_standard text default 'edifact',
  p_reference_date date default current_date
)
returns table(
  id uuid,
  version_code text,
  valid_from date,
  valid_to date,
  requires_contrl boolean,
  requires_aperak boolean,
  supports_negative_response boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      r.*,
      case
        when (r.valid_from is null or r.valid_from <= coalesce(p_reference_date, current_date))
         and (r.valid_to is null or r.valid_to >= coalesce(p_reference_date, current_date)) then 0
        when r.valid_to < coalesce(p_reference_date, current_date) then 1
        else 2
      end as window_rank
    from public.ediel_message_rules r
    where upper(r.message_family) = upper(p_message_family)
      and upper(coalesce(r.message_code, '*')) in (upper(p_message_code), '*')
      and lower(coalesce(r.message_standard, 'edifact')) = lower(coalesce(p_message_standard, 'edifact'))
      and lower(coalesce(r.direction, 'both')) in ('inbound', 'both')
      and coalesce(r.is_active, true) = true
      and (r.valid_from is null or r.valid_from <= coalesce(p_reference_date, current_date))
  ), ranked as (
    select
      candidates.*,
      row_number() over (
        partition by window_rank
        order by
          case when upper(coalesce(message_code, '*')) = upper(p_message_code) then 0 else 1 end,
          valid_from desc nulls last,
          valid_to desc nulls last,
          updated_at desc nulls last,
          created_at desc nulls last
      ) as rn
    from candidates
    where window_rank in (0, 1)
  )
  select
    id,
    version_code,
    valid_from,
    valid_to,
    requires_contrl,
    requires_aperak,
    supports_negative_response
  from ranked
  where rn = 1
  order by window_rank;
$$;

-- -----------------------------------------------------------------------------
-- 3. Ediel APERAK registry/detail tables used by the runtime APERAK decisioner
-- -----------------------------------------------------------------------------

-- Create minimal APERAK/runtime issue tables if they are missing in live DB.
create table if not exists public.ediel_message_validation_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  ediel_message_id uuid,
  message_id uuid,
  issue_code text,
  rule_key text,
  severity text not null default 'warning',
  title text,
  description text,
  segment_ref text,
  field_path text,
  field_value text,
  expected_value text,
  metering_point_id text,
  transaction_reference text,
  source_order integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ediel_aperak_error_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  message_family text,
  message_code text,
  error_key text,
  rule_key text,
  rule_description text,
  erc_code text,
  application_error text,
  ftx_code text,
  free_text_code text,
  ftx_text text,
  free_text text,
  applies_to_field text,
  direction text not null default 'both',
  environment text not null default 'all',
  priority integer not null default 1000,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table if not exists public.ediel_aperak_error_details (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  error_rule_id uuid,
  source_message_id uuid,
  aperak_message_id uuid,
  validation_issue_id uuid,
  detail_key text,
  detail_value text,
  rule_key text,
  application_error text,
  free_text_code text,
  free_text text,
  metering_point_id text,
  transaction_reference text,
  source_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ediel_message_validation_issues enable row level security;
alter table public.ediel_aperak_error_rules enable row level security;
alter table public.ediel_aperak_error_details enable row level security;

do $$
begin
  if to_regclass('public.ediel_aperak_error_rules') is not null then
    alter table public.ediel_aperak_error_rules add column if not exists direction text not null default 'both';
    alter table public.ediel_aperak_error_rules add column if not exists rule_key text;
    alter table public.ediel_aperak_error_rules add column if not exists rule_description text;
    alter table public.ediel_aperak_error_rules add column if not exists application_error text;
    alter table public.ediel_aperak_error_rules add column if not exists free_text_code text;
    alter table public.ediel_aperak_error_rules add column if not exists free_text text;
    alter table public.ediel_aperak_error_rules add column if not exists applies_to_field text;
    alter table public.ediel_aperak_error_rules add column if not exists environment text not null default 'all';
    alter table public.ediel_aperak_error_rules add column if not exists priority integer not null default 1000;
    alter table public.ediel_aperak_error_rules add column if not exists valid_from date;
    alter table public.ediel_aperak_error_rules add column if not exists valid_to date;
    alter table public.ediel_aperak_error_rules add column if not exists created_by uuid;
    alter table public.ediel_aperak_error_rules add column if not exists updated_by uuid;

    update public.ediel_aperak_error_rules
       set rule_key = coalesce(rule_key, error_key),
           application_error = coalesce(application_error, erc_code),
           free_text_code = coalesce(free_text_code, ftx_code),
           free_text = coalesce(free_text, ftx_text),
           rule_description = coalesce(rule_description, error_key),
           environment = coalesce(nullif(environment, ''), 'all'),
           direction = coalesce(nullif(direction, ''), 'both')
     where rule_key is null
        or application_error is null
        or free_text_code is null
        or free_text is null
        or rule_description is null
        or environment is null
        or direction is null;
  end if;

  if to_regclass('public.ediel_message_validation_issues') is not null then
    alter table public.ediel_message_validation_issues add column if not exists message_id uuid;
    alter table public.ediel_message_validation_issues add column if not exists rule_key text;
    alter table public.ediel_message_validation_issues add column if not exists field_path text;
    alter table public.ediel_message_validation_issues add column if not exists field_value text;
    alter table public.ediel_message_validation_issues add column if not exists expected_value text;
    alter table public.ediel_message_validation_issues add column if not exists metering_point_id text;
    alter table public.ediel_message_validation_issues add column if not exists transaction_reference text;
    alter table public.ediel_message_validation_issues add column if not exists source_order integer not null default 0;
    alter table public.ediel_message_validation_issues add column if not exists updated_at timestamptz not null default now();

    update public.ediel_message_validation_issues
       set message_id = coalesce(message_id, ediel_message_id),
           rule_key = coalesce(rule_key, issue_code),
           field_path = coalesce(field_path, segment_ref)
     where message_id is null or rule_key is null or field_path is null;

    alter table public.ediel_message_validation_issues add column if not exists coalesce_field_path text generated always as (coalesce(field_path, '')) stored;
    alter table public.ediel_message_validation_issues add column if not exists coalesce_metering_point_id text generated always as (coalesce(metering_point_id, '')) stored;
    alter table public.ediel_message_validation_issues add column if not exists coalesce_transaction_reference text generated always as (coalesce(transaction_reference, '')) stored;
  end if;

  if to_regclass('public.ediel_aperak_error_details') is not null then
    alter table public.ediel_aperak_error_details add column if not exists source_message_id uuid;
    alter table public.ediel_aperak_error_details add column if not exists aperak_message_id uuid;
    alter table public.ediel_aperak_error_details add column if not exists validation_issue_id uuid;
    alter table public.ediel_aperak_error_details add column if not exists rule_key text;
    alter table public.ediel_aperak_error_details add column if not exists application_error text;
    alter table public.ediel_aperak_error_details add column if not exists free_text_code text;
    alter table public.ediel_aperak_error_details add column if not exists free_text text;
    alter table public.ediel_aperak_error_details add column if not exists metering_point_id text;
    alter table public.ediel_aperak_error_details add column if not exists transaction_reference text;
    alter table public.ediel_aperak_error_details add column if not exists source_order integer not null default 0;
    alter table public.ediel_aperak_error_details add column if not exists updated_at timestamptz not null default now();

    update public.ediel_aperak_error_details
       set rule_key = coalesce(rule_key, detail_key),
           free_text = coalesce(free_text, detail_value)
     where rule_key is null or free_text is null;

    alter table public.ediel_aperak_error_details add column if not exists coalesce_free_text_code text generated always as (coalesce(free_text_code, '')) stored;
    alter table public.ediel_aperak_error_details add column if not exists coalesce_metering_point_id text generated always as (coalesce(metering_point_id, '')) stored;
    alter table public.ediel_aperak_error_details add column if not exists coalesce_transaction_reference text generated always as (coalesce(transaction_reference, '')) stored;
  end if;
end $$;

do $$
begin
  if to_regclass('public.ediel_aperak_error_rules') is not null then
    create index if not exists ediel_aperak_error_rules_lookup_v1b_idx
      on public.ediel_aperak_error_rules(message_family, message_code, direction, environment, is_active, priority, created_at);
  end if;
end $$;

-- Deduplicate before adding the unique indexes that PostgREST upsert depends on.
do $$
begin
  if to_regclass('public.ediel_message_validation_issues') is not null then
    with ranked as (
      select id,
             row_number() over (
               partition by message_id, rule_key, coalesce_field_path, coalesce_metering_point_id, coalesce_transaction_reference
               order by created_at asc, id asc
             ) as rn
      from public.ediel_message_validation_issues
      where message_id is not null and rule_key is not null
    )
    delete from public.ediel_message_validation_issues t
    using ranked r
    where t.id = r.id and r.rn > 1;

    create unique index if not exists ediel_message_validation_issues_upsert_v1b_uidx
      on public.ediel_message_validation_issues(message_id, rule_key, coalesce_field_path, coalesce_metering_point_id, coalesce_transaction_reference);
  end if;

  if to_regclass('public.ediel_aperak_error_details') is not null then
    with ranked as (
      select id,
             row_number() over (
               partition by source_message_id, rule_key, application_error, coalesce_free_text_code, coalesce_metering_point_id, coalesce_transaction_reference
               order by created_at asc, id asc
             ) as rn
      from public.ediel_aperak_error_details
      where source_message_id is not null and rule_key is not null and application_error is not null
    )
    delete from public.ediel_aperak_error_details t
    using ranked r
    where t.id = r.id and r.rn > 1;

    create unique index if not exists ediel_aperak_error_details_upsert_v1b_uidx
      on public.ediel_aperak_error_details(source_message_id, rule_key, application_error, coalesce_free_text_code, coalesce_metering_point_id, coalesce_transaction_reference);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Auth/RBAC RPC helpers used by middleware, dashboard and guards
-- -----------------------------------------------------------------------------
create or replace function public.gridex_get_user_roles(p_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roles text[] := '{}'::text[];
  v_more text[] := '{}'::text[];
begin
  if p_user_id is null then
    return '{}'::text[];
  end if;

  if to_regclass('public.user_roles') is not null then
    begin
      execute $sql$
        select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
        from (
          select ur.role::text as role_name
          from public.user_roles ur
          where ur.user_id = $1
            and coalesce(ur.is_active, true) = true
            and ur.role is not null
        ) x
      $sql$ into v_more using p_user_id;

      select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
        into v_roles
      from unnest(coalesce(v_roles, '{}'::text[]) || coalesce(v_more, '{}'::text[])) as u(role_name);
    exception
      when undefined_table or undefined_column then
        null;
    end;

    if to_regclass('public.roles') is not null then
      begin
        execute $sql$
          select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
          from (
            select r.key::text as role_name
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = $1
              and coalesce(ur.is_active, true) = true
              and r.key is not null
          ) x
        $sql$ into v_more using p_user_id;

        select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
          into v_roles
        from unnest(coalesce(v_roles, '{}'::text[]) || coalesce(v_more, '{}'::text[])) as u(role_name);
      exception
        when undefined_table or undefined_column then
          null;
      end;
    end if;
  end if;

  if to_regclass('public.admin_users') is not null then
    begin
      execute $sql$
        select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
        from (
          select au.role::text as role_name
          from public.admin_users au
          where au.user_id = $1
            and coalesce(au.is_active, true) = true
            and au.role is not null
        ) x
      $sql$ into v_more using p_user_id;

      select coalesce(array_agg(distinct role_name order by role_name), '{}'::text[])
        into v_roles
      from unnest(coalesce(v_roles, '{}'::text[]) || coalesce(v_more, '{}'::text[])) as u(role_name);
    exception
      when undefined_table or undefined_column then
        null;
    end;
  end if;

  return coalesce(v_roles, '{}'::text[]);
end;
$$;

create or replace function public.gridex_get_user_permission_overrides(p_user_id uuid)
returns table(permission_key text, effect text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user_id is null or to_regclass('public.user_permission_overrides') is null then
    return;
  end if;

  return query execute $sql$
    select upo.permission_key::text, upo.effect::text
    from public.user_permission_overrides upo
    where upo.user_id = $1
      and coalesce(upo.is_active, true) = true
      and (upo.valid_from is null or upo.valid_from <= now())
      and (upo.valid_to is null or upo.valid_to >= now())
    order by upo.created_at asc
  $sql$ using p_user_id;
exception
  when undefined_table or undefined_column then
    return;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4B. Company invitation/membership/user-profile columns used by direct account flows
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.company_memberships') is not null then
    alter table public.company_memberships add column if not exists membership_role text default 'member';
    alter table public.company_memberships add column if not exists role_key text;
    alter table public.company_memberships add column if not exists invited_at timestamptz;
    alter table public.company_memberships add column if not exists accepted_at timestamptz;
    alter table public.company_memberships add column if not exists disabled_at timestamptz;
    alter table public.company_memberships add column if not exists disabled_by uuid;
    alter table public.company_memberships add column if not exists removed_at timestamptz;
    alter table public.company_memberships add column if not exists removed_by uuid;
    alter table public.company_memberships add column if not exists status_reason text;
    alter table public.company_memberships add column if not exists metadata jsonb not null default '{}'::jsonb;

    -- Backfill happens in a separate type-aware block below. Do not compare enum columns to ''.
  end if;

  if to_regclass('public.company_invitations') is not null then
    alter table public.company_invitations add column if not exists full_name text;
    alter table public.company_invitations add column if not exists membership_role text default 'member';
    alter table public.company_invitations add column if not exists role_key text;
    alter table public.company_invitations add column if not exists invited_by uuid;
    alter table public.company_invitations add column if not exists invited_user_id uuid;
    alter table public.company_invitations add column if not exists revoked_at timestamptz;
    alter table public.company_invitations add column if not exists accept_token_hash text;
    alter table public.company_invitations add column if not exists temporary_password_issued_at timestamptz;
    alter table public.company_invitations add column if not exists temporary_password_expires_at timestamptz;
    alter table public.company_invitations add column if not exists metadata jsonb not null default '{}'::jsonb;

    -- Backfill happens in a separate type-aware block below. Do not compare enum columns to ''.
  end if;

  if to_regclass('public.user_profiles') is not null then
    alter table public.user_profiles add column if not exists must_change_password boolean not null default false;
    alter table public.user_profiles add column if not exists temporary_password_set_at timestamptz;
    alter table public.user_profiles add column if not exists temporary_password_expires_at timestamptz;
    alter table public.user_profiles add column if not exists temporary_password_set_by uuid;
    alter table public.user_profiles add column if not exists temporary_password_company_id uuid;
    alter table public.user_profiles add column if not exists temporary_password_company_name text;
    alter table public.user_profiles add column if not exists active_company_id uuid;
    alter table public.user_profiles add column if not exists user_status text not null default 'active';
    alter table public.user_profiles add column if not exists last_auth_email_action text;
  end if;

end $$;

-- Type-aware backfill for membership_role. Some live databases have membership_role as an enum
-- (company_membership_role), so assigning/coalescing raw text such as '' will fail.
do $$
declare
  v_table text;
  v_has_table boolean;
  v_role_oid oid;
  v_role_type_sql text;
  v_is_enum boolean;
  v_default_role text;
  v_has_legacy_role boolean;
  v_has_joined_at boolean;
  v_has_created_at boolean;
  v_has_cancelled_at boolean;
  v_time_expr text;
  v_sql text;
begin
  -- company_memberships
  v_table := 'company_memberships';
  v_has_table := to_regclass('public.' || v_table) is not null;
  if v_has_table then
    select a.atttypid,
           quote_ident(n.nspname) || '.' || quote_ident(t.typname),
           t.typtype = 'e'
      into v_role_oid, v_role_type_sql, v_is_enum
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
    where cn.nspname = 'public'
      and c.relname = v_table
      and a.attname = 'membership_role'
      and not a.attisdropped;

    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = v_table and column_name = 'role') into v_has_legacy_role;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = v_table and column_name = 'joined_at') into v_has_joined_at;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = v_table and column_name = 'created_at') into v_has_created_at;

    v_time_expr := 'coalesce(accepted_at';
    if v_has_joined_at then v_time_expr := v_time_expr || ', joined_at'; end if;
    if v_has_created_at then v_time_expr := v_time_expr || ', created_at'; end if;
    v_time_expr := v_time_expr || ', now())';

    if v_role_oid is not null then
      if v_is_enum then
        select coalesce(
          (select e.enumlabel from pg_enum e where e.enumtypid = v_role_oid and e.enumlabel = 'member' limit 1),
          (select e.enumlabel from pg_enum e where e.enumtypid = v_role_oid and e.enumlabel = 'company_admin' limit 1),
          (select e.enumlabel from pg_enum e where e.enumtypid = v_role_oid order by e.enumsortorder limit 1)
        ) into v_default_role;

        if v_has_legacy_role then
          v_sql := format(
            'update public.company_memberships cm
                set membership_role = case
                  when cm.membership_role is not null then cm.membership_role
                  when cm.role is not null
                    and exists (select 1 from pg_enum e where e.enumtypid = %s::oid and e.enumlabel = cm.role::text)
                    then (cm.role::text)::%s
                  else %L::%s
                end,
                accepted_at = %s
              where cm.membership_role is null or cm.accepted_at is null',
            v_role_oid::text,
            v_role_type_sql,
            v_default_role,
            v_role_type_sql,
            v_time_expr
          );
        else
          v_sql := format(
            'update public.company_memberships cm
                set membership_role = coalesce(cm.membership_role, %L::%s),
                    accepted_at = %s
              where cm.membership_role is null or cm.accepted_at is null',
            v_default_role,
            v_role_type_sql,
            v_time_expr
          );
        end if;
      else
        if v_has_legacy_role then
          v_sql := format(
            'update public.company_memberships cm
                set membership_role = coalesce(nullif(cm.membership_role::text, ''''), nullif(cm.role::text, ''''), ''member''),
                    accepted_at = %s
              where nullif(cm.membership_role::text, '''') is null or cm.accepted_at is null',
            v_time_expr
          );
        else
          v_sql := format(
            'update public.company_memberships cm
                set membership_role = coalesce(nullif(cm.membership_role::text, ''''), ''member''),
                    accepted_at = %s
              where nullif(cm.membership_role::text, '''') is null or cm.accepted_at is null',
            v_time_expr
          );
        end if;
      end if;

      execute v_sql;
    end if;
  end if;

  -- company_invitations
  v_table := 'company_invitations';
  v_has_table := to_regclass('public.' || v_table) is not null;
  if v_has_table then
    select a.atttypid,
           quote_ident(n.nspname) || '.' || quote_ident(t.typname),
           t.typtype = 'e'
      into v_role_oid, v_role_type_sql, v_is_enum
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
    where cn.nspname = 'public'
      and c.relname = v_table
      and a.attname = 'membership_role'
      and not a.attisdropped;

    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = v_table and column_name = 'role') into v_has_legacy_role;
    select exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = v_table and column_name = 'cancelled_at') into v_has_cancelled_at;

    v_time_expr := 'coalesce(revoked_at';
    if v_has_cancelled_at then v_time_expr := v_time_expr || ', cancelled_at'; end if;
    v_time_expr := v_time_expr || ')';

    if v_role_oid is not null then
      if v_is_enum then
        select coalesce(
          (select e.enumlabel from pg_enum e where e.enumtypid = v_role_oid and e.enumlabel = 'member' limit 1),
          (select e.enumlabel from pg_enum e where e.enumtypid = v_role_oid and e.enumlabel = 'company_admin' limit 1),
          (select e.enumlabel from pg_enum e where e.enumtypid = v_role_oid order by e.enumsortorder limit 1)
        ) into v_default_role;

        if v_has_legacy_role then
          v_sql := format(
            'update public.company_invitations ci
                set membership_role = case
                  when ci.membership_role is not null then ci.membership_role
                  when ci.role is not null
                    and exists (select 1 from pg_enum e where e.enumtypid = %s::oid and e.enumlabel = ci.role::text)
                    then (ci.role::text)::%s
                  else %L::%s
                end,
                revoked_at = %s
              where ci.membership_role is null',
            v_role_oid::text,
            v_role_type_sql,
            v_default_role,
            v_role_type_sql,
            v_time_expr
          );
        else
          v_sql := format(
            'update public.company_invitations ci
                set membership_role = coalesce(ci.membership_role, %L::%s),
                    revoked_at = %s
              where ci.membership_role is null',
            v_default_role,
            v_role_type_sql,
            v_time_expr
          );
        end if;
      else
        if v_has_legacy_role then
          v_sql := format(
            'update public.company_invitations ci
                set membership_role = coalesce(nullif(ci.membership_role::text, ''''), nullif(ci.role::text, ''''), ''member''),
                    revoked_at = %s
              where nullif(ci.membership_role::text, '''') is null',
            v_time_expr
          );
        else
          v_sql := format(
            'update public.company_invitations ci
                set membership_role = coalesce(nullif(ci.membership_role::text, ''''), ''member''),
                    revoked_at = %s
              where nullif(ci.membership_role::text, '''') is null',
            v_time_expr
          );
        end if;
      end if;

      execute v_sql;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.company_invitations') is not null then
    create unique index if not exists company_invitations_accept_token_hash_v1b_uidx
      on public.company_invitations(accept_token_hash)
      where accept_token_hash is not null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Customer latest-contract bucket counts RPC
-- -----------------------------------------------------------------------------
create or replace function public.admin_customer_latest_contract_counts(
  search_text text default null,
  customer_status text default null
)
returns table(bucket text, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.customers') is null then
    return;
  end if;

  if to_regclass('public.customer_contracts') is null then
    return query execute $sql$
      select 'none'::text as bucket, count(*)::bigint as total
      from public.customers c
      where ($2 is null or $2 = '' or c.status = $2)
        and (
          $1 is null or $1 = '' or
          coalesce(c.customer_number, '') ilike '%' || $1 || '%' or
          coalesce(c.full_name, '') ilike '%' || $1 || '%' or
          coalesce(c.first_name, '') ilike '%' || $1 || '%' or
          coalesce(c.last_name, '') ilike '%' || $1 || '%' or
          coalesce(c.company_name, '') ilike '%' || $1 || '%' or
          coalesce(c.email, '') ilike '%' || $1 || '%' or
          coalesce(c.phone, '') ilike '%' || $1 || '%'
        )
    $sql$ using search_text, customer_status;
    return;
  end if;

  return query execute $sql$
    with filtered_customers as (
      select c.id
      from public.customers c
      where ($2 is null or $2 = '' or c.status = $2)
        and (
          $1 is null or $1 = '' or
          coalesce(c.customer_number, '') ilike '%' || $1 || '%' or
          coalesce(c.full_name, '') ilike '%' || $1 || '%' or
          coalesce(c.first_name, '') ilike '%' || $1 || '%' or
          coalesce(c.last_name, '') ilike '%' || $1 || '%' or
          coalesce(c.company_name, '') ilike '%' || $1 || '%' or
          coalesce(c.email, '') ilike '%' || $1 || '%' or
          coalesce(c.phone, '') ilike '%' || $1 || '%'
        )
    ), latest_contract as (
      select distinct on (cc.customer_id)
        cc.customer_id,
        cc.status
      from public.customer_contracts cc
      join filtered_customers fc on fc.id = cc.customer_id
      order by cc.customer_id, cc.created_at desc, cc.id desc
    ), bucketed as (
      select
        fc.id,
        case
          when lc.customer_id is null then 'none'
          when lc.status = 'pending_signature' then 'pending_signature'
          when lc.status = 'signed' then 'signed'
          when lc.status = 'active' then 'active'
          when lc.status in ('terminated', 'cancelled', 'expired') then 'closed'
          else 'none'
        end as bucket
      from filtered_customers fc
      left join latest_contract lc on lc.customer_id = fc.id
    )
    select bucket, count(*)::bigint as total
    from bucketed
    group by bucket
    order by bucket
  $sql$ using search_text, customer_status;
exception
  when undefined_table or undefined_column then
    return;
end;
$$;


-- -----------------------------------------------------------------------------
-- 6. Control-tower RPC helpers missing in live schema export
-- -----------------------------------------------------------------------------
create or replace function public.gridex_companies_missing_ediel_profile()
returns table(id uuid, name text, org_number text, status text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('public.companies') is null or to_regclass('public.ediel_actor_settings') is null then
    return;
  end if;

  return query execute $sql$
    select c.id, c.name::text, c.org_number::text, c.status::text, c.updated_at
    from public.companies c
    where coalesce(c.status, 'active') not in ('archived', 'deleted_test_only')
      and not exists (
        select 1
        from public.ediel_actor_settings eas
        where eas.company_id = c.id
          and coalesce(eas.is_active, true) = true
      )
    order by c.updated_at desc nulls last
  $sql$;
exception
  when undefined_table or undefined_column then
    return;
end;
$$;

create or replace function public.gridex_companies_missing_route_setup()
returns table(id uuid, name text, org_number text, status text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_has_communication_routes boolean := to_regclass('public.communication_routes') is not null;
  v_has_ediel_route_profiles boolean := to_regclass('public.ediel_route_profiles') is not null;
begin
  if to_regclass('public.companies') is null then
    return;
  end if;

  v_sql := 'select c.id, c.name::text, c.org_number::text, c.status::text, c.updated_at from public.companies c where coalesce(c.status, ''active'') not in (''archived'', ''deleted_test_only'')';

  if v_has_communication_routes then
    v_sql := v_sql || ' and not exists (select 1 from public.communication_routes cr where cr.company_id = c.id and coalesce(cr.is_active, true) = true)';
  end if;

  if v_has_ediel_route_profiles then
    v_sql := v_sql || ' and not exists (select 1 from public.ediel_route_profiles erp where erp.company_id = c.id and coalesce(erp.is_enabled, true) = true)';
  end if;

  if not v_has_communication_routes and not v_has_ediel_route_profiles then
    return query execute v_sql || ' order by c.updated_at desc nulls last';
    return;
  end if;

  return query execute v_sql || ' order by c.updated_at desc nulls last';
exception
  when undefined_table or undefined_column then
    return;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Customer portal/invoice companion columns used by the current portal code
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null then
    alter table public.customer_portal_accounts add column if not exists user_email text;
    alter table public.customer_portal_accounts add column if not exists role text not null default 'owner';
    alter table public.customer_portal_accounts add column if not exists is_active boolean not null default true;
    alter table public.customer_portal_accounts add column if not exists invited_at timestamptz;
    alter table public.customer_portal_accounts add column if not exists activated_at timestamptz;
    alter table public.customer_portal_accounts add column if not exists verified_at timestamptz;
    alter table public.customer_portal_accounts add column if not exists last_seen_at timestamptz;
    alter table public.customer_portal_accounts add column if not exists match_method text;
    alter table public.customer_portal_accounts add column if not exists verified_identity_snapshot jsonb not null default '{}'::jsonb;
    alter table public.customer_portal_accounts add column if not exists notes text;
    alter table public.customer_portal_accounts add column if not exists metadata jsonb not null default '{}'::jsonb;

    update public.customer_portal_accounts
       set user_email = coalesce(user_email, email)
     where user_email is null and email is not null;
  end if;

  if to_regclass('public.customer_portal_claims') is not null then
    alter table public.customer_portal_claims add column if not exists user_email text;
    alter table public.customer_portal_claims add column if not exists match_method text not null default 'manual';
    alter table public.customer_portal_claims add column if not exists personal_number_last4 text;
    alter table public.customer_portal_claims add column if not exists email_matched boolean not null default false;
    alter table public.customer_portal_claims add column if not exists name_matched boolean not null default false;
    alter table public.customer_portal_claims add column if not exists personal_number_matched boolean not null default false;
    alter table public.customer_portal_claims add column if not exists installation_matched boolean not null default false;
    alter table public.customer_portal_claims add column if not exists matched_site_id uuid;
    alter table public.customer_portal_claims add column if not exists matched_metering_point_id uuid;
    alter table public.customer_portal_claims add column if not exists failure_reason text;
    alter table public.customer_portal_claims add column if not exists input_snapshot jsonb not null default '{}'::jsonb;
    alter table public.customer_portal_claims add column if not exists match_snapshot jsonb not null default '{}'::jsonb;
    alter table public.customer_portal_claims add column if not exists reviewed_at timestamptz;
  end if;

  if to_regclass('public.customer_portal_events') is not null then
    alter table public.customer_portal_events add column if not exists message text;
    alter table public.customer_portal_events add column if not exists metadata jsonb not null default '{}'::jsonb;
  end if;

  if to_regclass('public.customer_invoice_lines') is not null then
    alter table public.customer_invoice_lines add column if not exists line_type text not null default 'energy';
    alter table public.customer_invoice_lines add column if not exists unit text;
    alter table public.customer_invoice_lines add column if not exists vat_rate numeric;
    alter table public.customer_invoice_lines add column if not exists sort_order integer not null default 0;
  end if;

  if to_regclass('public.customer_invoice_documents') is not null then
    alter table public.customer_invoice_documents add column if not exists document_type text not null default 'invoice_pdf';
    alter table public.customer_invoice_documents add column if not exists title text;
    alter table public.customer_invoice_documents add column if not exists public_url text;
    alter table public.customer_invoice_documents add column if not exists source_system text;
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_portal_accounts') is not null then
    create unique index if not exists customer_portal_accounts_user_customer_v1b_uidx
      on public.customer_portal_accounts(user_id, customer_id);
  end if;

  if to_regclass('public.customer_invoice_lines') is not null then
    create index if not exists customer_invoice_lines_invoice_sort_v1b_idx
      on public.customer_invoice_lines(invoice_id, sort_order, created_at);
  end if;
end $$;
