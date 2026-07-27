-- GRIDEX contract identity and immutable-version integrity repair.
--
-- Forward-only: the earlier 20260727150000 collision and the immutable-row
-- rewrites in 20260727040000/20260727161000 may already have been applied.
-- This migration therefore establishes the final invariants without changing
-- any historical migration or mutating an existing immutable version.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. A live offer slug is unique inside one tenant. Archived offers retain
--    their historical slug and no longer reserve it.
-- ---------------------------------------------------------------------------
lock table public.contract_offers in share row exclusive mode;

do $$
declare
  v_duplicates jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'company_id', duplicate.company_id,
      'slug', duplicate.slug_key,
      'offer_ids', duplicate.offer_ids
    )
    order by duplicate.company_id, duplicate.slug_key
  )
  into v_duplicates
  from (
    select
      company_id,
      lower(btrim(slug)) as slug_key,
      array_agg(id order by created_at, id) as offer_ids
    from public.contract_offers
    where company_id is not null
      and nullif(btrim(slug), '') is not null
      and archived_at is null
      and lifecycle_status <> 'archived'
    group by company_id, lower(btrim(slug))
    having count(*) > 1
  ) duplicate;

  if v_duplicates is not null then
    raise exception using
      errcode = '23505',
      message = 'contract_offer_live_slug_duplicates_block_repair',
      detail = v_duplicates::text,
      hint = 'Archive or explicitly rename duplicate live offers before retrying the migration.';
  end if;
end
$$;

drop index if exists public.contract_offers_company_live_slug_uidx;

create unique index contract_offers_company_live_slug_uidx
  on public.contract_offers(company_id, lower(btrim(slug)))
  where company_id is not null
    and nullif(btrim(slug), '') is not null
    and archived_at is null
    and lifecycle_status <> 'archived';

comment on index public.contract_offers_company_live_slug_uidx is
  'Final canonical invariant: one normalized live offer slug per company; archived offers do not reserve the slug.';

-- ---------------------------------------------------------------------------
-- 2. Preserve evidence of repairs as successor versions. Existing immutable
--    rows are never updated or deleted.
-- ---------------------------------------------------------------------------
alter table public.contract_product_versions
  add column if not exists supersedes_contract_product_version_id uuid
    references public.contract_product_versions(id) on delete restrict,
  add column if not exists correction_reason text,
  add column if not exists audit_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists
  contract_product_versions_one_integrity_successor_uidx
  on public.contract_product_versions(supersedes_contract_product_version_id)
  where supersedes_contract_product_version_id is not null
    and correction_reason = 'canonical_snapshot_alignment_20260727';

do $$
declare
  v_source public.contract_product_versions%rowtype;
  v_product_direction text;
  v_snapshot jsonb;
  v_hash text;
  v_version_number integer;
