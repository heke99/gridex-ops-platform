-- Customer-card edits must not change a scalar while the next signature uses
-- the old immutable pricing ledger. Reuse the existing one-off authoring path,
-- with an explicitly acknowledged new agreement and its current tenant terms.
-- This command never signs, sends mail, changes supply dates or edits originals.
begin;
-- Serialize the zero-source check with every existing CPS writer; otherwise
-- an old transaction could commit an unproven reserved label between the
-- check and installing the guarded source/index policy.
lock table public.contract_price_snapshots in share row exclusive mode;
do $$begin
  if exists(select from public.contract_price_snapshots where source='customer_contract_unsigned_edit') then
    raise exception 'unsigned_contract_edit_reserved_source_already_present';
  end if;
end$$;

-- Legacy schedules retain one snapshot per effective start. Only a snapshot
-- pre-authorized by this transaction's unsigned edit may append another version
-- for the SAME genuine date. A caller-controlled source label grants nothing.
create schema gridex_unsigned_contract_revision;
revoke all on schema gridex_unsigned_contract_revision from public,anon,authenticated,service_role;
create table gridex_unsigned_contract_revision.price_revisions (
  snapshot_id uuid primary key references public.contract_price_snapshots(id) deferrable initially deferred,
  company_id uuid not null,
  customer_id uuid not null,
  contract_id uuid not null,
  price_plan_version_id uuid not null,
  original_snapshot_id uuid not null references public.contract_price_snapshots(id),
  actor_user_id uuid not null,
  edit_id uuid not null,
  creating_txid bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(company_id,contract_id,edit_id)
);
alter table gridex_unsigned_contract_revision.price_revisions enable row level security;
alter table gridex_unsigned_contract_revision.price_revisions force row level security;
revoke all on table gridex_unsigned_contract_revision.price_revisions from public,anon,authenticated,service_role;
create function gridex_unsigned_contract_revision.immutable_v1() returns trigger language plpgsql
set search_path=pg_catalog as $$begin
  raise exception using errcode='55000',message='unsigned_contract_price_revision_immutable';
end$$;
revoke all on function gridex_unsigned_contract_revision.immutable_v1() from public,anon,authenticated,service_role;
create trigger unsigned_contract_price_revision_immutable before update or delete
on gridex_unsigned_contract_revision.price_revisions for each row execute function gridex_unsigned_contract_revision.immutable_v1();
create function gridex_unsigned_contract_revision.require_insert_origin_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$begin
  if new.source='customer_contract_unsigned_edit' and (
    auth.role() is distinct from 'service_role' or not exists(
      select from gridex_unsigned_contract_revision.price_revisions r
      where r.snapshot_id=new.id and r.company_id=new.company_id and r.customer_id=new.customer_id
        and r.contract_id=new.contract_id and r.price_plan_version_id=new.price_plan_version_id
        and r.creating_txid=txid_current())) then
    raise exception using errcode='42501',message='unsigned_contract_price_revision_origin_required';
  end if;
  return new;
end$$;
revoke all on function gridex_unsigned_contract_revision.require_insert_origin_v1() from public,anon,authenticated,service_role;
create trigger aabc_contract_price_unsigned_revision_origin_v1 before insert on public.contract_price_snapshots
for each row execute function gridex_unsigned_contract_revision.require_insert_origin_v1();

-- Create the new revision-only uniqueness before replacing the legacy index.
-- Old rows cannot already carry this private command's provenance.
create unique index contract_price_snapshots_unsigned_revision_version_uidx
on public.contract_price_snapshots(company_id,contract_id,price_plan_version_id,valid_from)
where source='customer_contract_unsigned_edit';
do $$begin
  if not exists(select from pg_index i where i.indexrelid=to_regclass('public.contract_price_snapshots_contract_valid_from_uidx')
    and i.indrelid='public.contract_price_snapshots'::regclass and i.indisunique and i.indisvalid and i.indisready
    and i.indnkeyatts=3 and pg_get_expr(i.indpred,i.indrelid)='(contract_id IS NOT NULL)'
    and (select array_agg(a.attname::text order by k.ordinality) from unnest(i.indkey) with ordinality k(attnum,ordinality)
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum)=array['company_id','contract_id','valid_from']) then
    raise exception 'unsigned_contract_edit_unexpected_legacy_snapshot_index';
  end if;
end$$;
drop index public.contract_price_snapshots_contract_valid_from_uidx;
create unique index contract_price_snapshots_contract_valid_from_uidx
on public.contract_price_snapshots(company_id,contract_id,valid_from)
where contract_id is not null and source is distinct from 'customer_contract_unsigned_edit';

-- Readiness must follow an explicitly bound snapshot. Preserve the legacy
-- timeline only for contracts with no pointer AND no controlled revisions.
-- Replace exactly the observed LATERAL predicate; retain view columns, owner,
-- grants and security_invoker. Drift fails the whole forward transaction.
do $readiness$
declare
  definition text;
  needle text := 'WHERE ((cps_1.company_id = cc.company_id) AND (cps_1.contract_id = cc.id))';
