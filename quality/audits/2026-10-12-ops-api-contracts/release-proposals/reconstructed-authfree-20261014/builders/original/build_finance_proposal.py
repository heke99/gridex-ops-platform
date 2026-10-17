import json,re,hashlib,pathlib
root=pathlib.Path('/tmp/gridex-api-rebuild-20261014/finance-proposal')
src=pathlib.Path('/tmp/gridex-ops-final/quality/audits/2026-10-12-ops-api-contracts/release-proposals/native-additive-reconciliation.sql')
b3=src.read_text(); rows=json.loads((root/'five-native-bound-functions.json').read_text())
q=lambda s:"'"+s.replace("'","''")+"'"
j=lambda x:q(json.dumps(x,separators=(',',':')))+'::jsonb'
fm="""jsonb_build_object('owner',pg_get_userbyid(p.proowner),'def_md5',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'cost',p.procost,'rows',p.prorows,'strict',p.proisstrict,'leakproof',p.proleakproof,'support',p.prosupport::text,'secdef',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'kind',p.prokind,'config',p.proconfig)"""
tm="""jsonb_build_object('type',t.tgtype,'enabled',t.tgenabled,'args',encode(t.tgargs,'hex'),'attr',t.tgattr::text,'qual',pg_get_expr(t.tgqual,t.tgrelid),'constraint',t.tgconstraint<>0,'deferrable',t.tgdeferrable,'initdeferred',t.tginitdeferred,'constrrel',CASE WHEN t.tgconstrrelid=0 THEN NULL ELSE t.tgconstrrelid::regclass::text END,'parent',t.tgparentid<>0,'oldtable',t.tgoldtable,'newtable',t.tgnewtable)"""
gate="""BEGIN IF TG_OP='UPDATE' THEN IF pg_catalog.has_function_privilege(current_user,'public.ediel_is_qualified_finance_retention_transition_v1(text,text,jsonb,jsonb)','EXECUTE') THEN IF public.ediel_is_qualified_finance_retention_transition_v1(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) IS TRUE THEN RETURN NEW; END IF; END IF; END IF;"""
out=['-- DERIVED PRIVATE PROPOSAL. Not applied; requires installer qualification and two reviews.','-- Reconstruct canonical 20261001070000 per-binding adapters without public body changes.','SET LOCAL search_path=pg_catalog;', 'LOCK TABLE public.billing_export_run_items, public.billing_underlays, public.partner_exports, public.customer_invoice_lines, public.invoice_dead_letters, public.portfolio_settlement_audit_log, public.portfolio_settlement_invoice_bindings IN ACCESS EXCLUSIVE MODE;']
manifest=[]
for r in rows:
 name='finance_guard_api_'+hashlib.md5((r['table']+'.'+r['trigger']).encode()).hexdigest(); sig='gridex_ediel_retention.'+name+'()'
 body,n=re.subn(r'\bBEGIN\b',lambda _:gate,r['body'],count=1,flags=re.I);assert n==1
 definition=r['def'].replace('CREATE OR REPLACE FUNCTION '+r['function'],'CREATE FUNCTION '+sig).replace(r['body'],body)
 assert 'CREATE FUNCTION '+sig in definition
 definition=definition.rstrip()+';'
 trigger=re.sub(r'EXECUTE (?:FUNCTION|PROCEDURE) .*$', 'EXECUTE FUNCTION '+sig+'()',r['trigger_def']) if False else re.sub(r'EXECUTE (?:FUNCTION|PROCEDURE) .*$', 'EXECUTE FUNCTION '+sig,r['trigger_def'])
 # Unknown original function or trigger metadata must fail, including replay.
 block=f"""DO $finance_adapter$
DECLARE observed jsonb; bound oid;
BEGIN
 SELECT {fm} INTO observed FROM pg_proc p WHERE p.oid=to_regprocedure({q(r['function'])});
 IF observed IS DISTINCT FROM {j(r['function_meta'])} THEN RAISE EXCEPTION 'ops_finance_original_function_metadata_unknown: %',{q(r['function'])}; END IF;
 SELECT {tm},t.tgfoid INTO observed,bound FROM pg_trigger t WHERE t.tgrelid={q(r['table'])}::regclass AND t.tgname={q(r['trigger'])} AND NOT t.tgisinternal;
 IF observed IS DISTINCT FROM {j(r['trigger_meta'])} OR (bound IS DISTINCT FROM to_regprocedure({q(r['function'])})::oid AND bound IS DISTINCT FROM to_regprocedure({q(sig)})::oid) THEN RAISE EXCEPTION 'ops_finance_trigger_metadata_unknown: %',{q(r['table']+'.'+r['trigger'])}; END IF;
 IF to_regprocedure({q(sig)}) IS NULL THEN
  EXECUTE {q(definition)};
  EXECUTE 'ALTER FUNCTION {sig} OWNER TO postgres';
  EXECUTE 'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_retention_owner';
 END IF;
 SELECT jsonb_build_object('body_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'secdef',p.prosecdef,'config',p.proconfig,'cost',p.procost,'rows',p.prorows,'strict',p.proisstrict,'leakproof',p.proleakproof,'support',p.prosupport::text,'volatility',p.provolatile,'parallel',p.proparallel,'acl',p.proacl::text,'kind',p.prokind,'args',p.pronargs,'rettype',p.prorettype::regtype::text,'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),'bin',p.probin,'allargtypes',p.proallargtypes,'argmodes',p.proargmodes,'argnames',p.proargnames,'argdefaults',p.proargdefaults::text,'trftypes',p.protrftypes,'sqlbody',p.prosqlbody::text) INTO observed FROM pg_proc p WHERE p.oid=to_regprocedure({q(sig)});
 IF observed IS DISTINCT FROM EXPECTED_WRAPPER THEN RAISE EXCEPTION 'ops_finance_private_adapter_metadata_unknown: %',{q(sig)}; END IF;
 IF bound=to_regprocedure({q(r['function'])})::oid THEN
  EXECUTE {q('DROP TRIGGER '+r['trigger']+' ON '+r['table'])};
  EXECUTE {q(trigger)};
 END IF;
 SELECT {tm},t.tgfoid INTO observed,bound FROM pg_trigger t WHERE t.tgrelid={q(r['table'])}::regclass AND t.tgname={q(r['trigger'])} AND NOT t.tgisinternal;
 IF observed IS DISTINCT FROM {j(r['trigger_meta'])} OR bound IS DISTINCT FROM to_regprocedure({q(sig)})::oid THEN RAISE EXCEPTION 'ops_finance_adapter_binding_postcheck_failed: %',{q(sig)}; END IF;
 SELECT {fm} INTO observed FROM pg_proc p WHERE p.oid=to_regprocedure({q(r['function'])});
 IF observed IS DISTINCT FROM {j(r['function_meta'])} THEN RAISE EXCEPTION 'ops_finance_original_function_preservation_failed: %',{q(r['function'])}; END IF;
END
$finance_adapter$;"""
 expected={k:v for k,v in r['function_meta'].items() if k not in ('def_md5','owner','acl')};expected.update(body_md5=hashlib.md5(body.encode()).hexdigest(),owner='postgres',acl='{postgres=X/postgres}',args=0,rettype='trigger',language='plpgsql',bin=None,allargtypes=None,argmodes=None,argnames=None,argdefaults=None,trftypes=None,sqlbody=None)
 # Numeric JSON equality treats int and float equally.
 block=block.replace('EXPECTED_WRAPPER',j(expected));out.append(block)
 manifest.append(dict(table=r['table'],trigger=r['trigger'],original_function=r['function'],original_body_md5=hashlib.md5(r['body'].encode()).hexdigest(),adapter=sig,adapter_body_md5=expected['body_md5'],trigger_metadata=r['trigger_meta'],original_function_metadata=r['function_meta'],adapter_expected_metadata=expected))
