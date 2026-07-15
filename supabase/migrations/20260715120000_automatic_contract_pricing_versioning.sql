-- Automatic, immutable and tenant-safe contract pricing versions.
-- Users submit commercial values; the database creates/reuses the canonical plan,
-- version, components and price book in one transaction.

begin;
create extension if not exists pgcrypto;

alter table if exists public.price_plans
  add column if not exists plan_code text,
  add column if not exists customer_type text not null default 'both',
  add column if not exists contract_product_id uuid;

update public.price_plans
set plan_code = lower(trim(both '-' from regexp_replace(coalesce(nullif(name,''), id::text), '[^a-zA-Z0-9]+', '-', 'g')))
where plan_code is null or btrim(plan_code) = '';

with ranked as (
  select id, row_number() over (partition by company_id, plan_code order by created_at, id) as rn
  from public.price_plans
)
update public.price_plans p
set plan_code = left(p.plan_code, 68) || '-' || substr(p.id::text, 1, 8)
from ranked r
where r.id = p.id and r.rn > 1;

alter table public.price_plans alter column plan_code set not null;
create unique index if not exists ux_price_plans_company_code on public.price_plans(company_id, plan_code);

alter table if exists public.price_plan_versions
  add column if not exists version_number integer,
  add column if not exists content_sha256 text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists published_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists supersedes_version_id uuid,
  add column if not exists updated_at timestamptz not null default now();

with numbered as (
  select id, row_number() over (partition by price_plan_id order by created_at, id) as n
  from public.price_plan_versions
)
update public.price_plan_versions v
set version_number = n.n
from numbered n
where n.id = v.id and v.version_number is null;

update public.price_plan_versions
set content_sha256 = encode(digest(coalesce(snapshot_json, '{}'::jsonb)::text, 'sha256'), 'hex')
where content_sha256 is null or content_sha256 = '';

update public.price_plan_versions
set approved_at = coalesce(approved_at, created_at),
    published_at = coalesce(published_at, created_at),
    locked_at = coalesce(locked_at, created_at)
where status in ('active','published','approved');

alter table public.price_plan_versions alter column version_number set not null;
alter table public.price_plan_versions alter column content_sha256 set not null;
create unique index if not exists ux_price_plan_versions_plan_number on public.price_plan_versions(price_plan_id, version_number);
create index if not exists idx_price_plan_versions_plan_hash on public.price_plan_versions(price_plan_id, content_sha256);

alter table if exists public.price_books
  add column if not exists price_plan_id uuid,
  add column if not exists price_plan_version_id uuid,
  add column if not exists content_sha256 text,
  add column if not exists published_at timestamptz,
  add column if not exists locked_at timestamptz;

create index if not exists idx_price_books_exact_version on public.price_books(company_id, price_plan_id, price_plan_version_id);
create unique index if not exists ux_price_books_version_hash
  on public.price_books(company_id, price_plan_version_id, content_sha256)
  where price_plan_version_id is not null and content_sha256 is not null;

alter table if exists public.contract_offers
  add column if not exists price_plan_id uuid,
  add column if not exists price_plan_version_id uuid,
  add column if not exists price_book_id uuid,
  add column if not exists commercial_snapshot jsonb not null default '{}'::jsonb;

alter table if exists public.public_contract_offers
  add column if not exists electricity_certificate_ore_per_kwh numeric,
  add column if not exists start_fee_sek numeric,
  add column if not exists administration_fee_sek numeric,
  add column if not exists break_fee_sek numeric,
  add column if not exists portfolio_management_fee_ore_per_kwh numeric,
  add column if not exists discount_value numeric,
  add column if not exists discount_unit text,
  add column if not exists discount_months integer,
  add column if not exists vat_rate numeric not null default 25,
  add column if not exists price_areas text[] not null default '{}',
  add column if not exists automatic_renewal boolean not null default false,
  add column if not exists power_of_attorney_required boolean not null default true;

create or replace function public.gridex_reject_locked_price_version_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.locked_at is not null and coalesce(current_setting('gridex.pricing_version_write', true), '') <> 'on' then
    raise exception 'Publicerad prisversion är låst och får inte ändras. Skapa en ny version.' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.gridex_reject_locked_price_child_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_locked_at timestamptz;
begin
  v_version_id := coalesce(old.price_plan_version_id, new.price_plan_version_id);
  if v_version_id is not null then
    select locked_at into v_locked_at from public.price_plan_versions where id = v_version_id;
    if v_locked_at is not null and coalesce(current_setting('gridex.pricing_version_write', true), '') <> 'on' then
      raise exception 'Priskomponent tillhör en låst prisversion och får inte ändras.' using errcode = '55000';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.gridex_reject_locked_price_book_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_book_id uuid;
  v_locked_at timestamptz;
