-- gridex_ediel_duplicate_responses.matches_business_sequence_v1
-- (20261001134500) refuses an unreceipted APERAK to a UTILTS source unless its
-- RFF+ACW set covers every source IDE. A message-scope APERAK (UTILTS header
-- rejection, U-APERAK without ACW) carries no ACW at all: it answers the whole
-- message, not one transaction. ediel_create_outbound_ack_atomic_v1 re-reads
-- its own just-inserted ACK through this matcher before the creation receipt
-- exists, so every header rejection failed with
-- ediel_historical_ack_sequence_basis_unavailable.
--
-- Only a partial ACW set is ambiguous. An APERAK without any ACW stays a full
-- message response; one with ACW must still cover every source IDE. Body
-- rewrite with predecessor and metadata guards; everything else is unchanged.
BEGIN;
DO $scope$DECLARE f record;
 needle CONSTANT text:=$n$IF EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(s->'ide','[]'))x WHERE NOT coalesce(a#>'{refs,ACW}','[]') ? x)$n$;
 replacement CONSTANT text:=$n$IF jsonb_array_length(coalesce(a#>'{refs,ACW}','[]'))>0 AND EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(s->'ide','[]'))x WHERE NOT coalesce(a#>'{refs,ACW}','[]') ? x)$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_ediel_duplicate_responses.matches_business_sequence_v1(public.ediel_messages,public.ediel_messages,text,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'historical_aperak_message_scope_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'historical_aperak_message_scope_metadata_changed';END IF;
END$scope$;
COMMIT;
