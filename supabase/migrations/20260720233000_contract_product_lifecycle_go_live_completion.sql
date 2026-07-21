-- Gridex OPS contract-product lifecycle go-live completion.
-- One permanent product series, immutable versions, explicit lifecycle,
-- safe deletion/archiving, capacity enforcement and delegated RBAC.

begin;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Canonical lifecycle and missing commercial fields
-- ---------------------------------------------------------------------------
alter table public.contract_offers
  add column if not exists version_series_id uuid,
  add column if not exists supersedes_offer_id uuid references public.contract_offers(id) on delete restrict,
  add column if not exists superseded_at timestamptz,
  add column if not exists lifecycle_status text,
  add column if not exists discount_months integer,
  add column if not exists discount_calculation_base text,
  add column if not exists discount_starts_on_mode text not null default 'contract_start',
  add column if not exists automatic_renewal_term_months integer,
  add column if not exists power_of_attorney_mode text not null default 'required_when_information_missing';

update public.contract_offers
set version_series_id=coalesce(version_series_id,contract_product_id,id),
    lifecycle_status=coalesce(
      lifecycle_status,
      case
        when archived_at is not null then 'archived'
        when status='active' and is_active then 'published'
        when status='draft' then 'draft'
        else 'paused'
      end
    ),
    power_of_attorney_mode=case
      when power_of_attorney_mode in ('always_required','required_when_information_missing','not_required') then power_of_attorney_mode
      when coalesce(power_of_attorney_required,true) then 'required_when_information_missing'
      else 'not_required'
    end
where version_series_id is null or lifecycle_status is null;

alter table public.contract_offers alter column version_series_id set default gen_random_uuid();
alter table public.contract_offers alter column version_series_id set not null;
alter table public.contract_offers alter column lifecycle_status set default 'draft';
alter table public.contract_offers alter column lifecycle_status set not null;

alter table public.contract_offers drop constraint if exists contract_offers_lifecycle_status_check;
alter table public.contract_offers add constraint contract_offers_lifecycle_status_check
  check(lifecycle_status in ('draft','ready','published','paused','expired','archived','superseded'));
alter table public.contract_offers drop constraint if exists contract_offers_discount_months_check;
alter table public.contract_offers add constraint contract_offers_discount_months_check
  check(discount_months is null or discount_months>0);
alter table public.contract_offers drop constraint if exists contract_offers_auto_renew_term_check;
alter table public.contract_offers add constraint contract_offers_auto_renew_term_check
  check(automatic_renewal_term_months is null or automatic_renewal_term_months>0);
alter table public.contract_offers drop constraint if exists contract_offers_poa_mode_check;
alter table public.contract_offers add constraint contract_offers_poa_mode_check
  check(power_of_attorney_mode in ('always_required','required_when_information_missing','not_required'));
alter table public.contract_offers drop constraint if exists contract_offers_valid_window_check;
alter table public.contract_offers add constraint contract_offers_valid_window_check
  check(valid_to is null or valid_from is null or valid_to>=valid_from);
alter table public.contract_offers drop constraint if exists contract_offers_max_customers_check;
alter table public.contract_offers add constraint contract_offers_max_customers_check
  check(max_customers is null or max_customers>0);
alter table public.contract_offers drop constraint if exists contract_offers_discount_value_check;
alter table public.contract_offers add constraint contract_offers_discount_value_check
  check(discount_value is null or discount_value>=0) not valid;
alter table public.contract_offers drop constraint if exists contract_offers_discount_percent_check;
alter table public.contract_offers add constraint contract_offers_discount_percent_check
  check(discount_value is null or discount_unit<>'percent' or discount_value<=100) not valid;
alter table public.contract_offers drop constraint if exists contract_offers_discount_period_consistency_check;
alter table public.contract_offers add constraint contract_offers_discount_period_consistency_check
  check(discount_value is null or discount_months is not null) not valid;
alter table public.contract_offers drop constraint if exists contract_offers_renewal_consistency_check;
alter table public.contract_offers add constraint contract_offers_renewal_consistency_check
  check(not coalesce(automatic_renewal,false) or automatic_renewal_term_months is not null) not valid;
alter table public.contract_offers drop constraint if exists contract_offers_vat_rate_range_check;
alter table public.contract_offers add constraint contract_offers_vat_rate_range_check
  check(vat_rate is null or (vat_rate>=0 and vat_rate<=100)) not valid;
alter table public.contract_offers drop constraint if exists contract_offers_nonnegative_fees_check;
alter table public.contract_offers add constraint contract_offers_nonnegative_fees_check
  check(
    (start_fee_sek is null or start_fee_sek>=0)
    and (admin_fee_sek is null or admin_fee_sek>=0)
    and (break_fee_sek is null or break_fee_sek>=0)
    and (monthly_fee_sek is null or monthly_fee_sek>=0)
    and (invoice_fee_sek is null or invoice_fee_sek>=0)
  ) not valid;

create unique index if not exists contract_offers_company_series_version_uidx
  on public.contract_offers(company_id,version_series_id,version_number)
  where company_id is not null;
create index if not exists contract_offers_company_lifecycle_idx
  on public.contract_offers(company_id,lifecycle_status,updated_at desc);

-- A product series may have only one mutable successor at a time. Keep the
-- newest draft/ready row and retire stale parallel drafts before enforcing it.
with ranked as (
  select id,row_number() over(
    partition by company_id,version_series_id
    order by version_number desc,updated_at desc,id desc
  ) as rn
  from public.contract_offers
  where lifecycle_status in ('draft','ready')
)
update public.contract_offers o
set lifecycle_status='superseded',status='inactive',is_active=false,
    superseded_at=coalesce(superseded_at,now()),updated_at=now()
from ranked r
where r.id=o.id and r.rn>1;

create unique index if not exists contract_offers_one_open_draft_per_series_uidx
  on public.contract_offers(company_id,version_series_id)
  where lifecycle_status in ('draft','ready');

alter table public.public_contract_offers
  add column if not exists source_contract_offer_id uuid references public.contract_offers(id) on delete restrict,
  add column if not exists lifecycle_status text;

do $$
begin
  -- This is a controlled canonical backfill. Published legacy rows remain
  -- immutable for normal application writes, but the migration must be able
  -- to attach lifecycle metadata without forcing a false new version.
  perform set_config('gridex.public_offer_write','on',true);
  update public.public_contract_offers
  set lifecycle_status=coalesce(
    lifecycle_status,
    case
      when is_archived or publication_status='archived' then 'archived'
      when publication_status='published' and is_public then 'published'
      when publication_status in ('draft','review') then 'draft'
      when publication_status='expired' then 'expired'
      else 'paused'
    end
  )
  where lifecycle_status is null;
end $$;

alter table public.public_contract_offers alter column lifecycle_status set default 'draft';
alter table public.public_contract_offers alter column lifecycle_status set not null;
alter table public.public_contract_offers drop constraint if exists public_contract_offers_lifecycle_status_check;
alter table public.public_contract_offers add constraint public_contract_offers_lifecycle_status_check
  check(lifecycle_status in ('draft','ready','published','paused','expired','archived','superseded'));

-- ---------------------------------------------------------------------------
-- Permission catalog: schema-compatible across old/new permission table shapes
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_name boolean;
  v_has_label boolean;
  v_has_description boolean;
  v_has_category boolean;
  v_has_area boolean;
  v_has_risk boolean;
  v_has_is_active boolean;
  v_row record;
  v_columns text[];
  v_values text[];
  v_updates text[];
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='name') into v_has_name;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='label') into v_has_label;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='description') into v_has_description;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='category') into v_has_category;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='area') into v_has_area;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='risk') into v_has_risk;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='permissions' and column_name='is_active') into v_has_is_active;

  for v_row in
    select * from (values
      ('contracts.create','Skapa avtalsutkast','Kan skapa avtalsutkast i canonical avtalsmodell.','high'),
      ('contracts.edit_draft','Redigera avtalsutkast','Kan redigera olåsta avtalsutkast.','high'),
      ('contracts.create_version','Skapa avtalsversion','Kan skapa en immutable version i befintlig produktserie.','high'),
      ('contracts.publish','Publicera avtal','Kan publicera readiness-godkänd avtalsversion.','high'),
      ('contracts.pause','Pausa avtal','Kan pausa avtalskanaler.','high'),
      ('contracts.archive','Arkivera avtal','Kan arkivera produktserie med historik bevarad.','high'),
      ('contracts.delete_unused','Radera oanvända avtalsutkast','Kan permanent radera oanvända utkast efter dependency-kontroll.','high')
    ) x(permission_key,display_name,description,risk)
  loop
    v_columns:=array['key'];
    v_values:=array[quote_literal(v_row.permission_key)];
    v_updates:=array[]::text[];
    if v_has_name then v_columns:=array_append(v_columns,'name'); v_values:=array_append(v_values,quote_literal(v_row.display_name)); v_updates:=array_append(v_updates,'name=excluded.name'); end if;
    if v_has_label then v_columns:=array_append(v_columns,'label'); v_values:=array_append(v_values,quote_literal(v_row.display_name)); v_updates:=array_append(v_updates,'label=excluded.label'); end if;
    if v_has_description then v_columns:=array_append(v_columns,'description'); v_values:=array_append(v_values,quote_literal(v_row.description)); v_updates:=array_append(v_updates,'description=excluded.description'); end if;
    if v_has_category then v_columns:=array_append(v_columns,'category'); v_values:=array_append(v_values,quote_literal('contracts')); v_updates:=array_append(v_updates,'category=excluded.category'); end if;
    if v_has_area then v_columns:=array_append(v_columns,'area'); v_values:=array_append(v_values,quote_literal('Avtal')); v_updates:=array_append(v_updates,'area=excluded.area'); end if;
    if v_has_risk then v_columns:=array_append(v_columns,'risk'); v_values:=array_append(v_values,quote_literal(v_row.risk)); v_updates:=array_append(v_updates,'risk=excluded.risk'); end if;
    if v_has_is_active then v_columns:=array_append(v_columns,'is_active'); v_values:=array_append(v_values,'true'); v_updates:=array_append(v_updates,'is_active=true'); end if;

    execute format(
      'insert into public.permissions(%s) values(%s) on conflict(key) do %s',
      array_to_string(v_columns,','),
      array_to_string(v_values,','),
      case when cardinality(v_updates)>0 then 'update set '||array_to_string(v_updates,',') else 'nothing' end
    );
  end loop;
end $$;

create or replace function public.gridex_contract_actor_has_permission(
  p_actor_user_id uuid,p_permission text
) returns boolean
language sql
stable
security definer
set search_path=public,auth,pg_temp
as $$
  select p_actor_user_id is not null
    and (coalesce(auth.role(),'')='service_role' or p_actor_user_id=auth.uid())
    and (
      exists(
        select 1 from public.admin_users au
        where au.user_id=p_actor_user_id and coalesce(au.is_active,true)
          and lower(coalesce(au.role,'')) in ('super_admin','superadmin','platform_superadmin')
      )
      or exists(
        select 1
        from public.user_roles ur
        left join public.roles r on r.id=ur.role_id
        where ur.user_id=p_actor_user_id
          and coalesce(ur.status,'active')='active'
          and coalesce(ur.is_active,true)
          and lower(coalesce(ur.role,r.key,r.name,'')) in ('super_admin','superadmin','platform_superadmin')
      )
      or public.gridex_has_permission(p_actor_user_id,p_permission)
    )
$$;

create or replace function public.gridex_assert_contract_permission(
  p_actor_user_id uuid,p_permission text
) returns void
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
begin
  if not public.gridex_contract_actor_has_permission(p_actor_user_id,p_permission) then
    raise exception using errcode='42501',message='contract_permission_denied:'||coalesce(p_permission,'unknown');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Shared readiness gate
