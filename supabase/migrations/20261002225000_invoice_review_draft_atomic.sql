-- Invoice review draft: export graph and calculation snapshot in one transaction.
--
-- Before: invoice review created the run/item/draft invoice through
-- gridex_create_invoice_export_graph_v1 and then wrote the calculation snapshot
-- onto the draft in a second call. When that failed, best-effort compensating
-- updates (errors ignored) tried to cancel the reservation, so a reserved draft
-- without its snapshot could remain. After: gridex_create_invoice_review_draft_v1
-- calls the existing graph function and writes the snapshot in the same
-- transaction; any failure leaves nothing behind.

create or replace function public.gridex_create_invoice_review_draft_v1(
  p_company_id uuid,
  p_run jsonb,
  p_items jsonb,
  p_invoices jsonb,
  p_enrichment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_result jsonb;
  v_item_id uuid := nullif(p_enrichment->>'invoice_export_item_id', '')::uuid;
  v_invoice_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'invoice_review_draft_service_role_required';
  end if;
  if p_company_id is null or v_item_id is null
     or nullif(p_run->>'company_id', '')::uuid is distinct from p_company_id then
    raise exception using errcode = '22023', message = 'invoice_review_draft_payload_invalid';
  end if;

  v_result := public.gridex_create_invoice_export_graph_v1(p_run, p_items, p_invoices);

  update public.customer_invoices
  set price_plan_version_id = nullif(p_enrichment->>'price_plan_version_id', '')::uuid,
      price_area_code = nullif(p_enrichment->>'price_area_code', ''),
      consumption_kwh = nullif(p_enrichment->>'consumption_kwh', '')::numeric,
      vat_rate = nullif(p_enrichment->>'vat_rate', '')::numeric,
      calculation_snapshot = p_enrichment->'calculation_snapshot',
      calculation_snapshot_sha256 = nullif(p_enrichment->>'calculation_snapshot_sha256', ''),
      metadata = coalesce(p_enrichment->'metadata', metadata),
      updated_at = now()
  where company_id = p_company_id
    and invoice_export_item_id = v_item_id
  returning id into v_invoice_id;
  if v_invoice_id is null then
    raise exception using errcode = 'P0002', message = 'invoice_review_draft_invoice_missing';
  end if;

  return v_result || jsonb_build_object('invoice_id', v_invoice_id);
end
$function$;

revoke all on function public.gridex_create_invoice_review_draft_v1(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gridex_create_invoice_review_draft_v1(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
