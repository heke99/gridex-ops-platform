CREATE FUNCTION gridex_ediel_transport.is_verified_pre_smtp_certificate_rejection_v1(p_result jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
AS $certificate$
  SELECT coalesce(
    jsonb_typeof(p_result->'error')='object'
    AND p_result#>>'{error,phase}'='implicit_tls_handshake'
    AND p_result#>>'{error,code}' IN (
      'CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','CERT_REVOKED','CERT_SIGNATURE_FAILURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID','INVALID_CA','INVALID_PURPOSE',
      'SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    )
    AND p_result->>'smtpCode' IS NULL AND p_result->>'queueId' IS NULL
    AND p_result#>>'{error,command}' IS NULL AND p_result#>>'{error,syscall}' IS NULL
    AND p_result#>>'{error,responseCode}' IS NULL AND p_result#>>'{error,response}' IS NULL,
    false)
$certificate$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.is_verified_pre_smtp_certificate_rejection_v1(jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

DO $certificate$
DECLARE
  target regprocedure;
  original record;
  next_body text;
  original_condition constant text := $condition$result#>>'{error,syscall}'='connect'$condition$;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)'::regprocedure,
    'gridex_outbound_dispatch.mutate_before_observed_clock_v1(jsonb)'::regprocedure
  ] LOOP
    SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS properties
      INTO STRICT original FROM pg_proc p WHERE p.oid=target;
    IF (length(original.prosrc)-length(replace(original.prosrc,original_condition,'')))/length(original_condition)<>1
    THEN RAISE EXCEPTION 'ediel_smtp_certificate_owner_changed:%',target; END IF;
    next_body:=replace(original.prosrc,original_condition,original_condition ||
      ' OR gridex_ediel_transport.is_verified_pre_smtp_certificate_rejection_v1(result)');
    EXECUTE replace(original.definition,original.prosrc,next_body);
    IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=original.oid) IS DISTINCT FROM original.properties
    THEN RAISE EXCEPTION 'ediel_smtp_certificate_owner_metadata_changed:%',target; END IF;
  END LOOP;
END
$certificate$;