-- ---------------------------------------------------------------------------
create or replace function public.gridex_validate_contract_readiness(
  p_company_id uuid,p_contract_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_blockers text[]:='{}'::text[];
  v_snapshot jsonb;
  v_required_modules text[];
  v_production_enabled boolean:=false;
begin
  select * into o from public.contract_offers
  where id=p_contract_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object('status','blocked','can_publish',false,'blockers',jsonb_build_array('contract_offer_not_found'));
  end if;

  v_snapshot:=coalesce(o.commercial_snapshot,'{}'::jsonb);
  v_production_enabled:=coalesce((v_snapshot#>>'{production,enabled}')::boolean,false);
  v_required_modules:=public.gridex_required_legal_modules(
    o.customer_type,o.contract_type,'internal',coalesce(o.automatic_renewal,false),
    coalesce(o.power_of_attorney_required,true),v_production_enabled
  );

  if nullif(btrim(o.name),'') is null then v_blockers:=array_append(v_blockers,'name_missing'); end if;
  if o.price_plan_id is null then v_blockers:=array_append(v_blockers,'price_plan_missing'); end if;
  if o.price_plan_version_id is null then v_blockers:=array_append(v_blockers,'price_plan_version_missing'); end if;
  if o.price_book_id is null then v_blockers:=array_append(v_blockers,'price_book_missing'); end if;
  if o.invoice_fee_sek is null then v_blockers:=array_append(v_blockers,'invoice_fee_missing'); end if;
  if o.invoice_fee_sek is not null and o.invoice_fee_sek<0 then v_blockers:=array_append(v_blockers,'invoice_fee_invalid'); end if;
  if o.vat_rate is null or o.vat_rate<0 or o.vat_rate>100 then v_blockers:=array_append(v_blockers,'vat_rate_invalid'); end if;
  if o.contract_type='fixed' and (o.fixed_price_ore_per_kwh is null or o.fixed_price_ore_per_kwh<=0) then v_blockers:=array_append(v_blockers,'fixed_price_missing'); end if;
  if jsonb_array_length(
       case when jsonb_typeof(v_snapshot->'price_areas')='array'
         then v_snapshot->'price_areas' else '[]'::jsonb end
     )=0 then
    v_blockers:=array_append(v_blockers,'price_areas_missing');
  elsif (select count(*) from jsonb_array_elements_text(v_snapshot->'price_areas'))
        <> (select count(distinct upper(value)) from jsonb_array_elements_text(v_snapshot->'price_areas')) then
    v_blockers:=array_append(v_blockers,'duplicate_price_areas');
  end if;
  if o.valid_from is not null and o.valid_to is not null and o.valid_to<o.valid_from then v_blockers:=array_append(v_blockers,'invalid_validity_period'); end if;
  if o.max_customers is not null and o.max_customers<=0 then v_blockers:=array_append(v_blockers,'invalid_max_customers'); end if;
  if coalesce(o.automatic_renewal,false) and o.automatic_renewal_term_months is null then v_blockers:=array_append(v_blockers,'automatic_renewal_term_missing'); end if;
  if o.discount_value is not null and o.discount_months is null then v_blockers:=array_append(v_blockers,'discount_months_missing'); end if;
  if o.contract_type in ('portfolio','mixed') and nullif(v_snapshot#>>'{portfolio_method,portfolio_id}','') is null then v_blockers:=array_append(v_blockers,'portfolio_id_missing'); end if;
  if o.contract_type in ('portfolio','mixed') and coalesce((v_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}')::numeric,0)
      +coalesce((v_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}')::numeric,0)
      +coalesce((v_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}')::numeric,0)<>100 then
    v_blockers:=array_append(v_blockers,'pricing_weights_invalid');
  end if;
  if not exists(
    select 1 from public.platform_go_live_readiness_v readiness
    where readiness.company_id=p_company_id
      and readiness.has_actor_setting
      and readiness.has_brp
      and readiness.has_prodat_route
      and readiness.has_utilts_route
      and readiness.has_sender_identity
  ) then v_blockers:=array_append(v_blockers,'tenant_go_live_not_ready'); end if;
  if not exists(
    select 1 from public.tenant_legal_profiles lp
    where lp.company_id=p_company_id
      and lp.completeness_status in ('complete','verified')
      and not coalesce(lp.review_required,false)
  ) then v_blockers:=array_append(v_blockers,'tenant_legal_profile_not_ready'); end if;
  if exists(
    select 1 from unnest(v_required_modules) as required(module_key)
    where not exists(
      select 1 from public.legal_templates lt
      join public.legal_template_versions ltv on ltv.legal_template_id=lt.id
      where lt.module_key=required.module_key and lt.status='active'
        and ltv.status='published' and ltv.locked_at is not null
    )
  ) then v_blockers:=array_append(v_blockers,'required_legal_modules_missing'); end if;

  return jsonb_build_object(
    'status',case when cardinality(v_blockers)=0 then 'ready' else 'blocked' end,
    'can_publish',cardinality(v_blockers)=0,
    'blockers',to_jsonb(v_blockers),
    'required_legal_modules',to_jsonb(v_required_modules),
    'evaluated_at',now()
  );
end $$;

-- ---------------------------------------------------------------------------
-- Stable product series and immutable canonical versions
-- ---------------------------------------------------------------------------
create or replace function public.gridex_sync_internal_offer_to_canonical(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_product_id uuid;
  v_version_id uuid;
  v_assignment_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_number integer;
  v_required text[];
  v_legal_version_id uuid;
  v_production_enabled boolean:=false;
  v_sellable boolean:=false;
  v_product_status text;
begin
  select * into o from public.contract_offers where id=p_offer_id for update;
  if not found or o.company_id is null then return null; end if;

  v_product_id:=o.contract_product_id;
  if v_product_id is null and o.supersedes_offer_id is not null then
    select contract_product_id into v_product_id
    from public.contract_offers where id=o.supersedes_offer_id;
  end if;
  if v_product_id is null then
    select id into v_product_id
    from public.contract_products
    where company_id=o.company_id and product_code='contract:'||o.version_series_id::text
    limit 1;
  end if;

  v_product_status:=case
    when o.lifecycle_status='published' then 'active'
    when o.lifecycle_status='archived' then 'archived'
    when exists(
      select 1 from public.contract_offers sibling
      where sibling.company_id=o.company_id
        and sibling.version_series_id=o.version_series_id
        and sibling.id<>o.id
        and sibling.lifecycle_status='published'
        and sibling.is_active
    ) then 'active'
    when o.lifecycle_status in ('draft','ready') then 'draft'
    else 'paused'
  end;

  if v_product_id is null then
    insert into public.contract_products(
      company_id,product_code,name,product_category,description,status,created_by
    ) values(
      o.company_id,'contract:'||o.version_series_id::text,o.name,'electricity',o.description,v_product_status,o.created_by
    ) returning id into v_product_id;
  else
    update public.contract_products
    set name=case when o.lifecycle_status='published'
                    or not exists(
                      select 1 from public.contract_offers sibling
                      where sibling.company_id=o.company_id
                        and sibling.version_series_id=o.version_series_id
                        and sibling.id<>o.id
                        and sibling.lifecycle_status='published'
                        and sibling.is_active
                    ) then o.name else name end,
        description=case when o.lifecycle_status='published'
                    or not exists(
                      select 1 from public.contract_offers sibling
                      where sibling.company_id=o.company_id
                        and sibling.version_series_id=o.version_series_id
                        and sibling.id<>o.id
                        and sibling.lifecycle_status='published'
                        and sibling.is_active
                    ) then o.description else description end,
        status=v_product_status,
        updated_at=now()
    where id=v_product_id and company_id=o.company_id;
  end if;

  v_production_enabled:=coalesce((o.commercial_snapshot#>>'{production,enabled}')::boolean,false);
  v_required:=public.gridex_required_legal_modules(
    o.customer_type,o.contract_type,'internal',coalesce(o.automatic_renewal,false),
    coalesce(o.power_of_attorney_required,true),v_production_enabled
  );

  -- Lifecycle/publication state is intentionally excluded from the immutable
  -- commercial hash. Publishing an unchanged draft must lock the same version,
  -- not create a second price/product version only because status changed.
  v_snapshot:=(coalesce(o.commercial_snapshot,'{}'::jsonb)-'lifecycle_status')||jsonb_strip_nulls(jsonb_build_object(
    'schema','gridex_contract_product_version_v5',
    'version_series_id',o.version_series_id,
    'legacy_contract_offer_id',o.id,
    'supersedes_offer_id',o.supersedes_offer_id,
    'company_id',o.company_id,
    'name',o.name,
    'customer_type',o.customer_type,
    'contract_type',o.contract_type,
    'price_plan_id',o.price_plan_id,
    'price_plan_version_id',o.price_plan_version_id,
    'price_book_id',o.price_book_id,
    'price_version',o.price_version,
    'terms_version',o.terms_version,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to,
    'max_customers',o.max_customers,
    'discount_value',o.discount_value,
    'discount_unit',o.discount_unit,
    'discount_months',o.discount_months,
    'discount_calculation_base',o.discount_calculation_base,
    'discount_starts_on_mode',o.discount_starts_on_mode,
    'automatic_renewal',o.automatic_renewal,
    'automatic_renewal_term_months',o.automatic_renewal_term_months,
    'power_of_attorney_required',o.power_of_attorney_required,
    'power_of_attorney_mode',o.power_of_attorney_mode,
    'optional_fees',coalesce(o.optional_fee_lines,'[]'::jsonb),
    'required_legal_modules',v_required,
    'legal_source','legal_template_versions'
  ));
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_version_id
  from public.contract_product_versions
  where contract_product_id=v_product_id and content_sha256=v_hash
  limit 1;

  if v_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number
    from public.contract_product_versions where contract_product_id=v_product_id;

    insert into public.contract_product_versions(
      contract_product_id,version_number,customer_type,contract_type,pricing_model,
      price_plan_id,price_plan_version_id,binding_months,notice_months,price_areas,
      automatic_renewal,power_of_attorney_required,required_legal_modules,
      commercial_snapshot,content_sha256,status,approved_at,approved_by,locked_at,created_by
    ) values(
      v_product_id,v_number,o.customer_type,o.contract_type,
      coalesce(v_snapshot->>'pricing_model',o.contract_type),o.price_plan_id,o.price_plan_version_id,
      o.default_binding_months,o.default_notice_months,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),
      coalesce(o.automatic_renewal,false),coalesce(o.power_of_attorney_required,true),v_required,
      v_snapshot,v_hash,
      case when o.lifecycle_status='published' then 'approved' else 'draft' end,
      case when o.lifecycle_status='published' then now() end,
      case when o.lifecycle_status='published' then o.updated_by end,
      case when o.lifecycle_status='published' then now() end,
      o.created_by
    ) returning id into v_version_id;
  elsif o.lifecycle_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_product_versions
    set status='approved',approved_at=coalesce(approved_at,now()),approved_by=coalesce(approved_by,o.updated_by),locked_at=coalesce(locked_at,now())
    where id=v_version_id and (status<>'approved' or locked_at is null);
  end if;

  v_sellable:=o.lifecycle_status='published'
    and (o.valid_from is null or o.valid_from<=current_date)
    and (o.valid_to is null or o.valid_to>=current_date);

  if o.lifecycle_status='published' then
    -- Internal publication moves only the internal sales channel. Website/API
    -- channels on the predecessor remain live until that exact channel is
    -- explicitly published for the successor, preventing a sales outage.
    update public.tenant_contract_channels ch
    set status='ended',valid_to=coalesce(valid_to,now()),updated_at=now()
    from public.tenant_contract_assignments ta
    join public.contract_product_versions oldv on oldv.id=ta.contract_product_version_id
    where ch.assignment_id=ta.id and ta.company_id=o.company_id
      and oldv.contract_product_id=v_product_id
      and ta.contract_product_version_id<>v_version_id
      and ch.channel='internal'
      and ch.status in ('active','paused');

    update public.tenant_contract_assignments ta
    set internal_sales_allowed=false,
        status=case when exists(
          select 1 from public.tenant_contract_channels remaining
          where remaining.assignment_id=ta.id and remaining.status='active'
            and (remaining.valid_from is null or remaining.valid_from<=now())
            and (remaining.valid_to is null or remaining.valid_to>=now())
        ) then 'active' else 'ended' end,
        valid_to=case when exists(
          select 1 from public.tenant_contract_channels remaining
          where remaining.assignment_id=ta.id and remaining.status='active'
            and (remaining.valid_from is null or remaining.valid_from<=now())
            and (remaining.valid_to is null or remaining.valid_to>=now())
        ) then ta.valid_to else coalesce(ta.valid_to,current_date) end,
        updated_at=now()
    from public.contract_product_versions oldv
    where oldv.id=ta.contract_product_version_id and ta.company_id=o.company_id
      and oldv.contract_product_id=v_product_id
      and ta.contract_product_version_id<>v_version_id;

    v_legal_version_id:=public.gridex_materialize_legal_bundle_version(
      o.company_id,v_version_id,null,o.updated_by
    );
    if exists(
      select 1 from public.legal_bundle_versions
      where id=v_legal_version_id and cardinality(unresolved_variables)>0
    ) then
      raise exception using errcode='23514',message='internal_offer_legal_documents_not_ready';
    end if;
    perform set_config('gridex.version_transition','on',true);
    update public.legal_bundle_versions
    set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now())
    where id=v_legal_version_id and locked_at is null;
  else
    v_legal_version_id:=o.legal_bundle_version_id;
  end if;

  insert into public.tenant_contract_assignments(
    company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,
    status,legal_mode,valid_from,valid_to,assigned_by
  ) values(
    o.company_id,v_version_id,true,false,
    case when v_sellable then 'active' else 'paused' end,
    coalesce((select legal_mode from public.legal_bundle_versions where id=v_legal_version_id),'ops_standard'),
    o.valid_from,o.valid_to,o.updated_by
  )
  on conflict(company_id,contract_product_version_id) do update set
    internal_sales_allowed=true,
    status=excluded.status,
    legal_mode=excluded.legal_mode,
    valid_from=excluded.valid_from,
    valid_to=excluded.valid_to,
    updated_at=now()
  returning id into v_assignment_id;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,'internal',case when v_sellable then 'active' else 'paused' end,
    o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object(
      'name',o.name,'version_series_id',o.version_series_id,
      'source_of_truth','contract_product_versions'
    ),o.updated_by
  )
  on conflict(assignment_id,channel) do update set
    status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,
    marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  update public.contract_offers
  set contract_product_id=v_product_id,
      contract_product_version_id=v_version_id,
      legal_bundle_version_id=v_legal_version_id,
      legal_bundle_id=null,
      updated_at=now()
  where id=o.id;

  return v_version_id;
end $$;

create or replace function public.gridex_upsert_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_old public.contract_offers%rowtype;
  v_saved public.contract_offers%rowtype;
  v_pricing jsonb;
  v_new_id uuid;
  v_active boolean;
  v_status text;
  v_lifecycle text;
  v_customer_type text;
  v_slug text;
  v_version integer;
  v_canonical uuid;
  v_series uuid;
  v_product_id uuid;
  v_create_version boolean:=false;
  v_invoice_fee numeric;
  v_poa_mode text;
  v_discount_value numeric;
  v_discount_months integer;
  v_auto_renewal boolean;
  v_auto_renewal_term integer;
  v_vat_rate numeric;
begin
  if p_company_id is null or p_actor_user_id is null then
    raise exception using errcode='22023',message='company_actor_required';
  end if;
  perform public.gridex_assert_contract_permission(
    p_actor_user_id,case when p_offer_id is null then 'contracts.create' else 'contracts.edit_draft' end
  );
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.write');

  if p_offer_id is not null then
    select * into v_old from public.contract_offers
    where id=p_offer_id and company_id=p_company_id for update;
    if not found then raise exception using errcode='P0002',message='internal_contract_offer_not_found'; end if;
  end if;

  v_lifecycle:=coalesce(nullif(p_payload->>'lifecycle_status',''),'draft');
  if v_lifecycle not in ('draft','ready') then
    raise exception using errcode='23514',message='contract_draft_save_requires_draft_or_ready';
  end if;

  -- Saving commercial data never publishes it. Publication is a separate
  -- readiness-gated command that promotes and locks the exact same price and
  -- product versions.
  v_status:='draft';
  v_active:=false;
  v_customer_type:=coalesce(nullif(p_payload->>'customer_type',''),'both');
  if v_customer_type not in ('private','business','both') then
    raise exception using errcode='22023',message='invalid_customer_type';
  end if;

  v_invoice_fee:=nullif(replace(coalesce(p_payload->>'invoice_fee_sek',''),',','.'),'')::numeric;
  v_poa_mode:=coalesce(nullif(p_payload->>'power_of_attorney_mode',''),'required_when_information_missing');
  v_discount_value:=nullif(replace(coalesce(p_payload->>'discount_value',''),',','.'),'')::numeric;
  v_discount_months:=nullif(p_payload->>'discount_months','')::integer;
  v_auto_renewal:=coalesce((p_payload->>'automatic_renewal')::boolean,false);
  v_auto_renewal_term:=nullif(p_payload->>'automatic_renewal_term_months','')::integer;
  v_vat_rate:=coalesce(nullif(replace(coalesce(p_payload->>'vat_rate',''),',','.'),'')::numeric,25);
  if v_poa_mode not in ('always_required','required_when_information_missing','not_required') then
    raise exception using errcode='22023',message='invalid_power_of_attorney_mode';
  end if;
  if v_discount_value is not null and (v_discount_value<0 or v_discount_months is null or v_discount_months<1) then
    raise exception using errcode='23514',message='invalid_discount_configuration';
  end if;
  if coalesce(p_payload->>'discount_unit','')='percent' and coalesce(v_discount_value,0)>100 then
    raise exception using errcode='23514',message='invalid_discount_percent';
  end if;
  if v_auto_renewal and coalesce(v_auto_renewal_term,0)<1 then
    raise exception using errcode='23514',message='automatic_renewal_term_missing';
  end if;
  if v_vat_rate<0 or v_vat_rate>100 then
    raise exception using errcode='23514',message='invalid_vat_rate';
  end if;
  if coalesce(nullif(p_payload->>'start_fee_sek','')::numeric,0)<0
     or coalesce(nullif(p_payload->>'admin_fee_sek','')::numeric,0)<0
     or coalesce(nullif(p_payload->>'break_fee_sek','')::numeric,0)<0
     or coalesce(nullif(p_payload->>'monthly_fee_sek','')::numeric,0)<0 then
    raise exception using errcode='23514',message='negative_contract_fee_not_allowed';
  end if;
  if v_active and v_invoice_fee is null then
    raise exception using errcode='23514',message='invoice_fee_missing';
  end if;
  if v_invoice_fee is not null and v_invoice_fee<0 then
    raise exception using errcode='23514',message='invalid_invoice_fee';
  end if;

  v_series:=coalesce(v_old.version_series_id,gen_random_uuid());
  v_product_id:=v_old.contract_product_id;
  v_create_version:=v_old.id is not null and (
    v_old.lifecycle_status in ('published','paused','expired','archived','superseded')
    or v_old.contract_product_version_id is not null and exists(
      select 1 from public.contract_product_versions cpv
      where cpv.id=v_old.contract_product_version_id and cpv.locked_at is not null
    )
    or exists(select 1 from public.customer_contracts c where c.company_id=p_company_id and (c.contract_offer_id=v_old.id or c.contract_product_id=v_old.contract_product_id))
  );
  if v_create_version then
    perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create_version');
    if exists(
      select 1 from public.contract_offers open_draft
      where open_draft.company_id=p_company_id
        and open_draft.version_series_id=v_series
        and open_draft.id<>v_old.id
        and open_draft.lifecycle_status in ('draft','ready')
    ) then
      raise exception using errcode='23505',message='contract_series_open_draft_exists';
    end if;
  end if;

  p_pricing_snapshot:=(coalesce(p_pricing_snapshot,'{}'::jsonb)-'lifecycle_status')||jsonb_build_object(
    'plan_code','contract-'||v_series::text,
    'product_key','contract-'||v_series::text,
    'version_series_id',v_series
  );
  v_pricing:=public.gridex_create_or_version_contract_pricing(
    p_company_id,p_payload->>'name',p_payload->>'contract_type',
    coalesce(p_payload->>'pricing_model','spot'),v_customer_type,p_pricing_snapshot,
    nullif(p_payload->>'valid_from','')::date,nullif(p_payload->>'valid_to','')::date,
    v_active,p_actor_user_id
  );

  v_slug:=coalesce(
    nullif(p_payload->>'slug',''),
    lower(trim(both '-' from regexp_replace(p_payload->>'name','[^a-zA-Z0-9]+','-','g')))
  );
  if v_create_version then
    -- The currently published predecessor stays sellable while the successor
    -- is only a draft. It is superseded atomically only when the successor is
    -- successfully published.
    v_new_id:=gen_random_uuid();
    select coalesce(max(version_number),0)+1 into v_version
    from public.contract_offers where company_id=p_company_id and version_series_id=v_series;
    v_slug:=left(v_slug,105)||'-v'||v_version;
  else
    v_new_id:=coalesce(v_old.id,gen_random_uuid());
    v_version:=coalesce(v_old.version_number,1);
  end if;

  insert into public.contract_offers(
    id,company_id,version_series_id,supersedes_offer_id,contract_product_id,
    name,slug,status,lifecycle_status,contract_type,customer_type,
    campaign_name,campaign_code,campaign_version,price_version,terms_version,offer_version,version_number,
    version_snapshot,max_customers,discount_value,discount_unit,discount_months,discount_calculation_base,discount_starts_on_mode,
    start_fee_sek,admin_fee_sek,break_fee_sek,vat_rate,description,
    fixed_price_ore_per_kwh,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,monthly_fee_sek,invoice_fee_sek,
    green_fee_mode,green_fee_value,default_binding_months,default_notice_months,optional_fee_lines,
    is_active,valid_from,valid_to,price_plan_id,price_plan_version_id,price_book_id,commercial_snapshot,
    automatic_renewal,automatic_renewal_term_months,power_of_attorney_required,power_of_attorney_mode,
    legal_bundle_id,last_price_change_at,created_by,updated_by,archived_at
  ) values(
    v_new_id,p_company_id,v_series,case when v_create_version then v_old.id else v_old.supersedes_offer_id end,v_product_id,
    p_payload->>'name',v_slug,v_status,v_lifecycle,p_payload->>'contract_type',v_customer_type,
    nullif(p_payload->>'campaign_name',''),nullif(p_payload->>'campaign_code',''),nullif(p_payload->>'campaign_version',''),
    v_pricing->>'version_label',nullif(p_payload->>'terms_version',''),
    coalesce(nullif(p_payload->>'terms_version',''),v_pricing->>'version_label','v1'),v_version,
    jsonb_build_object(
      'model','canonical_contract_product_version','version_series_id',v_series,
      'price_plan_id',v_pricing->>'price_plan_id','price_plan_version_id',v_pricing->>'price_plan_version_id',
      'price_book_id',v_pricing->>'price_book_id','pricing_snapshot',p_pricing_snapshot,
      'legal_source','legal_template_versions'
    ),
    nullif(p_payload->>'max_customers','')::integer,
    v_discount_value,nullif(p_payload->>'discount_unit',''),
    v_discount_months,nullif(p_payload->>'discount_calculation_base',''),
    coalesce(nullif(p_payload->>'discount_starts_on_mode',''),'contract_start'),
    nullif(p_payload->>'start_fee_sek','')::numeric,nullif(p_payload->>'admin_fee_sek','')::numeric,
    nullif(p_payload->>'break_fee_sek','')::numeric,v_vat_rate,
    nullif(p_payload->>'description',''),nullif(p_payload->>'fixed_price_ore_per_kwh','')::numeric,
    nullif(p_payload->>'spot_markup_ore_per_kwh','')::numeric,nullif(p_payload->>'variable_fee_ore_per_kwh','')::numeric,
    nullif(p_payload->>'monthly_fee_sek','')::numeric,v_invoice_fee,
    coalesce(nullif(p_payload->>'green_fee_mode',''),'none'),nullif(p_payload->>'green_fee_value','')::numeric,
    nullif(p_payload->>'default_binding_months','')::integer,nullif(p_payload->>'default_notice_months','')::integer,
    coalesce(p_payload->'optional_fee_lines','[]'::jsonb),v_active,
    nullif(p_payload->>'valid_from','')::date,nullif(p_payload->>'valid_to','')::date,
    (v_pricing->>'price_plan_id')::uuid,(v_pricing->>'price_plan_version_id')::uuid,
    nullif(v_pricing->>'price_book_id','')::uuid,p_pricing_snapshot,
    v_auto_renewal,
    v_auto_renewal_term,
    v_poa_mode<>'not_required',
    v_poa_mode,
    null,case when coalesce((v_pricing->>'reused')::boolean,false) then coalesce(v_old.last_price_change_at,now()) else now() end,
    p_actor_user_id,p_actor_user_id,case when v_lifecycle='archived' then now() else null end
  )
  on conflict(id) do update set
    name=excluded.name,slug=excluded.slug,status=excluded.status,lifecycle_status=excluded.lifecycle_status,
    contract_type=excluded.contract_type,customer_type=excluded.customer_type,campaign_name=excluded.campaign_name,
    campaign_code=excluded.campaign_code,campaign_version=excluded.campaign_version,price_version=excluded.price_version,
    terms_version=excluded.terms_version,offer_version=excluded.offer_version,version_snapshot=excluded.version_snapshot,
    max_customers=excluded.max_customers,discount_value=excluded.discount_value,discount_unit=excluded.discount_unit,
    discount_months=excluded.discount_months,discount_calculation_base=excluded.discount_calculation_base,
    discount_starts_on_mode=excluded.discount_starts_on_mode,start_fee_sek=excluded.start_fee_sek,
    admin_fee_sek=excluded.admin_fee_sek,break_fee_sek=excluded.break_fee_sek,vat_rate=excluded.vat_rate,
    description=excluded.description,fixed_price_ore_per_kwh=excluded.fixed_price_ore_per_kwh,
    spot_markup_ore_per_kwh=excluded.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=excluded.variable_fee_ore_per_kwh,
    monthly_fee_sek=excluded.monthly_fee_sek,invoice_fee_sek=excluded.invoice_fee_sek,
    green_fee_mode=excluded.green_fee_mode,green_fee_value=excluded.green_fee_value,
    default_binding_months=excluded.default_binding_months,default_notice_months=excluded.default_notice_months,
    optional_fee_lines=excluded.optional_fee_lines,is_active=excluded.is_active,valid_from=excluded.valid_from,
    valid_to=excluded.valid_to,price_plan_id=excluded.price_plan_id,price_plan_version_id=excluded.price_plan_version_id,
    price_book_id=excluded.price_book_id,commercial_snapshot=excluded.commercial_snapshot,
    automatic_renewal=excluded.automatic_renewal,automatic_renewal_term_months=excluded.automatic_renewal_term_months,
    power_of_attorney_required=excluded.power_of_attorney_required,power_of_attorney_mode=excluded.power_of_attorney_mode,
    legal_bundle_id=null,last_price_change_at=excluded.last_price_change_at,
    archived_at=excluded.archived_at,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_saved;

  v_canonical:=public.gridex_sync_internal_offer_to_canonical(v_saved.id);
  select * into v_saved from public.contract_offers where id=v_saved.id;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_offer',v_saved.id::text,
    case when v_create_version then 'contract.version.created'
         when p_offer_id is null then 'contract.draft.created'
         else 'contract.draft.updated' end,
    case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_saved),
    jsonb_build_object(
      'version_series_id',v_series,'contract_product_id',v_saved.contract_product_id,
      'contract_product_version_id',v_canonical,'price_plan_version_id',v_saved.price_plan_version_id,
      'lifecycle_status',v_lifecycle,'readiness','{}'::jsonb
    )
  );

  return jsonb_build_object(
    'offer',to_jsonb(v_saved),'pricing',v_pricing,
    'contract_product_id',v_saved.contract_product_id,
    'contract_product_version_id',v_canonical,
    'version_series_id',v_series,
    'created_new_version',v_create_version,
    'readiness','{}'::jsonb,
    'legal_source','legal_template_versions'
  );
end $$;

-- ---------------------------------------------------------------------------
-- Explicit readiness-gated publication of an existing draft/version
-- ---------------------------------------------------------------------------
create or replace function public.gridex_publish_internal_contract_version(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_readiness jsonb;
  v_pricing jsonb;
  v_canonical uuid;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='contract_offer_not_found';
  end if;
  if o.lifecycle_status not in ('draft','ready','paused') then
    raise exception using errcode='23514',message='contract_version_not_publishable';
  end if;

  v_readiness:=public.gridex_validate_contract_readiness(p_company_id,o.id);
  if not coalesce((v_readiness->>'can_publish')::boolean,false) then
    raise exception using errcode='23514',message='contract_not_ready:'||v_readiness::text;
  end if;

  -- Reuse the draft's exact immutable commercial hash and promote the same
  -- pricing version/book. A lifecycle change must never create a new price.
  v_pricing:=public.gridex_create_or_version_contract_pricing(
    p_company_id,o.name,o.contract_type,
    coalesce(o.commercial_snapshot->>'pricing_model',o.contract_type),
    o.customer_type,coalesce(o.commercial_snapshot,'{}'::jsonb)-'lifecycle_status',
    o.valid_from,o.valid_to,true,p_actor_user_id
  );

  if (v_pricing->>'price_plan_version_id')::uuid is distinct from o.price_plan_version_id
     or nullif(v_pricing->>'price_book_id','')::uuid is distinct from o.price_book_id then
    raise exception using errcode='23514',message='contract_pricing_identity_changed_during_publish';
  end if;

  update public.contract_offers
  set lifecycle_status='published',status='active',is_active=true,
      price_plan_id=(v_pricing->>'price_plan_id')::uuid,
      price_plan_version_id=(v_pricing->>'price_plan_version_id')::uuid,
      price_book_id=nullif(v_pricing->>'price_book_id','')::uuid,
      updated_by=p_actor_user_id,updated_at=now()
  where id=o.id
  returning * into o;

  v_canonical:=public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- Only now, after pricing/legal/canonical publication succeeded, retire the
  -- predecessor. Existing customer contracts remain bound to their old IDs.
  update public.contract_offers predecessor
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'superseded' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ),
      superseded_at=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=predecessor.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then predecessor.superseded_at else coalesce(predecessor.superseded_at,now()) end,
      updated_by=p_actor_user_id,updated_at=now()
  where predecessor.company_id=p_company_id
    and predecessor.version_series_id=o.version_series_id
    and predecessor.id<>o.id
    and predecessor.lifecycle_status in ('published','paused','ready','draft');

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_offer',o.id::text,
    'contract.version.published',null,to_jsonb(o),
    jsonb_build_object(
      'version_series_id',o.version_series_id,
      'contract_product_id',o.contract_product_id,
      'contract_product_version_id',v_canonical,
      'price_plan_version_id',o.price_plan_version_id,
      'price_book_id',o.price_book_id,
      'readiness',v_readiness
    )
  );

  return jsonb_build_object(
    'ok',true,'mode','published','offer',to_jsonb(o),
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',v_canonical,
    'price_plan_version_id',o.price_plan_version_id,
    'price_book_id',o.price_book_id,
    'readiness',v_readiness
  );
end $$;

-- ---------------------------------------------------------------------------
-- Lifecycle transitions
-- ---------------------------------------------------------------------------
create or replace function public.gridex_pause_contract_channels(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare o public.contract_offers%rowtype;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.pause');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;

  update public.tenant_contract_channels ch set status='paused',updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where ch.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and ch.status='active';
  update public.contract_publications p set status='paused',updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where p.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and p.status='published';
  update public.tenant_contract_assignments ta set status='paused',updated_at=now()
  from public.contract_product_versions cpv
  where cpv.id=ta.contract_product_version_id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and ta.status='active';
  update public.contract_offers set lifecycle_status='paused',status='inactive',is_active=false,updated_by=p_actor_user_id,updated_at=now()
  where id=o.id returning * into o;
  update public.contract_products set status='paused',updated_at=now() where id=o.contract_product_id;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_product',o.contract_product_id::text,'contract.channels.paused',null,to_jsonb(o),jsonb_build_object('offer_id',o.id));
  return jsonb_build_object('ok',true,'mode','paused','offer',to_jsonb(o));
end $$;

create or replace function public.gridex_archive_contract_product(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare o public.contract_offers%rowtype; v_before jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.archive');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;
  v_before:=to_jsonb(o);

  update public.tenant_contract_channels ch
  set status='ended',valid_to=coalesce(valid_to,now()),updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where ch.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and ch.status<>'ended';

  update public.contract_publication_versions pv
  set status=case when pv.locked_at is null then 'archived' else 'ended' end,
      valid_to=coalesce(valid_to,now())
  from public.contract_publications p
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where pv.contract_publication_id=p.id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id
    and pv.status not in ('ended','archived');

  update public.contract_publications p set status='archived',updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where p.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and p.status<>'archived';

  update public.tenant_contract_assignments ta
  set status='ended',valid_to=coalesce(valid_to,current_date),updated_at=now()
  from public.contract_product_versions cpv
  where cpv.id=ta.contract_product_version_id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and ta.status<>'ended';

  perform set_config('gridex.public_offer_write','on',true);
  update public.public_contract_offers
  set lifecycle_status='archived',publication_status='archived',is_public=false,is_archived=true,
      website_enabled=false,website_cta_enabled=false,archived_at=coalesce(archived_at,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where company_id=p_company_id
    and (
      (o.contract_product_id is not null and contract_product_id=o.contract_product_id)
      or source_contract_offer_id in (
        select series_offer.id from public.contract_offers series_offer
        where series_offer.company_id=p_company_id
          and series_offer.version_series_id=o.version_series_id
      )
    )
    and not is_archived;

  update public.contract_offers series_offer
  set lifecycle_status='archived',status='inactive',is_active=false,
      archived_at=coalesce(series_offer.archived_at,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where series_offer.company_id=p_company_id
    and (series_offer.version_series_id=o.version_series_id
         or (o.contract_product_id is not null and series_offer.contract_product_id=o.contract_product_id))
    and series_offer.lifecycle_status<>'archived';

  select * into o from public.contract_offers where id=p_offer_id;
  update public.contract_products set status='archived',updated_at=now() where id=o.contract_product_id;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_product',o.contract_product_id::text,'contract.product.archived',v_before,to_jsonb(o),jsonb_build_object('offer_id',o.id,'history_preserved',true));
  return jsonb_build_object('ok',true,'mode','archived','offer',to_jsonb(o),'contract_product_id',o.contract_product_id);
end $$;

create or replace function public.gridex_restore_archived_contract(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare o public.contract_offers%rowtype;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create_version');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;
  if o.lifecycle_status<>'archived' then
    raise exception using errcode='23514',message='contract_not_archived';
  end if;

  -- Archive is intentionally irreversible. Reusing an archived publication
  -- would risk reviving stale legal/pricing/channel state. The admin UI opens
  -- this row as source for a new draft in the same permanent product series.
  raise exception using errcode='23514',message='archived_contract_requires_new_version';
end $$;

-- ---------------------------------------------------------------------------
-- Dependency preview and permanent deletion of unused drafts
-- ---------------------------------------------------------------------------
create or replace function public.gridex_preview_delete_unused_contract(
  p_company_id uuid,p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_customer_contracts bigint:=0;
  v_applications bigint:=0;
  v_external_intakes bigint:=0;
  v_snapshots bigint:=0;
  v_invoices bigint:=0;
  v_billing_underlays bigint:=0;
  v_billing_underlay_items bigint:=0;
  v_charge_ledger bigint:=0;
  v_acceptances bigint:=0;
  v_offer_versions bigint:=0;
  v_successor_offers bigint:=0;
  v_public_offers bigint:=0;
  v_product_versions bigint:=0;
  v_locked_product_versions bigint:=0;
  v_publication_versions bigint:=0;
  v_locked_publication_versions bigint:=0;
  v_locked_legal_versions bigint:=0;
  v_deletable boolean:=false;
begin
  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object('ok',false,'code','contract_offer_not_found');
  end if;

  select count(*) into v_customer_contracts
  from public.customer_contracts c
  where c.company_id=p_company_id and (
    c.contract_offer_id=o.id
    or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
    or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
        and c.contract_offer_id is null and c.contract_product_version_id is null)
  );

  select count(*) into v_applications
  from public.website_customer_applications a
  where a.company_id=p_company_id and exists(
    select 1 from public.public_contract_offers po
    where po.id=a.public_contract_offer_id
      and (po.source_contract_offer_id=o.id
        or (o.contract_product_version_id is not null and po.contract_product_version_id=o.contract_product_version_id)
        or (o.contract_product_id is not null and po.contract_product_id=o.contract_product_id
            and po.source_contract_offer_id is null and po.contract_product_version_id is null))
  );

  select count(*) into v_external_intakes
  from public.external_contract_intakes x
  where x.company_id=p_company_id and exists(
    select 1 from public.public_contract_offers po
    where po.id=x.public_contract_offer_id
      and (po.source_contract_offer_id=o.id
        or (o.contract_product_version_id is not null and po.contract_product_version_id=o.contract_product_version_id)
        or (o.contract_product_id is not null and po.contract_product_id=o.contract_product_id
            and po.source_contract_offer_id is null and po.contract_product_version_id is null))
  );

  select count(*) into v_snapshots
  from public.contract_price_snapshots s
  where s.company_id=p_company_id and (
    exists(
      select 1 from public.customer_contracts c
      where c.id=s.contract_id and c.company_id=p_company_id and (
        c.contract_offer_id=o.id
        or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
        or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
            and c.contract_offer_id is null and c.contract_product_version_id is null)
      )
    )
    or exists(
      select 1 from public.public_contract_offers po
      where po.id=s.public_contract_offer_id
        and (po.source_contract_offer_id=o.id
          or (o.contract_product_version_id is not null and po.contract_product_version_id=o.contract_product_version_id)
          or (o.contract_product_id is not null and po.contract_product_id=o.contract_product_id
              and po.source_contract_offer_id is null and po.contract_product_version_id is null))
    )
  );

  select count(*) into v_invoices
  from public.customer_invoices i
  where i.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=coalesce(i.customer_contract_id,i.contract_id)
      and c.company_id=p_company_id and (
        c.contract_offer_id=o.id
        or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
        or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
            and c.contract_offer_id is null and c.contract_product_version_id is null)
      )
  );

  select count(*) into v_billing_underlays
  from public.billing_underlays b
  where b.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=b.contract_id and c.company_id=p_company_id and (
      c.contract_offer_id=o.id
      or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
      or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
          and c.contract_offer_id is null and c.contract_product_version_id is null)
    )
  );

  select count(*) into v_billing_underlay_items
  from public.billing_underlay_items bi
  where bi.company_id=p_company_id and (
    (o.price_plan_version_id is not null and bi.price_plan_version_id=o.price_plan_version_id)
    or (o.price_book_id is not null and bi.price_book_id=o.price_book_id)
  );

  select count(*) into v_charge_ledger
  from public.contract_charge_ledger l
  where l.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=l.customer_contract_id and c.company_id=p_company_id and (
      c.contract_offer_id=o.id
      or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
      or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
          and c.contract_offer_id is null and c.contract_product_version_id is null)
    )
  );

  select count(*) into v_acceptances
  from public.customer_contract_acceptances a
  where a.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=a.customer_contract_id and c.company_id=p_company_id and (
      c.contract_offer_id=o.id
      or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
      or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
          and c.contract_offer_id is null and c.contract_product_version_id is null)
    )
  );

  select count(*) into v_offer_versions
  from public.contract_offer_versions v
  where v.company_id=p_company_id and v.contract_offer_id=o.id;

  select count(*) into v_successor_offers
  from public.contract_offers successor
  where successor.company_id=p_company_id and successor.supersedes_offer_id=o.id;

  select count(*) into v_public_offers
  from public.public_contract_offers po
  where po.company_id=p_company_id and (
    po.source_contract_offer_id=o.id
    or (o.contract_product_version_id is not null and po.contract_product_version_id=o.contract_product_version_id)
    or (o.contract_product_id is not null and po.contract_product_id=o.contract_product_id
        and po.source_contract_offer_id is null and po.contract_product_version_id is null)
  );

  select count(*),count(*) filter(where pv.locked_at is not null or pv.status in ('approved','archived'))
  into v_product_versions,v_locked_product_versions
  from public.contract_product_versions pv
  where o.contract_product_version_id is not null and pv.id=o.contract_product_version_id;

  select count(*),count(*) filter(where pv.locked_at is not null or pv.published_at is not null)
  into v_publication_versions,v_locked_publication_versions
  from public.contract_publication_versions pv
  join public.contract_publications p on p.id=pv.contract_publication_id
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where ta.company_id=p_company_id
    and o.contract_product_version_id is not null
    and cpv.id=o.contract_product_version_id;

  select count(*) into v_locked_legal_versions
  from public.legal_bundle_versions lv
  join public.contract_product_versions cpv on cpv.id=lv.contract_product_version_id
  where lv.company_id=p_company_id
    and o.contract_product_version_id is not null
    and cpv.id=o.contract_product_version_id
    and (lv.locked_at is not null or lv.published_at is not null);

  v_deletable:=o.lifecycle_status in ('draft','ready','paused')
    and v_customer_contracts=0
    and v_applications=0
    and v_external_intakes=0
    and v_snapshots=0
    and v_invoices=0
    and v_billing_underlays=0
    and v_billing_underlay_items=0
    and v_charge_ledger=0
    and v_acceptances=0
    and v_successor_offers=0
    and v_locked_product_versions=0
    and v_locked_publication_versions=0
    and v_locked_legal_versions=0;

  return jsonb_build_object(
    'ok',true,
    'deletable',v_deletable,
    'result_mode',case when v_deletable then 'delete' else 'archive_only' end,
    'business_references',jsonb_build_object(
      'customer_contracts',v_customer_contracts,
      'customer_applications',v_applications,
      'external_intakes',v_external_intakes,
      'price_snapshots',v_snapshots,
      'invoices',v_invoices,
      'billing_underlays',v_billing_underlays,
      'billing_underlay_items',v_billing_underlay_items,
      'charge_ledger',v_charge_ledger,
      'acceptances',v_acceptances
    ),
    'system_references',jsonb_build_object(
      'offer_versions',v_offer_versions,
      'successor_offers',v_successor_offers,
      'public_offers',v_public_offers,
      'product_versions',v_product_versions,
      'locked_product_versions',v_locked_product_versions,
      'publication_versions',v_publication_versions,
      'locked_publication_versions',v_locked_publication_versions,
      'locked_legal_versions',v_locked_legal_versions
    ),
    'lifecycle_status',o.lifecycle_status,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id
  );