missing=['customer_invoice_lines','invoice_dead_letters','portfolio_settlement_audit_log','portfolio_settlement_invoice_bindings']
for table in missing:
 out.append(f"""DO $finance_target$
DECLARE observed jsonb;bound oid;
BEGIN
 IF NOT EXISTS (SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('gridex_ediel_retention.finance_target_guard_v1()') AND md5(p.prosrc)='186bb662ed1d3fc2f872fb7a11786808' AND pg_get_userbyid(p.proowner)='gridex_ediel_retention_owner' AND p.prosecdef AND p.prokind='f' AND p.prorettype='trigger'::regtype AND p.pronargs=0 AND p.procost=100 AND p.prorows=0 AND NOT p.proisstrict AND NOT p.proleakproof AND p.prosupport=0 AND p.provolatile='v' AND p.proparallel='u' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND p.proacl::text='{{gridex_ediel_retention_owner=X/gridex_ediel_retention_owner}}') THEN RAISE EXCEPTION 'ops_finance_target_function_metadata_unknown'; END IF;
 IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.{table}'::regclass AND tgname='zz_finance_retention_target') THEN
  CREATE TRIGGER zz_finance_retention_target BEFORE INSERT OR DELETE OR UPDATE ON public.{table} FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.finance_target_guard_v1();
 END IF;
 SELECT {tm},t.tgfoid INTO observed,bound FROM pg_trigger t WHERE t.tgrelid='public.{table}'::regclass AND t.tgname='zz_finance_retention_target' AND NOT t.tgisinternal;
 IF observed IS DISTINCT FROM {j(dict(type=31,enabled='O',args='',attr='',qual=None,constraint=False,deferrable=False,initdeferred=False,constrrel=None,parent=False,oldtable=None,newtable=None))} OR bound IS DISTINCT FROM to_regprocedure('gridex_ediel_retention.finance_target_guard_v1()')::oid THEN RAISE EXCEPTION 'ops_finance_target_metadata_unknown: public.{table}'; END IF;
END
$finance_target$;""")

