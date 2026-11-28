DO $migration$
DECLARE
  idx oid:=to_regclass('public.invoice_provider_events_global_received_id_idx');
  expected_index constant text:=$definition$CREATE INDEX invoice_provider_events_global_received_id_idx ON public.invoice_provider_events USING btree (received_at, id) WHERE ((company_id IS NOT NULL) AND (status = ANY (ARRAY['received'::text, 'needs_review'::text, 'failed'::text, 'processing'::text])))$definition$;
  definition constant text:=$ddl$CREATE INDEX invoice_provider_events_global_received_id_idx ON public.invoice_provider_events USING btree (received_at, id) WHERE company_id IS NOT NULL AND status IN ('received','needs_review','failed','processing')$ddl$;
  target constant regprocedure:='public.gridex_claim_invoice_provider_events(uuid,text[],integer,uuid,integer)'::regprocedure;
  successor constant text:=$body$
declare
  evaluated_at timestamptz;
  received_cutoff timestamptz;
  reclaim_cutoff timestamptz;
begin
  if p_processing_token is null or p_statuses is null or coalesce(array_length(p_statuses,1),0)=0
     or p_limit is null or p_limit < 1 or p_limit > 500
     or p_max_age_days is null or p_max_age_days < 1 or p_max_age_days > 3650 then
    raise exception 'invalid_provider_event_claim_arguments' using errcode='22023';
  end if;
  if exists(select 1 from unnest(p_statuses) s where s not in ('received','needs_review','failed')) then
    raise exception 'invalid_provider_event_claim_status' using errcode='22023';
  end if;

  evaluated_at := clock_timestamp();
  received_cutoff := evaluated_at-(p_max_age_days::text||' days')::interval;
  reclaim_cutoff := evaluated_at-interval '15 minutes';

  return query
  with candidates as (
    select e.id
      from public.invoice_provider_events e
     where e.company_id is not null
       and (p_company_id is null or e.company_id=p_company_id)
       and e.received_at >= received_cutoff
       and e.status IN ('received','needs_review','failed','processing')
       and (
         e.status=any(p_statuses)
         or (e.status='processing' and e.processing_started_at < reclaim_cutoff)
       )
     order by e.received_at,e.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.invoice_provider_events e
       set status='processing',
           processing_token=p_processing_token,
           processing_started_at=clock_timestamp(),
           attempt_count=coalesce(e.attempt_count,0)+1,
           failure_reason=null
      from candidates c
     where e.id=c.id
     returning e.*
  )
  select * from claimed order by received_at,id;
end;
$body$;
  installed record;
BEGIN
  IF idx IS NULL THEN
    LOCK TABLE public.invoice_provider_events IN SHARE MODE NOWAIT;
    IF EXISTS(SELECT 1 FROM public.invoice_provider_events LIMIT 1) THEN
      RAISE EXCEPTION 'invoice_provider_global_index_requires_concurrent_build';
    END IF;
    EXECUTE definition;
    idx:=to_regclass('public.invoice_provider_events_global_received_id_idx');
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_index i WHERE i.indexrelid=idx
       AND i.indrelid='public.invoice_provider_events'::regclass AND i.indisready AND i.indisvalid AND i.indislive)
     OR pg_catalog.pg_get_indexdef(idx) IS DISTINCT FROM expected_index THEN
    RAISE EXCEPTION 'invoice_provider_global_index_mismatch';
  END IF;
  SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata,pg_get_functiondef(p.oid) AS body INTO STRICT installed
    FROM pg_proc p WHERE p.oid=target;
  IF installed.prosrc=successor THEN RETURN; END IF;
  IF encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex') IS DISTINCT FROM
      'a34baa21bf150e46c8a08e7688c12e480eb6257763bb88bd68db572e3ad815b7'
     OR (length(installed.body)-length(replace(installed.body,installed.prosrc,'')))/length(installed.prosrc) <> 1 THEN
    RAISE EXCEPTION 'invoice_provider_global_index_claim_predecessor_changed';
  END IF;
  EXECUTE replace(installed.body,installed.prosrc,successor);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=installed.oid) IS DISTINCT FROM installed.metadata
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=installed.oid) IS DISTINCT FROM successor THEN
    RAISE EXCEPTION 'invoice_provider_global_index_claim_postimage_changed';
  END IF;
END
$migration$;
