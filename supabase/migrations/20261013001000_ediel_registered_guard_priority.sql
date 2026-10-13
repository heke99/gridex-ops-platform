BEGIN;
-- Give only genuine received H05 raw/direction mutations their registered
-- refusal. Keep both existing triggers and all existing functions untouched.
-- A nullable classification reads protected original receipts, never caller flags.
DO $guard$
DECLARE
 v_relation oid:=pg_catalog.to_regclass('public.ediel_messages');
 v_expected record;v_proc pg_catalog.pg_proc%rowtype;
 v_registered pg_catalog.pg_trigger%rowtype;v_general pg_catalog.pg_trigger%rowtype;v_context pg_catalog.pg_trigger%rowtype;v_new pg_catalog.pg_trigger%rowtype;
 v_functions oid[]:='{}';v_before_functions jsonb;v_after_functions jsonb;
 v_before_triggers jsonb;v_after_triggers jsonb;v_before_columns jsonb;v_after_columns jsonb;
 v_wrapper oid;v_wrapper_proc pg_catalog.pg_proc%rowtype;
 v_context_relation oid:=pg_catalog.to_regclass('gridex_ediel_inbound_context.receipts');v_classifier oid;v_new_proc pg_catalog.pg_proc%rowtype;
BEGIN
 IF v_relation IS NULL OR v_context_relation IS NULL OR pg_catalog.to_regprocedure('public.ediel_is_received_h05_original_v1(public.ediel_messages)') IS NOT NULL OR pg_catalog.to_regprocedure('public.ediel_guard_received_h05_original_v1()') IS NOT NULL THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
 LOCK TABLE public.ediel_messages IN ACCESS EXCLUSIVE MODE;
 FOR v_expected IN SELECT * FROM (VALUES
  ('gridex_ediel_inbound_receptions.guard_original_v1()',
   'af8d0de66049632f22787ea67a5ea5971c8fcc4e5d302ae09eef20b035b93241',true,'search_path=pg_catalog','plpgsql','pg_catalog.trigger'),
  ('public.gridex_validate_ediel_message_contract()',
   'cb4d6aa9100614d29f0dc8862e94762e36fdc698508c8e01639baef3e86ad4a4',false,'search_path=public, extensions, pg_temp','plpgsql','pg_catalog.trigger'),
  ('public.ediel_is_qualified_retention_transition_v1(public.ediel_messages,public.ediel_messages)',
   '7c5b1fdea7c14b76ec33f1c2999a4e3d6917fcdc1c4c2408973a6d883babddbd',true,'search_path=pg_catalog','sql','pg_catalog.bool'),
  ('gridex_ediel_retention.public_content_v1(public.ediel_messages)',
   '296fcae37ddb26e2ff3c193dc540122b0b2b6baae1a12b06fac4ee56a58b94f4',false,'search_path=pg_catalog','sql','pg_catalog.jsonb'),
  ('gridex_ediel_inbound_context.immutable()',
   '4f4503c50650b347d5f56b40b5d5a9be2e8a4a23b07da73b29339f28bbae4922',false,'search_path=pg_catalog','plpgsql','pg_catalog.trigger')
 ) AS expected(signature,body_sha256,security_definer,configuration,language_name,result_type)
 LOOP
  SELECT * INTO v_proc FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(v_expected.signature);
  IF NOT FOUND OR v_proc.prokind<>'f' OR v_proc.prosecdef IS DISTINCT FROM v_expected.security_definer
   OR v_proc.proconfig IS DISTINCT FROM ARRAY[v_expected.configuration]
   OR v_proc.prorettype IS DISTINCT FROM pg_catalog.to_regtype(v_expected.result_type)
   OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=v_proc.prolang) IS DISTINCT FROM v_expected.language_name
   OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_proc.prosrc,'UTF8')),'hex') IS DISTINCT FROM v_expected.body_sha256
  THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
  v_functions:=pg_catalog.array_append(v_functions,v_proc.oid);
 END LOOP;
 SELECT * INTO v_registered FROM pg_catalog.pg_trigger WHERE tgrelid=v_relation AND tgname='registered_reception_original_immutable';
 IF NOT FOUND OR v_registered.tgfoid IS DISTINCT FROM v_functions[1] OR v_registered.tgtype<>27
  OR v_registered.tgenabled<>'O' OR v_registered.tgisinternal OR v_registered.tgnargs<>0
  OR v_registered.tgattr::text<>'' OR v_registered.tgqual IS NOT NULL OR v_registered.tgconstraint<>0
  OR v_registered.tgparentid<>0 OR v_registered.tgdeferrable OR v_registered.tginitdeferred
  OR EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgrelid=v_relation AND tgname IN('ediel_00_registered_reception_original_immutable','ediel_00_registered_h05_original_immutable'))
 THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
 SELECT * INTO v_general FROM pg_catalog.pg_trigger WHERE tgrelid=v_relation AND tgname='ediel_messages_canonical_contract_biu';
 IF NOT FOUND OR v_general.tgfoid IS DISTINCT FROM v_functions[2] OR v_general.tgtype<>23
  OR v_general.tgenabled<>'O' OR v_general.tgisinternal OR v_general.tgnargs<>0
  OR v_general.tgattr::text<>'' OR v_general.tgqual IS NOT NULL OR v_general.tgconstraint<>0
 THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
 SELECT * INTO v_context FROM pg_catalog.pg_trigger WHERE tgrelid=v_context_relation AND tgname='immutable_receipts';
 IF NOT FOUND OR v_context.tgfoid IS DISTINCT FROM v_functions[5] OR v_context.tgtype<>27
  OR v_context.tgenabled<>'O' OR v_context.tgisinternal OR v_context.tgnargs<>0 OR v_context.tgattr::text<>'' OR v_context.tgqual IS NOT NULL
  OR v_context.tgconstraint<>0 OR v_context.tgparentid<>0 OR v_context.tgdeferrable OR v_context.tginitdeferred
  OR v_registered.tgfoid IS DISTINCT FROM v_functions[1]
  OR (SELECT proowner FROM pg_catalog.pg_proc WHERE oid=v_functions[1]) IS DISTINCT FROM current_user::pg_catalog.regrole::oid
 THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.oid) INTO v_before_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN(v_relation,v_context_relation);
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.oid) INTO v_before_functions FROM pg_catalog.pg_proc p WHERE p.oid=ANY(v_functions);
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.attnum) INTO v_before_columns FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_relation;
 EXECUTE $new_classifier$
