-- GRIDEX canonical contract type and future slug normalization alignment.
-- Forward-only. Existing historical slugs are not rewritten.
-- Legacy contract-type aliases are normalized explicitly; pricing_model values
-- such as "spot" remain unchanged because pricing model and contract type are
-- separate canonical concepts.

begin;

-- Mutable offer rows: normalize only known legacy aliases. Unknown values still
-- fail closed below rather than being guessed.
update public.contract_offers offer
set contract_type=case lower(btrim(offer.contract_type))
  when 'spot' then 'variable_monthly'
  when 'variable' then 'variable_monthly'
  when 'variable_spot' then 'variable_monthly'
  when 'hourly_spot' then 'variable_hourly'
  else lower(btrim(offer.contract_type))
end
where lower(btrim(offer.contract_type)) in (
  'spot','variable','variable_spot','hourly_spot'
);

-- Fail closed after recognized aliases have been mapped.
do $$
declare
  v_unsupported jsonb;
begin
  select jsonb_agg(
    jsonb_build_object('contract_type',contract_type,'row_count',row_count)
    order by contract_type
  )
  into v_unsupported
  from (
    select contract_type,count(*) as row_count
    from public.contract_offers
    where contract_type not in (
      'fixed','variable_monthly','variable_hourly','variable_quarterly','portfolio','mixed'
    )
    group by contract_type
  ) unsupported;

  if v_unsupported is not null then
    raise exception using
      errcode='23514',
      message='contract_offers_contract_type_alignment_blocked',
      detail=v_unsupported::text,
      hint='Map unsupported legacy contract types explicitly before applying this migration.';
  end if;
end
$$;

alter table public.contract_offers
  drop constraint if exists contract_offers_contract_type_check;
alter table public.contract_offers
  add constraint contract_offers_contract_type_check
  check (contract_type in (
    'fixed','variable_monthly','variable_hourly','variable_quarterly','portfolio','mixed'
  )) not valid;
alter table public.contract_offers
  validate constraint contract_offers_contract_type_check;

-- Immutable versions: perform one controlled canonicalization while preserving
-- commercial_snapshot and content_sha256 as the original historical evidence.
-- The legacy source value therefore remains available in the immutable snapshot,
-- while the queryable contract_type column becomes canonical.
lock table public.contract_product_versions in access exclusive mode;

drop trigger if exists contract_product_versions_immutable
  on public.contract_product_versions;
drop trigger if exists contract_product_versions_set_legal_modules
  on public.contract_product_versions;

update public.contract_product_versions product_version
set contract_type=case lower(btrim(product_version.contract_type))
  when 'spot' then 'variable_monthly'
  when 'variable' then 'variable_monthly'
  when 'variable_spot' then 'variable_monthly'
  when 'hourly_spot' then 'variable_hourly'
  else lower(btrim(product_version.contract_type))
end
where lower(btrim(product_version.contract_type)) in (
  'spot','variable','variable_spot','hourly_spot'
);

-- Restore the canonical guards in the same transaction before application
-- writes can resume.
create trigger contract_product_versions_set_legal_modules
before insert or update of
  customer_type,contract_type,automatic_renewal,
  power_of_attorney_required,required_legal_modules
on public.contract_product_versions
for each row execute function public.gridex_set_contract_version_legal_modules();

create trigger contract_product_versions_immutable
before update or delete on public.contract_product_versions
for each row execute function public.gridex_reject_locked_row_mutation();

do $$
declare
  v_unsupported jsonb;
begin
  select jsonb_agg(
    jsonb_build_object('contract_type',contract_type,'row_count',row_count)
    order by contract_type
  )
  into v_unsupported
  from (
    select contract_type,count(*) as row_count
    from public.contract_product_versions
    where contract_type not in (
      'fixed','variable_monthly','variable_hourly','variable_quarterly','portfolio','mixed'
    )
    group by contract_type
  ) unsupported;

  if v_unsupported is not null then
    raise exception using
      errcode='23514',
      message='contract_product_versions_contract_type_alignment_blocked',
      detail=v_unsupported::text,
      hint='Map unsupported immutable version types explicitly before applying this migration.';
  end if;
end
$$;

alter table public.contract_product_versions
  drop constraint if exists contract_product_versions_contract_type_check;
alter table public.contract_product_versions
  add constraint contract_product_versions_contract_type_check
  check (contract_type in (
    'fixed','variable_monthly','variable_hourly','variable_quarterly','portfolio','mixed'
  )) not valid;
alter table public.contract_product_versions
  validate constraint contract_product_versions_contract_type_check;

create or replace function public.gridex_contract_slugify(p_value text)
returns text
language sql
immutable
strict
set search_path=pg_catalog,pg_temp
as $$
  select nullif(
    trim(both '-' from regexp_replace(
      translate(lower(btrim(p_value)), 'åäö', 'aao'),
      '[^a-z0-9]+',
      '-',
      'g'
    )),
    ''
  )
$$;

create or replace function public.gridex_contract_offer_slug_before_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_supplied text:=nullif(btrim(new.slug),'');
  v_legacy_generated text:=nullif(
    lower(trim(both '-' from regexp_replace(coalesce(new.name,''),'[^a-zA-Z0-9]+','-','g'))),
    ''
  );
begin
  -- Detect the legacy ASCII-only generated value and regenerate from name
  -- before Swedish characters have been lost.
  if v_supplied is null or v_supplied=v_legacy_generated then
    new.slug:=public.gridex_contract_slugify(new.name);
  else
    new.slug:=public.gridex_contract_slugify(v_supplied);
  end if;
  return new;
end
$$;

drop trigger if exists contract_offers_slug_normalization_before_write
  on public.contract_offers;
create trigger contract_offers_slug_normalization_before_write
before insert or update of name,slug on public.contract_offers
for each row execute function public.gridex_contract_offer_slug_before_write();

-- Slug is a presentation/lookup field, never business identity.
alter table public.contract_offers
  drop constraint if exists contract_offers_slug_key;
drop index if exists public.contract_offers_slug_key;
drop index if exists public.contract_offers_company_live_slug_uidx;
create index if not exists contract_offers_company_slug_idx
  on public.contract_offers(company_id,lower(btrim(slug)))
  where nullif(btrim(slug),'') is not null;

revoke all on function public.gridex_contract_slugify(text)
  from public,anon,authenticated;
grant execute on function public.gridex_contract_slugify(text)
  to service_role;
revoke all on function public.gridex_contract_offer_slug_before_write()
  from public,anon,authenticated;
grant execute on function public.gridex_contract_offer_slug_before_write()
  to service_role;

comment on function public.gridex_contract_slugify(text) is
  'Canonical future-write slug normalizer. Transliteration: å/ä -> a, ö -> o. Slug is non-unique and is not contract identity.';
comment on index public.contract_offers_company_slug_idx is
  'Non-unique tenant-scoped lookup index. Archived, closed and new products may reuse the same slug.';

commit;