begin
  for v_source in
    select version.*
    from public.contract_product_versions version
    where version.supersedes_contract_product_version_id is null
      and (
        nullif(version.commercial_snapshot->>'contract_type', '')
          is distinct from version.contract_type
        or nullif(version.commercial_snapshot->>'energy_direction', '')
          is distinct from version.energy_direction
        or encode(digest(version.commercial_snapshot::text, 'sha256'), 'hex')
          is distinct from version.content_sha256
      )
    order by version.contract_product_id, version.version_number, version.id
  loop
    if exists (
      select 1
      from public.contract_product_versions successor
      where successor.supersedes_contract_product_version_id = v_source.id
        and successor.correction_reason =
          'canonical_snapshot_alignment_20260727'
    ) then
      continue;
    end if;

    select product.energy_direction
    into v_product_direction
    from public.contract_products product
    where product.id = v_source.contract_product_id;

    v_snapshot :=
      coalesce(v_source.commercial_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'contract_type', v_source.contract_type,
        'energy_direction',
          coalesce(v_source.energy_direction, v_product_direction, 'consumption'),
        'integrity_correction',
          jsonb_build_object(
            'reason', 'canonical_snapshot_alignment_20260727',
            'supersedes_contract_product_version_id', v_source.id,
            'source_content_sha256', v_source.content_sha256
          )
      );
    v_hash := encode(digest(v_snapshot::text, 'sha256'), 'hex');

    select coalesce(max(version.version_number), 0) + 1
    into v_version_number
    from public.contract_product_versions version
    where version.contract_product_id = v_source.contract_product_id;

    insert into public.contract_product_versions(
      contract_product_id,
      version_number,
      customer_type,
      contract_type,
      pricing_model,
      price_plan_id,
      price_plan_version_id,
      binding_months,
      notice_months,
      price_areas,
      start_rules,
      campaign_rules,
      automatic_renewal,
      power_of_attorney_required,
      withdrawal_rules,
      required_legal_modules,
      commercial_snapshot,
      content_sha256,
      status,
      approved_at,
      approved_by,
      locked_at,
      created_by,
      energy_direction,
      supersedes_contract_product_version_id,
      correction_reason,
      audit_metadata
    ) values (
      v_source.contract_product_id,
      v_version_number,
      v_source.customer_type,
      v_source.contract_type,
      v_source.pricing_model,
      v_source.price_plan_id,
      v_source.price_plan_version_id,
      v_source.binding_months,
      v_source.notice_months,
      v_source.price_areas,
      v_source.start_rules,
      v_source.campaign_rules,
      v_source.automatic_renewal,
      v_source.power_of_attorney_required,
      v_source.withdrawal_rules,
      v_source.required_legal_modules,
      v_snapshot,
      v_hash,
      case
        when v_source.status in ('approved', 'paused', 'archived') then 'approved'
        else v_source.status
      end,
      case
        when v_source.status in ('approved', 'paused', 'archived')
          then coalesce(v_source.approved_at, now())
        else null
      end,
      v_source.approved_by,
      case
        when v_source.status in ('approved', 'paused', 'archived')
          then now()
        else null
      end,
      v_source.created_by,
      coalesce(v_source.energy_direction, v_product_direction, 'consumption'),
      v_source.id,
      'canonical_snapshot_alignment_20260727',
      jsonb_build_object(
        'migration', '20260727162000_contract_slug_version_integrity_repair',
        'created_at', now(),
        'original_status', v_source.status,
        'original_version_number', v_source.version_number
      )
    );
  end loop;
end
$$;

-- Every newly written version must be internally self-consistent. The guard is
-- deliberately insert-only: historical evidence remains queryable, while bad
-- future versions fail before they can be referenced or published.
create or replace function public.gridex_contract_product_version_integrity_guard_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_expected_hash text;
begin
  if nullif(new.commercial_snapshot->>'contract_type', '')
       is distinct from new.contract_type then
    raise exception using
      errcode = '23514',
      message = 'contract_product_version_snapshot_contract_type_mismatch';
  end if;

  if nullif(new.commercial_snapshot->>'energy_direction', '')
       is distinct from new.energy_direction then
    raise exception using
      errcode = '23514',
      message = 'contract_product_version_snapshot_energy_direction_mismatch';
  end if;

  v_expected_hash :=
    encode(digest(new.commercial_snapshot::text, 'sha256'), 'hex');
  if new.content_sha256 is distinct from v_expected_hash then
    raise exception using
      errcode = '23514',
      message = 'contract_product_version_content_hash_mismatch',
      detail = jsonb_build_object(
        'expected', v_expected_hash,
        'received', new.content_sha256
      )::text;
  end if;

  return new;
end
$$;

drop trigger if exists contract_product_versions_integrity_guard_v1
  on public.contract_product_versions;
create trigger contract_product_versions_integrity_guard_v1
before insert on public.contract_product_versions
for each row execute function
  public.gridex_contract_product_version_integrity_guard_v1();

revoke all on function
  public.gridex_contract_product_version_integrity_guard_v1()
  from public, anon, authenticated;

comment on function
  public.gridex_contract_product_version_integrity_guard_v1() is
  'Rejects new product versions whose query columns, canonical snapshot and SHA-256 evidence disagree.';

commit;