begin
  if tg_table_name = 'price_books' then
    if old.locked_at is not null and coalesce(current_setting('gridex.pricing_version_write', true), '') <> 'on' then
      raise exception 'Publicerad prislista är låst och får inte ändras.' using errcode = '55000';
    end if;
  else
    v_book_id := coalesce(old.price_book_id, new.price_book_id);
    select locked_at into v_locked_at from public.price_books where id = v_book_id;
    if v_locked_at is not null and coalesce(current_setting('gridex.pricing_version_write', true), '') <> 'on' then
      raise exception 'Rad i låst prislista får inte ändras.' using errcode = '55000';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.gridex_create_or_version_contract_pricing(
  p_company_id uuid,
  p_plan_name text,
  p_contract_type text,
  p_pricing_model text,
  p_customer_type text,
  p_snapshot jsonb,
  p_valid_from date default null,
  p_valid_to date default null,
  p_publish boolean default false,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_version_id uuid;
  v_book_id uuid;
  v_previous_version_id uuid;
  v_plan_code text;
  v_hash text;
  v_version_number integer;
  v_version_label text;
  v_status text;
  v_now timestamptz := now();
  v_component jsonb;
begin
  if p_company_id is null or not exists(select 1 from public.companies where id = p_company_id) then
    raise exception 'Bolaget hittades inte.' using errcode = '23503';
  end if;
  if nullif(btrim(p_plan_name), '') is null then raise exception 'Avtalsnamn krävs.'; end if;
  if jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Prissnapshot måste vara ett JSON-objekt.'; end if;
  if p_valid_from is not null and p_valid_to is not null and p_valid_to < p_valid_from then raise exception 'Slutdatum får inte ligga före startdatum.'; end if;
  if p_customer_type not in ('private','business','both') then raise exception 'Ogiltig kundtyp.'; end if;
  if p_pricing_model not in ('spot','fixed','portfolio','mixed') then raise exception 'Ogiltig prismodell.'; end if;

  v_plan_code := left(lower(trim(both '-' from regexp_replace(p_plan_name, '[^a-zA-Z0-9]+', '-', 'g'))), 48)
    || '-' || left(lower(regexp_replace(p_contract_type, '[^a-zA-Z0-9]+', '-', 'g')), 12)
    || '-' || p_customer_type;
  v_hash := encode(digest(p_snapshot::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text || ':' || v_plan_code, 0));
  perform set_config('gridex.pricing_version_write', 'on', true);

  insert into public.price_plans(company_id, plan_code, name, pricing_model, customer_type, status, created_by, updated_by)
  values(p_company_id, v_plan_code, btrim(p_plan_name), p_pricing_model, p_customer_type, case when p_publish then 'active' else 'draft' end, p_actor_user_id, p_actor_user_id)
  on conflict(company_id, plan_code) do update
    set name = excluded.name,
        pricing_model = excluded.pricing_model,
        customer_type = excluded.customer_type,
        status = case when p_publish then 'active' else public.price_plans.status end,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning id into v_plan_id;

  select id, version_number, version_label
  into v_version_id, v_version_number, v_version_label
  from public.price_plan_versions
  where company_id = p_company_id and price_plan_id = v_plan_id and content_sha256 = v_hash
  order by created_at
  limit 1;

  if v_version_id is null then
    select id into v_previous_version_id
    from public.price_plan_versions
    where price_plan_id = v_plan_id
    order by version_number desc
    limit 1;

    select coalesce(max(version_number), 0) + 1 into v_version_number
    from public.price_plan_versions
    where price_plan_id = v_plan_id;

    v_version_label := 'v' || v_version_number::text;
    v_status := case when p_publish then 'published' else 'draft' end;

    insert into public.price_plan_versions(
      company_id, price_plan_id, version_number, version_label, status, valid_from, valid_to,
      snapshot_json, content_sha256, approved_at, approved_by, published_at, locked_at,
      supersedes_version_id, created_by, updated_at
    ) values(
      p_company_id, v_plan_id, v_version_number, v_version_label, v_status, p_valid_from, p_valid_to,
      p_snapshot, v_hash,
      case when p_publish then v_now end, case when p_publish then p_actor_user_id end,
      case when p_publish then v_now end, case when p_publish then v_now end,
      v_previous_version_id, p_actor_user_id, v_now
    ) returning id into v_version_id;

    for v_component in select value from jsonb_array_elements(coalesce(p_snapshot->'base_components', '[]'::jsonb)) loop
      insert into public.base_price_components(
        company_id, price_plan_version_id, source_type, label, weight_percent,
        fixed_price_sek_per_kwh, price_area, valid_from, valid_to, status, metadata, created_by
      ) values(
        p_company_id, v_version_id, coalesce(v_component->>'source_type','manual'), v_component->>'label',
        coalesce((v_component->>'weight_percent')::numeric, 100),
        nullif(v_component->>'fixed_price_sek_per_kwh','')::numeric,
        nullif(v_component->>'price_area',''), p_valid_from, p_valid_to,
        case when p_publish then 'active' else 'draft' end,
        coalesce(v_component->'metadata','{}'::jsonb), p_actor_user_id
      );
    end loop;

    for v_component in select value from jsonb_array_elements(coalesce(p_snapshot->'price_components', '[]'::jsonb)) loop
      insert into public.price_components(
        company_id, price_plan_version_id, component_type, name, description, calculation_type,
        amount, unit, vat_applicable, invoice_line_visible, periodization_mode, priority,
        valid_from, valid_to, status, metadata, created_by
      ) values(
        p_company_id, v_version_id, coalesce(v_component->>'component_type','fee'), coalesce(v_component->>'name',v_component->>'component_code','Avgift'),
        v_component->>'description', coalesce(v_component->>'calculation_type','fixed'),
        (v_component->>'amount')::numeric, v_component->>'unit',
        coalesce((v_component->>'vat_applicable')::boolean,true), coalesce((v_component->>'invoice_line_visible')::boolean,true),
        coalesce(v_component->>'periodization_mode','none'), coalesce((v_component->>'priority')::integer,100),
        p_valid_from, p_valid_to, case when p_publish then 'active' else 'draft' end,
        coalesce(v_component->'metadata','{}'::jsonb) || jsonb_build_object('component_code',v_component->>'component_code'), p_actor_user_id
      );
    end loop;
  elsif p_publish then
    update public.price_plan_versions
    set status = 'published', approved_at = coalesce(approved_at,v_now), approved_by = coalesce(approved_by,p_actor_user_id),
        published_at = coalesce(published_at,v_now), locked_at = coalesce(locked_at,v_now), updated_at = v_now
    where id = v_version_id;
  end if;

  select id into v_book_id
  from public.price_books
  where company_id = p_company_id and price_plan_version_id = v_version_id and content_sha256 = v_hash
  order by created_at
  limit 1;

  if v_book_id is null then
    insert into public.price_books(
      company_id, name, status, valid_from, valid_to, price_plan_id, price_plan_version_id,
      content_sha256, published_at, locked_at
    ) values(
      p_company_id, 'Prislista · ' || btrim(p_plan_name) || ' · ' || v_version_label,
      case when p_publish then 'published' else 'draft' end, p_valid_from, p_valid_to,
      v_plan_id, v_version_id, v_hash, case when p_publish then v_now end, case when p_publish then v_now end
    ) returning id into v_book_id;

    insert into public.price_book_lines(price_book_id, sort_order, component_key, value, unit, metadata)
    values(v_book_id, 10, 'price_plan_version', null, 'reference', jsonb_build_object(
      'price_plan_id', v_plan_id, 'price_plan_version_id', v_version_id,
      'version_number', v_version_number, 'version_label', v_version_label,
      'content_sha256', v_hash, 'snapshot', p_snapshot
    ));

    for v_component in select value from jsonb_array_elements(coalesce(p_snapshot->'price_components', '[]'::jsonb)) loop
      insert into public.price_book_lines(price_book_id, sort_order, component_key, value, unit, metadata)
      values(
        v_book_id, 100 + coalesce((v_component->>'priority')::integer,100),
        coalesce(v_component->>'component_code',v_component->>'component_type','fee'),
        (v_component->>'amount')::numeric, v_component->>'unit', v_component
      );
    end loop;
  elsif p_publish then
    update public.price_books
    set status='published', published_at=coalesce(published_at,v_now), locked_at=coalesce(locked_at,v_now), updated_at=v_now
    where id=v_book_id;
  end if;

  return jsonb_build_object(
    'price_plan_id', v_plan_id,
    'price_plan_version_id', v_version_id,
    'price_book_id', v_book_id,
    'version_number', v_version_number,
    'version_label', v_version_label,
    'content_sha256', v_hash,
    'reused', exists(select 1 from public.price_plan_versions where id=v_version_id and created_at < v_now - interval '1 millisecond')
  );
end $$;

revoke all on function public.gridex_create_or_version_contract_pricing(uuid,text,text,text,text,jsonb,date,date,boolean,uuid) from public, anon, authenticated;
grant execute on function public.gridex_create_or_version_contract_pricing(uuid,text,text,text,text,jsonb,date,date,boolean,uuid) to service_role;

-- Locked parent/child records are immutable. New commercial values must create a new version.
drop trigger if exists price_plan_versions_locked_immutable on public.price_plan_versions;
create trigger price_plan_versions_locked_immutable before update or delete on public.price_plan_versions
for each row execute function public.gridex_reject_locked_price_version_mutation();

drop trigger if exists base_price_components_locked_immutable on public.base_price_components;
create trigger base_price_components_locked_immutable before update or delete on public.base_price_components
for each row execute function public.gridex_reject_locked_price_child_mutation();

drop trigger if exists price_components_locked_immutable on public.price_components;
create trigger price_components_locked_immutable before update or delete on public.price_components
for each row execute function public.gridex_reject_locked_price_child_mutation();

drop trigger if exists price_books_locked_immutable on public.price_books;
create trigger price_books_locked_immutable before update or delete on public.price_books
for each row execute function public.gridex_reject_locked_price_book_mutation();

drop trigger if exists price_book_lines_locked_immutable on public.price_book_lines;
create trigger price_book_lines_locked_immutable before update or delete on public.price_book_lines
for each row execute function public.gridex_reject_locked_price_book_mutation();

commit;