begin
  perform set_config('search_path','pg_catalog',true);
  if (select pg_get_userbyid(relowner) from pg_class where oid='public.gridex_billing_launch_readiness_v'::regclass)<>'postgres'
     or not coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.gridex_billing_launch_readiness_v'::regclass),false) then
    raise exception 'unsigned_contract_edit_unexpected_readiness_view_authority';
  end if;
  definition:=pg_get_viewdef('public.gridex_billing_launch_readiness_v'::regclass,false);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'unsigned_contract_edit_unexpected_readiness_view_source';
  end if;
  definition:=replace(definition,needle,needle||$predicate$
    AND ((cc.contract_price_snapshot_id IS NOT NULL AND cps_1.id=cc.contract_price_snapshot_id
      AND cps_1.price_plan_version_id IS NOT DISTINCT FROM cc.price_plan_version_id)
    OR (cc.contract_price_snapshot_id IS NULL AND cps_1.source IS DISTINCT FROM 'customer_contract_unsigned_edit'
      AND NOT EXISTS(SELECT FROM public.contract_price_snapshots revision
        WHERE revision.company_id=cc.company_id AND revision.contract_id=cc.id AND revision.source='customer_contract_unsigned_edit')))
  $predicate$);
  execute 'CREATE OR REPLACE VIEW public.gridex_billing_launch_readiness_v WITH (security_invoker=true) AS '||definition;
end $readiness$;

