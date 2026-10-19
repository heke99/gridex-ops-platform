-- SC-031 / P119: canonical ignored fields cannot supply business values.
-- Preserve raw/register evidence and all same-source/assessment/physical scope
-- checks. Only the owned first register's already-qualified decisions mask its
-- comparator locals. Outgoing policies/builders and applied history are intact.
DO $sc031_ignored_projection$
DECLARE
 target_oid oid;
 before_metadata jsonb;after_metadata jsonb;
 before_source text;after_source text;definition text;before_hash text;after_hash text;
 predecessor CONSTANT text:='6d5e21a429db0d8d1a0e07a08bf391f0ae643118b20ac19d2059490feaf2f500';
 successor CONSTANT text:='4c9dd19aaa1c28efccd3faa17b04d68272891879859e3212b3746fa71b0ba43a';
 anchor CONSTANT text:=$anchor$ -- Consume canonical decisions without another subtype classifier.
$anchor$;
 masks CONSTANT text:=$masks$ IF '213'=ANY(own_fields) THEN qty:=NULL;END IF;
 IF '222'=ANY(own_fields) THEN frequency:=NULL;END IF;
 IF '242'=ANY(own_fields) THEN product:=NULL;END IF;
$masks$;
BEGIN
 target_oid:=to_regprocedure('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)');
 IF target_oid IS NULL THEN RAISE EXCEPTION 'sc031_ignored_projection_existing_owner_required';END IF;
 SELECT to_jsonb(p)-'prosrc',p.prosrc,pg_get_functiondef(p.oid)
  INTO before_metadata,before_source,definition FROM pg_catalog.pg_proc p WHERE p.oid=target_oid;
 before_hash:=encode(sha256(convert_to(before_source,'UTF8')),'hex');
 IF before_hash=predecessor THEN
  IF (length(before_source)-length(replace(before_source,anchor,'')))/length(anchor)<>1
   THEN RAISE EXCEPTION 'sc031_ignored_projection_unique_anchor_required';END IF;
  after_source:=replace(before_source,anchor,anchor||masks);
  IF encode(sha256(convert_to(after_source,'UTF8')),'hex') IS DISTINCT FROM successor
   THEN RAISE EXCEPTION 'sc031_ignored_projection_exact_postimage_required';END IF;
  IF (length(definition)-length(replace(definition,before_source,'')))/length(before_source)<>1
   THEN RAISE EXCEPTION 'sc031_ignored_projection_exact_definition_required';END IF;
  -- Keep the existing signature, language, settings, security mode and every
  -- other catalog attribute. CREATE OR REPLACE preserves the owner/OID/ACL.
  EXECUTE replace(definition,before_source,after_source);
 ELSIF before_hash IS DISTINCT FROM successor THEN
  RAISE EXCEPTION 'sc031_ignored_projection_unknown_predecessor';
 END IF;
 SELECT to_jsonb(p)-'prosrc',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')
  INTO after_metadata,after_hash FROM pg_catalog.pg_proc p WHERE p.oid=target_oid;
 IF to_regprocedure('gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)') IS DISTINCT FROM target_oid
  OR after_hash IS DISTINCT FROM successor OR after_metadata IS DISTINCT FROM before_metadata
  THEN RAISE EXCEPTION 'sc031_ignored_projection_catalog_preservation_failed';END IF;
 RAISE NOTICE 'SC031 ignored projection catalog target=% beforeSHA256=% afterSHA256=% metadataSHA256=%',
  target_oid,before_hash,after_hash,encode(sha256(convert_to(before_metadata::text,'UTF8')),'hex');
END
$sc031_ignored_projection$;
