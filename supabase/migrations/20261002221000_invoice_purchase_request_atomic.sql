-- Recording a requested invoice purchase is one write.
--
-- Before: after Capway accepted the purchase request, the internal API inserted
-- the invoice_purchase_events row and updated invoice_export_items.purchase_status
-- as two calls whose errors were ignored, so a purchase could be requested at
-- the provider without any local trace. After: one RPC records both for the
-- tenant's export item and fails loudly when the item is not the tenant's.

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
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'invoice_purchase_service_role_required';
  end if;
  if p_company_id is null or p_invoice_export_item_id is null
     or p_financing_mode not in ('factoring_without_recourse', 'factoring_with_recourse') then
    raise exception using errcode = '22023', message = 'invoice_purchase_payload_invalid';
  end if;

  update public.invoice_export_items
  set purchase_status = 'requested',
      financing_mode = p_financing_mode,
      updated_at = now()
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