create function public.gridex_edit_unsigned_customer_contract_v1(
  p_company_id uuid, p_customer_id uuid, p_contract_id uuid,
  p_actor_user_id uuid, p_edit_id uuid, p_expected_updated_at timestamptz,
  p_patch jsonb, p_acknowledge_current_terms boolean
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  c public.customer_contracts%rowtype;
  n public.customer_contracts%rowtype;
  original public.contract_price_snapshots%rowtype;
  receipt public.canonical_command_results%rowtype;
  site public.customer_sites%rowtype;
  binding jsonb;
  snapshot jsonb;
  components jsonb;
  bases jsonb;
  component jsonb;
  revised jsonb;
  payload jsonb;
  request jsonb;
  result jsonb;
  key text;
  value jsonb;
  code text;
  unit text;
  calculation text;
  component_name text;
  priority integer;
  alias text;
  codes text[];
  changed boolean := false;
  commercial boolean := false;
  customer_visible boolean := false;
  matches integer;
  revoked integer := 0;
  fresh_id uuid;
  fresh public.contract_price_snapshots%rowtype;
  actual_final public.customer_contracts%rowtype;
  command_key text;
  request_hash text;
  numeric_fields constant text[] := array[
    'fixed_price_ore_per_kwh','spot_markup_ore_per_kwh','variable_fee_ore_per_kwh',
    'monthly_fee_sek','invoice_fee_sek','green_fee_value','discount_value',
    'start_fee_sek','admin_fee_sek','break_fee_sek','vat_rate',
    'binding_months','notice_months','auto_renew_term_months'];
  allowed constant text[] := array[
    'contract_name','contract_type','campaign_name','campaign_code','campaign_version',
    'price_version','terms_version','green_fee_mode','discount_unit','starts_at','ends_at',
    'site_id','metering_point_id','override_reason','auto_renew_enabled',
    'fixed_price_ore_per_kwh','spot_markup_ore_per_kwh','variable_fee_ore_per_kwh',
    'monthly_fee_sek','invoice_fee_sek','green_fee_value','discount_value',
    'start_fee_sek','admin_fee_sek','break_fee_sek','vat_rate',
    'binding_months','notice_months','auto_renew_term_months'];
begin
  -- An authenticated server action supplies the real staff actor. Merely
  -- possessing a service credential never supplies that person's authority.
  if auth.role() is distinct from 'service_role'
     or p_actor_user_id is null
     or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.write'),false) then
    raise exception using errcode='42501',message='unsigned_contract_edit_permission_denied';
  end if;
  if p_company_id is null or p_customer_id is null or p_contract_id is null
     or p_edit_id is null or p_expected_updated_at is null
     or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception using errcode='22023',message='unsigned_contract_edit_payload_invalid';
  end if;
  for key,value in select * from jsonb_each(p_patch) loop
    if not key=any(allowed) then
      raise exception using errcode='22023',message='unsigned_contract_edit_field_forbidden';
    end if;
    if key=any(numeric_fields) then
      if value <> 'null'::jsonb and (jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]+([.][0-9]+)?$') then
        raise exception using errcode='22023',message='unsigned_contract_edit_numeric_invalid';
      end if;
      if key like '%\_months' escape '\' and value <> 'null'::jsonb and (value::text)::numeric<>trunc((value::text)::numeric) then
        raise exception using errcode='22023',message='unsigned_contract_edit_months_invalid';
      end if;
    elsif key='auto_renew_enabled' then
      if jsonb_typeof(value) is distinct from 'boolean' then
        raise exception using errcode='22023',message='unsigned_contract_edit_boolean_invalid';
      end if;
    elsif value<>'null'::jsonb and jsonb_typeof(value)<>'string' then
      raise exception using errcode='22023',message='unsigned_contract_edit_text_invalid';
    end if;
  end loop;

  -- Same company -> contract -> requests ordering as signature finalization.
  perform id from public.companies where id=p_company_id and is_active
    and lifecycle_status='active' and suspended_at is null for share;
  if not found then raise exception using errcode='55000',message='unsigned_contract_edit_company_unavailable';end if;
  select * into c from public.customer_contracts
    where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id for update;
  if not found then raise exception using errcode='22023',message='unsigned_contract_edit_contract_not_found';end if;
  -- Customer archival locks the customer before its contracts. Do not wait
  -- for that inverse order while this command holds the contract row.
  begin
    perform id from public.customers where id=p_customer_id and company_id=p_company_id
      and archived_at is null and status is distinct from 'archived' for share nowait;
    if not found then raise exception using errcode='22023',message='unsigned_contract_edit_customer_not_found';end if;
  exception when lock_not_available then
    raise exception using errcode='40001',message='unsigned_contract_edit_customer_busy';
  end;

  command_key:=p_contract_id::text||':'||p_edit_id::text;
  request:=jsonb_build_object('company_id',p_company_id,'customer_id',p_customer_id,
    'contract_id',p_contract_id,'actor_user_id',p_actor_user_id,'edit_id',p_edit_id,
    'expected_updated_at',to_char(p_expected_updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'patch',p_patch,'acknowledge_current_terms',coalesce(p_acknowledge_current_terms,false));
  request_hash:=public.canonical_json_sha256(request);
  select * into receipt from public.canonical_command_results
    where company_id=p_company_id and command_type='customer_contract.unsigned.edit.v1' and idempotency_key=command_key;
  if found then
    if receipt.request_hash is distinct from request_hash or receipt.request_payload is distinct from request then
      raise exception using errcode='22023',message='unsigned_contract_edit_idempotency_conflict';
    end if;
    return receipt.result_payload;
  end if;
  if c.signed_at is not null or c.locked_at is not null or c.status not in ('draft','pending_signature','signature_failed') then
    raise exception using errcode='55000',message='unsigned_contract_edit_signed_or_locked';
  end if;
  if c.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001',message='unsigned_contract_edit_stale';
  end if;
  -- Direct event commands acquire this advisory key before their contract
  -- lock; finalization acquires it afterwards. Never wait here while holding
  -- the contract: a competing event gets a retryable, effect-free refusal.
  if not pg_try_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_contract_id::text,0)) then
    raise exception using errcode='40001',message='unsigned_contract_edit_concurrent_event';
  end if;
  perform id from public.customer_contract_signature_requests where company_id=p_company_id
    and customer_id=p_customer_id and customer_contract_id=p_contract_id order by id for update;
  if exists(select from public.customer_contract_signature_requests where company_id=p_company_id
    and customer_id=p_customer_id and customer_contract_id=p_contract_id and used_at is not null) then
    raise exception using errcode='55000',message='unsigned_contract_edit_used_signature_evidence';
  end if;
  if not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.write'),false) then
    raise exception using errcode='42501',message='unsigned_contract_edit_permission_denied';
  end if;
  perform public.ediel_require_contract_records_available_v1(p_company_id,p_contract_id);

  n:=jsonb_populate_record(c,p_patch);
  if p_patch ? 'site_id' then n.customer_site_id:=n.site_id;end if;
  if nullif(btrim(n.contract_name),'') is null or n.contract_type not in ('fixed','variable_monthly','variable_hourly','variable_quarterly')
     or (n.starts_at is not null and n.ends_at<n.starts_at)
     or (n.auto_renew_enabled and coalesce(n.auto_renew_term_months,0)<1) then
    raise exception using errcode='22023',message='unsigned_contract_edit_terms_invalid';
  end if;
  if n.site_id is distinct from n.customer_site_id then
    raise exception using errcode='22023',message='unsigned_contract_edit_site_alias_mismatch';
  end if;
  if n.customer_site_id is not null then
    begin
      select * into site from public.customer_sites where id=n.customer_site_id and company_id=p_company_id and customer_id=p_customer_id for share nowait;
    exception when lock_not_available then
      raise exception using errcode='40001',message='unsigned_contract_edit_site_busy';
    end;
    if not found or (c.price_area_used is not null and site.price_area_code is distinct from c.price_area_used) then
      raise exception using errcode='22023',message='unsigned_contract_edit_owned_same_area_site_required';
    end if;
  end if;
  if n.metering_point_id is not null then
    begin
      perform id from public.metering_points where id=n.metering_point_id and company_id=p_company_id
        and customer_id=p_customer_id and site_id=n.customer_site_id for share nowait;
      if not found then raise exception using errcode='22023',message='unsigned_contract_edit_owned_point_required';end if;
    exception when lock_not_available then
      raise exception using errcode='40001',message='unsigned_contract_edit_point_busy';
    end;
  end if;
  for key,value in select * from jsonb_each(p_patch) loop
    if value is distinct from to_jsonb(c)->key then
      changed:=true;
      if key<>'override_reason' then customer_visible:=true;end if;
      if key not in ('site_id','metering_point_id','override_reason') then commercial:=true;end if;
    end if;
  end loop;

  if commercial then
    if not coalesce(p_acknowledge_current_terms,false) or nullif(btrim(n.override_reason),'') is null then
      raise exception using errcode='22023',message='unsigned_contract_edit_new_agreement_acknowledgement_required';
    end if;
    if not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.create'),false)
       or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'pricing.write'),false) then
      raise exception using errcode='42501',message='unsigned_contract_edit_pricing_permission_required';
    end if;
    if n.energy_direction<>'consumption' or n.vat_rate is distinct from 0.25
       or n.quote_reference is not null or n.discount_value is not null
       or coalesce(n.optional_fee_lines,'[]'::jsonb)<>'[]'::jsonb
       or coalesce(n.signature_snapshot,'{}'::jsonb)<>'{}'::jsonb
       or n.signature_snapshot_sha256 is not null then
      raise exception using errcode='22023',message='unsigned_contract_edit_specialist_revision_required';
    end if;
    select * into original from public.contract_price_snapshots
      where id=c.contract_price_snapshot_id and company_id=p_company_id and customer_id=p_customer_id
        and contract_id=p_contract_id and price_plan_version_id=c.price_plan_version_id;
    if not found or original.snapshot_quality is distinct from 'canonical'
       or original.snapshot_hash is distinct from public.canonical_json_sha256(original.snapshot_json)
       or original.quote_reference is not null or cardinality(original.selected_component_references)>0 then
      raise exception using errcode='22023',message='unsigned_contract_edit_canonical_ledger_required';
    end if;
    if not exists(select from public.contract_offers o
      join public.contract_product_versions product on product.id=c.contract_product_version_id and product.contract_product_id=o.contract_product_id
      join public.contract_publication_versions publication on publication.id=c.contract_publication_version_id
      join public.price_plan_versions plan on plan.id=publication.price_plan_version_id and plan.company_id=p_company_id
      join public.legal_bundle_versions legal on legal.id=publication.legal_bundle_version_id and legal.company_id=p_company_id
      where o.id=c.contract_offer_id and o.company_id=p_company_id and o.contract_product_id=c.contract_product_id
        and publication.contract_product_version_id=product.id and publication.price_plan_version_id=c.price_plan_version_id
        and publication.price_plan_id=c.price_plan_id and publication.price_book_id=c.price_book_id
        and publication.legal_bundle_version_id=c.legal_bundle_version_id
        and publication.status='published' and publication.locked_at is not null
        and product.status='approved' and product.locked_at is not null
        and plan.status in ('published','approved','active') and plan.locked_at is not null
        and legal.status='published' and legal.locked_at is not null and coalesce(cardinality(legal.unresolved_variables),0)=0) then
      raise exception using errcode='22023',message='unsigned_contract_edit_locked_original_graph_required';
    end if;
    -- Ordinary installed contract triggers derive commercial end dates and
    -- normalize proposed scalar terms. Read their actual result before creating
    -- a price/legal version; do not freeze a pre-trigger approximation.
    update public.customer_contracts set source_type='manual_override',
      site_id=n.site_id,customer_site_id=n.customer_site_id,metering_point_id=n.metering_point_id,
      contract_name=n.contract_name,contract_type=n.contract_type,campaign_name=n.campaign_name,
      campaign_code=n.campaign_code,campaign_version=n.campaign_version,price_version=n.price_version,terms_version=n.terms_version,
      fixed_price_ore_per_kwh=n.fixed_price_ore_per_kwh,spot_markup_ore_per_kwh=n.spot_markup_ore_per_kwh,
      variable_fee_ore_per_kwh=n.variable_fee_ore_per_kwh,monthly_fee_sek=n.monthly_fee_sek,invoice_fee_sek=n.invoice_fee_sek,
      green_fee_mode=n.green_fee_mode,green_fee_value=n.green_fee_value,discount_value=n.discount_value,discount_unit=n.discount_unit,
      start_fee_sek=n.start_fee_sek,admin_fee_sek=n.admin_fee_sek,break_fee_sek=n.break_fee_sek,vat_rate=n.vat_rate,
      binding_months=n.binding_months,notice_months=n.notice_months,starts_at=n.starts_at,ends_at=n.ends_at,
      auto_renew_enabled=n.auto_renew_enabled,auto_renew_term_months=n.auto_renew_term_months,override_reason=n.override_reason,
      updated_by=p_actor_user_id
    where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id returning * into n;
    snapshot:=original.snapshot_json;
    components:=original.price_components_snapshot;
    bases:=original.base_price_components_snapshot;
    if jsonb_typeof(components)<>'array' or jsonb_typeof(bases)<>'array' or jsonb_array_length(bases)=0
       or exists(select from jsonb_array_elements(bases) b where b->>'source_type' not in ('spot','fixed')
         or b ? 'conditions' or b ? 'selected_component_references')
       or exists(select from jsonb_array_elements(components) x where x ? 'conditions' or x ? 'selected_component_references')
       or (snapshot ? 'price_components' and snapshot->'price_components' is distinct from components)
       or (snapshot ? 'price_components_snapshot' and snapshot->'price_components_snapshot' is distinct from components)
       or (snapshot ? 'base_components' and snapshot->'base_components' is distinct from bases)
       or (snapshot ? 'base_price_components_snapshot' and snapshot->'base_price_components_snapshot' is distinct from bases)
       or coalesce(snapshot#>>'{production,enabled}','false')<>'false' or snapshot->'production'='true'::jsonb
       or coalesce(snapshot#>>'{portfolio_method,enabled}','false')<>'false'
       or coalesce(snapshot->'selected_component_references','[]'::jsonb) not in ('[]'::jsonb,'null'::jsonb)
       or nullif(snapshot->>'quote_reference','') is not null
       or coalesce(snapshot->>'pricing_model','') not in ('spot','fixed') then
      raise exception using errcode='22023',message='unsigned_contract_edit_unsupported_or_conflicting_price_graph';
    end if;
    -- A change in pricing model/base/unit needs the dedicated template editor.
    -- Fee amounts retain their exact existing component's full metadata.
    if n.contract_type is distinct from c.contract_type
       or n.fixed_price_ore_per_kwh is distinct from c.fixed_price_ore_per_kwh
       or n.green_fee_mode is distinct from c.green_fee_mode
       or n.discount_unit is distinct from c.discount_unit then
      raise exception using errcode='22023',message='unsigned_contract_edit_price_model_change_requires_template';
    end if;
    if n.campaign_name is distinct from c.campaign_name or n.campaign_code is distinct from c.campaign_code
       or n.campaign_version is distinct from c.campaign_version or n.price_version is distinct from c.price_version
       or n.terms_version is distinct from c.terms_version then
      raise exception using errcode='22023',message='unsigned_contract_edit_campaign_version_requires_template';
    end if;
    for key,code,unit,calculation,component_name,priority in select * from (values
      ('monthly_fee_sek','monthly_fee','sek_month','per_month','Månadsavgift',100),
      ('invoice_fee_sek','invoice_fee','sek_invoice','per_invoice','Fakturaavgift',110),
      ('spot_markup_ore_per_kwh','spot_markup','ore_per_kwh','per_kwh','Påslag',130),
      ('variable_fee_ore_per_kwh','variable_fee','ore_per_kwh','per_kwh','Rörlig avgift',140),
      ('green_fee_value','green_energy_fee',case when n.green_fee_mode='sek_month' then 'sek_month' else 'ore_per_kwh' end,case when n.green_fee_mode='sek_month' then 'per_month' else 'per_kwh' end,'Grönt el-tillägg',150),
      ('start_fee_sek','start_fee','sek_contract','fixed_once','Startavgift',170),
      ('admin_fee_sek','administration_fee','sek_contract','fixed_once','Administrativ avgift',180),
      ('break_fee_sek','break_fee','sek_event','event_only','Brytavgift',190)
    ) mappings(field,code,unit,calculation,name,priority) loop
      if not p_patch ? key or to_jsonb(n)->key is not distinct from to_jsonb(c)->key then continue;end if;
      revised:='[]'::jsonb;matches:=0;
      for component in select * from jsonb_array_elements(components) loop
        select array_agg(distinct a) into codes from unnest(array[
          nullif(component->>'component_code',''),nullif(component->>'componentCode',''),
          nullif(component#>>'{metadata,component_code}',''),nullif(component#>>'{metadata,component_key}','')]) a where a is not null;
        if code=any(codes) then
          matches:=matches+1;
          if cardinality(codes)<>1 or component->>'unit' is distinct from unit
             or not (component->>'calculation_type'=calculation or (code='monthly_fee' and component->>'calculation_type'='fixed_monthly'))
             or component->>'calculation_inclusion'='excluded' or component->>'selected'='false' or component->>'eligible'='false'
             or nullif(component#>>'{metadata,conditions}','') is not null
             or to_jsonb(n)->key='null'::jsonb then
            raise exception using errcode='22023',message='unsigned_contract_edit_component_mapping_ambiguous';
          end if;
          component:=jsonb_set(component,'{amount}',to_jsonb(n)->key);
        end if;
        revised:=revised||jsonb_build_array(component);
      end loop;
      -- A new ordinary scalar fee has no original component to retain. Its
      -- exact supported lifecycle/unit is explicit; a missing NONNULL original
      -- amount remains an inconsistent ledger and is never silently repaired.
      if matches=0 and coalesce(to_jsonb(c)->key,'null'::jsonb)='null'::jsonb
         and to_jsonb(n)->key<>'null'::jsonb and not (key='green_fee_value' and n.green_fee_mode='none') then
        revised:=revised||jsonb_build_array(jsonb_build_object('component_code',code,'component_type','fee',
          'name',component_name,'unit',unit,'amount',to_jsonb(n)->key,'calculation_type',calculation,
          'vat_applicable',true,'invoice_line_visible',true,'website_card_visible',true,
          'calculation_inclusion','included','priority',priority,'metadata',
          case when code in ('start_fee','administration_fee') then jsonb_build_object('lifecycle','once_per_contract','event','contract_started')
               when code='break_fee' then jsonb_build_object('lifecycle','event_only','event','early_termination')
               else '{}'::jsonb end));
        matches:=1;
      end if;
      if matches<>1 then raise exception using errcode='22023',message='unsigned_contract_edit_unique_component_required';end if;
      components:=revised;
    end loop;

    -- Strip only documented top-level source identities/derived signing values;
    -- never recursively delete metadata or hidden components such as certificates.
    snapshot:=snapshot-array['contract_id','contractId','company_id','customer_id','customer_number',
      'contract_price_snapshot_id','snapshot_hash','snapshot_sha256','document_sha256','signature_snapshot_sha256',
      'contract_offer_id','public_contract_offer_id','contract_product_id','contract_product_version_id',
      'contract_publication_version_id','price_plan_id','price_plan_version_id','price_book_id',
      'legal_bundle_id','legal_bundle_version_id','source','snapshot_schema','snapshot_schema_version','schema_version',
      'offer_reference','total','totals','total_price','quote_reference','quote_hash','one_off_identity','plan_code','product_key'];
    snapshot:=snapshot||jsonb_build_object('base_components',bases,'base_price_components_snapshot',bases,
      'price_components',components,'price_components_snapshot',components,
      'contract_type',n.contract_type,'energy_direction',n.energy_direction,'price_area',n.price_area_used,
      'source','customer_contract_unsigned_edit','snapshot_schema','gridex_unsigned_contract_edit_v1',
      'schema_version','gridex_unsigned_contract_edit_v1');
    -- Refresh scalar aliases too: legacy presentation reads camelCase, while
    -- the canonical materializer reads snake_case and billing reads the arrays.
    foreach key in array numeric_fields||array['green_fee_mode','discount_unit','auto_renew_enabled',
      'starts_at','ends_at','contract_name','campaign_name','campaign_code','campaign_version','price_version','terms_version'] loop
      snapshot:=snapshot||jsonb_build_object(key,to_jsonb(n)->key);
    end loop;
    for key,alias in select * from (values
      ('monthly_fee_sek','monthlyFeeSek'),('invoice_fee_sek','invoiceFeeSek'),
      ('spot_markup_ore_per_kwh','spotMarkupOrePerKwh'),('variable_fee_ore_per_kwh','variableFeeOrePerKwh'),
      ('green_fee_value','greenFeeValue'),('green_fee_mode','greenFeeMode'),
      ('fixed_price_ore_per_kwh','fixedPriceOrePerKwh'),('start_fee_sek','startFeeSek'),
      ('admin_fee_sek','adminFeeSek'),('break_fee_sek','breakFeeSek'),('vat_rate','vatRate'),
      ('discount_value','discountValue'),('discount_unit','discountUnit'),
      ('starts_at','startsAt'),('ends_at','endsAt'),('binding_months','bindingMonths'),('notice_months','noticeMonths'),
      ('auto_renew_enabled','autoRenewEnabled'),('auto_renew_term_months','autoRenewTermMonths'),
      ('contract_name','contractName'),('campaign_name','campaignName'),('campaign_code','campaignCode'),
      ('campaign_version','campaignVersion'),('price_version','priceVersion'),('terms_version','termsVersion')) aliases(field,alias) loop
      if snapshot ? alias then snapshot:=jsonb_set(snapshot,array[alias],to_jsonb(n)->key);end if;
    end loop;
    payload:=to_jsonb(n)||jsonb_build_object('name',n.contract_name,'intended_contract_id',p_contract_id,
      'automatic_renewal',n.auto_renew_enabled,'automatic_renewal_term_months',n.auto_renew_term_months,
      'default_binding_months',n.binding_months,'default_notice_months',n.notice_months,
      'valid_from',current_date,'valid_to',null,'customer_type','both');
    binding:=public.gridex_prepare_manual_contract_binding(p_company_id,payload,snapshot,p_actor_user_id);
    select v.snapshot_json into snapshot from public.price_plan_versions v
      where v.id=(binding->>'price_plan_version_id')::uuid and v.company_id=p_company_id
        and v.status='published' and v.locked_at is not null;
    if not found or snapshot->'price_components' is distinct from components
       or snapshot->'price_components_snapshot' is distinct from components
       or snapshot->'base_components' is distinct from bases
       or snapshot->'base_price_components_snapshot' is distinct from bases then
      raise exception using errcode='22023',message='unsigned_contract_edit_materialized_components_changed';
    end if;
    -- The existing CPS insert trigger binds against the CURRENT contract.
    -- Stage the new exact graph first, in this same rollback-safe transaction.
    -- Leaving the old graph here would freeze mixed old/new signing identities.
    update public.customer_contracts set
      source_type='manual_override',contract_offer_id=(binding->>'contract_offer_id')::uuid,public_contract_offer_id=null,
      contract_product_id=(binding->>'contract_product_id')::uuid,
      contract_product_version_id=(binding->>'contract_product_version_id')::uuid,
      contract_publication_version_id=(binding->>'contract_publication_version_id')::uuid,
      price_plan_id=(binding->>'price_plan_id')::uuid,price_plan_version_id=(binding->>'price_plan_version_id')::uuid,
      price_book_id=(binding->>'price_book_id')::uuid,legal_bundle_version_id=(binding->>'legal_bundle_version_id')::uuid,
      offer_reference=binding->>'offer_reference',commercial_snapshot=binding->'commercial_snapshot',
      legal_snapshot=binding->'legal_snapshot',updated_by=p_actor_user_id
    where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id;
    fresh_id:=gen_random_uuid();
    insert into gridex_unsigned_contract_revision.price_revisions(snapshot_id,company_id,customer_id,contract_id,
      price_plan_version_id,original_snapshot_id,actor_user_id,edit_id,creating_txid)
    values(fresh_id,p_company_id,p_customer_id,p_contract_id,(binding->>'price_plan_version_id')::uuid,
      original.id,p_actor_user_id,p_edit_id,txid_current());
    insert into public.contract_price_snapshots(id,company_id,contract_id,customer_id,
      price_plan_version_id,price_plan_id,price_book_id,pricing_model,
      base_price_components_snapshot,price_components_snapshot,snapshot_json,snapshot_hash,
      snapshot_quality,source,snapshot_schema_version,valid_from,valid_to,contract_number,customer_number)
    values(fresh_id,p_company_id,p_contract_id,p_customer_id,(binding->>'price_plan_version_id')::uuid,
      (binding->>'price_plan_id')::uuid,(binding->>'price_book_id')::uuid,
      snapshot->>'pricing_model',bases,components,snapshot,public.canonical_json_sha256(snapshot),
      'canonical','customer_contract_unsigned_edit','gridex_unsigned_contract_edit_v1',coalesce(n.starts_at,current_date),n.ends_at,c.contract_number,c.customer_number)
    returning * into fresh;
    fresh_id:=fresh.id;snapshot:=fresh.snapshot_json;
    if fresh.price_components_snapshot is distinct from components or fresh.base_price_components_snapshot is distinct from bases then
      raise exception using errcode='22023',message='unsigned_contract_edit_normalized_components_changed';
    end if;
  end if;
  if changed then
    -- A stale link is invalid even for site/name changes: finalization must not
    -- accept consent to a different version than the one the customer reviewed.
    if customer_visible then
      update public.customer_contract_signature_requests set revoked_at=clock_timestamp()
        where company_id=p_company_id and customer_id=p_customer_id and customer_contract_id=p_contract_id
          and used_at is null and revoked_at is null;
      get diagnostics revoked=row_count;
    end if;
    if commercial then
      update public.customer_contracts set
      source_type=case when commercial then 'manual_override' else c.source_type end,
      site_id=n.site_id,customer_site_id=n.customer_site_id,metering_point_id=n.metering_point_id,
      contract_name=n.contract_name,contract_type=n.contract_type,campaign_name=n.campaign_name,
      campaign_code=n.campaign_code,campaign_version=n.campaign_version,price_version=n.price_version,terms_version=n.terms_version,
      fixed_price_ore_per_kwh=n.fixed_price_ore_per_kwh,spot_markup_ore_per_kwh=n.spot_markup_ore_per_kwh,
      variable_fee_ore_per_kwh=n.variable_fee_ore_per_kwh,monthly_fee_sek=n.monthly_fee_sek,invoice_fee_sek=n.invoice_fee_sek,
      green_fee_mode=n.green_fee_mode,green_fee_value=n.green_fee_value,discount_value=n.discount_value,discount_unit=n.discount_unit,
      start_fee_sek=n.start_fee_sek,admin_fee_sek=n.admin_fee_sek,break_fee_sek=n.break_fee_sek,vat_rate=n.vat_rate,
      binding_months=n.binding_months,notice_months=n.notice_months,starts_at=n.starts_at,ends_at=n.ends_at,
      auto_renew_enabled=n.auto_renew_enabled,auto_renew_term_months=n.auto_renew_term_months,override_reason=n.override_reason,
      contract_offer_id=case when commercial then (binding->>'contract_offer_id')::uuid else c.contract_offer_id end,
      public_contract_offer_id=case when commercial then null else c.public_contract_offer_id end,
      contract_product_id=case when commercial then (binding->>'contract_product_id')::uuid else c.contract_product_id end,
      contract_product_version_id=case when commercial then (binding->>'contract_product_version_id')::uuid else c.contract_product_version_id end,
      contract_publication_version_id=case when commercial then (binding->>'contract_publication_version_id')::uuid else c.contract_publication_version_id end,
      price_plan_id=case when commercial then (binding->>'price_plan_id')::uuid else c.price_plan_id end,
      price_plan_version_id=case when commercial then (binding->>'price_plan_version_id')::uuid else c.price_plan_version_id end,
      price_book_id=case when commercial then (binding->>'price_book_id')::uuid else c.price_book_id end,
      legal_bundle_version_id=case when commercial then (binding->>'legal_bundle_version_id')::uuid else c.legal_bundle_version_id end,
      offer_reference=case when commercial then binding->>'offer_reference' else c.offer_reference end,
      commercial_snapshot=case when commercial then binding->'commercial_snapshot' else c.commercial_snapshot end,
      legal_snapshot=case when commercial then binding->'legal_snapshot' else c.legal_snapshot end,
      price_snapshot=case when commercial then snapshot else c.price_snapshot end,
      contract_price_snapshot_id=case when commercial then fresh_id else c.contract_price_snapshot_id end,
      snapshot_hash=case when commercial then public.canonical_json_sha256(snapshot) else c.snapshot_hash end,
      snapshot_quality=case when commercial then 'canonical' else c.snapshot_quality end,
      updated_by=p_actor_user_id,updated_at=clock_timestamp()
      where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id;
    else
      -- Column-specific catalog/publication triggers fire even when a listed
      -- column is assigned its old value. A site/note edit must not invoke
      -- those commercial projections or rebuild any unsubmitted snapshot.
      update public.customer_contracts set site_id=n.site_id,customer_site_id=n.customer_site_id,
        metering_point_id=n.metering_point_id,override_reason=n.override_reason,
        updated_by=p_actor_user_id,updated_at=clock_timestamp()
      where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id;
    end if;
    perform public.gridex_record_customer_contract_event_v1(p_company_id,p_contract_id,p_customer_id,'updated',clock_timestamp(),
      n.override_reason,jsonb_build_object('source','unsigned_contract_edit_v1','changed_fields',(select jsonb_agg(k) from jsonb_object_keys(p_patch) k),
        'old_price_snapshot_id',c.contract_price_snapshot_id,'new_price_snapshot_id',coalesce(fresh_id,c.contract_price_snapshot_id),
        'old_publication_id',c.contract_publication_version_id,'new_publication_id',binding->'contract_publication_version_id',
        'links_revoked',revoked,'current_terms_acknowledged',commercial and p_acknowledge_current_terms),
      p_actor_user_id,null,'unsigned-edit:'||command_key);
  end if;
  select * into actual_final from public.customer_contracts where id=p_contract_id and company_id=p_company_id and customer_id=p_customer_id;
  if commercial then
    if actual_final.contract_price_snapshot_id is distinct from fresh_id
       or actual_final.price_snapshot is distinct from fresh.snapshot_json
       or actual_final.snapshot_hash is distinct from fresh.snapshot_hash
       or (actual_final.starts_at is distinct from fresh.valid_from and actual_final.starts_at is not null)
       or actual_final.ends_at is distinct from fresh.valid_to
       or actual_final.ends_at::text is distinct from fresh.snapshot_json->>'ends_at' then
      raise exception using errcode='22023',message='unsigned_contract_edit_final_snapshot_mismatch';
    end if;
  elsif actual_final.starts_at is distinct from c.starts_at or actual_final.ends_at is distinct from c.ends_at
     or actual_final.price_snapshot is distinct from c.price_snapshot or actual_final.campaign_snapshot is distinct from c.campaign_snapshot then
    raise exception using errcode='22023',message='unsigned_contract_edit_unsubmitted_terms_changed';
  end if;
  -- Materialization/trigger dependencies may wait. Refresh the real actor's
  -- company authority again before recording a successful durable command.
  if not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.write'),false)
     or (commercial and (
       not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'contracts.create'),false)
       or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_company_id,'pricing.write'),false))) then
    raise exception using errcode='42501',message='unsigned_contract_edit_permission_denied';
  end if;
  result:=jsonb_build_object('ok',true,'contract_id',p_contract_id,'pricing_revised',commercial,'links_revoked',revoked);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id,request_hash)
    values(p_company_id,'customer_contract.unsigned.edit.v1',command_key,request,result,p_actor_user_id,request_hash);
  return result;
end $$;

revoke all on function public.gridex_edit_unsigned_customer_contract_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.gridex_edit_unsigned_customer_contract_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,boolean) to service_role;
comment on function public.gridex_edit_unsigned_customer_contract_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,jsonb,boolean)
is 'Atomic actor/tenant-scoped unsigned proposal edit. Commercial edits author a new one-off/current-terms agreement, preserve original ledgers and revoke old links; never customer consent or mail dispatch.';
commit;
