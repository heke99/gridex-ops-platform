BEGIN;
-- Authentic clean replay found that the published reception functions used a
-- column belonging to the private reception ledger on the public original.
-- public.ediel_messages retains the real transport selector as mailbox_message_id;
-- the immutable private reception keeps its own inbound_email_message_id FK.
-- Change only these exact references in the installed functions, retaining the
-- native-qualified erase exception and all later source/authorization guards.
DO $$
DECLARE
 f record;
 definition text;
 body text;
 original_owner oid;
 original_acl aclitem[];
 original_config text[];
 original_security boolean;
 installed oid;
BEGIN
 IF EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.ediel_messages'::regclass
  AND attname='inbound_email_message_id' AND NOT attisdropped)
  OR NOT EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.ediel_messages'::regclass
   AND attname='mailbox_message_id' AND atttypid='text'::regtype AND NOT attisdropped)
 THEN RAISE EXCEPTION 'ediel_reception_actual_original_shape_changed'; END IF;
 FOR f IN SELECT p.oid,p.oid::regprocedure AS identity,p.prosrc,p.proowner,p.proacl,p.proconfig,p.prosecdef
  FROM pg_proc p WHERE p.oid IN(
   'gridex_ediel_inbound_receptions.guard_original_v1()'::regprocedure,
   'public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)'::regprocedure)
 LOOP
  body:=f.prosrc;
  IF f.oid='gridex_ediel_inbound_receptions.guard_original_v1()'::regprocedure THEN
   IF position('NEW.inbound_email_message_id,NEW.mailbox_message_id' IN body)=0
    OR position('OLD.inbound_email_message_id,OLD.mailbox_message_id' IN body)=0
    THEN RAISE EXCEPTION 'ediel_reception_original_guard_reference_changed'; END IF;
   body:=replace(replace(body,'NEW.inbound_email_message_id,NEW.mailbox_message_id','NEW.mailbox_message_id'),
    'OLD.inbound_email_message_id,OLD.mailbox_message_id','OLD.mailbox_message_id');
  ELSE
   IF position('(m.inbound_email_message_id=mail.id OR m.mailbox_message_id=mail.id::text)' IN body)=0
    THEN RAISE EXCEPTION 'ediel_reception_first_original_selector_changed'; END IF;
   body:=replace(body,'(m.inbound_email_message_id=mail.id OR m.mailbox_message_id=mail.id::text)',
    '(m.mailbox_message_id=mail.id::text)');
  END IF;
  definition:=pg_get_functiondef(f.oid);
  IF position(f.prosrc IN definition)=0 THEN RAISE EXCEPTION 'ediel_reception_installed_body_binding_failed'; END IF;
  original_owner:=f.proowner;original_acl:=f.proacl;original_config:=f.proconfig;original_security:=f.prosecdef;
  EXECUTE replace(definition,f.prosrc,body);
  installed:=to_regprocedure(f.identity::text);
  IF installed IS DISTINCT FROM f.oid OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=installed
   AND p.proowner=original_owner AND p.proacl IS NOT DISTINCT FROM original_acl
   AND p.proconfig IS NOT DISTINCT FROM original_config AND p.prosecdef=original_security)
   THEN RAISE EXCEPTION 'ediel_reception_original_function_authority_changed'; END IF;
 END LOOP;
END $$;
COMMIT;
