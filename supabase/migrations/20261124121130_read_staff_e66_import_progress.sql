-- Staff can follow the same qualified intake while a value or case write is retried.
CREATE FUNCTION public.gridex_read_staff_e66_import_progress_v1(p_company uuid,p_request uuid DEFAULT NULL)
RETURNS TABLE(company_id uuid,request_id uuid,customer_id uuid,customer_label text,started_at timestamptz,environment text,retry_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $progress$
DECLARE actor uuid:=auth.uid();
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'authenticated' OR actor IS NULL OR p_company IS NULL
    OR public.gridex_is_current_session_allowed() IS NOT TRUE
    OR NOT (
      coalesce(public.gridex_actor_has_company_permission(actor,p_company,'metering.read'),false)
      OR coalesce(public.gridex_actor_has_company_permission(actor,p_company,'switching.read'),false)
      OR coalesce(public.gridex_actor_has_company_permission(actor,p_company,'billing_underlay.read'),false)
      OR (p_request IS NOT NULL AND coalesce(public.gridex_actor_has_company_permission(actor,p_company,'communication.read'),false))
    ) THEN RAISE EXCEPTION 'e66_staff_import_progress_forbidden' USING ERRCODE='42501'; END IF;

  RETURN QUERY
  SELECT w.company_id,r.id,r.customer_id,
    coalesce(nullif(c.company_name,''),nullif(c.full_name,''),nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),'Kund'),
    min(w.created_at),w.environment,
    bool_or(EXISTS(
      SELECT FROM gridex_e66_intake.customer_import_failures f
      WHERE (f.source_id,f.company_id,f.environment,f.request_id,f.customer_id,f.site_id,f.metering_point_id,
        f.requested_period_start,f.requested_period_end,f.source_hash,f.transaction_id,f.contract_hash,f.stage)
        =(b.source_id,b.company_id,b.environment,b.request_id,b.customer_id,b.site_id,b.metering_point_id,
          b.requested_period_start,b.requested_period_end,b.source_hash,b.transaction_id,b.contract_hash,w.phase)
    ))
  FROM gridex_e66_intake.work w
  JOIN gridex_e66_intake.customer_import_binding b
    ON (b.company_id,b.environment,b.source_id,b.source_hash)=(w.company_id,w.environment,w.source_id,w.payload_sha256)
  JOIN gridex_ediel_inbound_receptions.receptions receipt
    ON (receipt.id,receipt.company_id,receipt.environment,receipt.source_message_id,receipt.canonical_payload_hash)
      =(w.reception_id,w.company_id,w.environment,w.source_id,w.payload_sha256)
    AND receipt.classification='first_reception'
  JOIN public.ediel_messages m
    ON (m.company_id,m.environment,m.id,m.immutable_payload_hash)=(w.company_id,w.environment,w.source_id,w.payload_sha256)
    AND m.direction='inbound' AND m.message_family='UTILTS' AND m.message_code='E66' AND m.raw_payload IS NOT NULL
  JOIN public.grid_owner_data_requests r ON (r.company_id,r.id)=(b.company_id,b.request_id)
  JOIN public.customers c ON (c.company_id,c.id)=(r.company_id,r.customer_id)
  WHERE w.company_id=p_company AND w.phase IN ('normalization','readiness')
    AND ((p_request IS NULL AND r.status='received') OR (r.id=p_request AND r.status IN ('pending','sent','received')))
    AND coalesce(c.source,'')<>'ediel_portal_test'
    AND coalesce(c.status,'') NOT IN ('archived','deleted','deleted_test_only','pending_deletion')
    AND NOT EXISTS(SELECT FROM gridex_ediel_retention.blob_tombstones gone
      WHERE (gone.company_id,gone.message_id)=(w.company_id,w.source_id))
  GROUP BY w.company_id,r.id,r.customer_id,c.company_name,c.full_name,c.first_name,c.last_name,w.environment
  ORDER BY min(w.created_at),r.id,w.environment
  LIMIT 250;
END
$progress$;
REVOKE ALL ON FUNCTION public.gridex_read_staff_e66_import_progress_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_read_staff_e66_import_progress_v1(uuid,uuid) TO authenticated;
