BEGIN;
-- Preserve the registered owner's typed refusal before the general contract
-- trigger can mask it. No guard function, source row, ACL or retention rule is
-- replaced. Qualify the actual current catalog before changing only the name.
DO $guard$
DECLARE
 v_relation oid:=pg_catalog.to_regclass('public.ediel_messages');
 v_expected record;v_proc pg_catalog.pg_proc%rowtype;
 v_registered pg_catalog.pg_trigger%rowtype;v_general pg_catalog.pg_trigger%rowtype;
 v_functions oid[]:='{}';v_before_functions jsonb;v_after_functions jsonb;
 v_before_trigger jsonb;v_after_trigger jsonb;v_before_columns jsonb;v_after_columns jsonb;
BEGIN
 IF v_relation IS NULL THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
 LOCK TABLE public.ediel_messages IN ACCESS EXCLUSIVE MODE;
 FOR v_expected IN SELECT * FROM (VALUES
  ('gridex_ediel_inbound_receptions.guard_original_v1()',
   'af8d0de66049632f22787ea67a5ea5971c8fcc4e5d302ae09eef20b035b93241',true,'search_path=pg_catalog','plpgsql','pg_catalog.trigger'),
  ('public.gridex_validate_ediel_message_contract()',
   'cb4d6aa9100614d29f0dc8862e94762e36fdc698508c8e01639baef3e86ad4a4',false,'search_path=public, extensions, pg_temp','plpgsql','pg_catalog.trigger'),
  ('public.ediel_is_qualified_retention_transition_v1(public.ediel_messages,public.ediel_messages)',
   '7c5b1fdea7c14b76ec33f1c2999a4e3d6917fcdc1c4c2408973a6d883babddbd',true,'search_path=pg_catalog','sql','pg_catalog.bool'),
  ('gridex_ediel_retention.public_content_v1(public.ediel_messages)',
   '296fcae37ddb26e2ff3c193dc540122b0b2b6baae1a12b06fac4ee56a58b94f4',false,'search_path=pg_catalog','sql','pg_catalog.jsonb')
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
  OR EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgrelid=v_relation AND tgname='ediel_00_registered_reception_original_immutable')
 THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
 SELECT * INTO v_general FROM pg_catalog.pg_trigger WHERE tgrelid=v_relation AND tgname='ediel_messages_canonical_contract_biu';
 IF NOT FOUND OR v_general.tgfoid IS DISTINCT FROM v_functions[2] OR v_general.tgtype<>23
  OR v_general.tgenabled<>'O' OR v_general.tgisinternal OR v_general.tgnargs<>0
  OR v_general.tgattr::text<>'' OR v_general.tgqual IS NOT NULL OR v_general.tgconstraint<>0
 THEN RAISE EXCEPTION 'ediel_registered_guard_priority_preimage_required';END IF;
 v_before_trigger:=pg_catalog.to_jsonb(v_registered);
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.oid) INTO v_before_functions FROM pg_catalog.pg_proc p WHERE p.oid=ANY(v_functions);
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.attnum) INTO v_before_columns FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_relation;
 ALTER TRIGGER registered_reception_original_immutable ON public.ediel_messages RENAME TO ediel_00_registered_reception_original_immutable;
 SELECT pg_catalog.to_jsonb(t) INTO v_after_trigger FROM pg_catalog.pg_trigger t WHERE t.oid=v_registered.oid;
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.oid) INTO v_after_functions FROM pg_catalog.pg_proc p WHERE p.oid=ANY(v_functions);
 SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.attnum) INTO v_after_columns FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_relation;
 IF v_after_trigger IS DISTINCT FROM v_before_trigger||pg_catalog.jsonb_build_object('tgname','ediel_00_registered_reception_original_immutable')
  OR v_after_functions IS DISTINCT FROM v_before_functions OR v_after_columns IS DISTINCT FROM v_before_columns
 THEN RAISE EXCEPTION 'ediel_registered_guard_priority_postcondition_required';END IF;
END
$guard$;
COMMIT;
