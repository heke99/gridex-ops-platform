DO $gridex_invoice_migration$
BEGIN
CREATE TABLE gridex_invoice_file_archive.legacy_projection_jobs (
 company_id uuid NOT NULL,file_id uuid NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','held')),
 reason text,last_error_code text,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,file_id),
 FOREIGN KEY(company_id,file_id) REFERENCES gridex_invoice_file_archive.receipts(company_id,file_id)
);
CREATE TABLE gridex_invoice_file_archive.file_effect_members (
 company_id uuid NOT NULL,file_id uuid NOT NULL,item_id uuid NOT NULL,run_id uuid NOT NULL,event_id uuid NOT NULL,
 legacy_run_created_at timestamptz,legacy_item_created_at timestamptz,
 PRIMARY KEY(company_id,file_id,item_id),UNIQUE(event_id),
 FOREIGN KEY(company_id,file_id) REFERENCES gridex_invoice_file_archive.legacy_projection_jobs(company_id,file_id)
);
CREATE INDEX invoice_file_legacy_due_idx ON gridex_invoice_file_archive.legacy_projection_jobs(updated_at,company_id,file_id) WHERE status='pending';
ALTER TABLE gridex_invoice_file_archive.legacy_projection_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_invoice_file_archive.file_effect_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE gridex_invoice_file_archive.legacy_projection_jobs,gridex_invoice_file_archive.file_effect_members FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_invoice_file_archive.queue_file_effects() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $queue_export_effects$
DECLARE v_file public.invoice_export_files%rowtype; v_item record; v_event uuid; v_count integer:=0; v_legacy_run timestamptz; v_legacy_item timestamptz; v_missing boolean:=false;
BEGIN
 SELECT * INTO STRICT v_file FROM public.invoice_export_files WHERE company_id=NEW.company_id AND id=NEW.file_id AND artifact_archive_version=2;
 INSERT INTO gridex_invoice_file_archive.legacy_projection_jobs(company_id,file_id) VALUES(NEW.company_id,NEW.file_id);
 FOR v_item IN
  SELECT i.id,i.export_run_id,row_value
  FROM jsonb_array_elements(v_file.rows) row_value
  JOIN public.invoice_export_items i ON i.company_id=v_file.company_id AND i.id=(row_value->>'invoice_export_item_id')::uuid
  WHERE i.export_file_id=v_file.id AND i.status='sent'
  ORDER BY i.id
 LOOP
  INSERT INTO public.domain_events(company_id,event_type,aggregate_type,aggregate_id,actor_user_id,source,idempotency_key,payload)
  VALUES(v_file.company_id,'invoice.sent','invoice_export_item',v_item.id::text,v_file.created_by,'invoice_file_export_v1',
   'invoice-sent:'||v_item.id::text||':file:'||v_file.id::text,
   jsonb_build_object('invoice_file_id',v_file.id,'billing_month',v_file.billing_month,
    'amount_inc_vat',(v_item.row_value->>'amount_inc_vat')::numeric,'due_date',v_item.row_value->>'due_date'))
  RETURNING id INTO v_event;
  INSERT INTO public.event_outbox(company_id,domain_event_id,destination_type,destination_key,status,attempts,max_attempts,available_at,payload)
  VALUES(v_file.company_id,v_event,'webhook','webhook_fanout_v1','queued',0,12,now(),
   jsonb_build_object('event_type','invoice.sent','aggregate_type','invoice_export_item','aggregate_id',v_item.id));
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_file_fanout_missing' USING ERRCODE='23514'; END IF;
  -- Snapshot the exact preexisting compatibility identities. Never attach a
  -- newly created/reassigned compatibility row on a delayed replay.
  SELECT r.created_at,l.created_at INTO v_legacy_run,v_legacy_item
  FROM public.billing_export_runs r JOIN public.billing_export_run_items l
    ON l.company_id=r.company_id AND l.billing_export_run_id=r.id
  WHERE r.company_id=v_file.company_id AND r.id=v_item.export_run_id AND r.period_month=v_file.billing_month
    AND r.metadata->>'canonical_invoice_export_run_id'=r.id::text
    AND l.id=v_item.id AND (l.export_run_id IS NULL OR l.export_run_id=r.id);
  v_missing:=v_missing OR NOT FOUND;
  INSERT INTO gridex_invoice_file_archive.file_effect_members
  VALUES(v_file.company_id,v_file.id,v_item.id,v_item.export_run_id,v_event,v_legacy_run,v_legacy_item);
  v_count:=v_count+1;
 END LOOP;
 IF v_missing THEN
  UPDATE gridex_invoice_file_archive.legacy_projection_jobs SET status='held',reason='legacy_projection_scope_changed'
  WHERE company_id=v_file.company_id AND file_id=v_file.id;
 END IF;
 IF v_count<>v_file.row_count THEN RAISE EXCEPTION 'invoice_file_effect_members_changed' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END