# Exact final aggregate: all sixteen canonical targets and all eleven reviewed bindings.
canonical_tables=re.findall(r"^ \('[^']+','([^']+)','([^']+)'",pathlib.Path('/tmp/gridex-ops-final/supabase/migrations/20261001070000_ediel_finance_copy_class_retention.sql').read_text(),re.M)
assert len(canonical_tables)==16
binding_lines=[x for x in b3.splitlines() if re.match(r'CREATE (?:OR REPLACE )?TRIGGER ',x) and 'EXECUTE FUNCTION gridex_ediel_retention.finance_guard_' in x]
assert len(binding_lines)==6
for r,a in zip(rows,manifest):
 binding_lines.append(re.sub(r'EXECUTE (?:FUNCTION|PROCEDURE) .*$', 'EXECUTE FUNCTION '+a['adapter'],r['trigger_def'])+';')
assert len(binding_lines)==11
checks=[]
for schema,table in canonical_tables:
 definition=f'CREATE TRIGGER zz_finance_retention_target BEFORE INSERT OR DELETE OR UPDATE ON {schema}.{table} FOR EACH ROW EXECUTE FUNCTION gridex_ediel_retention.finance_target_guard_v1()'
 checks.append((schema+'.'+table,'zz_finance_retention_target',definition))
for line in binding_lines:
 m=re.match(r'CREATE (?:OR REPLACE )?TRIGGER (\w+) .* ON ([\w.]+) FOR EACH ROW ',line);assert m,line
 checks.append((m[2],m[1],line.replace('CREATE OR REPLACE TRIGGER','CREATE TRIGGER').rstrip(';')))
values=','.join('('+','.join(q(x) for x in row)+')' for row in checks)
out.append(f"""DO $finance_all_postcheck$
DECLARE spec record; actual text;
BEGIN
 FOR spec IN SELECT * FROM (VALUES {values}) expected(relation_name,trigger_name,definition) LOOP
  SELECT pg_get_triggerdef(t.oid) INTO actual FROM pg_trigger t WHERE t.tgrelid=spec.relation_name::regclass AND t.tgname=spec.trigger_name AND NOT t.tgisinternal AND t.tgenabled='O' AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgconstraint=0 AND t.tgparentid=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL;
  IF actual IS DISTINCT FROM spec.definition THEN RAISE EXCEPTION 'ops_finance_complete_binding_postcheck_failed: %.%',spec.relation_name,spec.trigger_name; END IF;
 END LOOP;
END
$finance_all_postcheck$;""")

text='\n\n'.join(out)+'\n';path=root/'five-adapters-four-target-guards.sql';path.write_text(text)
(root/'manifest.json').write_text(json.dumps(dict(status='PRIVATE_DERIVED_NOT_APPLIED_NOT_RUNTIME_QUALIFIED',source_sha256=hashlib.sha256(src.read_bytes()).hexdigest(),canonical_migration='/tmp/gridex-ops-final/supabase/migrations/20261001070000_ediel_finance_copy_class_retention.sql',sql_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),sql_bytes=len(path.read_bytes()),adapters=manifest,target_tables=missing,expected_total_target_guards=16,expected_total_adapter_bindings=11),indent=2)+'\n')
print(path,len(path.read_bytes()),hashlib.sha256(path.read_bytes()).hexdigest())
