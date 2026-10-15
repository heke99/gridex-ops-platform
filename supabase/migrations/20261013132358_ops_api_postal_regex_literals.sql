-- One existing Swedish postal normalizer: correct SQL E-string literal.
-- With standard_conforming_strings=on the older double-backslash plain pattern
-- fails to remove nondigits. No proven current app caller; exposed native helper.
-- Escape literals only; preserve every existing pg_proc attribute and public ABI.
-- No data/provider/business RPC invocation or grants; exact canonical replay inert.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $postal_regex_literals$
DECLARE spec jsonb; before_function pg_catalog.pg_proc%rowtype;
 after_function pg_catalog.pg_proc%rowtype;actual jsonb;definition text;
 config constant jsonb := '[{"signature":"public.gridex_normalize_swedish_postal_code(text)","before":"8a46c0c90010c981a5d8cd0bd041d261","after":"6da381c2dad3451762d227cb2c79fa87","original":"\n  select nullif(regexp_replace(coalesce(p_postal_code, ''''), ''\\\\D'', '''', ''g''), '''');\n","patched":"\n  select nullif(regexp_replace(coalesce(p_postal_code, ''''), E''\\\\D'', '''', ''g''), '''');\n","source_line":77110,"source_statement_sha256":"183e1c152f76c6b340b5b532417b5b746837a201408d33bf5f56ca3efeb1b73d","expected":{"owner":"postgres","acl":"{=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","proconfig":["search_path=public, auth, extensions"],"provolatile":"i","prosecdef":false,"proisstrict":false,"proleakproof":false,"proparallel":"u","procost":100,"prorows":0,"proargnames":["p_postal_code"],"proargmodes":null,"return_type":"text","proretset":false,"identity_arguments":"p_postal_code text","arguments":"p_postal_code text","language":"sql"}}]'::jsonb;
BEGIN
 IF current_setting('standard_conforming_strings')<>'on' THEN
  RAISE EXCEPTION 'postal_regex_standard_conforming_strings_on_required';END IF;
 FOR spec IN SELECT value FROM jsonb_array_elements(config) LOOP
  SELECT * INTO before_function FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(spec->>'signature');
  IF NOT FOUND THEN RAISE EXCEPTION 'postal_regex_existing_helper_required: %',spec->>'signature';END IF;
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
   RAISE EXCEPTION 'postal_regex_existing_body_or_attributes_changed_requires_review: %',spec->>'signature';END IF;
  definition:=pg_get_functiondef(before_function.oid);
  IF strpos(definition,spec->>'original')=0 THEN RAISE EXCEPTION 'postal_regex_exact_body_required';END IF;
  EXECUTE replace(definition,spec->>'original',spec->>'patched');
  SELECT * INTO STRICT after_function FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(spec->>'signature');
  IF (to_jsonb(after_function)-'prosrc')IS DISTINCT FROM(to_jsonb(before_function)-'prosrc')
   OR md5(after_function.prosrc)IS DISTINCT FROM spec->>'after' THEN
   RAISE EXCEPTION 'postal_regex_all_helper_identity_attributes_must_remain_exact: %',spec->>'signature';END IF;
 END LOOP;
END
$postal_regex_literals$;
NOTIFY pgrst,'reload schema';
COMMIT;
