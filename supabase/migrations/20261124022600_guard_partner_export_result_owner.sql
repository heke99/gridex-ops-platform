DO $migration$
BEGIN
  CREATE OR REPLACE FUNCTION public.gridex_update_partner_export_business_v1(
    p_export_id uuid, p_company_id uuid, p_customer_id uuid, p_actor_id uuid,
    p_original_status text, p_changes jsonb
  )
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO pg_catalog
  AS $function$
  DECLARE
    next_status text := p_changes->>'status';
    changed_at timestamptz := clock_timestamp();
    current_export public.partner_exports;
    updated_export public.partner_exports;
  BEGIN
    IF p_export_id IS NULL OR p_company_id IS NULL OR p_customer_id IS NULL OR p_actor_id IS NULL
      OR (p_original_status IN ('queued','sent','acknowledged','failed','cancelled')) IS NOT TRUE
      OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
      OR p_changes = '{}'::jsonb
      OR p_changes - ARRAY['status','external_reference','failure_reason','admin_note'] <> '{}'::jsonb
      OR (p_changes ? 'status' AND
        (next_status IN ('queued','sent','acknowledged','failed','cancelled')
          AND next_status <> p_original_status) IS NOT TRUE)
      OR EXISTS (
        SELECT FROM jsonb_each(p_changes - 'status') AS field(key,value)
        WHERE jsonb_typeof(field.value) NOT IN ('string','null')
      ) THEN
      RAISE EXCEPTION 'Ogiltig ändring av partnerexport.' USING ERRCODE = '22023';
    END IF;

    IF (
      public.canonical_actor_is_platform_admin(p_actor_id)
      OR public.gridex_actor_has_company_permission(p_actor_id, p_company_id, 'partner_exports.write')
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'Manuell hantering kräver partnerexportbehörighet för bolaget.' USING ERRCODE = '42501';
    END IF;

    IF next_status = 'queued' THEN
      PERFORM 1 FROM public.companies WHERE id = p_company_id AND status IN ('active','onboarding') FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ett pausat bolag kan inte återköa en partnerexport.' USING ERRCODE = '42501';
      END IF;
    END IF;

    SELECT * INTO current_export FROM public.partner_exports
      WHERE id = p_export_id AND company_id = p_company_id AND customer_id = p_customer_id
        AND (next_status IS NULL OR status = p_original_status)
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Partnerexporten har ändrats eller är inte tillgänglig. Ladda om sidan.' USING ERRCODE = 'P0002';
    END IF;

    -- The canonical queue binds an export-run item while locking its partner row.
    -- An operator may edit a separate, unbound handling state or record a note.
    IF next_status IN ('sent','acknowledged')
      OR ((next_status IS NOT NULL OR p_changes ?| ARRAY['external_reference','failure_reason']) AND (
        current_export.status IN ('sent','acknowledged')
        OR current_export.sent_at IS NOT NULL OR current_export.acknowledged_at IS NOT NULL
        OR current_export.last_partner_response_at IS NOT NULL
        OR current_export.partner_response_log <> '[]'::jsonb
        OR EXISTS (
          SELECT FROM public.billing_export_run_items item
          WHERE item.company_id = p_company_id AND item.partner_export_id = current_export.id
        )
      )) THEN
      RAISE EXCEPTION 'Partnerintegrationen ansvarar för exportens leveransstatus och kvitton.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.partner_exports AS export
    SET status = coalesce(next_status, export.status),
        external_reference = CASE WHEN p_changes ? 'external_reference' THEN p_changes->>'external_reference' ELSE export.external_reference END,
        failure_reason = CASE WHEN p_changes ? 'failure_reason' THEN p_changes->>'failure_reason' ELSE export.failure_reason END,
        response_payload = CASE WHEN p_changes ? 'admin_note'
          THEN jsonb_set(export.response_payload, '{admin_note}', p_changes->'admin_note', true)
          ELSE export.response_payload END,
        failed_at = CASE next_status WHEN 'failed' THEN changed_at WHEN 'queued' THEN NULL ELSE export.failed_at END,
        updated_at = CASE WHEN next_status = 'queued' THEN changed_at ELSE export.updated_at END,
        updated_by = p_actor_id
    WHERE export.id = p_export_id AND export.company_id = p_company_id AND export.customer_id = p_customer_id
      AND (next_status IS NULL OR export.status = p_original_status)
      AND (NOT p_changes ? 'admin_note' OR jsonb_typeof(export.response_payload) = 'object')
    RETURNING export.* INTO updated_export;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Partnerexporten har ändrats eller är inte tillgänglig. Ladda om sidan.' USING ERRCODE = 'P0002';
    END IF;
    RETURN to_jsonb(updated_export);
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.gridex_update_partner_export_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.gridex_update_partner_export_business_v1(uuid,uuid,uuid,uuid,text,jsonb)
    TO service_role;
END
$migration$;
