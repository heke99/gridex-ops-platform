-- The Supabase CLI records this migration in the same transaction as this block.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN

DO $purchase_audit_preimage$
DECLARE
  existing regprocedure := pg_catalog.to_regprocedure('public.gridex_record_invoice_purchase_request_v1(uuid,uuid,text,jsonb,uuid)');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = existing AND routine.prosecdef
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(routine.prosrc,'UTF8')),'hex') = '23a22bb1b13ccca366fe1884145fab942eab499073c5b8c541f4bd4338d70127'
  ) THEN
    RAISE EXCEPTION 'invoice_purchase_audit_preimage_required' USING ERRCODE = '55000';
  END IF;
END
$purchase_audit_preimage$;

create or replace function public.gridex_record_invoice_purchase_request_v1(
  p_company_id uuid,
  p_invoice_export_item_id uuid,
  p_financing_mode text,
  p_payload jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_event_id uuid;
  v_may_project_request boolean;
begin
  if auth.role() IS DISTINCT FROM 'service_role' then
    raise exception using errcode = '42501', message = 'invoice_purchase_service_role_required';
  end if;
  if p_company_id is null or p_invoice_export_item_id is null
     or p_financing_mode is null or p_financing_mode not in ('factoring_without_recourse', 'factoring_with_recourse') then
    raise exception using errcode = '22023', message = 'invoice_purchase_payload_invalid';
  end if;

  -- Serialize with the signed provider projection on this exact export item.
  select item.provider_purchase_confirmed_at is null
      and (item.purchase_status is null or item.purchase_status in ('service', 'own_ledger'))
      and item.status not in ('credited', 'cancelled', 'disputed')
      and item.provider_status is distinct from 'cancelled'
  into v_may_project_request
  from public.invoice_export_items as item
  where item.id = p_invoice_export_item_id and item.company_id = p_company_id
  for no key update;
  if not found then
    raise exception using errcode = 'P0002', message = 'invoice_export_item_not_found_for_tenant';
  end if;

  -- Keep the existing UPDATE so all row and retention guards still run.
  update public.invoice_export_items
  set purchase_status = case when v_may_project_request then 'requested' else purchase_status end,
      financing_mode = case when v_may_project_request then p_financing_mode else financing_mode end,
      updated_at = case when v_may_project_request then now() else updated_at end
  where id = p_invoice_export_item_id and company_id = p_company_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'invoice_export_item_not_found_for_tenant';
  end if;

  insert into public.invoice_purchase_events (
    company_id, invoice_export_item_id, event_type, purchase_status, finance_status, payload, created_by
  ) values (
    p_company_id, p_invoice_export_item_id, 'purchase_requested_manual', 'requested', p_financing_mode,
    coalesce(p_payload, '{}'::jsonb), p_actor_user_id
  )
  returning id into v_event_id;

  return jsonb_build_object('event_id', v_event_id);
end
$function$;

revoke all on function public.gridex_record_invoice_purchase_request_v1(uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.gridex_record_invoice_purchase_request_v1(uuid, uuid, text, jsonb, uuid) to service_role;

END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
