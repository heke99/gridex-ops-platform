-- Actual CLI 2.101.0 identity 20260911114443. Immediate private boundary only.
-- Later company ownership, authority helpers and application convergence remain separate.
DO $alignment$
DECLARE item text; role_name text; col text; row record;
BEGIN
 IF current_user<>'postgres' OR current_setting('transaction_isolation')<>'read committed'
 OR to_regclass('pg_temp.alignment_context') IS NULL
 OR to_regclass('pg_temp.alignment_reference') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_CONTEXT_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM pg_temp.alignment_context c JOIN pg_temp.alignment_reference r
 ON c.hashes=r.hashes AND c.token=r.token WHERE c.database_name=current_database()
 AND c.backend=pg_backend_pid() AND c.txid=txid_current() AND c.stage='C'
 AND cardinality(c.hashes)=5
 AND c.hashes[2]='e7be5cf935817846dcbe65e64c3b3d558d5e442c9bf7f7af5863f2180f108f04'
 AND c.hashes[3]='afd5c2693cbb1a9f9bd40055cd993189e0118d4871bbb2bfcfb18e4124c2fcb2'
 AND c.hashes[4]='5a4a2326232ab847d23fed32af2be13a046ee3e3a2dae41dead6f5b4eba16472')<>1 THEN
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_CONTEXT_REQUIRED';
 END IF;
 FOREACH item IN ARRAY ARRAY['alignment_context','alignment_reference'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass('pg_temp.'||item)
   AND relnamespace=pg_my_temp_schema() AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
   AND relacl IS NULL) THEN
   RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='ALIGNMENT_CONTEXT_REQUIRED';
  END IF;
 END LOOP;
 -- Exact selected fifteen-name source body, independently admitted before mutation.
 EXECUTE 'CREATE OR REPLACE VIEW public.gridex_debug_step1_2_schema_alignment_v AS '||
  (SELECT diagnostic_definition FROM pg_temp.alignment_reference);
 -- C retains its historical TABLE role result; no unavailable later helper is imported.
 FOREACH item IN ARRAY ARRAY['gridex_debug_column_exists(text,text)',
  'gridex_get_user_roles(uuid)','gridex_get_user_permission_overrides(uuid)',
  'admin_customer_latest_contract_counts(text,text)',
  'ediel_resolve_message_rule(text,text,text,text,date)',
  'ediel_resolve_inbound_message_rules(text,text,text,date)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC',item);
  FOR row IN SELECT rolname FROM pg_roles WHERE oid<>
   (SELECT proowner FROM pg_proc WHERE oid=('public.'||item)::regprocedure) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I',item,row.rolname);
  END LOOP;
 END LOOP;
 ALTER VIEW public.gridex_debug_batch2_rbac_v SET (security_invoker=true);
 FOR role_name IN SELECT 'PUBLIC' UNION ALL SELECT quote_ident(rolname) FROM pg_roles
  WHERE oid<>(SELECT relowner FROM pg_class WHERE oid='public.gridex_debug_batch2_rbac_v'::regclass) LOOP
  EXECUTE 'REVOKE ALL ON TABLE public.gridex_debug_batch2_rbac_v FROM '||role_name;
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.gridex_debug_batch2_rbac_v'::regclass
   AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE format('REVOKE ALL (%I) ON TABLE public.gridex_debug_batch2_rbac_v FROM %s',col,role_name);
  END LOOP;
 END LOOP;
 UPDATE pg_temp.alignment_context SET stage='W';
END $alignment$;
