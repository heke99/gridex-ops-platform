-- Preserve the current partial permission source executor and every historical
-- result. Only fresh own A74/Z14 qualification gains original-purpose binding;
-- the existing public partition still holds bad scopes and commits good ones.
-- One atomic DO preserves function OID/owner/ACL/configuration and refuses an
-- unknown predecessor rather than replacing an independently changed owner.
DO $purpose$
DECLARE f record; body text; body_hash text;
 signature CONSTANT text:='gridex_received_sources.apply_permission_group_v1(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb,boolean)';
 old_hash CONSTANT text:='5d3cae0314213756668f612eb31aada1862b4421f6ad1ac377f5ebc22fa6f3e9';
 new_hash CONSTANT text:='33bbd09e49210e93c684e41527ff2ef48aac70c49a44c4cf92bdabc3c5d132fa';
 needle CONSTANT text:=$needle$   ELSIF reason=mode AND a->>'status'='A74' THEN
$needle$;
 guard CONSTANT text:=$guard$    -- Fresh positive Z14 must correspond to its independently sealed/sent
    -- own-LI original purpose. NULL is a distinct possible original value.
    IF (SELECT count(DISTINCT jsonb_build_array(o->'purpose')) FROM jsonb_array_elements(original->'objects')o WHERE o->>'li'=p.rff_li_reference)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_reporting_purpose_unqualified');END IF;
    IF a->>'purpose' IS DISTINCT FROM (SELECT DISTINCT o->>'purpose' FROM jsonb_array_elements(original->'objects')o WHERE o->>'li'=p.rff_li_reference) THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_reporting_purpose_mismatch');END IF;
$guard$;
BEGIN
 IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'permission_original_purpose_predecessor_required';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=to_regprocedure(signature);
 body_hash:=encode(sha256(convert_to(f.prosrc,'UTF8')),'hex');
 IF body_hash=new_hash THEN RETURN;END IF;
 IF body_hash<>old_hash OR (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
  OR (length(f.definition)-length(replace(f.definition,f.prosrc,'')))/length(f.prosrc)<>1 THEN RAISE EXCEPTION 'permission_original_purpose_predecessor_required';END IF;
 body:=replace(f.prosrc,needle,needle||guard);
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>new_hash THEN RAISE EXCEPTION 'permission_original_purpose_body_shape_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=f.oid) IS DISTINCT FROM new_hash THEN RAISE EXCEPTION 'permission_original_purpose_metadata_changed';END IF;
END
$purpose$;
