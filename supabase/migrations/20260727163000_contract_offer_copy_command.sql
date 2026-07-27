-- Canonical "copy contract offer" command.
-- Copies commercial draft input into a new product/version graph while
-- preserving the source offer only as an audit reference.

begin;

alter table public.contract_offers
  add column if not exists copied_from_contract_offer_id uuid
    references public.contract_offers(id) on delete restrict;

create index if not exists contract_offers_copied_from_idx
  on public.contract_offers(company_id, copied_from_contract_offer_id)
  where copied_from_contract_offer_id is not null;

create or replace function public.gridex_copy_contract_offer_v1(
  p_company_id uuid,
  p_source_offer_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_source public.contract_offers%rowtype;
  v_payload jsonb;
  v_pricing_snapshot jsonb;
  v_result jsonb;
  v_new_offer_id uuid;
  v_suffix text := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'contract_offer_copy_service_role_required';
  end if;

  perform public.gridex_assert_contract_permission(
    p_actor_user_id,
    'contracts.create'
  );

  select *
  into v_source
  from public.contract_offers
  where id = p_source_offer_id
    and company_id = p_company_id
  for share;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'contract_offer_copy_source_not_found';
  end if;

  v_pricing_snapshot :=
    coalesce(v_source.commercial_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'copied_from_contract_offer_id', v_source.id,
      'copy_operation', 'gridex_copy_contract_offer_v1'
    );

  v_payload :=
    to_jsonb(v_source)
    - array[
        'id',
        'contract_product_id',
        'contract_product_version_id',
        'version_series_id',
        'supersedes_offer_id',
        'copied_from_contract_offer_id',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by',
        'published_at',
        'archived_at',
        'superseded_at',
        'ended_at',
        'version_snapshot',
        'commercial_snapshot'
      ]
    || jsonb_build_object(
      'name', v_source.name || ' (kopia)',
      'slug',
        public.gridex_contract_slugify(v_source.slug || '-kopia-' || v_suffix),
      'status', 'draft',
      'lifecycle_status', 'draft',
      'is_active', false,
      'valid_from', null,
      'valid_to', null,
      'channels', jsonb_build_object(
        'internal', 'paused',
        'website', 'paused',
        'api', 'paused'
      ),
      'copied_from_contract_offer_id', v_source.id
    );

  v_result := public.gridex_upsert_internal_contract_offer_v2(
    p_company_id,
    null,
    v_payload,
    v_pricing_snapshot,
    p_actor_user_id
  );

  if not coalesce((v_result->>'ok')::boolean, true) then
    return v_result;
  end if;

  v_new_offer_id := nullif(v_result#>>'{offer,id}', '')::uuid;
  if v_new_offer_id is null then
    raise exception using
      errcode = '23502',
      message = 'contract_offer_copy_result_missing_offer_id';
  end if;

  update public.contract_offers
  set copied_from_contract_offer_id = v_source.id,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = v_new_offer_id
    and company_id = p_company_id
    and lifecycle_status = 'draft';
  if not found then
    raise exception using
      errcode = '23514',
      message = 'contract_offer_copy_draft_binding_failed';
  end if;

  insert into public.domain_events(
    company_id,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    source,
    idempotency_key,
    payload
  ) values (
    p_company_id,
    'contract.offer.copied',
    'contract_offer',
    v_new_offer_id,
    p_actor_user_id,
    'gridex_copy_contract_offer_v1',
    'contract-copy:' || v_new_offer_id::text,
    jsonb_build_object(
      'source_contract_offer_id', v_source.id,
      'new_contract_offer_id', v_new_offer_id
    )
  ) on conflict do nothing;

  return v_result || jsonb_build_object(
    'ok', true,
    'copied', true,
    'source_contract_offer_id', v_source.id,
    'new_contract_offer_id', v_new_offer_id
  );
end
$$;

revoke all on function public.gridex_copy_contract_offer_v1(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.gridex_copy_contract_offer_v1(
  uuid, uuid, uuid
) to service_role;

comment on function public.gridex_copy_contract_offer_v1(
  uuid, uuid, uuid
) is
  'Creates a new unpublished contract product/version graph from any tenant-scoped source offer. Customer contracts, quotes, signatures, POAs, publications and capacity state are never copied.';

commit;
