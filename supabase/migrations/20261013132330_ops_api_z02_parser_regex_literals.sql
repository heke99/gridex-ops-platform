-- Two existing Z02 parser helpers: exact source-owned SQL E-string literals.
-- With standard_conforming_strings=on the older double-backslash plain patterns
-- fail to match valid CCI/CAV/NAD fields before the enabled atomic job gate.
-- Escape literals only; preserve every existing pg_proc attribute and public ABI.
-- No data/provider/business RPC invocation or grants; exact canonical replay inert.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $z02_regex_literals$
DECLARE spec jsonb; before_function pg_catalog.pg_proc%rowtype;
 after_function pg_catalog.pg_proc%rowtype;actual jsonb;definition text;
 config constant jsonb := '[{"signature":"public.gridex_edifact_cci_cav_value(text,text)","before":"bbf519caaea189a26c297e49cbc8a721","after":"9c2260f2d165463bde841c6ba239fde6","original":"\ndeclare\n  v_match text[];\n  v_value text;\nbegin\n  if coalesce(p_raw, '''') = '''' or coalesce(p_cci_code, '''') = '''' then return null; end if;\n  v_match := regexp_match(\n    p_raw,\n    ''CCI\\\\+\\\\+'' || regexp_replace(p_cci_code, ''([^a-zA-Z0-9])'', ''\\\\\\1'', ''g'') || ''[^'''']*''''[[:space:]]*CAV\\\\+([^+''''\\\\r\\\\n]+)''\n  );\n  v_value := nullif(btrim(v_match[1]), '''');\n  if v_value is null then return null; end if;\n  return nullif(btrim(regexp_replace(v_value, ''^.*:'', '''')), '''');\nexception when others then return null;\nend;\n","patched":"\ndeclare\n  v_match text[];\n  v_value text;\nbegin\n  if coalesce(p_raw, '''') = '''' or coalesce(p_cci_code, '''') = '''' then return null; end if;\n  v_match := regexp_match(\n    p_raw,\n    E''CCI\\\\+\\\\+'' || regexp_replace(p_cci_code, ''([^a-zA-Z0-9])'', E''\\\\\\\\\\\\1'', ''g'') || E''[^'''']*''''[[:space:]]*CAV\\\\+([^+''''\\\\r\\\\n]+)''\n  );\n  v_value := nullif(btrim(v_match[1]), '''');\n  if v_value is null then return null; end if;\n  return nullif(btrim(regexp_replace(v_value, ''^.*:'', '''')), '''');\nexception when others then return null;\nend;\n","source_line":65826,"source_statement_sha256":"c03241f04e5c818f4a15f55e90d897f04f65976e99734abd9c65a64961dc4823","expected":{"owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","proconfig":["search_path=pg_catalog, public"],"provolatile":"i","prosecdef":false,"proisstrict":false,"proleakproof":false,"proparallel":"u","procost":100,"prorows":0,"proargnames":["p_raw","p_cci_code"],"proargmodes":null,"return_type":"text","proretset":false,"identity_arguments":"p_raw text, p_cci_code text","arguments":"p_raw text, p_cci_code text","language":"plpgsql"}},{"signature":"public.gridex_edifact_nad_element(text,text,integer)","before":"a306217032036b0272286b95cf1615bb","after":"eeda2752e19d456ac1d8c0bcbd8d9b52","original":"\ndeclare\n  v_match text[];\n  v_parts text[];\n  v_segment text;\nbegin\n  if coalesce(p_raw, '''') = '''' or coalesce(p_qualifier, '''') = '''' or p_element_index < 0 then return null; end if;\n  v_match := regexp_match(\n    p_raw,\n    ''NAD\\\\+'' || regexp_replace(p_qualifier, ''([^a-zA-Z0-9])'', ''\\\\\\1'', ''g'') || ''\\\\+([^''''\\\\r\\\\n]+)''\n  );\n  v_segment := ''NAD+'' || p_qualifier || ''+'' || coalesce(v_match[1], '''');\n  v_parts := string_to_array(v_segment, ''+'');\n  return nullif(btrim(v_parts[p_element_index + 1]), '''');\nexception when others then return null;\nend;\n","patched":"\ndeclare\n  v_match text[];\n  v_parts text[];\n  v_segment text;\nbegin\n  if coalesce(p_raw, '''') = '''' or coalesce(p_qualifier, '''') = '''' or p_element_index < 0 then return null; end if;\n  v_match := regexp_match(\n    p_raw,\n    E''NAD\\\\+'' || regexp_replace(p_qualifier, ''([^a-zA-Z0-9])'', E''\\\\\\\\\\\\1'', ''g'') || E''\\\\+([^''''\\\\r\\\\n]+)''\n  );\n  v_segment := ''NAD+'' || p_qualifier || ''+'' || coalesce(v_match[1], '''');\n  v_parts := string_to_array(v_segment, ''+'');\n  return nullif(btrim(v_parts[p_element_index + 1]), '''');\nexception when others then return null;\nend;\n","source_line":65869,"source_statement_sha256":"9b5eac85828f471b53b95e4c3d16d3ad8da4f9f7c4389c139fe4d48eb497bd94","expected":{"owner":"postgres","acl":"{postgres=X/postgres,service_role=X/postgres}","proconfig":["search_path=pg_catalog, public"],"provolatile":"i","prosecdef":false,"proisstrict":false,"proleakproof":false,"proparallel":"u","procost":100,"prorows":0,"proargnames":["p_raw","p_qualifier","p_element_index"],"proargmodes":null,"return_type":"text","proretset":false,"identity_arguments":"p_raw text, p_qualifier text, p_element_index integer","arguments":"p_raw text, p_qualifier text, p_element_index integer","language":"plpgsql"}}]'::jsonb;
