-- Apply this database owner and its migration receipt atomically.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_migration$
BEGIN
CREATE FUNCTION public.gridex_checkpoint_ediel_imap_scan_v1(
  p_mailbox_id uuid, p_locked_by text, p_locked_at timestamptz,
  p_expected_metadata jsonb, p_scan jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF current_user <> 'service_role' OR p_mailbox_id IS NULL
    OR nullif(p_locked_by,'') IS NULL OR p_locked_at IS NULL
    OR jsonb_typeof(p_scan) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ediel_imap_scan_claim_required';
  END IF;

  UPDATE public.ediel_mailboxes
  SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('ediel_imap_scan_v1',p_scan)
  WHERE id=p_mailbox_id AND locked_by=p_locked_by AND locked_at=p_locked_at
    AND (metadata IS NULL OR jsonb_typeof(metadata)='object')
    AND metadata IS NOT DISTINCT FROM p_expected_metadata;
  RETURN FOUND;
END
$function$;
REVOKE ALL ON FUNCTION public.gridex_checkpoint_ediel_imap_scan_v1(uuid,text,timestamptz,jsonb,jsonb)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gridex_checkpoint_ediel_imap_scan_v1(uuid,text,timestamptz,jsonb,jsonb)
TO service_role;
END
$gridex_migration$;
RESET statement_timeout;
RESET lock_timeout;
