-- Keep the original transport observation when a later ACK confirms delivery.
DO $migration$
DECLARE
  prior record;
  signature constant regprocedure := 'public.gridex_apply_grid_owner_provider_status_v1(uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure;
  needle constant text := $anchor$sent_at = CASE WHEN NOT retain_e66_state AND next_status = 'sent' THEN changed_at ELSE request.sent_at END,$anchor$;
  replacement constant text := $anchor$sent_at = CASE WHEN NOT retain_e66_state AND next_status = 'sent' THEN coalesce(request.sent_at, changed_at) ELSE request.sent_at END,$anchor$;
BEGIN
  SELECT p.oid, p.prosrc, pg_get_functiondef(p.oid) AS definition, to_jsonb(p)-'prosrc' AS metadata
    INTO STRICT prior
  FROM pg_proc p
  WHERE p.oid = signature AND p.proowner = current_user::regrole;
  IF encode(sha256(convert_to(prior.prosrc,'UTF8')),'hex') <> 'f61448c69df8b1cd2002c6fcabacbe22f92af2a5b59d59af32a7c95c665d0ee9' THEN
    RAISE EXCEPTION 'grid_owner_request_sent_at_exact_predecessor_required';
  END IF;

  EXECUTE replace(prior.definition, prior.prosrc, replace(prior.prosrc, needle, replacement));
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid = prior.oid) IS DISTINCT FROM prior.metadata THEN
    RAISE EXCEPTION 'grid_owner_request_provider_status_metadata_changed';
  END IF;
END
$migration$;