CREATE FUNCTION public.ediel_is_received_h05_original_v1(m public.ediel_messages) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $class$
 SELECT coalesce(m.direction='inbound' AND m.message_standard='edifact' AND m.message_family='PRODAT' AND m.message_code='Z05'
  AND m.raw_payload IS NOT NULL AND m.immutable_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  AND m.execution_context_snapshot#>'{receivedProdatContext,version}'='1'::jsonb
  AND m.execution_context_snapshot#>>'{receivedProdatContext,contextOrigin}'='database_insert'
  AND m.execution_context_snapshot#>>'{receivedProdatContext,sourceMessageId}'=m.id::text
  AND m.execution_context_snapshot#>>'{receivedProdatContext,companyId}'=m.company_id::text
  AND m.execution_context_snapshot#>>'{receivedProdatContext,environment}'=m.environment
  AND m.execution_context_snapshot#>>'{receivedProdatContext,messageCode}'=m.message_code
  AND m.execution_context_snapshot#>>'{receivedProdatContext,payloadHash}'=m.immutable_payload_hash
  AND EXISTS(SELECT FROM gridex_ediel_inbound_receptions.receptions r WHERE r.source_message_id=m.id AND r.company_id=m.company_id AND r.environment=m.environment AND r.canonical_payload_hash=m.immutable_payload_hash)
  AND EXISTS(SELECT FROM gridex_ediel_inbound_context.receipts basis JOIN public.ediel_messages original ON original.id=basis.source_message_id AND original.company_id=basis.company_id WHERE basis.source_message_id=m.id
   AND ROW(original.company_id,original.environment,original.direction,original.message_standard,original.message_family,original.message_code,original.raw_payload,original.sender_ediel_id,original.receiver_ediel_id,original.application_reference,original.interchange_reference,original.mailbox_message_id,original.immutable_payload_hash,original.message_received_at,original.execution_context_snapshot->'receivedProdatContext')
    IS NOT DISTINCT FROM ROW(m.company_id,m.environment,m.direction,m.message_standard,m.message_family,m.message_code,m.raw_payload,m.sender_ediel_id,m.receiver_ediel_id,m.application_reference,m.interchange_reference,m.mailbox_message_id,m.immutable_payload_hash,m.message_received_at,m.execution_context_snapshot->'receivedProdatContext')
   AND basis.status='ready' AND basis.company_id=m.company_id AND basis.environment=m.environment AND basis.direction=m.direction
   AND basis.source_received_at=m.message_received_at AND basis.payload_sha256=m.immutable_payload_hash
   AND basis.context @> jsonb_build_object('basisKind','observed_source_persistence','companyId',m.company_id,
    'environment',m.environment,'direction','inbound','family','PRODAT','code','Z05','subtype','H')),false)
$class$;
$new_classifier$;
 REVOKE ALL ON FUNCTION public.ediel_is_received_h05_original_v1(public.ediel_messages) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION public.ediel_is_received_h05_original_v1(public.ediel_messages) TO service_role;
 EXECUTE $new_priority$
CREATE FUNCTION public.ediel_guard_received_h05_original_v1() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $priority$
BEGIN
 IF TG_OP<>'UPDATE' OR TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'ediel_messages' THEN
  RAISE EXCEPTION 'ediel_h05_original_priority_owner_required' USING ERRCODE='23514';END IF;
 IF NEW.raw_payload IS NOT NULL AND (NEW.raw_payload,NEW.direction) IS DISTINCT FROM (OLD.raw_payload,OLD.direction)
  AND public.ediel_is_received_h05_original_v1(OLD)
 THEN RAISE EXCEPTION 'ediel_registered_reception_original_immutable';END IF;
 RETURN NEW;
