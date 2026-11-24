-- The Supabase CLI records this migration in the same transaction as this block.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN

create function public.gridex_finalize_automatic_invoice_purchase_ack_v1(
  p_company_id uuid,
  p_invoice_export_item_id uuid,
  p_export_run_id uuid,
  p_environment text,
  p_invoice_guid text,
  p_provider_key text,
  p_attempt_no integer,
  p_started_at timestamptz,
  p_request_payload jsonb,
  p_purchase_ack jsonb,
  p_customer_invoice_id uuid,
  p_issued_at timestamptz,
  p_due_date date
)
returns jsonb
language plpgsql
security invoker
set search_path to pg_catalog
as $function$
declare
  item public.invoice_export_items%rowtype;
  checkpoint jsonb;
  create_guids jsonb;
  cancellation_event_id uuid;
  finished_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'automatic_invoice_purchase_service_role_required';
  end if;
  if p_environment is null or p_environment not in ('test', 'production')
    or nullif(btrim(p_invoice_guid), '') is null or nullif(btrim(p_provider_key), '') is null
    or p_attempt_no is null or p_attempt_no < 1 or p_started_at is null
    or p_customer_invoice_id is null or p_issued_at is null or p_due_date is null
    or jsonb_typeof(p_request_payload) is distinct from 'object'
    or jsonb_typeof(p_purchase_ack) is distinct from 'object' or p_purchase_ack = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'automatic_invoice_purchase_ack_invalid';
  end if;

  -- The event's existing nondeferrable company/item FK takes KEY SHARE.
  -- Lock the same item before taking the following statement's event snapshot.
  select * into item
  from public.invoice_export_items
  where company_id = p_company_id and id = p_invoice_export_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'automatic_invoice_purchase_item_not_found';
  end if;

  checkpoint := item.response_payload->'automatic_purchase_reconciliation';
  if jsonb_typeof(item.response_payload#>'{create_invoice,invoiceGuids}') = 'array' then
    select jsonb_agg(guid order by ordinal) into create_guids
    from jsonb_array_elements(item.response_payload#>'{create_invoice,invoiceGuids}')
      with ordinality as entry(guid, ordinal)
    where jsonb_typeof(guid) = 'string' and nullif(btrim(guid#>>'{}'), '') is not null;
  end if;
  if item.export_run_id is distinct from p_export_run_id or item.environment is distinct from p_environment
    or item.provider <> 'capway_aptic' or item.status not in ('needs_review', 'pending', 'failed', 'failed_retryable')
    or item.provider_invoice_guid is not null or item.provider_invoice_id is not null
    or item.attempt_count is distinct from p_attempt_no or item.last_attempt_at is distinct from p_started_at
    or item.response_payload ? 'manual_purchase_reconciliation'
    or item.response_payload->>'purchase' is not null
    or checkpoint->>'invoice_export_item_id' is distinct from item.id::text
    or checkpoint->>'company_id' is distinct from item.company_id::text
    or checkpoint->>'export_run_id' is distinct from item.export_run_id::text
    or checkpoint->>'provider' is distinct from item.provider
    or checkpoint->>'environment' is distinct from item.environment
    or checkpoint->>'invoice_guid' is distinct from p_invoice_guid
    or checkpoint->>'provider_idempotency_key' is distinct from p_provider_key
    or coalesce(nullif(btrim(item.provider_idempotency_key), ''), nullif(btrim(item.idempotency_key), ''),
      'invoice:' || item.company_id || ':' || item.id) is distinct from p_provider_key
    or checkpoint->'attempt_no' is distinct from to_jsonb(p_attempt_no)
    or coalesce(checkpoint->>'financing_mode', '') not in ('factoring_with_recourse', 'factoring_without_recourse')
    or create_guids is distinct from jsonb_build_array(p_invoice_guid) then
    raise exception using errcode = '23514', message = 'automatic_invoice_purchase_checkpoint_changed';
  end if;

  select event.id into cancellation_event_id
  from public.invoice_provider_events event
  join public.billing_provider_webhook_events webhook
    on webhook.company_id = event.company_id and webhook.provider = event.provider
    and webhook.environment = event.environment and webhook.idempotency_key = event.idempotency_hash
    and webhook.external_event_id = event.provider_event_id and webhook.event_type = event.event_type
    and webhook.signature_valid is true and webhook.payload = event.payload
  where event.company_id = item.company_id and event.matched_invoice_export_item_id = item.id
    and event.environment = item.environment and event.provider = item.provider
    and event.provider_invoice_guid = p_invoice_guid
    and lower(btrim(event.event_type)) in ('invoice.cancelled', 'cancelled')
  order by event.received_at, event.id
  limit 1;

  finished_at := clock_timestamp();
  if cancellation_event_id is not null then
    if checkpoint ? 'partner_ack' then
      if checkpoint->'partner_ack' is distinct from p_purchase_ack then
        raise exception using errcode = '23514', message = 'automatic_invoice_purchase_ack_already_recorded';
      end if;
    else
      update public.invoice_export_items
      set status = 'needs_review', next_retry_at = null,
          error_code = 'signed_cancellation_before_automatic_ack',
          error_payload = jsonb_build_object('provider_event_id', cancellation_event_id),
          response_payload = jsonb_set(item.response_payload, '{automatic_purchase_reconciliation}',
            checkpoint || jsonb_build_object('partner_ack', p_purchase_ack, 'signed_cancellation_event_id', cancellation_event_id)),
          updated_at = finished_at
      where id = item.id and company_id = item.company_id;
    end if;
    return jsonb_build_object('id', item.id, 'status', 'needs_review');
  end if;

  update public.invoice_export_items
  set status = 'sent', provider_invoice_guid = p_invoice_guid, provider_invoice_id = p_invoice_guid,
      provider_idempotency_key = p_provider_key, provider_confirmed_at = finished_at, provider_request_id = p_provider_key,
      request_payload = p_request_payload,
      response_payload = jsonb_build_object('create_invoice', item.response_payload->'create_invoice', 'purchase', p_purchase_ack),
      next_retry_at = null, error_code = null, error_payload = '{}'::jsonb, sent_at = finished_at, updated_at = finished_at
  where id = item.id and company_id = item.company_id;
  -- A later signed event may update the portal immediately after commit. Publish
  -- its initial mirror while the same export-row lock still serializes ingress.
  update public.customer_invoices
  set partner_invoice_reference = p_invoice_guid, issued_at = p_issued_at, due_date = p_due_date,
      status = 'sent',
      raw_payload = jsonb_build_object('create_invoice', item.response_payload->'create_invoice', 'purchase', p_purchase_ack),
      updated_at = finished_at
  where company_id = item.company_id and invoice_export_item_id = item.id
    and id = p_customer_invoice_id
    and status in ('draft', 'issued', 'failed')
    and (partner_invoice_reference is null or partner_invoice_reference = p_invoice_guid);
  if not found then
    raise exception using errcode = '23514', message = 'automatic_invoice_purchase_mirror_changed';
  end if;
  return jsonb_build_object('id', item.id, 'status', 'sent');
end
$function$;

revoke all on function public.gridex_finalize_automatic_invoice_purchase_ack_v1(uuid, uuid, uuid, text, text, text, integer, timestamptz, jsonb, jsonb, uuid, timestamptz, date) from public, anon, authenticated;
grant execute on function public.gridex_finalize_automatic_invoice_purchase_ack_v1(uuid, uuid, uuid, text, text, text, integer, timestamptz, jsonb, jsonb, uuid, timestamptz, date) to service_role;

END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
