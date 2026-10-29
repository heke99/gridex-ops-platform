-- Canonical review approval: immutable financial inputs, atomic metadata and audit.
-- The authenticated application retains its canonical permission checks; this
-- internal entrypoint is callable only by service_role.
create or replace function public.gridex_approve_invoice_review_v1(
  p_company_id uuid,
  p_invoice_export_item_id uuid,
  p_actor_user_id uuid,
  p_review jsonb,
  p_review_hash text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_item public.invoice_export_items%rowtype;
  v_invoice public.customer_invoices%rowtype;
  v_underlay public.billing_underlays%rowtype;
  v_pricing public.pricing_runs%rowtype;
  v_company_status text;
  v_expected jsonb;
  v_approval jsonb;
  v_now timestamptz := clock_timestamp();
  v_event_id uuid;
  v_event public.domain_events%rowtype;
  v_event_key text;
  v_new boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='invoice_review_approval_service_role_required';
  end if;
  if p_company_id is null or p_invoice_export_item_id is null or p_actor_user_id is null
     or jsonb_typeof(p_review) is distinct from 'object'
     or p_review_hash is null or p_review_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023', message='invoice_review_approval_payload_invalid';
  end if;

  -- Row locks disappear on commit/rollback; there is no separately released TTL
  -- lock whose cleanup error could mask a committed approval.
  select * into v_item from public.invoice_export_items
    where company_id=p_company_id and id=p_invoice_export_item_id for update nowait;
  if not found then
    raise exception using errcode='P0002', message='invoice_review_approval_item_missing';
  end if;
  select * into strict v_invoice from public.customer_invoices
    where company_id=p_company_id and invoice_export_item_id=v_item.id for update nowait;
  select status into v_company_status from public.companies
    where id=p_company_id for share nowait;
  if not found or v_company_status is null or v_company_status not in ('active','onboarding') then
    raise exception using errcode='42501', message='invoice_review_approval_company_not_operational';
  end if;
  if v_item.status is distinct from 'pending' or v_invoice.status is distinct from 'draft' then
    raise exception using errcode='23514', message='invoice_review_approval_not_draft';
  end if;
  if jsonb_typeof(coalesce(v_item.metadata,'{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(v_invoice.metadata,'{}'::jsonb)) is distinct from 'object' then
    raise exception using errcode='55000', message='invoice_review_approval_metadata_invalid';
  end if;
  select * into strict v_underlay from public.billing_underlays
    where company_id=p_company_id and id=v_item.billing_underlay_id for share nowait;
  select * into strict v_pricing from public.pricing_runs
    where company_id=p_company_id and id=v_item.pricing_run_id for share nowait;
  perform public.ediel_require_invoice_source_copies_available_v1(
    p_company_id, v_underlay.id, v_invoice.id, v_item.id);

  if v_underlay.status is distinct from 'validated' or v_underlay.readiness_status is distinct from 'ready'
     or coalesce(v_underlay.missing_values_count,0)>0
     or v_pricing.status is distinct from 'locked' or v_pricing.locked_at is null
     or v_pricing.billing_underlay_id is distinct from v_underlay.id
     or v_item.customer_id is distinct from v_underlay.customer_id
     or v_item.customer_contract_id is distinct from coalesce(v_underlay.customer_contract_id,v_underlay.contract_id)
     or v_invoice.customer_id is distinct from v_item.customer_id
     or v_invoice.customer_contract_id is distinct from v_item.customer_contract_id
     or v_invoice.billing_underlay_id is distinct from v_underlay.id
     or nullif(v_invoice.calculation_snapshot_sha256,'') is null
     or coalesce(nullif(v_invoice.price_area_code,''),v_underlay.price_area) not in ('SE1','SE2','SE3','SE4')
     or coalesce(nullif(v_invoice.price_area_code,''),v_underlay.price_area) is null
     or v_underlay.total_kwh is null or v_item.total_kwh is null
     or abs(v_underlay.total_kwh-v_item.total_kwh)>0.001
     or (coalesce(v_invoice.total_kwh,v_invoice.consumption_kwh) is not null
         and abs(v_underlay.total_kwh-coalesce(v_invoice.total_kwh,v_invoice.consumption_kwh))>0.001)
     or v_item.amount_ex_vat is null or v_pricing.total_ex_vat is null
     or v_item.vat_amount is null or v_pricing.vat_amount is null
     or v_item.amount_inc_vat is null or v_pricing.total_inc_vat is null or v_invoice.amount_inc_vat is null
     or abs(v_item.amount_ex_vat-v_pricing.total_ex_vat)>0.01
     or abs(v_item.vat_amount-v_pricing.vat_amount)>0.01
     or abs(v_item.amount_inc_vat-v_pricing.total_inc_vat)>0.01
     or abs(v_invoice.amount_inc_vat-v_pricing.total_inc_vat)>0.01 then
    raise exception using errcode='23514', message='invoice_review_approval_readiness_changed';
  end if;
  v_expected := jsonb_build_object(
    'invoice_export_item_id',v_item.id,
    'billing_underlay_id',v_underlay.id,
    'pricing_run_id',v_pricing.id,
    'calculation_snapshot_sha256',v_invoice.calculation_snapshot_sha256,
    'total_kwh',v_underlay.total_kwh,
    'total_inc_vat',v_invoice.amount_inc_vat,
    'price_area',coalesce(nullif(v_invoice.price_area_code,''),v_underlay.price_area));
  if v_expected is distinct from p_review then
    raise exception using errcode='40001', message='invoice_review_approval_review_changed';
  end if;
  -- review_hash is produced by the trusted service's stableJson/sha256 encoder;
  -- the authoritative financial basis above is independently compared natively.

  if coalesce(v_item.metadata#>>'{approval,status}','')='approved'
     or coalesce(v_invoice.metadata#>>'{approval,status}','')='approved' then
    -- Historical partial approvals need explicit recovery, never silent success
    -- or replacement of the original actor and time.
    if v_item.metadata->'approval' is distinct from v_invoice.metadata->'approval'
       or v_item.metadata#>>'{approval,status}' is distinct from 'approved'
       or v_item.metadata#>>'{approval,review_hash}' is distinct from p_review_hash
       or v_item.metadata#>>'{approval,calculation_snapshot_sha256}' is distinct from v_invoice.calculation_snapshot_sha256 then
      raise exception using errcode='55000', message='invoice_review_approval_mirror_mismatch';
    end if;
    v_approval := v_item.metadata->'approval';
    if nullif(v_approval->>'approved_by','') is null or nullif(v_approval->>'approved_at','') is null then
      raise exception using errcode='55000', message='invoice_review_approval_metadata_invalid';
    end if;
  else
    v_new := true;
    v_approval := jsonb_build_object('status','approved','approved_at',v_now,
      'approved_by',p_actor_user_id,'review_hash',p_review_hash,
      'calculation_snapshot_sha256',v_invoice.calculation_snapshot_sha256);
    update public.invoice_export_items set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('approval',v_approval),updated_at=v_now
      where company_id=p_company_id and id=v_item.id;
    update public.customer_invoices set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('approval',v_approval),updated_at=v_now
      where company_id=p_company_id and id=v_invoice.id;
  end if;

  v_event_key := 'invoice-approved:'||v_item.id::text||':'||p_review_hash;
  insert into public.domain_events(company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,actor_user_id,source,idempotency_key,payload)
    values(p_company_id,'invoice.approved','invoice_export_item',v_item.id::text,v_item.customer_id,
      (v_approval->>'approved_by')::uuid,'invoice_approved_dispatch_v1',v_event_key,
      jsonb_build_object('approved_at',v_approval->'approved_at','review_hash',p_review_hash))
    on conflict(idempotency_key) where idempotency_key is not null do nothing;
  select * into strict v_event from public.domain_events
    where company_id=p_company_id and idempotency_key=v_event_key
      and event_type='invoice.approved' and aggregate_type='invoice_export_item' and aggregate_id=v_item.id::text;
  if v_event.actor_user_id is distinct from (v_approval->>'approved_by')::uuid
     or v_event.subject_customer_id is distinct from v_item.customer_id
     or v_event.payload is distinct from jsonb_build_object('approved_at',v_approval->'approved_at','review_hash',p_review_hash) then
    raise exception using errcode='55000', message='invoice_review_approval_event_mismatch';
  end if;
  v_event_id := v_event.id;
  insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,status,attempts,max_attempts,available_at,payload)
    values(p_company_id,v_event_id,'webhook','webhook_fanout_v1','queued',0,12,v_now,
      jsonb_build_object('event_type','invoice.approved','aggregate_type','invoice_export_item','aggregate_id',v_item.id))
    on conflict do nothing;
  -- Fanout owns the job's mutable lifecycle: on completion it replaces payload
  -- with delivery_count. Reuse its stable identity without resetting that state.
  if not exists(select 1 from public.event_outbox where company_id=p_company_id and domain_event_id=v_event_id
      and destination_type='webhook' and destination_key='webhook_fanout_v1') then
    raise exception using errcode='55000', message='invoice_review_approval_outbox_mismatch';
  end if;
  return jsonb_build_object('newly_approved',v_new,'invoice_export_item_id',v_item.id,'invoice_id',v_invoice.id,'event_id',v_event_id);
exception when lock_not_available then
  raise exception using errcode='55P03', message='invoice_review_approval_already_running';
end;
$$;
revoke all on function public.gridex_approve_invoice_review_v1(uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.gridex_approve_invoice_review_v1(uuid,uuid,uuid,jsonb,text) to service_role;
