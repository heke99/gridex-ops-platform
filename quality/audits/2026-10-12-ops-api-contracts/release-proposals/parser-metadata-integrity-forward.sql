-- Assertion-only forward: qualify already-correct EDIFACT/postal parser bodies and
-- complete normalized function metadata before any replay/no-op is accepted.
-- Exact actual and genuine canonical source fixtures have the same three contracts.
-- No function, owner, ACL, configuration, data, or history is changed here.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $parser_metadata_integrity$
DECLARE
 config jsonb := $parser_contracts$[{"signature":"public.gridex_edifact_cci_cav_value(text,text)","body_md5":"9c2260f2d165463bde841c6ba239fde6","expected":{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","procost":100,"prorows":0,"language":"plpgsql","arguments":"p_raw text, p_cci_code text","proconfig":["search_path=pg_catalog, public"],"proretset":false,"prosecdef":false,"proargmodes":null,"proargnames":["p_raw","p_cci_code"],"proisstrict":false,"proparallel":"u","provolatile":"i","return_type":"text","proleakproof":false,"identity_arguments":"p_raw text, p_cci_code text","probin":null,"prokind":"f","pronargs":2,"prosqlbody":null,"prosupport":"0","provariadic":"0","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"public.gridex_edifact_nad_element(text,text,integer)","body_md5":"eeda2752e19d456ac1d8c0bcbd8d9b52","expected":{"acl":"{postgres=X/postgres,service_role=X/postgres}","owner":"postgres","procost":100,"prorows":0,"language":"plpgsql","arguments":"p_raw text, p_qualifier text, p_element_index integer","proconfig":["search_path=pg_catalog, public"],"proretset":false,"prosecdef":false,"proargmodes":null,"proargnames":["p_raw","p_qualifier","p_element_index"],"proisstrict":false,"proparallel":"u","provolatile":"i","return_type":"text","proleakproof":false,"identity_arguments":"p_raw text, p_qualifier text, p_element_index integer","probin":null,"prokind":"f","pronargs":3,"prosqlbody":null,"prosupport":"0","provariadic":"0","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}},{"signature":"public.gridex_normalize_swedish_postal_code(text)","body_md5":"6da381c2dad3451762d227cb2c79fa87","expected":{"acl":"{=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","owner":"postgres","procost":100,"prorows":0,"language":"sql","arguments":"p_postal_code text","proconfig":["search_path=public, auth, extensions"],"proretset":false,"prosecdef":false,"proargmodes":null,"proargnames":["p_postal_code"],"proisstrict":false,"proparallel":"u","provolatile":"i","return_type":"text","proleakproof":false,"identity_arguments":"p_postal_code text","probin":null,"prokind":"f","pronargs":1,"prosqlbody":null,"prosupport":"0","provariadic":"0","proallargtypes":null,"proargdefaults":null,"pronargdefaults":0}}]$parser_contracts$::jsonb;
 spec jsonb;
 fn pg_catalog.pg_proc%ROWTYPE;
 actual jsonb;
 before_identity jsonb;
 after_identity jsonb;
BEGIN
 FOR spec IN SELECT value FROM jsonb_array_elements(config) LOOP
  SELECT * INTO fn FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(spec->>'signature');
  IF NOT FOUND THEN RAISE EXCEPTION 'parser_metadata_integrity_function_missing: %',spec->>'signature'; END IF;
  before_identity:=to_jsonb(fn);
  SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
   'proconfig',p.proconfig,'provolatile',p.provolatile,'prosecdef',p.prosecdef,
   'proisstrict',p.proisstrict,'proleakproof',p.proleakproof,'proparallel',p.proparallel,
   'procost',p.procost,'prorows',p.prorows,'proargnames',p.proargnames,'proargmodes',p.proargmodes::text,
   'return_type',p.prorettype::regtype::text,'proretset',p.proretset,
   'identity_arguments',pg_get_function_identity_arguments(p.oid),
   'arguments',pg_get_function_arguments(p.oid),'language',l.lanname,
   'prokind',p.prokind,'prosupport',p.prosupport::oid::text,'provariadic',p.provariadic::text,
   'pronargs',p.pronargs,'pronargdefaults',p.pronargdefaults,'proallargtypes',p.proallargtypes,
   'proargdefaults',p.proargdefaults::text,'probin',p.probin,'prosqlbody',p.prosqlbody::text)
  INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=fn.oid;
  IF actual IS DISTINCT FROM spec->'expected' THEN
   RAISE EXCEPTION 'parser_metadata_integrity_attributes_changed_requires_review: %',spec->>'signature';
  END IF;
  IF md5(fn.prosrc) IS DISTINCT FROM spec->>'body_md5' THEN
   RAISE EXCEPTION 'parser_metadata_integrity_body_changed_requires_review: %',spec->>'signature';
  END IF;
  SELECT to_jsonb(p) INTO after_identity FROM pg_catalog.pg_proc p WHERE p.oid=fn.oid;
  IF after_identity IS DISTINCT FROM before_identity THEN
   RAISE EXCEPTION 'parser_metadata_integrity_identity_changed: %',spec->>'signature';
  END IF;
 END LOOP;
END;
$parser_metadata_integrity$;
COMMIT;
