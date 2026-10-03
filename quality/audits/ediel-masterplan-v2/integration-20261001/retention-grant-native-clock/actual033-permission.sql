CREATE FUNCTION gridex_ediel_retention.permission_v1(c uuid, actor uuid, wanted text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE retention_keys constant text[]:=ARRAY['ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes','ediel.retention.artifact_decision_evidence','ediel.retention.blob_decision_evidence','ediel.retention.record_decision_evidence','ediel.retention.process_decision_evidence','ediel.retention.decision_policy_evidence','ediel.retention.billing_source_evidence','ediel.retention.invoice_copy_evidence','ediel.retention.settlement_copy_evidence','ediel.retention.finance_decision_evidence'];
BEGIN
 IF wanted<>ALL(retention_keys) THEN RETURN gridex_requested_changes.scoped_permission_v1(c,actor,wanted) IS TRUE
 AND NOT EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
 AND NOT EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted)
 AND public.gridex_actor_has_company_permission(actor,c,wanted) IS TRUE;END IF;
 IF NOT EXISTS(SELECT FROM public.companies WHERE id=c AND status IN('active','archived','pending_deletion'))
  OR NOT public.ediel_retention_lock_auth_actor_v1(actor)
  OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=actor AND user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=c AND user_id=actor AND status='active' AND is_active AND accepted_at IS NOT NULL) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)
  OR EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND u.effect='deny' AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND (o.company_id=c OR o.company_id IS NULL) AND o.is_active AND o.effect='deny' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=now()) AND (o.valid_to IS NULL OR now()<o.valid_to))
  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND (u.company_id=c OR u.company_id IS NULL) AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='deny' AND p.key=wanted) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT FROM public.user_permissions u JOIN public.permissions p ON p.id=u.permission_id OR u.permission_id IS NULL AND p.key=u.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND u.effect='allow' AND p.is_active AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE u.user_id=actor AND u.company_id=c AND u.is_active AND u.status='active' AND r.is_active AND rp.effect='allow' AND p.is_active AND p.key=wanted)
  OR EXISTS(SELECT FROM public.user_permission_overrides o WHERE o.user_id=actor AND o.company_id=c AND o.is_active AND o.effect='allow' AND o.permission_key=wanted AND (o.valid_from IS NULL OR o.valid_from<=now()) AND (o.valid_to IS NULL OR now()<o.valid_to));
END$$;