end $$;

create or replace function public.gridex_delete_unused_contract(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_preview jsonb;
  v_product_id uuid;
  v_price_plan_id uuid;
  v_price_plan_version_id uuid;
  v_price_book_id uuid;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_publication_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_counts jsonb:='{}'::jsonb;
  v_count bigint;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='contract_offer_not_found';
  end if;

  v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
  if not coalesce((v_preview->>'deletable')::boolean,false) then
    raise exception using errcode='23514',message='unused_contract_delete_blocked:'||v_preview::text;
  end if;

  v_product_id:=o.contract_product_id;
  v_price_plan_id:=o.price_plan_id;
  v_price_plan_version_id:=o.price_plan_version_id;
  v_price_book_id:=o.price_book_id;

  select coalesce(array_agg(id),'{}'::uuid[]) into v_public_offer_ids
  from public.public_contract_offers
  where company_id=p_company_id and (
    source_contract_offer_id=o.id
    or (o.contract_product_version_id is not null and contract_product_version_id=o.contract_product_version_id)
    or (v_product_id is not null and contract_product_id=v_product_id
        and source_contract_offer_id is null and contract_product_version_id is null)
  );

  select coalesce(array_agg(id),'{}'::uuid[]) into v_product_version_ids
  from public.contract_product_versions
  where o.contract_product_version_id is not null and id=o.contract_product_version_id;

  select coalesce(array_agg(id),'{}'::uuid[]) into v_assignment_ids
  from public.tenant_contract_assignments
  where company_id=p_company_id
    and contract_product_version_id=any(v_product_version_ids);

  select coalesce(array_agg(id),'{}'::uuid[]) into v_publication_ids
  from public.contract_publications
  where assignment_id=any(v_assignment_ids);

  select coalesce(array_agg(id),'{}'::uuid[]) into v_legal_version_ids
  from public.legal_bundle_versions
  where company_id=p_company_id
    and contract_product_version_id=any(v_product_version_ids);

  perform set_config('gridex.public_offer_write','on',true);
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.pricing_version_write','on',true);

  -- Break the intentionally restrictive legacy compatibility cycle before
  -- deleting either side: public_contract_offers points to the publication
  -- version, while the publication version points back to the legacy offer.
  update public.contract_publication_versions
  set legacy_public_contract_offer_id=null
  where contract_publication_id=any(v_publication_ids)
    and legacy_public_contract_offer_id=any(v_public_offer_ids);

  update public.public_contract_offers
  set lifecycle_status='draft',publication_status='draft',is_public=false,is_archived=false,
      website_enabled=false,website_cta_enabled=false,
      contract_publication_version_id=null,updated_at=now()
  where id=any(v_public_offer_ids);

  delete from public.contract_offer_versions
  where company_id=p_company_id and contract_offer_id=o.id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_offer_versions',v_count);

  -- Compatibility rows and the source draft are removed before their
  -- referenced legal/product versions. Publication rows are already detached.
  delete from public.public_contract_offers
  where id=any(v_public_offer_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('public_contract_offers',v_count);

  delete from public.contract_offers
  where id=o.id and company_id=p_company_id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_offers',v_count);

  delete from public.contract_publication_versions
  where contract_publication_id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publication_versions',v_count);

  delete from public.contract_publications
  where id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publications',v_count);

  delete from public.tenant_contract_channels
  where assignment_id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_channels',v_count);

  delete from public.tenant_contract_assignments
  where id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_assignments',v_count);

  delete from public.legal_bundle_version_documents
  where legal_bundle_version_id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_version_documents',v_count);

  delete from public.legal_bundle_versions
  where id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_versions',v_count);

  delete from public.contract_product_versions
  where id=any(v_product_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_product_versions',v_count);

  if v_product_id is not null
     and not exists(select 1 from public.contract_product_versions where contract_product_id=v_product_id) then
    delete from public.contract_products where id=v_product_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('contract_products',v_count);
  end if;

  if v_price_book_id is not null
     and not exists(select 1 from public.contract_offers where price_book_id=v_price_book_id)
     and not exists(select 1 from public.public_contract_offers where price_book_id=v_price_book_id)
     and not exists(select 1 from public.customer_contracts where price_book_id=v_price_book_id)
     and not exists(select 1 from public.contract_price_snapshots where price_book_id=v_price_book_id)
     and not exists(select 1 from public.billing_underlays where price_book_id=v_price_book_id)
     and not exists(select 1 from public.billing_underlay_items where price_book_id=v_price_book_id) then
    delete from public.price_books where id=v_price_book_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_books',v_count);
  end if;

  if v_price_plan_version_id is not null
     and not exists(select 1 from public.contract_offers where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.public_contract_offers where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.customer_contracts where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.contract_price_snapshots where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.billing_underlays where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.billing_underlay_items where price_plan_version_id=v_price_plan_version_id) then
    delete from public.price_plan_versions where id=v_price_plan_version_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_plan_versions',v_count);
  end if;

  if v_price_plan_id is not null
     and not exists(select 1 from public.price_plan_versions where price_plan_id=v_price_plan_id) then
    delete from public.price_plans where id=v_price_plan_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_plans',v_count);
  end if;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',coalesce(v_product_id,p_offer_id)::text,
    'contract.unused_draft.deleted',to_jsonb(o),null,
    jsonb_build_object('offer_id',p_offer_id,'deleted_rows',v_counts,'preview',v_preview)
  );

  return jsonb_build_object(
    'ok',true,'mode','deleted','offer_id',p_offer_id,
    'contract_product_id',v_product_id,'deleted_rows',v_counts
  );
end $$;

create or replace function public.gridex_cleanup_unused_contract_drafts(
  p_company_id uuid,p_actor_user_id uuid,p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r record;
  v_preview jsonb;
  v_item jsonb;
  v_items jsonb:='[]'::jsonb;
  v_deleted integer:=0;
  v_archive_only integer:=0;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  for r in
    select id,name,lifecycle_status,updated_at
    from public.contract_offers
    where company_id=p_company_id and lifecycle_status in ('draft','ready','paused','archived')
    order by updated_at,id
  loop
    v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,r.id);
    if coalesce((v_preview->>'deletable')::boolean,false) then
      if p_apply then
        v_item:=public.gridex_delete_unused_contract(p_company_id,r.id,p_actor_user_id);
        v_deleted:=v_deleted+1;
      else
        v_item:=jsonb_build_object('offer_id',r.id,'name',r.name,'action','delete','preview',v_preview);
      end if;
    else
      v_archive_only:=v_archive_only+1;
      v_item:=jsonb_build_object('offer_id',r.id,'name',r.name,'action','archive_only','preview',v_preview);
    end if;
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;
  return jsonb_build_object(
    'ok',true,'apply',p_apply,'deleted_count',v_deleted,
    'archive_only_count',v_archive_only,'items',v_items
  );
end $$;

-- Compatibility wrapper used by the current admin actions.
create or replace function public.gridex_remove_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_mode text default 'archive',p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_preview jsonb;
begin
  if p_mode='archive' then
    return public.gridex_archive_contract_product(p_company_id,p_offer_id,p_actor_user_id);
  elsif p_mode='safe_delete' then
    v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
    if coalesce((v_preview->>'deletable')::boolean,false) then
      return public.gridex_delete_unused_contract(p_company_id,p_offer_id,p_actor_user_id);
    end if;
    -- Never turn an explicit permanent-delete command into an archive behind
    -- the user's back. The UI exposes Archive as a separate deliberate action.
    return jsonb_build_object(
      'ok',false,'mode','blocked','code','unused_contract_delete_blocked',
      'recommended_action','archive','delete_preview',v_preview
    );
  end if;
  raise exception using errcode='22023',message='invalid_contract_remove_mode';
end $$;

-- ---------------------------------------------------------------------------
-- Canonical channel publication from the same internal offer/product version
-- ---------------------------------------------------------------------------
create or replace function public.gridex_publish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_readiness jsonb;
  v_assignment_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_legal_version_id uuid;
  v_public_offer_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_offer_reference text;
  v_version integer;
  v_channel text;
begin
  v_channel:=lower(coalesce(p_channel,''));
  if v_channel not in ('internal','website','api','partner','phone') then
    raise exception using errcode='22023',message='invalid_contract_channel';
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;
  if o.lifecycle_status not in ('published','paused') then
    raise exception using errcode='23514',message='contract_version_not_published';
  end if;
  if o.contract_product_version_id is null or not exists(
    select 1 from public.contract_product_versions pv
    where pv.id=o.contract_product_version_id and pv.status='approved' and pv.locked_at is not null
  ) then
    raise exception using errcode='23514',message='contract_version_not_locked';
  end if;

  v_readiness:=public.gridex_validate_contract_readiness(p_company_id,p_offer_id);
  if not coalesce((v_readiness->>'can_publish')::boolean,false) then
    raise exception using errcode='23514',message='contract_not_ready:'||v_readiness::text;
  end if;

  perform public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- Move only the selected channel from older versions in the same product
  -- series. Other channels stay active until separately switched.
  update public.tenant_contract_channels old_channel
  set status='ended',valid_to=coalesce(valid_to,now()),updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_channel.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_channel.channel=v_channel
    and old_channel.status in ('active','paused');

  update public.contract_publication_versions old_publication_version
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications old_publication
  join public.tenant_contract_assignments old_assignment on old_assignment.id=old_publication.assignment_id
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication_version.contract_publication_id=old_publication.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication_version.status='published';

  update public.contract_publications old_publication
  set status='ended',updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication.status not in ('ended','archived');

  update public.tenant_contract_assignments old_assignment
  set internal_sales_allowed=case when v_channel='internal' then false else old_assignment.internal_sales_allowed end,
      website_publication_allowed=case when v_channel='website' then false else old_assignment.website_publication_allowed end,
      status=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then 'active' else 'ended' end,
      valid_to=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then old_assignment.valid_to else coalesce(old_assignment.valid_to,current_date) end,
      updated_at=now()
  from public.contract_product_versions old_version
  where old_version.id=old_assignment.contract_product_version_id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id;

  update public.contract_offers old_offer
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'superseded' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ),
      superseded_at=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then old_offer.superseded_at else coalesce(old_offer.superseded_at,now()) end,
      updated_by=p_actor_user_id,updated_at=now()
  where old_offer.company_id=p_company_id
    and old_offer.contract_product_id=o.contract_product_id
    and old_offer.id<>o.id
    and old_offer.lifecycle_status not in ('archived','expired');

  update public.contract_offers
  set lifecycle_status='published',status='active',is_active=true,
      superseded_at=null,updated_by=p_actor_user_id,updated_at=now()
  where id=o.id;
  update public.contract_products set status='active',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  select id into v_assignment_id
  from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  for update;

  update public.tenant_contract_assignments
  set website_publication_allowed=website_publication_allowed or v_channel='website',
      internal_sales_allowed=internal_sales_allowed or v_channel='internal',
      status='active',valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
  where id=v_assignment_id;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,v_channel,'active',o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object('name',o.name,'source_contract_offer_id',o.id,'source_of_truth','contract_product_versions'),
    p_actor_user_id
  ) on conflict(assignment_id,channel) do update set
    status='active',valid_from=excluded.valid_from,valid_to=excluded.valid_to,
    marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  select legal_bundle_version_id into v_legal_version_id
  from public.contract_offers where id=o.id;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,v_channel,'published',p_actor_user_id)
  on conflict(assignment_id,channel) do update set status='published',updated_at=now()
  returning id into v_publication_id;

  select coalesce(max(version_number),0)+1 into v_version
  from public.contract_publication_versions where contract_publication_id=v_publication_id;
  v_offer_reference:='GRIDEX-'||replace(o.version_series_id::text,'-','')||'-V'||o.version_number||'-'||upper(v_channel);
  v_snapshot:=jsonb_build_object(
    'schema','gridex_contract_publication_v5',
    'company_id',p_company_id,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'source_contract_offer_id',o.id,
    'channel',v_channel,
    'offer_reference',v_offer_reference,
    'commercial_snapshot',o.commercial_snapshot,
    'legal_bundle_version_id',v_legal_version_id,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to
  );
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_publication_version_id
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id and content_sha256=v_hash;
  if v_publication_version_id is null then
    insert into public.contract_publication_versions(
      contract_publication_id,version_number,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
      customer_type,channel,valid_from,valid_to,publication_snapshot,offer_reference,
      content_sha256,status,published_at,locked_at,created_by
    ) values(
      v_publication_id,v_version,o.contract_product_version_id,
      o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,
      o.customer_type,v_channel,o.valid_from::timestamptz,o.valid_to::timestamptz,
      v_snapshot,v_offer_reference,v_hash,'published',now(),now(),p_actor_user_id
    ) returning id into v_publication_version_id;
  else
    -- Content is immutable, but a previously ended channel may be re-enabled.
    -- Reactivate the same locked publication identity instead of attempting a
    -- duplicate row with the same content hash/offer reference.
    update public.contract_publication_versions
    set status='published',valid_from=o.valid_from::timestamptz,
        valid_to=o.valid_to::timestamptz,published_at=coalesce(published_at,now()),
        locked_at=coalesce(locked_at,now())
    where id=v_publication_version_id;
  end if;

  if v_channel='website' then
    perform set_config('gridex.public_offer_write','on',true);

    -- Only one website offer in a product series may be public. Older public
    -- compatibility rows remain for historic references but are immediately
    -- removed from all public/CTA surfaces.
    update public.public_contract_offers old_public
    set lifecycle_status='superseded',publication_status='unpublished',
        is_public=false,website_enabled=false,website_cta_enabled=false,
        updated_by=p_actor_user_id,updated_at=now()
    where old_public.company_id=p_company_id
      and old_public.contract_product_id=o.contract_product_id
      and old_public.source_contract_offer_id is distinct from o.id
      and (old_public.is_public or old_public.website_enabled or old_public.website_cta_enabled
           or old_public.publication_status='published');

    select id into v_public_offer_id
    from public.public_contract_offers
    where company_id=p_company_id and source_contract_offer_id=o.id
    order by created_at desc limit 1 for update;

    if v_public_offer_id is null then
      insert into public.public_contract_offers(
        company_id,source_contract_offer_id,version_series_id,version_number,
        contract_product_id,contract_product_version_id,contract_publication_version_id,
        legal_bundle_version_id,price_plan_id,price_plan_version_id,price_book_id,
        product_code,offer_code,public_name,public_description,contract_type,billing_model,
        customer_type,monthly_fee_sek,invoice_fee_sek,spot_markup_ore_per_kwh,
        variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,
        start_fee_sek,administration_fee_sek,break_fee_sek,discount_value,discount_unit,
        discount_months,vat_rate,terms_version,binding_months,notice_months,
        spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,price_areas,
        automatic_renewal,power_of_attorney_required,valid_from,valid_to,
        is_public,is_archived,publication_status,lifecycle_status,website_enabled,
        website_cta_enabled,published_at,metadata,created_by,updated_by
      ) values(
        p_company_id,o.id,o.version_series_id,o.version_number,
        o.contract_product_id,o.contract_product_version_id,v_publication_version_id,
        v_legal_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,
        'electricity','contract-'||o.version_series_id::text,o.name,o.description,o.contract_type,
        coalesce(o.commercial_snapshot->>'pricing_model',o.contract_type),o.customer_type,
        o.monthly_fee_sek,o.invoice_fee_sek,o.spot_markup_ore_per_kwh,o.variable_fee_ore_per_kwh,
        o.fixed_price_ore_per_kwh,o.green_fee_mode,o.green_fee_value,o.start_fee_sek,o.admin_fee_sek,
        o.break_fee_sek,o.discount_value,o.discount_unit,o.discount_months,o.vat_rate,o.terms_version,
        o.default_binding_months,o.default_notice_months,
        coalesce((o.commercial_snapshot->>'spot_weight_percent')::numeric,100),
        coalesce((o.commercial_snapshot->>'portfolio_weight_percent')::numeric,0),
        coalesce((o.commercial_snapshot->>'fixed_weight_percent')::numeric,0),
        coalesce(array(select jsonb_array_elements_text(coalesce(o.commercial_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),
        o.automatic_renewal,o.power_of_attorney_required,o.valid_from,o.valid_to,
        true,false,'published','published',true,true,now(),
        jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        p_actor_user_id,p_actor_user_id
      ) returning id into v_public_offer_id;
    else
      update public.public_contract_offers set
        contract_product_id=o.contract_product_id,
        contract_product_version_id=o.contract_product_version_id,
        contract_publication_version_id=v_publication_version_id,
        legal_bundle_version_id=v_legal_version_id,
        price_plan_id=o.price_plan_id,price_plan_version_id=o.price_plan_version_id,price_book_id=o.price_book_id,
        public_name=o.name,public_description=o.description,contract_type=o.contract_type,customer_type=o.customer_type,
        monthly_fee_sek=o.monthly_fee_sek,invoice_fee_sek=o.invoice_fee_sek,
        spot_markup_ore_per_kwh=o.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=o.variable_fee_ore_per_kwh,
        fixed_price_ore_per_kwh=o.fixed_price_ore_per_kwh,green_fee_mode=o.green_fee_mode,green_fee_value=o.green_fee_value,
        start_fee_sek=o.start_fee_sek,administration_fee_sek=o.admin_fee_sek,break_fee_sek=o.break_fee_sek,
        discount_value=o.discount_value,discount_unit=o.discount_unit,discount_months=o.discount_months,
        vat_rate=o.vat_rate,terms_version=o.terms_version,binding_months=o.default_binding_months,
        notice_months=o.default_notice_months,automatic_renewal=o.automatic_renewal,
        power_of_attorney_required=o.power_of_attorney_required,valid_from=o.valid_from,valid_to=o.valid_to,
        is_public=true,is_archived=false,publication_status='published',lifecycle_status='published',
        website_enabled=true,website_cta_enabled=true,published_at=coalesce(published_at,now()),archived_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_public_offer_id;
    end if;
    update public.contract_publication_versions
    set legacy_public_contract_offer_id=v_public_offer_id
    where id=v_publication_version_id and legacy_public_contract_offer_id is null;
  end if;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(
    p_company_id,p_actor_user_id,'contract_publication_version',v_publication_version_id::text,
    'contract.channel.published',null,v_snapshot,
    jsonb_build_object('offer_id',o.id,'channel',v_channel,'offer_reference',v_offer_reference)
  );

  return jsonb_build_object(
    'ok',true,'mode','published','channel',v_channel,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'contract_publication_version_id',v_publication_version_id,
    'public_contract_offer_id',v_public_offer_id,
    'offer_reference',v_offer_reference
  );
end $$;

-- ---------------------------------------------------------------------------
-- Channel-specific unpublication. This does not pause the internal channel or
-- mutate the immutable commercial version.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_unpublish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_channel text:=lower(coalesce(p_channel,''));
  v_affected bigint:=0;
begin
  if v_channel not in ('internal','website','api','partner','phone') then
    raise exception using errcode='22023',message='invalid_contract_channel';
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.pause');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;

  update public.tenant_contract_channels ch
  set status='paused',updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  where ch.assignment_id=ta.id
    and ta.company_id=p_company_id
    and ta.contract_product_version_id=o.contract_product_version_id
    and ch.channel=v_channel
    and ch.status='active';
  get diagnostics v_affected=row_count;

  update public.contract_publications p
  set status='paused',updated_at=now()
  from public.tenant_contract_assignments ta
  where p.assignment_id=ta.id
    and ta.company_id=p_company_id
    and ta.contract_product_version_id=o.contract_product_version_id
    and p.channel=v_channel
    and p.status='published';

  update public.contract_publication_versions pv
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications p
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  where pv.contract_publication_id=p.id
    and ta.company_id=p_company_id
    and ta.contract_product_version_id=o.contract_product_version_id
    and p.channel=v_channel
    and pv.status='published';

  if v_channel='website' then
    perform set_config('gridex.public_offer_write','on',true);
    update public.public_contract_offers
    set lifecycle_status='paused',publication_status='unpublished',
        is_public=false,website_enabled=false,website_cta_enabled=false,
        updated_by=p_actor_user_id,updated_at=now()
    where company_id=p_company_id and source_contract_offer_id=o.id
      and (is_public or website_enabled or website_cta_enabled or publication_status='published');
  end if;

  update public.tenant_contract_assignments ta
  set internal_sales_allowed=case when v_channel='internal' then false else ta.internal_sales_allowed end,
      website_publication_allowed=case when v_channel='website' then false else ta.website_publication_allowed end,
      status=case when exists(
        select 1 from public.tenant_contract_channels active_channel
        where active_channel.assignment_id=ta.id and active_channel.status='active'
          and (active_channel.valid_from is null or active_channel.valid_from<=now())
          and (active_channel.valid_to is null or active_channel.valid_to>=now())
      ) then 'active' else 'paused' end,
      updated_at=now()
  where ta.company_id=p_company_id
    and ta.contract_product_version_id=o.contract_product_version_id;

  update public.contract_offers source_offer
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=source_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'paused' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=source_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=source_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ),
      updated_by=p_actor_user_id,updated_at=now()
  where source_offer.id=o.id;

  update public.contract_products product
  set status=case when exists(
        select 1 from public.contract_product_versions pv
        join public.tenant_contract_assignments ta on ta.contract_product_version_id=pv.id
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where pv.contract_product_id=product.id and ta.company_id=p_company_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'paused' end,
      updated_at=now()
  where product.id=o.contract_product_id and product.company_id=p_company_id;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_product_version',o.contract_product_version_id::text,
    'contract.channel.unpublished',null,null,
    jsonb_build_object('offer_id',o.id,'channel',v_channel,'affected_channels',v_affected));

  return jsonb_build_object('ok',true,'mode','unpublished','offer_id',o.id,
    'channel',v_channel,'affected_channels',v_affected);
end $$;

-- ---------------------------------------------------------------------------
-- Legacy public rows are attached to a canonical contract source. Rows that
-- cannot be mapped safely are converted to non-public drafts and must be
-- reviewed/re-published from the canonical contract administration.
-- ---------------------------------------------------------------------------
do $$
declare
  r public.public_contract_offers%rowtype;
  v_source_id uuid;
  v_series uuid;
  v_lifecycle text;
  v_version_number integer;
begin
  -- Legacy-to-canonical attachment updates published compatibility rows. Keep
  -- the production immutability trigger enabled and open only this controlled
  -- transaction-local write path for the duration of the backfill block.
  perform set_config('gridex.public_offer_write','on',true);

  with matches as (
    select po.id as public_offer_id,
      (
        select o.id
        from public.contract_offers o
        where o.company_id=po.company_id
          and (
            (po.contract_product_version_id is not null and o.contract_product_version_id=po.contract_product_version_id)
            or (po.contract_product_id is not null and o.contract_product_id=po.contract_product_id)
          )
        order by case when o.contract_product_version_id=po.contract_product_version_id then 0 else 1 end,
                 o.version_number desc,o.updated_at desc
        limit 1
      ) as source_offer_id
    from public.public_contract_offers po
    where po.source_contract_offer_id is null
  )
  update public.public_contract_offers po
  set source_contract_offer_id=co.id,
      version_series_id=co.version_series_id,
      lifecycle_status=co.lifecycle_status
  from matches m
  join public.contract_offers co on co.id=m.source_offer_id
  where po.id=m.public_offer_id;

  for r in
    select * from public.public_contract_offers
    where source_contract_offer_id is null
    order by created_at,id
  loop
    -- A previous loop iteration may already have created the canonical source
    -- for this product/version. Reuse it instead of creating a parallel series.
    select o.id,o.version_series_id into v_source_id,v_series
    from public.contract_offers o
    where o.company_id=r.company_id and (
      (r.contract_product_version_id is not null and o.contract_product_version_id=r.contract_product_version_id)
      or (r.contract_product_id is not null and o.contract_product_id=r.contract_product_id)
    )
    order by case when o.contract_product_version_id=r.contract_product_version_id then 0 else 1 end,
             o.version_number desc,o.updated_at desc
    limit 1;
    if found then
      update public.public_contract_offers
      set source_contract_offer_id=v_source_id,version_series_id=v_series,
          lifecycle_status=(select lifecycle_status from public.contract_offers where id=v_source_id),
          updated_at=now()
      where id=r.id;
      continue;
    end if;

    v_lifecycle:=case
      when r.contract_product_id is not null and r.contract_product_version_id is not null
           and r.publication_status='published' and r.is_public then 'published'
      when r.publication_status in ('archived','expired') or r.is_archived then 'archived'
      else 'draft'
    end;
    v_series:=case when v_lifecycle='draft' then gen_random_uuid()
      else coalesce(r.version_series_id,r.contract_product_id,gen_random_uuid()) end;
    select coalesce(max(version_number),0)+1 into v_version_number
    from public.contract_offers
    where company_id=r.company_id and version_series_id=v_series;

    insert into public.contract_offers(
      company_id,version_series_id,contract_product_id,contract_product_version_id,
      legal_bundle_version_id,name,slug,status,lifecycle_status,contract_type,customer_type,
      price_version,terms_version,version_number,description,max_customers,
      discount_value,discount_unit,discount_months,start_fee_sek,admin_fee_sek,break_fee_sek,
      vat_rate,fixed_price_ore_per_kwh,spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,
      monthly_fee_sek,invoice_fee_sek,green_fee_mode,green_fee_value,
      default_binding_months,default_notice_months,is_active,valid_from,valid_to,
      price_plan_id,price_plan_version_id,price_book_id,commercial_snapshot,
      automatic_renewal,power_of_attorney_required,created_by,updated_by,archived_at
    ) values(
      r.company_id,v_series,r.contract_product_id,r.contract_product_version_id,
      r.legal_bundle_version_id,r.public_name,'legacy-public-'||r.id::text,
      case when v_lifecycle='published' then 'active' when v_lifecycle='draft' then 'draft' else 'inactive' end,
      v_lifecycle,
      case lower(coalesce(r.contract_type,''))
        when 'spot' then 'variable_monthly'
        when 'variable' then 'variable_monthly'
        when 'variable_spot' then 'variable_monthly'
        when 'variable_monthly' then 'variable_monthly'
        when 'hourly_spot' then 'variable_hourly'
        when 'variable_hourly' then 'variable_hourly'
        when 'variable_quarterly' then 'variable_hourly'
        when 'fixed' then 'fixed'
        when 'portfolio' then 'portfolio'
        when 'mixed' then 'mixed'
        else 'variable_monthly'
      end,
      r.customer_type,
      coalesce(r.metadata->>'price_version_label','legacy-v'||v_version_number::text),
      r.terms_version,v_version_number,r.public_description,null,
      r.discount_value,r.discount_unit,r.discount_months,r.start_fee_sek,r.administration_fee_sek,r.break_fee_sek,
      coalesce(r.vat_rate,25),r.fixed_price_ore_per_kwh,r.spot_markup_ore_per_kwh,r.variable_fee_ore_per_kwh,
      r.monthly_fee_sek,r.invoice_fee_sek,coalesce(r.green_fee_mode,'none'),r.green_fee_value,
      r.binding_months,r.notice_months,v_lifecycle='published',r.valid_from,r.valid_to,
      r.price_plan_id,r.price_plan_version_id,r.price_book_id,
      coalesce(r.metadata->'pricing_snapshot','{}'::jsonb),
      coalesce(r.automatic_renewal,false),coalesce(r.power_of_attorney_required,true),
      r.created_by,r.updated_by,case when v_lifecycle='archived' then coalesce(r.archived_at,now()) end
    ) returning id into v_source_id;

    update public.public_contract_offers
    set source_contract_offer_id=v_source_id,version_series_id=v_series,lifecycle_status=v_lifecycle,
        is_public=case when v_lifecycle='published' then is_public else false end,
        website_enabled=case when v_lifecycle='published' then website_enabled else false end,
        website_cta_enabled=case when v_lifecycle='published' then website_cta_enabled else false end,
        publication_status=case when v_lifecycle='published' then publication_status else 'draft' end,
        readiness_status=case when v_lifecycle='published' then readiness_status else 'blocked' end,
        readiness_blockers=case when v_lifecycle='published' then readiness_blockers
          else coalesce(readiness_blockers,'[]'::jsonb)||jsonb_build_array('legacy_public_offer_requires_canonical_republication') end,
        updated_at=now()
    where id=r.id;
  end loop;
end $$;

create or replace function public.gridex_guard_canonical_public_offer()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  -- Stand-alone public offers are no longer allowed. Every compatibility row,
  -- including a non-public draft, must point back to the canonical internal
  -- contract offer. This also makes the legacy gridex_publish_contract_version
  -- path fail closed instead of creating a parallel pricing/legal model.
  if new.source_contract_offer_id is null then
    raise exception using errcode='23514',message='canonical_contract_source_required';
  end if;

  if (coalesce(new.is_public,false)
      or coalesce(new.website_enabled,false)
      or coalesce(new.website_cta_enabled,false)
      or coalesce(new.publication_status,'draft')='published')
     and (new.contract_product_id is null
          or new.contract_product_version_id is null
          or new.contract_publication_version_id is null) then
    raise exception using errcode='23514',message='canonical_contract_publication_required';
  end if;
  return new;
end $$;

drop trigger if exists public_contract_offers_canonical_source_guard on public.public_contract_offers;
create trigger public_contract_offers_canonical_source_guard
before insert or update of is_public,website_enabled,website_cta_enabled,publication_status,
  source_contract_offer_id,contract_product_id,contract_product_version_id,contract_publication_version_id
on public.public_contract_offers
for each row execute function public.gridex_guard_canonical_public_offer();

-- ---------------------------------------------------------------------------
-- Availability/capacity is enforced in the same transaction as contract create
-- ---------------------------------------------------------------------------
create or replace function public.gridex_enforce_contract_availability_and_capacity()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_count bigint;
  v_statuses text[]:=array['draft','pending_signature','signed','active'];
begin
  if new.status not in ('draft','pending_signature','signed','active') then
    return new;
  end if;
  if new.contract_offer_id is null and new.contract_product_id is null and new.contract_product_version_id is null then
    return new;
  end if;

  select * into o
  from public.contract_offers
  where company_id=new.company_id and (
    id=new.contract_offer_id
    or (new.contract_product_version_id is not null and contract_product_version_id=new.contract_product_version_id)
    or (new.contract_product_id is not null and contract_product_id=new.contract_product_id and lifecycle_status='published')
  )
  order by version_number desc limit 1 for update;
  if not found then
    raise exception using errcode='23514',message='contract_offer_not_available';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(o.version_series_id::text,0));
  if o.lifecycle_status<>'published' or not o.is_active
     or (o.valid_from is not null and o.valid_from>current_date)
     or (o.valid_to is not null and o.valid_to<current_date) then
    raise exception using errcode='23514',message='contract_offer_not_available';
  end if;
  if not exists(
    select 1 from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=new.company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status='active'
      and ch.channel in ('internal','website','api','partner','phone') and ch.status='active'
      and (
        (ch.channel='internal' and ta.internal_sales_allowed)
        or (ch.channel='website' and ta.website_publication_allowed)
        or ch.channel in ('api','partner','phone')
      )
      and (ch.valid_from is null or ch.valid_from<=now())
      and (ch.valid_to is null or ch.valid_to>=now())
  ) then
    raise exception using errcode='23514',message='contract_channel_not_available';
  end if;

  if o.max_customers is not null then
    select count(*) into v_count
    from public.customer_contracts c
    where c.company_id=new.company_id and c.id is distinct from new.id
      and c.status=any(v_statuses) and (
        c.contract_offer_id=o.id
        or c.contract_product_id=o.contract_product_id
        or c.contract_product_version_id=o.contract_product_version_id
      );
    if v_count>=o.max_customers then
      raise exception using errcode='23514',message='contract_capacity_reached';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists customer_contracts_contract_availability on public.customer_contracts;
create trigger customer_contracts_contract_availability
before insert or update of status,contract_offer_id,contract_product_id,contract_product_version_id
on public.customer_contracts
for each row execute function public.gridex_enforce_contract_availability_and_capacity();

-- ---------------------------------------------------------------------------
-- Schema drift verification used by release checks
-- ---------------------------------------------------------------------------
create or replace function public.gridex_verify_contract_schema_alignment()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_missing text[]:='{}'::text[];
  v_functions text[]:=array[
    'gridex_upsert_internal_contract_offer','gridex_sync_internal_offer_to_canonical',
    'gridex_validate_contract_readiness','gridex_publish_internal_contract_version','gridex_publish_contract_channel','gridex_unpublish_contract_channel',
    'gridex_pause_contract_channels','gridex_archive_contract_product',
    'gridex_restore_archived_contract','gridex_preview_delete_unused_contract',
    'gridex_delete_unused_contract','gridex_cleanup_unused_contract_drafts'
  ];
  v_function text;
  v_column text;
begin
  foreach v_function in array v_functions loop
    if to_regprocedure('public.'||v_function||case v_function
      when 'gridex_upsert_internal_contract_offer' then '(uuid,uuid,jsonb,jsonb,uuid)'
      when 'gridex_sync_internal_offer_to_canonical' then '(uuid)'
      when 'gridex_validate_contract_readiness' then '(uuid,uuid)'
      when 'gridex_publish_internal_contract_version' then '(uuid,uuid,uuid)'
      when 'gridex_publish_contract_channel' then '(uuid,uuid,text,uuid)'
      when 'gridex_unpublish_contract_channel' then '(uuid,uuid,text,uuid)'
      when 'gridex_pause_contract_channels' then '(uuid,uuid,uuid)'
      when 'gridex_archive_contract_product' then '(uuid,uuid,uuid)'
      when 'gridex_restore_archived_contract' then '(uuid,uuid,uuid)'
      when 'gridex_preview_delete_unused_contract' then '(uuid,uuid)'
      when 'gridex_delete_unused_contract' then '(uuid,uuid,uuid)'
      else '(uuid,uuid,boolean)' end) is null then
      v_missing:=array_append(v_missing,'function:'||v_function);
    end if;
  end loop;

  foreach v_column in array array[
    'version_series_id','lifecycle_status','discount_months','discount_calculation_base',
    'automatic_renewal_term_months','power_of_attorney_mode','contract_product_id','contract_product_version_id'
  ] loop
    if not exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='contract_offers' and column_name=v_column
    ) then
      v_missing:=array_append(v_missing,'contract_offers.'||v_column);
    end if;
  end loop;

  if exists(
    select 1 from public.public_contract_offers
    where source_contract_offer_id is null
  ) then
    v_missing:=array_append(v_missing,'data:public_offer_without_canonical_source');
  end if;

  if exists(
    select 1 from public.public_contract_offers
    where (is_public or website_enabled or website_cta_enabled or publication_status='published')
      and (contract_product_id is null or contract_product_version_id is null
           or contract_publication_version_id is null)
  ) then
    v_missing:=array_append(v_missing,'data:published_offer_without_canonical_publication');
  end if;

  return jsonb_build_object(
    'ok',cardinality(v_missing)=0,
    'missing',v_missing,
    'checked_at',now(),
    'contract_model_version','2026-07-21.2'
  );
