-- TR-05/TR-10: public message lineage is TEXT; private owners retain UUID.
-- Actual native recovery raises42883 before source qualification. Preserve
-- historical non-UUID references and every current authority/source condition.
-- Exact catalog-body composition retains signature/OID/owner/ACL and settings.
BEGIN;
DO $align$
DECLARE patch record;f record;body text;actual jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.ediel_messages'::regclass AND attname='original_message_id' AND atttypid='text'::regtype AND NOT attisdropped)
 THEN RAISE EXCEPTION 'ediel_recovery_public_reference_type_review_required';END IF;
 FOR patch IN SELECT * FROM (VALUES
  ('gridex_received_sources.assess_recovery_source_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)','a.original_message_id=m.id','a.original_message_id=m.id::text'),
  ('public.ediel_consume_prodat_retry_authorization_v1(uuid,uuid,uuid,uuid,uuid,uuid)','ack.original_message_id=m.id','ack.original_message_id=m.id::text'),
  ('gridex_received_sources.bind_prodat_recovery_message_v1()','NEW.original_message_id IS DISTINCT FROM op.original_message_id','NEW.original_message_id IS DISTINCT FROM op.original_message_id::text'),
  ('gridex_received_sources.require_recovery_insert_origin_v1()','NEW.original_message_id IS DISTINCT FROM op.original_message_id','NEW.original_message_id IS DISTINCT FROM op.original_message_id::text'),
  ('gridex_received_sources.qualified_recovery_origin_v1(uuid,uuid)','m.original_message_id IS DISTINCT FROM op.original_message_id','m.original_message_id IS DISTINCT FROM op.original_message_id::text'),
  ('public.ediel_require_prodat_recovery_current_v1(uuid,uuid)','m.original_message_id IS DISTINCT FROM op.original_message_id','m.original_message_id IS DISTINCT FROM op.original_message_id::text'),
  ('public.ediel_bind_switch_correction_before_method_v1(uuid,uuid,uuid)','m.original_message_id IS DISTINCT FROM original.id','m.original_message_id IS DISTINCT FROM original.id::text'),
  ('public.ediel_require_switch_original_current_v1(uuid,uuid)','m.original_message_id IS DISTINCT FROM op.original_message_id','m.original_message_id IS DISTINCT FROM op.original_message_id::text'),
  ('gridex_received_sources.require_production_contract_before_brp_current_v1(uuid,uuid,uuid)','m.original_message_id IS DISTINCT FROM original.id','m.original_message_id IS DISTINCT FROM original.id::text'),
  ('gridex_customer_life_events.recovery_basis_v1(uuid,uuid,uuid,text)','alias_message.original_message_id IS DISTINCT FROM previous.id','alias_message.original_message_id IS DISTINCT FROM previous.id::text'),
  ('gridex_customer_masterdata.require_recovery_preparation_v1(gridex_customer_masterdata.preparations,public.ediel_messages,uuid,text)','m.original_message_id IS DISTINCT FROM op.original_message_id','m.original_message_id IS DISTINCT FROM op.original_message_id::text'),
  ('gridex_switch_cancellations.bind_message_v1()','NEW.original_message_id IS DISTINCT FROM o.original_message_id','NEW.original_message_id IS DISTINCT FROM o.original_message_id::text')
 ) AS patches(signature,old_fragment,new_fragment)
 LOOP
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=patch.signature::regprocedure;
  IF f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR (length(f.prosrc)-length(replace(f.prosrc,patch.old_fragment,'')))<>length(patch.old_fragment)
   OR strpos(f.prosrc,patch.new_fragment)>0
  THEN RAISE EXCEPTION 'ediel_recovery_reference_body_review_required: %',patch.signature;END IF;
  body:=replace(f.prosrc,patch.old_fragment,patch.new_fragment);
  EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
  SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
  IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc'
  THEN RAISE EXCEPTION 'ediel_recovery_reference_authority_changed: %',patch.signature;END IF;
 END LOOP;
END$align$;
COMMIT;
