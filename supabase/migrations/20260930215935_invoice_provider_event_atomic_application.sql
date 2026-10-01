-- Classify with the existing server provider mapper; apply its decision only
-- against locked current rows and the exact claimed event snapshot.
begin;
create function private.gridex_provider_payload_text_v1(p_payload jsonb,p_key text)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
  select case when jsonb_typeof(p_payload->p_key)='string' then nullif(btrim(p_payload->>p_key),'') end;
$$;
revoke all on function private.gridex_provider_payload_text_v1(jsonb,text) from public,anon,authenticated;
grant execute on function private.gridex_provider_payload_text_v1(jsonb,text) to service_role;
create function public.gridex_apply_invoice_provider_event_v1(
  p_company_id uuid,p_event_id uuid,p_processing_token uuid,
  p_event_type text,p_payload jsonb,p_state text,p_finance_status text,
  p_amount numeric,p_currency text
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public as $$
declare
  v_event public.invoice_provider_events%rowtype;
  v_item public.invoice_export_items%rowtype;
  v_invoice public.customer_invoices%rowtype;
  v_now timestamptz:=clock_timestamp(); v_reason text; v_outcome text:='processed';
  v_rank integer; v_current_rank integer; v_canonical_rank integer; v_portal_status text; v_next_status text;
  v_amount numeric; v_currency text; v_number text; v_ocr text; v_paid_at timestamptz;
  v_domain_id uuid; v_event_type text; v_key text; v_domain_payload jsonb;
begin
  if current_user<>'service_role' then raise exception 'provider_event_service_required' using errcode='42501'; end if;
  if p_company_id is null or p_event_id is null or p_processing_token is null then
    raise exception 'invalid_provider_event_application' using errcode='22023'; end if;
  select * into v_event from public.invoice_provider_events e
    where e.id=p_event_id and e.company_id=p_company_id for update;
  if not found then raise exception 'provider_event_unavailable' using errcode='42501'; end if;
  if v_event.status='processed' then
    return jsonb_build_object('eventId',p_event_id,'outcome','processed','reason','provider_event_already_processed');
  end if;
  if v_event.status<>'processing' or v_event.processing_token is distinct from p_processing_token then
    raise exception 'provider_event_claim_unavailable' using errcode='42501'; end if;
  if v_event.event_type is distinct from p_event_type or v_event.payload is distinct from p_payload then
    raise exception 'provider_event_snapshot_changed' using errcode='40001'; end if;
  if v_event.matched_invoice_export_item_id is null or v_event.provider is null
    or v_event.environment is null or nullif(btrim(v_event.provider_invoice_guid),'') is null then
    v_reason:='provider_event_identity_incomplete'; v_outcome:='needs_review';
  else
    select * into v_item from public.invoice_export_items i where i.id=v_event.matched_invoice_export_item_id
      and i.company_id=p_company_id and i.provider=v_event.provider and i.environment=v_event.environment
      and i.provider_invoice_guid=v_event.provider_invoice_guid for update;
    if not found then v_reason:='no_matching_export_item'; v_outcome:='needs_review'; end if;
  end if;
  if v_reason is null then
    -- The service passes the existing mapper's classification of this exact
    -- locked snapshot. Do not introduce a second provider-number parser here.
    v_amount:=p_amount; v_currency:=p_currency;
    if v_amount::text in ('NaN','Infinity','-Infinity') then
      raise exception 'invalid_provider_event_amount' using errcode='22023'; end if;
    if (v_amount is not null and v_item.amount_inc_vat is not null and abs(v_amount-v_item.amount_inc_vat)>0.01)
      or (v_currency is not null and upper(v_currency)<>upper(coalesce(nullif(btrim(v_item.currency),''),'SEK'))) then
      v_reason:='provider_amount_or_currency_mismatch'; v_outcome:='needs_review';
    end if;
  end if;
  if v_reason is null then
    v_rank:=case p_state when 'registered' then 0 when 'unpaid' then 1 when 'partially_paid' then 2
      when 'overdue' then 3 when 'reminder_sent' then 4 when 'collection' then 5 when 'paid' then 10
      when 'disputed' then 11 when 'cancelled' then 12 when 'credited' then 13 else -1 end;
    v_current_rank:=case v_item.provider_status when 'registered' then 0 when 'unpaid' then 1 when 'partially_paid' then 2
      when 'overdue' then 3 when 'reminder_sent' then 4 when 'collection' then 5 when 'paid' then 10
      when 'disputed' then 11 when 'cancelled' then 12 when 'credited' then 13 else -1 end;
    if v_rank<0 then v_reason:='unknown_provider_state'; v_outcome:='needs_review';
    elsif v_rank<v_current_rank then v_reason:='stale_provider_state_ignored'; end if;
  end if;
  if v_reason is null then
    v_portal_status:=case when p_state='paid' then 'paid' when p_state='credited' then 'credited'
      when p_state='cancelled' then 'cancelled' when p_state in ('overdue','reminder_sent','collection') then 'overdue'
      when p_state in ('registered','unpaid','partially_paid') then 'sent' else null end;
    v_next_status:=case when p_state='credited' then 'credited' when p_state='disputed' then 'disputed'
      when p_state='cancelled' and v_item.status<>'sent' then 'cancelled' else null end;
    if v_portal_status is not null and (v_item.customer_id is null or v_item.customer_contract_id is null) then
      v_reason:='provider_invoice_canonical_identity_incomplete'; v_outcome:='needs_review';
    end if;
  end if;
  if v_reason is null then
    select * into v_invoice from public.customer_invoices i where i.company_id=p_company_id
      and i.invoice_export_item_id=v_item.id for update;
    if not found and v_portal_status is not null then
      v_reason:='provider_invoice_canonical_snapshot_missing'; v_outcome:='needs_review';
    elsif found and (v_invoice.customer_id is distinct from v_item.customer_id
      or v_invoice.customer_contract_id is distinct from v_item.customer_contract_id
      or v_invoice.contract_id is distinct from v_item.customer_contract_id) then
      v_reason:='provider_invoice_canonical_identity_conflict'; v_outcome:='needs_review';
    end if;
    -- Historical export projections can lag the issued canonical invoice.
    -- Only explicit terminal states have an unambiguous existing rank; a
    -- generic portal "sent" status is not evidence of a provider state.
    v_canonical_rank:=case v_invoice.status when 'paid' then 10 when 'cancelled' then 12 when 'credited' then 13 else -1 end;
    if v_reason is null and v_rank<v_canonical_rank then
      v_reason:='stale_canonical_invoice_state_ignored';
    end if;
  end if;
  if v_reason is null then
    v_number:=coalesce(private.gridex_provider_payload_text_v1(p_payload,'invoice_number'),private.gridex_provider_payload_text_v1(p_payload,'invoiceNumber'));
    v_ocr:=coalesce(private.gridex_provider_payload_text_v1(p_payload,'ocr'),private.gridex_provider_payload_text_v1(p_payload,'payment_reference'),private.gridex_provider_payload_text_v1(p_payload,'paymentReference'));
    if p_state='paid' then
      v_paid_at:=coalesce(private.gridex_provider_payload_text_v1(p_payload,'paid_at'),private.gridex_provider_payload_text_v1(p_payload,'paidAt'))::timestamptz;
      v_paid_at:=coalesce(v_paid_at,v_invoice.paid_at,v_now);
    end if;
    update public.invoice_export_items set provider_status=p_state,
      status=coalesce(v_next_status,status),
      status_payload=coalesce(status_payload,'{}'::jsonb)||jsonb_build_object('last_provider_event_id',p_event_id,
        'last_provider_event_type',p_event_type,'last_provider_state',p_state,'last_provider_event_at',v_now),
      last_reconciled_at=v_now,reconciliation_status='matched',updated_at=v_now,
      purchase_status=coalesce(p_finance_status,purchase_status),
      provider_invoice_number=coalesce(v_number,provider_invoice_number),provider_ocr=coalesce(v_ocr,provider_ocr)
      where company_id=p_company_id and id=v_item.id returning * into v_item;
    if v_portal_status is not null then
      -- Issued financial/identity snapshots and original provider request/
      -- purchase evidence remain untouched. This status event is retained in
      -- invoice_provider_events, not substituted for the original invoice.
      update public.customer_invoices set status=v_portal_status,
        paid_at=case when p_state='paid' then v_paid_at else paid_at end,
        updated_at=v_now where company_id=p_company_id and id=v_invoice.id;
    end if;
    -- Durably enqueue the same existing internal/public event semantics in
    -- this transaction; fan-out and actual transport remain separate workers.
    foreach v_event_type in array array_remove(array['invoice.provider.'||p_state,
      case when p_state='paid' then 'invoice.paid' when p_state='disputed' then 'invoice.disputed' end],null)
    loop
      if v_event_type like 'invoice.provider.%' then
        v_key:='invoice-provider-state:'||p_company_id::text||':'||p_event_id::text;
        v_domain_payload:=jsonb_build_object('provider',v_event.provider,'environment',v_event.environment,
          'provider_invoice_guid',v_event.provider_invoice_guid,'provider_state',p_state,'export_item_status',v_item.status);
      else
        v_key:='invoice-public-state:'||p_company_id::text||':'||p_event_id::text||':'||v_event_type;
        v_domain_payload:=jsonb_build_object('provider_invoice_guid',v_event.provider_invoice_guid,
          'invoice_number',v_item.provider_invoice_number,'provider_state',p_state);
      end if;
      insert into public.domain_events(company_id,event_type,aggregate_type,aggregate_id,subject_customer_id,
        source,payload,idempotency_key) values(p_company_id,v_event_type,'invoice_export_item',v_item.id::text,
        v_item.customer_id,'billing_provider_webhook',v_domain_payload,v_key)
        on conflict(idempotency_key) where idempotency_key is not null do nothing returning id into v_domain_id;
      if v_domain_id is null then select id into strict v_domain_id from public.domain_events
        where company_id=p_company_id and idempotency_key=v_key; end if;
      insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,
        status,attempts,max_attempts,available_at,payload)
      values(p_company_id,v_domain_id,'webhook','webhook_fanout_v1','queued',0,12,v_now,
        jsonb_build_object('event_type',v_event_type,'aggregate_type','invoice_export_item','aggregate_id',v_item.id))
        on conflict(domain_event_id,destination_type,destination_key) where destination_key is not null do nothing;
    end loop;
  end if;
  update public.invoice_provider_events set status=case when v_outcome='needs_review' then 'needs_review' else 'processed' end,
    processed_at=v_now,processing_token=null,processing_started_at=null,failure_reason=v_reason
    where company_id=p_company_id and id=p_event_id;
  return jsonb_build_object('eventId',p_event_id,'outcome',v_outcome,'reason',v_reason);
end;
$$;
revoke all on function public.gridex_apply_invoice_provider_event_v1(uuid,uuid,uuid,text,jsonb,text,text,numeric,text)
  from public,anon,authenticated;
grant execute on function public.gridex_apply_invoice_provider_event_v1(uuid,uuid,uuid,text,jsonb,text,text,numeric,text) to service_role;
commit;
