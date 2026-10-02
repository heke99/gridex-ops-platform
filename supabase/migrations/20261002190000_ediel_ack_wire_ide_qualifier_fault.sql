-- gridex_ack_authority.wire_v1 returned NULL for any IDE whose qualifier was
-- not 24. A UTILTS source whose own fault is exactly that (field 505, IDE/7495
-- not 24) therefore had no physical wire identity: its rule basis could not be
-- bound (ediel_registered_original_guide_unavailable) and the negative APERAK
-- the guide prescribes could never be created.
--
-- The IDE reference is still recorded so the APERAK can quote it (RFF+ACW),
-- and the source is marked ideQualifierInvalid. The runtime always classifies
-- such a transaction as guide_rejected (negative APERAK), so no positive or
-- business authority follows from the recorded reference.
BEGIN;
DO $wire$DECLARE f record;
 needle CONSTANT text:=$n$IF e#>>'{1,0}'<>'24' THEN RETURN NULL; END IF;$n$;
 replacement CONSTANT text:=$n$IF e#>>'{1,0}' IS DISTINCT FROM '24' THEN out:=out||jsonb_build_object('ideQualifierInvalid',true); END IF;$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='gridex_ack_authority.wire_v1(text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'ack_wire_ide_qualifier_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'ack_wire_ide_qualifier_metadata_changed';END IF;
END$wire$;
COMMIT;