END
$priority$;
$new_priority$;
 REVOKE ALL ON FUNCTION public.ediel_guard_received_h05_original_v1() FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION public.ediel_guard_received_h05_original_v1() TO service_role;
 CREATE TRIGGER ediel_00_registered_h05_original_immutable BEFORE UPDATE OF raw_payload,direction ON public.ediel_messages
 FOR EACH ROW EXECUTE FUNCTION public.ediel_guard_received_h05_original_v1();
 v_classifier:=pg_catalog.to_regprocedure('public.ediel_is_received_h05_original_v1(public.ediel_messages)');
 SELECT * INTO v_new_proc FROM pg_catalog.pg_proc WHERE oid=v_classifier;
 v_wrapper:=pg_catalog.to_regprocedure('public.ediel_guard_received_h05_original_v1()');
 SELECT * INTO v_wrapper_proc FROM pg_catalog.pg_proc WHERE oid=v_wrapper;
 SELECT * INTO v_new FROM pg_catalog.pg_trigger WHERE tgrelid=v_relation AND tgname='ediel_00_registered_h05_original_immutable';
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.oid) INTO v_after_triggers FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN(v_relation,v_context_relation) AND t.oid<>v_new.oid;
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.oid) INTO v_after_functions FROM pg_catalog.pg_proc p WHERE p.oid=ANY(v_functions);
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.attnum) INTO v_after_columns FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_relation;
 IF v_after_triggers IS DISTINCT FROM v_before_triggers
  OR v_new.tgtype IS DISTINCT FROM 19::smallint OR v_new.tgfoid IS DISTINCT FROM v_wrapper OR v_new.tgqual IS NOT NULL
  OR (pg_catalog.to_jsonb(v_new)-'oid'-'tgname'-'tgqual'-'tgattr'-'tgtype'-'tgfoid') IS DISTINCT FROM (pg_catalog.to_jsonb(v_registered)-'oid'-'tgname'-'tgqual'-'tgattr'-'tgtype'-'tgfoid')
  OR v_new.tgattr::text IS DISTINCT FROM (SELECT string_agg(a.attnum::text,' ' ORDER BY CASE a.attname WHEN 'raw_payload' THEN 1 ELSE 2 END) FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_relation AND a.attname IN('raw_payload','direction'))
  OR v_new_proc.proowner IS DISTINCT FROM (SELECT proowner FROM pg_catalog.pg_proc WHERE oid=v_functions[1])
  OR v_new_proc.prosecdef IS DISTINCT FROM true OR v_new_proc.provolatile<>'s' OR v_new_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
  OR v_new_proc.prorettype IS DISTINCT FROM 'boolean'::pg_catalog.regtype OR v_new_proc.pronargs<>1 OR v_new_proc.proargtypes[0] IS DISTINCT FROM 'public.ediel_messages'::pg_catalog.regtype::oid
  OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_new_proc.prosrc,'UTF8')),'hex') IS DISTINCT FROM '0985204328fa78934c7fbd365f25e79051ae6df7eb1f5b144a0419aa4d3f0f22'
  OR NOT pg_catalog.has_function_privilege('service_role',v_classifier,'EXECUTE')
  OR EXISTS(SELECT FROM pg_catalog.aclexplode(v_new_proc.proacl) acl WHERE acl.grantee NOT IN(v_new_proc.proowner,'service_role'::pg_catalog.regrole::oid))
  OR v_wrapper_proc.proowner IS DISTINCT FROM v_new_proc.proowner OR v_wrapper_proc.prosecdef IS DISTINCT FROM true
  OR v_wrapper_proc.provolatile<>'v' OR v_wrapper_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
  OR v_wrapper_proc.prorettype IS DISTINCT FROM 'trigger'::pg_catalog.regtype OR v_wrapper_proc.pronargs<>0
  OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_wrapper_proc.prosrc,'UTF8')),'hex') IS DISTINCT FROM '1796f66117657c684d23773e2198f30d03a3cc70bb299d1c54baa5b48a4ee212'
  OR NOT pg_catalog.has_function_privilege('service_role',v_wrapper,'EXECUTE')
  OR EXISTS(SELECT FROM pg_catalog.aclexplode(v_wrapper_proc.proacl) acl WHERE acl.grantee NOT IN(v_wrapper_proc.proowner,'service_role'::pg_catalog.regrole::oid))
  OR v_after_functions IS DISTINCT FROM v_before_functions OR v_after_columns IS DISTINCT FROM v_before_columns
 THEN RAISE EXCEPTION 'ediel_registered_guard_priority_postcondition_required';END IF;
END
$guard$;
COMMIT;