$queue_export_effects$;
REVOKE ALL ON FUNCTION gridex_invoice_file_archive.queue_file_effects() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER queue_invoice_file_effects AFTER INSERT ON gridex_invoice_file_archive.receipts
 FOR EACH ROW EXECUTE FUNCTION gridex_invoice_file_archive.queue_file_effects();

CREATE FUNCTION public.gridex_read_invoice_export_effects_v1(p_company_id uuid,p_file_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $read_export_effects$
 SELECT jsonb_build_object('fileId',j.file_id,'status',j.status,'reason',j.reason,'expectedEventCount',e.expected_count,'eventCount',e.event_count,'missingFanoutCount',e.missing_count)
 FROM gridex_invoice_file_archive.legacy_projection_jobs j
 CROSS JOIN LATERAL (
  SELECT count(*) expected_count,count(event.id) event_count,count(*) FILTER(WHERE o.id IS NULL OR event.id IS NULL) missing_count
  FROM gridex_invoice_file_archive.file_effect_members m
  LEFT JOIN public.domain_events event ON event.company_id=m.company_id AND event.id=m.event_id
  LEFT JOIN public.event_outbox o ON o.company_id=m.company_id AND o.domain_event_id=m.event_id
    AND o.destination_type='webhook' AND o.destination_key='webhook_fanout_v1'
  WHERE m.company_id=j.company_id AND m.file_id=j.file_id
 ) e
 WHERE j.company_id=p_company_id AND j.file_id=p_file_id;
$read_export_effects$;
REVOKE ALL ON FUNCTION public.gridex_read_invoice_export_effects_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_invoice_export_effects_v1(uuid,uuid) TO service_role;

CREATE FUNCTION public.gridex_reconcile_invoice_export_legacy_projection_v1(p_company_id uuid,p_file_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $legacy_reconcile$
DECLARE
 v_job gridex_invoice_file_archive.legacy_projection_jobs%rowtype; v_member record; v_run uuid; v_file_month text;
 v_status text:='applied'; v_reason text; v_code text;
BEGIN
 SELECT * INTO v_job FROM gridex_invoice_file_archive.legacy_projection_jobs
 WHERE company_id=p_company_id AND file_id=p_file_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_job.status<>'pending' THEN RETURN public.gridex_read_invoice_export_effects_v1(p_company_id,p_file_id); END IF;
 BEGIN
  SELECT billing_month INTO STRICT v_file_month FROM public.invoice_export_files WHERE company_id=p_company_id AND id=p_file_id;
  -- Match canonical partner writer/refresh order: runs before items.
  FOR v_member IN SELECT DISTINCT run_id,legacy_run_created_at FROM gridex_invoice_file_archive.file_effect_members
    WHERE company_id=p_company_id AND file_id=p_file_id ORDER BY run_id LOOP
   PERFORM 1 FROM public.billing_export_runs r WHERE r.id=v_member.run_id AND r.company_id=p_company_id AND r.period_month=v_file_month
    AND r.status<>'cancelled' AND r.created_at=v_member.legacy_run_created_at
    AND (r.metadata->>'canonical_invoice_export_run_id')=r.id::text FOR UPDATE NOWAIT;
   IF NOT FOUND THEN RAISE EXCEPTION 'legacy_projection_scope_changed' USING ERRCODE='P0I01'; END IF;
  END LOOP;
  FOR v_member IN SELECT * FROM gridex_invoice_file_archive.file_effect_members
    WHERE company_id=p_company_id AND file_id=p_file_id ORDER BY item_id LOOP
   PERFORM 1 FROM public.invoice_export_items i
    WHERE i.company_id=p_company_id AND i.id=v_member.item_id AND i.export_run_id=v_member.run_id
      AND i.export_file_id=p_file_id AND i.status IN ('sent','credited') FOR SHARE NOWAIT;
   IF NOT FOUND THEN RAISE EXCEPTION 'legacy_projection_scope_changed' USING ERRCODE='P0I01'; END IF;
   PERFORM 1 FROM public.billing_export_run_items i
    WHERE i.company_id=p_company_id AND i.id=v_member.item_id AND i.billing_export_run_id=v_member.run_id AND i.created_at=v_member.legacy_item_created_at
     AND (i.export_run_id IS NULL OR i.export_run_id=v_member.run_id)
     AND ((i.export_status='not_queued' AND i.status IN ('ready','ready_for_retry') AND i.partner_result_type='none')
      OR i.export_status IN ('sent','acknowledged')) FOR UPDATE NOWAIT;
   IF NOT FOUND THEN RAISE EXCEPTION 'legacy_projection_scope_changed' USING ERRCODE='P0I01'; END IF;
  END LOOP;

  UPDATE public.billing_export_run_items legacy
  SET status='sent',export_status='sent',sent_at=canonical.sent_at,failed_at=NULL,last_error=NULL,updated_at=now()
  FROM gridex_invoice_file_archive.file_effect_members member
  JOIN public.invoice_export_items canonical ON canonical.id=member.item_id AND canonical.company_id=member.company_id
  WHERE member.company_id=p_company_id AND member.file_id=p_file_id
   AND legacy.company_id=member.company_id AND legacy.id=member.item_id AND legacy.billing_export_run_id=member.run_id
   AND legacy.export_status='not_queued';
  FOR v_run IN SELECT DISTINCT run_id FROM gridex_invoice_file_archive.file_effect_members
    WHERE company_id=p_company_id AND file_id=p_file_id ORDER BY run_id LOOP
   PERFORM public.gridex_refresh_billing_export_run(p_company_id,v_run);
  END LOOP;
 EXCEPTION WHEN SQLSTATE 'P0I01' THEN
  v_status:='held'; v_reason:='legacy_projection_scope_changed';
 WHEN lock_not_available THEN
  v_status:='pending'; v_reason:='legacy_projection_busy';
 WHEN OTHERS THEN
  v_status:='pending'; v_reason:='legacy_projection_failed'; v_code:=SQLSTATE;
 END;
 UPDATE gridex_invoice_file_archive.legacy_projection_jobs
 SET status=v_status,reason=v_reason,last_error_code=v_code,updated_at=clock_timestamp() WHERE company_id=p_company_id AND file_id=p_file_id;
 RETURN public.gridex_read_invoice_export_effects_v1(p_company_id,p_file_id);
END
$legacy_reconcile$;
REVOKE ALL ON FUNCTION public.gridex_reconcile_invoice_export_legacy_projection_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_reconcile_invoice_export_legacy_projection_v1(uuid,uuid) TO service_role;

CREATE FUNCTION public.gridex_list_due_invoice_export_legacy_projections_v1(p_limit integer DEFAULT 10)
RETURNS TABLE(company_id uuid,file_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $due_legacy$
 SELECT j.company_id,j.file_id FROM gridex_invoice_file_archive.legacy_projection_jobs j
 WHERE j.status='pending' AND (j.reason IS NULL OR j.updated_at<=now()-interval '30 seconds')
 ORDER BY j.updated_at,j.company_id,j.file_id LIMIT greatest(1,least(coalesce(p_limit,10),50));
$due_legacy$;
REVOKE ALL ON FUNCTION public.gridex_list_due_invoice_export_legacy_projections_v1(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_list_due_invoice_export_legacy_projections_v1(integer) TO service_role;
END
$gridex_invoice_migration$;
