-- Apply the corresponding address owner and its migration receipt together.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_address_migration$
BEGIN
CREATE SCHEMA gridex_partner_address_receipts;
REVOKE ALL ON SCHEMA gridex_partner_address_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_partner_address_receipts.entries (
    company_id uuid NOT NULL, client_id uuid NOT NULL, scope_key bytea NOT NULL,
    resolution_id uuid NOT NULL, event_id uuid NOT NULL,
    resolved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, source_digest bytea NOT NULL,
    PRIMARY KEY(company_id,client_id,scope_key)
);
REVOKE ALL ON gridex_partner_address_receipts.entries FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.gridex_save_fresh_partner_address_resolution_v1(
    p_company_id uuid, p_client_id uuid, p_ttl_hours numeric, p_address_evidence jsonb, p_resolution jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $save$
DECLARE
    proposed public.customer_site_resolution%ROWTYPE;
    found_row public.customer_site_resolution%ROWTYPE;
    row_key bytea;
    source_key bytea;
    canonical_payload jsonb;
    recorded_event uuid;
    clock_at timestamptz;
    temporal_fields constant text[] := ARRAY['id','created_at','updated_at','resolved_at','expires_at'];
BEGIN
    IF p_company_id IS NULL OR p_client_id IS NULL OR jsonb_typeof(p_resolution) IS DISTINCT FROM 'object'
      OR NOT coalesce(p_ttl_hours BETWEEN 1 AND 168,false)
      OR jsonb_typeof(p_address_evidence->'addressEvidence') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'partner_address_receipt_input_invalid' USING ERRCODE='22023'; END IF;
    SELECT * INTO proposed FROM jsonb_populate_record(NULL::public.customer_site_resolution,p_resolution);
    IF proposed.company_id IS DISTINCT FROM p_company_id
      OR proposed.customer_id IS NOT NULL OR proposed.customer_site_id IS NOT NULL OR proposed.customer_application_id IS NOT NULL
      OR proposed.verified_by IS NOT NULL OR proposed.facility_data_verified_at IS NOT NULL OR proposed.source_claims->>'grid_area_code' IS NOT NULL
      OR proposed.input_snapshot#>>'{metadata,source_channel}' IS DISTINCT FROM 'partner_api'
      OR proposed.input_snapshot#>>'{metadata,partner_surface}' IS DISTINCT FROM 'business_v1'
      OR proposed.input_snapshot->>'companyId' IS DISTINCT FROM p_company_id::text
      OR jsonb_typeof(proposed.result_snapshot) IS DISTINCT FROM 'object'
      OR nullif(btrim(proposed.input_snapshot->>'street'),'') IS NULL
      OR nullif(btrim(proposed.input_snapshot->>'city'),'') IS NULL
      OR proposed.input_snapshot->>'country' IS DISTINCT FROM 'SE'
      OR proposed.resolution_status IS DISTINCT FROM 'grid_area_master_validated'
      OR proposed.price_area_assurance_status IS DISTINCT FROM 'verified'
      OR proposed.price_area_assurance_source IS DISTINCT FROM 'address_polygon'
      OR proposed.conflict_code IS NOT NULL
    THEN RAISE EXCEPTION 'partner_address_receipt_scope_invalid' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.integration_api_clients
      WHERE id=p_client_id AND company_id=p_company_id AND status='active' AND deleted_at IS NULL
        AND (expires_at IS NULL OR expires_at>clock_timestamp())
      FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'partner_address_receipt_client_unavailable' USING ERRCODE='42501'; END IF;
    row_key:=sha256(convert_to(jsonb_build_array(p_ttl_hours, proposed.input_snapshot)::text,'UTF8'));
    source_key:=sha256(convert_to(p_address_evidence::text,'UTF8'));
    PERFORM pg_advisory_xact_lock(hashtextextended('partner_address_receipt_v1:'||p_company_id||':'||p_client_id||':'||encode(row_key,'hex'),0));
    clock_at:=clock_timestamp();
    IF proposed.resolved_at IS NULL OR proposed.expires_at IS NULL OR proposed.expires_at<=clock_at
        OR proposed.expires_at<=proposed.resolved_at
    THEN RAISE EXCEPTION 'partner_address_receipt_expiry_invalid' USING ERRCODE='22023'; END IF;
    canonical_payload:=jsonb_build_object(
      'price_area',proposed.price_area,'grid_area_code',proposed.grid_area_code,'grid_owner_id',proposed.grid_owner_id,
      'resolution_status',proposed.resolution_status,'confidence',proposed.result_snapshot->'confidence',
      'price_area_assurance',proposed.result_snapshot->'priceAreaAssurance',
      'automation_allowed',proposed.result_snapshot->'automationAllowed','resolver_version',proposed.resolver_version,
      'geodata_version',proposed.geodata_version,'conflict_code',proposed.conflict_code);
    SELECT r.* INTO found_row
      FROM gridex_partner_address_receipts.entries k
      JOIN public.customer_site_resolution r ON r.id=k.resolution_id AND r.company_id=k.company_id
      JOIN public.canonical_energy_flow_events e ON e.id=k.event_id AND e.company_id=k.company_id AND e.resolution_id=r.id
      WHERE k.company_id=p_company_id AND k.client_id=p_client_id AND k.scope_key=row_key
        AND k.source_digest=source_key AND k.expires_at>clock_at AND r.expires_at=k.expires_at AND r.resolved_at=k.resolved_at
        AND (to_jsonb(r)-temporal_fields)=(to_jsonb(proposed)-temporal_fields)
        AND e.event_type='energy_area.resolved' AND e.event_scope='tenant' AND e.source='ops_energy_resolver'
        AND e.customer_id IS NULL AND e.site_id IS NULL AND e.metering_point_id IS NULL AND e.quote_id IS NULL
        AND e.contract_id IS NULL AND e.payload_version='1' AND e.actor_type='system' AND e.actor_id IS NULL
        AND e.payload=canonical_payload
      FOR SHARE OF r,e;
    IF NOT FOUND THEN
      proposed.id:=gen_random_uuid();
      proposed.created_at:=clock_at;
      INSERT INTO public.customer_site_resolution SELECT (proposed).* RETURNING * INTO found_row;
      INSERT INTO public.canonical_energy_flow_events(event_type,company_id,event_scope,resolution_id,source,payload)
        VALUES('energy_area.resolved',p_company_id,'tenant',found_row.id,'ops_energy_resolver',canonical_payload)
        RETURNING id INTO recorded_event;
      INSERT INTO gridex_partner_address_receipts.entries VALUES(p_company_id,p_client_id,row_key,found_row.id,recorded_event,found_row.resolved_at,found_row.expires_at,source_key)
        ON CONFLICT(company_id,client_id,scope_key) DO UPDATE SET resolution_id=excluded.resolution_id,event_id=excluded.event_id,
          resolved_at=excluded.resolved_at,expires_at=excluded.expires_at,source_digest=excluded.source_digest;
    END IF;
    RETURN jsonb_build_object('resolutionId',found_row.id,'resolvedAt',found_row.resolved_at,'expiresAt',found_row.expires_at);
END
$save$;
REVOKE ALL ON FUNCTION public.gridex_save_fresh_partner_address_resolution_v1(uuid,uuid,numeric,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_save_fresh_partner_address_resolution_v1(uuid,uuid,numeric,jsonb,jsonb) TO service_role;
END
$gridex_address_migration$;
RESET statement_timeout;
RESET lock_timeout;