end $$;

-- Rebuild internal compatibility view with canonical lifecycle/readiness/delete preview.
drop view if exists public.canonical_internal_contract_offers_v;
create view public.canonical_internal_contract_offers_v
with (security_invoker=true)
as
select
  o.*,
  cp.product_code as canonical_product_code,
  cp.status as canonical_product_status,
  cpv.version_number as canonical_version_number,
  cpv.status as canonical_version_status,
  cpv.content_sha256 as canonical_content_sha256,
  public.gridex_validate_contract_readiness(o.company_id,o.id) as readiness,
  public.gridex_preview_delete_unused_contract(o.company_id,o.id) as deletion_preview,
  case
    when o.lifecycle_status='published'
      and (o.valid_from is null or o.valid_from<=current_date)
      and (o.valid_to is null or o.valid_to>=current_date)
      and exists(
        select 1
        from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=o.company_id
          and ta.contract_product_version_id=o.contract_product_version_id
          and ta.status='active' and ta.internal_sales_allowed
          and ch.channel='internal' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      )
      then true else false
  end as currently_sellable
from public.contract_offers o
left join public.contract_products cp on cp.id=o.contract_product_id
left join public.contract_product_versions cpv on cpv.id=o.contract_product_version_id;

revoke all on function public.gridex_assert_contract_permission(uuid,text) from public,anon,authenticated;
revoke all on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid) from public,anon;
revoke all on function public.gridex_pause_contract_channels(uuid,uuid,uuid) from public,anon;
revoke all on function public.gridex_archive_contract_product(uuid,uuid,uuid) from public,anon;
revoke all on function public.gridex_restore_archived_contract(uuid,uuid,uuid) from public,anon;
revoke all on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid) from public,anon;
revoke all on function public.gridex_delete_unused_contract(uuid,uuid,uuid) from public,anon;
revoke all on function public.gridex_cleanup_unused_contract_drafts(uuid,uuid,boolean) from public,anon;
revoke all on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) from public,anon;
revoke all on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid) from public,anon;

