-- Exclude superseded Swedish UTILTS25A4 from both prospective inbound
-- profile lookups after the UTILTS25A5 registry/source forward. Preserve
-- bound originals, existing receipt dates, count checks and all permissions.
BEGIN;
DO $inbound_u5_supersession$
DECLARE f record;h record;needle text;replacement text;body text;actual_body text;
BEGIN
 SELECT p.oid,p.prosrc,p.proowner,p.prosecdef,to_jsonb(p)-'prosrc' metadata,pg_get_functiondef(p.oid) definition
 INTO STRICT f FROM pg_proc p
 WHERE p.oid='public.gridex_bind_inbound_ediel_rule_pack_evidence()'::regprocedure;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'ca403a7cb7fc48dd3a3e7aa13faa5533ed8c72f909090dd9ee0f6183933db391'
 THEN RAISE EXCEPTION 'ediel_u5_inbound_selector_predecessor_required';END IF;
 SELECT p.oid,p.prosrc,p.provolatile,p.proconfig,p.pronamespace INTO STRICT h FROM pg_proc p
 WHERE p.oid='gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1(text,text,text,text,date)'::regprocedure;
 IF encode(sha256(convert_to(h.prosrc,'UTF8')),'hex') IS DISTINCT FROM 'b55425f8b59404066120fe10804a5798175e76007acacc85fc3e41eb8325c37c'
  OR h.provolatile IS DISTINCT FROM 'i'::"char" OR h.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
 THEN RAISE EXCEPTION 'ediel_u5_inbound_supersession_source_required';END IF;
 -- The existing trigger executes as its unchanged owner. Refuse installation
 -- if that owner cannot reach the private helper; add no grants or new role.
 IF f.prosecdef IS NOT TRUE
  OR has_schema_privilege(f.proowner,h.pronamespace,'USAGE') IS NOT TRUE
  OR has_function_privilege(f.proowner,h.oid,'EXECUTE') IS NOT TRUE
 THEN RAISE EXCEPTION 'ediel_u5_inbound_selector_owner_path_required';END IF;
 needle:='    and rp.status in (''active'',''future'')';
 replacement:=needle||E'\n    and NOT gridex_ediel_source_rules.pack_superseded_by_swedish_utilts25a5_v1(rp.market,rp.family,rp.guide_version,rp.guide_revision,v_effective_date)';
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>2
 THEN RAISE EXCEPTION 'ediel_u5_inbound_selector_two_predicates_required';END IF;
 body:=replace(f.prosrc,needle,replacement);
 IF replace(body,replacement,needle) IS DISTINCT FROM f.prosrc
  OR encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM 'dc9335075c4e9f622f84c89d693d347f91c93768a9c8807fcc7ab499f18f75dd'
 THEN RAISE EXCEPTION 'ediel_u5_inbound_selector_exact_inverse_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 SELECT prosrc INTO STRICT actual_body FROM pg_proc WHERE oid=f.oid;
 IF actual_body IS DISTINCT FROM body OR replace(actual_body,replacement,needle) IS DISTINCT FROM f.prosrc
  OR (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
 THEN RAISE EXCEPTION 'ediel_u5_inbound_selector_metadata_or_body_changed';END IF;
END $inbound_u5_supersession$;
COMMIT;
