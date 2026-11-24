-- Store the registered notice and the proposed calendar date with the existing event transaction.
DO $notice_receipt$
DECLARE
  fn record;
  source text;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout','3s',true);
CREATE SCHEMA gridex_contract_notice_receipts;
REVOKE ALL ON SCHEMA gridex_contract_notice_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE gridex_contract_notice_receipts.receipts (
  event_id uuid PRIMARY KEY REFERENCES public.customer_contract_events(id) ON DELETE CASCADE,
  recorded_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  notice_received_on date NOT NULL,
  planned_contract_end_on date,
  stored_ended_at timestamptz,
  CHECK (isfinite(notice_received_on)),
  CHECK (planned_contract_end_on IS NULL OR (
    isfinite(planned_contract_end_on) AND planned_contract_end_on >= notice_received_on
    AND stored_ended_at IS NOT NULL AND isfinite(stored_ended_at)
  ))
);
CREATE INDEX notice_receipts_contract_scope
  ON gridex_contract_notice_receipts.receipts(company_id, customer_id, contract_id, recorded_order DESC);
REVOKE ALL ON TABLE gridex_contract_notice_receipts.receipts FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE gridex_contract_notice_receipts.receipts ENABLE ROW LEVEL SECURITY;

  SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS ddl,to_jsonb(p)-'prosrc' AS metadata
  INTO STRICT fn
  FROM pg_proc p
  WHERE p.oid='public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)'::regprocedure
    AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND p.prosecdef;
  IF encode(sha256(convert_to(fn.prosrc,'UTF8')),'hex')
    <> '355842acb7cdc2eaf25b1fb4abd8994756371e56849f4edb0b24c1bc8287ae97' THEN
    RAISE EXCEPTION 'termination_notice_exact_predecessor_required';
  END IF;

  source:=fn.prosrc;
  source:=replace(source,'  v_domain_event_id uuid;', '  v_domain_event_id uuid;
  v_notice_receipt jsonb;');
  IF position('Europe/Stockholm' IN source) = 0 THEN
    RAISE EXCEPTION 'termination_notice_calendar_not_registered';
  END IF;
  source:=replace(source,$before$  if found then
    return jsonb_build_object(
      'event', to_jsonb(v_event),
      'contract_status', v_contract.status,
      'existing', true
    );
$before$,$after$  if found then
    select jsonb_build_object('noticeReceivedOn', receipt.notice_received_on, 'plannedContractEndOn', receipt.planned_contract_end_on)
      into v_notice_receipt
    from gridex_contract_notice_receipts.receipts receipt
    where receipt.event_id=v_event.id and receipt.company_id=p_company_id
      and receipt.customer_id=p_customer_id and receipt.contract_id=p_customer_contract_id;
    return jsonb_build_object(
      'event', to_jsonb(v_event),
      'contract_status', v_contract.status,
      'existing', true
    ) || case when v_notice_receipt is null then '{}'::jsonb
      else jsonb_build_object('terminationNotice',v_notice_receipt) end;
$after$);
  source:=replace(source,$before$  returning * into v_event;

  insert into public.domain_events($before$,$after$  returning * into v_event;

  if p_event_type='termination_notice_received' and isfinite(p_happened_at) then
    insert into gridex_contract_notice_receipts.receipts(
      event_id,company_id,customer_id,contract_id,notice_received_on,planned_contract_end_on,stored_ended_at
    )
    values (
      v_event.id,p_company_id,p_customer_id,p_customer_contract_id,
      (p_happened_at at time zone 'Europe/Stockholm')::date,
      case when v_contract.ends_at is null and isfinite(p_derived_ends_at)
        and (p_derived_ends_at at time zone 'Europe/Stockholm')::date >= (p_happened_at at time zone 'Europe/Stockholm')::date
        then (p_derived_ends_at at time zone 'Europe/Stockholm')::date end,
      p_derived_ends_at
    )
    returning jsonb_build_object('noticeReceivedOn',notice_received_on,'plannedContractEndOn',planned_contract_end_on)
      into v_notice_receipt;
  end if;

  insert into public.domain_events($after$);
  source:=replace(source,$before$    'existing', false
  );
end$before$,$after$    'existing', false
  ) || case when v_notice_receipt is null then '{}'::jsonb
    else jsonb_build_object('terminationNotice',v_notice_receipt) end;
end$after$);

  IF source=fn.prosrc OR source NOT LIKE '%v_notice_receipt%'
    OR (length(source)-length(replace(source,'gridex_contract_notice_receipts.receipts','')))
      /length('gridex_contract_notice_receipts.receipts') <> 2 THEN
    RAISE EXCEPTION 'termination_notice_exact_anchors_required';
  END IF;
  EXECUTE replace(fn.ddl,fn.prosrc,source);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=fn.oid) IS DISTINCT FROM fn.metadata THEN
    RAISE EXCEPTION 'termination_notice_rpc_metadata_changed';
  END IF;

CREATE FUNCTION public.gridex_list_portal_contract_notice_dates_v1(
  p_company_id uuid, p_customer_ids uuid[], p_contract_ids uuid[]
)
RETURNS TABLE(contract_id uuid, notice_received_on date, planned_contract_end_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT contract.id, latest.notice_received_on,
    CASE WHEN latest.stored_ended_at=contract.ended_at AND contract.ends_at IS NULL THEN latest.planned_contract_end_on END
  FROM public.customer_contracts contract
  JOIN LATERAL (
    SELECT r.* FROM gridex_contract_notice_receipts.receipts r
    WHERE r.company_id=contract.company_id AND r.customer_id=contract.customer_id AND r.contract_id=contract.id
    ORDER BY r.recorded_order DESC LIMIT 1
  ) latest ON latest.notice_received_on=contract.termination_notice_date
  JOIN public.customer_contract_events event ON event.id=latest.event_id AND event.company_id=contract.company_id
    AND event.customer_id=contract.customer_id AND event.customer_contract_id=contract.id
    AND event.event_type='termination_notice_received'
    AND (event.happened_at at time zone 'Europe/Stockholm')::date=latest.notice_received_on
  WHERE coalesce(cardinality(p_customer_ids),0) BETWEEN 1 AND 100
    AND coalesce(cardinality(p_contract_ids),0) BETWEEN 1 AND 100
    AND contract.company_id=p_company_id AND contract.customer_id=ANY(p_customer_ids)
    AND contract.id=ANY(p_contract_ids) AND contract.status IN ('signed','active');
$function$;
REVOKE ALL ON FUNCTION public.gridex_list_portal_contract_notice_dates_v1(uuid,uuid[],uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_portal_contract_notice_dates_v1(uuid,uuid[],uuid[]) TO service_role;
END
$notice_receipt$;