grant execute on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_preview_delete_unused_contract(uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_validate_contract_readiness(uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_verify_contract_schema_alignment() to authenticated,service_role;
grant execute on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid) to authenticated,service_role;
grant execute on function public.gridex_pause_contract_channels(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_archive_contract_product(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_restore_archived_contract(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_delete_unused_contract(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_cleanup_unused_contract_drafts(uuid,uuid,boolean) to authenticated,service_role;
grant execute on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) to authenticated,service_role;
grant execute on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid) to authenticated,service_role;
grant execute on function public.gridex_remove_internal_contract_offer(uuid,uuid,text,uuid) to authenticated,service_role;

comment on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid)
is 'Creates/updates draft or creates immutable version in one stable contract product series.';
comment on function public.gridex_publish_internal_contract_version(uuid,uuid,uuid) is
  'Readiness-gated publication command that promotes and locks the existing canonical draft without changing its commercial identity.';
comment on function public.gridex_delete_unused_contract(uuid,uuid,uuid)
is 'Permanently removes only an unused, unlocked contract draft and its exclusive canonical/pricing objects.';
comment on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid)
is 'Publishes internal/website/API as channels of the same canonical product version.';
comment on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid)
is 'Stops one sales channel without mutating the canonical commercial version or other channels.';

commit;
