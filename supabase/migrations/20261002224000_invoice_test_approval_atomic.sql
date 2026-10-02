-- Invoice test-center approval marks the export item and its invoice mirror together.
--
-- Before: the approval metadata was written to invoice_export_items and then,
-- in a second call, to customer_invoices. If the second write failed the export
-- item was approved while its invoice was not, with no rollback.
-- After: gridex_approve_invoice_test_item_v1 writes both for the tenant in one
-- transaction and refuses when either row is no longer in the approvable state.

create or replace function public.gridex_approve_invoice_test_item_v1(
  p_company_id uuid,
  p_invoice_export_item_id uuid,
  p_approval jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_now timestamptz := now();
  v_item_id uuid;
  v_invoice_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'invoice_test_approval_service_role_required';
  end if;
  if p_company_id is null or p_invoice_export_item_id is null or jsonb_typeof(p_approval) <> 'object' then
    raise exception using errcode = '22023', message = 'invoice_test_approval_payload_invalid';
  end if;

  update public.invoice_export_items
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('approval', p_approval),
      updated_at = v_now
  where company_id = p_company_id
    and id = p_invoice_export_item_id
    and environment = 'test'
    and status = 'pending'
  returning id into v_item_id;
  if v_item_id is null then
    raise exception using errcode = '23514', message = 'invoice_test_approval_item_not_pending';
  end if;

  update public.customer_invoices
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('approval', p_approval),
      updated_at = v_now
  where company_id = p_company_id
    and invoice_export_item_id = p_invoice_export_item_id
    and status = 'draft'
  returning id into v_invoice_id;
  if v_invoice_id is null then
    raise exception using errcode = '23514', message = 'invoice_test_approval_invoice_not_draft';
  end if;

  return jsonb_build_object('invoice_export_item_id', v_item_id, 'invoice_id', v_invoice_id);
end
$function$;

revoke all on function public.gridex_approve_invoice_test_item_v1(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.gridex_approve_invoice_test_item_v1(uuid, uuid, jsonb) to service_role;