BEGIN
 IF current_setting('standard_conforming_strings')<>'on' THEN
  RAISE EXCEPTION 'z02_regex_standard_conforming_strings_on_required';END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements(config) LOOP
  SELECT * INTO before_function FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(spec->>'signature');
  IF NOT FOUND THEN RAISE EXCEPTION 'z02_regex_existing_helper_required: %',spec->>'signature';END IF;
  IF md5(before_function.prosrc)=spec->>'after' THEN CONTINUE;END IF;
  SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
   'proconfig',p.proconfig,'provolatile',p.provolatile,'prosecdef',p.prosecdef,
   'proisstrict',p.proisstrict,'proleakproof',p.proleakproof,'proparallel',p.proparallel,
   'procost',p.procost,'prorows',p.prorows,'proargnames',p.proargnames,'proargmodes',p.proargmodes::text,
   'return_type',p.prorettype::regtype::text,'proretset',p.proretset,
   'identity_arguments',pg_get_function_identity_arguments(p.oid),
   'arguments',pg_get_function_arguments(p.oid),'language',l.lanname)
  INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=before_function.oid;
  IF actual IS DISTINCT FROM spec->'expected' OR md5(before_function.prosrc)IS DISTINCT FROM spec->>'before'
   OR before_function.prosrc IS DISTINCT FROM spec->>'original' THEN
   RAISE EXCEPTION 'z02_regex_existing_body_or_attributes_changed_requires_review: %',spec->>'signature';END IF;
  definition:=pg_get_functiondef(before_function.oid);
  IF strpos(definition,spec->>'original')=0 THEN RAISE EXCEPTION 'z02_regex_exact_body_required';END IF;
  EXECUTE replace(definition,spec->>'original',spec->>'patched');
  SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(spec->>'signature');
  IF (to_jsonb(after_function)-'prosrc')IS DISTINCT FROM(to_jsonb(before_function)-'prosrc')
   OR md5(after_function.prosrc)IS DISTINCT FROM spec->>'after' THEN
   RAISE EXCEPTION 'z02_regex_all_helper_identity_attributes_must_remain_exact: %',spec->>'signature';END IF;
 END LOOP;
END
$z02_regex_literals$;
NOTIFY pgrst,'reload schema';
COMMIT;
