from pathlib import Path
import hashlib,json,re,shutil,sys
sys.path.insert(0,'/tmp/gridex-api-rebuild-20261014/reconstruction-inventory/python-deps')
from pglast import parse_sql
out=Path(__file__).parent;old=out/'five-adapters-four-target-guards.sql';oldbytes=old.read_bytes();oldsha=hashlib.sha256(oldbytes).hexdigest();assert oldsha=='e1c684e32ae8cb7511e1451eb5ce775656a75606721d7f650772ce4b7d381cac'
prior=out/'five-adapters-four-target-guards-owner-envelope.sql';assert hashlib.sha256(prior.read_bytes()).hexdigest()=='4812ee879d0d62081cc74a495d6d67d79ad6add0d1d04e4dd18aa3f6df5f8f46'
a=out/'historical-blocked-owner-envelope-capability-closure';a.mkdir(exist_ok=True)
for f in [prior,out/'owner-envelope-manifest.json',out/'derive_owner_creation_envelope.py']:
 target=a/f.name
 if target.exists():assert target.read_bytes()==f.read_bytes()
 else:shutil.copy2(f,target)
(a/'BLOCKED-NOT-APPLIED.json').write_text(json.dumps(dict(status='SOURCE_BLOCKED_NOT_APPLIED',prior_sha256='4812ee879d0d62081cc74a495d6d67d79ad6add0d1d04e4dd18aa3f6df5f8f46',reasons=['Temporary schema creation alone does not give PG EXECUTE needed for four RET-owned target trigger creations.','Final absence of PG namespace USAGE is invalid:14PG SECURITY DEFINER functions call five private RET predicates by name.'],original_e1_and_published_037_untouched=True),indent=2)+'\n')
body=oldbytes.decode();oldatom="p.proacl::text='{gridex_ediel_retention_owner=X/gridex_ediel_retention_owner}'";newatom="p.proacl::text='{gridex_ediel_retention_owner=X/gridex_ediel_retention_owner,postgres=X/gridex_ediel_retention_owner}'";assert body.count(oldatom)==4
edits=[dict(start_byte=len(body[:m.start()].encode()),old=oldatom,new=newatom,reason='Exact owner-controlled temporary EXECUTE lease on the one target guard required to CREATE TRIGGER.') for m in re.finditer(re.escape(oldatom),body)]
body=body.replace(oldatom,newatom)
# The original standalone e1 target-function guard is checked before the lease;
# main has already installed and qualified the persistent PG-only namespace U.
m=re.search(r" IF NOT EXISTS \(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure\('gridex_ediel_retention.finance_target_guard_v1\(\)'\).*? END IF;",oldbytes.decode(),re.S);assert m
original_guard=m[0]
helpers=['gridex_ediel_retention.protected_copy_current_v1(uuid,uuid)','gridex_ediel_retention.contract_copy_source_current_v1(uuid,text,text,uuid)','gridex_ediel_retention.protected_copy_transition_v1(text,jsonb,jsonb)','gridex_ediel_retention.classification_copy_source_current_v1(uuid,uuid)','gridex_ediel_retention.contract_copy_preparation_current_v1(uuid,uuid)']
helperarray='ARRAY['+','.join("'"+x+"'" for x in helpers)+']::text[]'
opening="""-- NEW DERIVED COMPONENT7 with complete DDL and runtime namespace capability closure.
-- Published e1/037 snapshots remain unchanged. The e1 payload below changes exactly
-- four closed temporary target-function ACL guard atoms, recorded in the manifest.
-- Main must already have installed PG-only permanent namespace USAGE for the fourteen
-- named PG-definer consumers of five existing private RET predicates. This component
-- leases only CREATE and one function's EXECUTE, then restores both exact originals.
SET LOCAL search_path=pg_catalog;
DO $ops_finance_creation_capability$
DECLARE signature text;
BEGIN
 IF current_user<>'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') THEN RAISE EXCEPTION 'ops_finance_ordinary_postgres_execution_required'; END IF;
 IF NOT pg_has_role('postgres','gridex_ediel_retention_owner','MEMBER') OR NOT pg_has_role('postgres','gridex_ediel_retention_owner','SET') OR pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') THEN RAISE EXCEPTION 'ops_finance_existing_owner_set_authority_required'; END IF;
 IF NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='gridex_ediel_retention' AND nspowner=(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner') AND nspacl=ARRAY['gridex_ediel_retention_owner=UC/gridex_ediel_retention_owner','postgres=U/gridex_ediel_retention_owner']::aclitem[]) OR NOT has_schema_privilege('postgres','gridex_ediel_retention','USAGE') OR has_schema_privilege('postgres','gridex_ediel_retention','CREATE') THEN RAISE EXCEPTION 'ops_finance_main_qualified_private_namespace_usage_required'; END IF;
@ORIGINAL_TARGET_GUARD@
 FOREACH signature IN ARRAY @HELPERS@ LOOP
  IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure(signature) AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner') AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]) OR NOT has_function_privilege('postgres',signature,'EXECUTE') THEN RAISE EXCEPTION 'ops_finance_private_runtime_predicate_capability_required: %',signature; END IF;
 END LOOP;
 IF to_regclass('pg_temp.ops_finance_adapter_owner_snapshot_20261014_v2') IS NOT NULL THEN RAISE EXCEPTION 'ops_finance_private_creation_snapshot_collision'; END IF;
 CREATE TEMPORARY TABLE ops_finance_adapter_owner_snapshot_20261014_v2(namespace_metadata jsonb NOT NULL,target_function_metadata jsonb NOT NULL,role_metadata jsonb NOT NULL,memberships jsonb);
 REVOKE ALL ON TABLE pg_temp.ops_finance_adapter_owner_snapshot_20261014_v2 FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_retention_owner;
 INSERT INTO pg_temp.ops_finance_adapter_owner_snapshot_20261014_v2
 SELECT (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.nspname='gridex_ediel_retention'),
 (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('gridex_ediel_retention.finance_target_guard_v1()')),
 (SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) FROM pg_roles r WHERE r.rolname IN('postgres','gridex_ediel_retention_owner')),
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) FROM pg_auth_members m WHERE m.roleid IN((SELECT oid FROM pg_roles WHERE rolname='postgres'),(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner')) OR m.member IN((SELECT oid FROM pg_roles WHERE rolname='postgres'),(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner')));
END $ops_finance_creation_capability$;

SET LOCAL ROLE gridex_ediel_retention_owner;
GRANT CREATE ON SCHEMA gridex_ediel_retention TO postgres;
GRANT EXECUTE ON FUNCTION gridex_ediel_retention.finance_target_guard_v1() TO postgres;
SET LOCAL ROLE postgres;
DO $ops_finance_creation_capability_active$
DECLARE original record;
BEGIN
 SELECT * INTO STRICT original FROM pg_temp.ops_finance_adapter_owner_snapshot_20261014_v2;
 IF current_user<>'postgres' OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.nspname='gridex_ediel_retention') IS DISTINCT FROM (original.namespace_metadata||jsonb_build_object('nspacl',ARRAY['gridex_ediel_retention_owner=UC/gridex_ediel_retention_owner','postgres=UC/gridex_ediel_retention_owner']::aclitem[])) THEN RAISE EXCEPTION 'ops_finance_exact_temporary_creation_grant_required'; END IF;
 IF (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('gridex_ediel_retention.finance_target_guard_v1()')) IS DISTINCT FROM (original.target_function_metadata||jsonb_build_object('proacl',ARRAY['gridex_ediel_retention_owner=X/gridex_ediel_retention_owner','postgres=X/gridex_ediel_retention_owner']::aclitem[])) THEN RAISE EXCEPTION 'ops_finance_exact_temporary_target_execute_grant_required'; END IF;
END $ops_finance_creation_capability_active$;

-- BEGIN derived e1 payload (only the four recorded ACL guard atoms differ).
""".replace('@ORIGINAL_TARGET_GUARD@',original_guard).replace('@HELPERS@',helperarray)
closing="""
-- END derived e1 payload.
SET LOCAL ROLE gridex_ediel_retention_owner;
REVOKE EXECUTE ON FUNCTION gridex_ediel_retention.finance_target_guard_v1() FROM postgres;
REVOKE CREATE ON SCHEMA gridex_ediel_retention FROM postgres;
SET LOCAL ROLE postgres;
DO $ops_finance_creation_capability_restored$
DECLARE original record;observed_roles jsonb;observed_memberships jsonb;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM pg_temp.ops_finance_adapter_owner_snapshot_20261014_v2)<>1 THEN RAISE EXCEPTION 'ops_finance_creation_restore_snapshot_required'; END IF;
 SELECT * INTO STRICT original FROM pg_temp.ops_finance_adapter_owner_snapshot_20261014_v2;
 SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.oid) INTO observed_roles FROM pg_roles r WHERE r.rolname IN('postgres','gridex_ediel_retention_owner');
 SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) INTO observed_memberships FROM pg_auth_members m WHERE m.roleid IN((SELECT oid FROM pg_roles WHERE rolname='postgres'),(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner')) OR m.member IN((SELECT oid FROM pg_roles WHERE rolname='postgres'),(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner'));
 IF (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.nspname='gridex_ediel_retention') IS DISTINCT FROM original.namespace_metadata OR (SELECT to_jsonb(p) FROM pg_proc p WHERE p.oid=to_regprocedure('gridex_ediel_retention.finance_target_guard_v1()')) IS DISTINCT FROM original.target_function_metadata OR observed_roles IS DISTINCT FROM original.role_metadata OR observed_memberships IS DISTINCT FROM original.memberships THEN RAISE EXCEPTION 'ops_finance_schema_function_owner_capability_exact_restore_failed'; END IF;
 IF NOT has_schema_privilege('postgres','gridex_ediel_retention','USAGE') OR has_schema_privilege('postgres','gridex_ediel_retention','CREATE') OR has_function_privilege('postgres','gridex_ediel_retention.finance_target_guard_v1()','EXECUTE') THEN RAISE EXCEPTION 'ops_finance_qualified_runtime_or_temporary_capability_restore_failed'; END IF;
 DROP TABLE pg_temp.ops_finance_adapter_owner_snapshot_20261014_v2 RESTRICT;
END $ops_finance_creation_capability_restored$;
"""
source=opening+body+closing;new=out/'five-adapters-four-target-guards-qualified-runtime-envelope.sql';new.write_text(source);ast=parse_sql(source)
assert not any(type(x.stmt).__name__=='TransactionStmt' and x.stmt.kind.name in('TRANS_STMT_BEGIN','TRANS_STMT_COMMIT') for x in ast)
# Reverse only the four explicit ACL atoms to recover the immutable e1 bytes.
assert body.replace(newatom,oldatom).encode()==oldbytes
inventory=json.loads(Path('/tmp/gridex-api-rebuild-20261014/reconstruction-inventory/reconstruction-inventory.json').read_text());refs={k:v for k,v in inventory['private_postgres_consumer_references'].items() if k!='gridex_ediel_retention.actor_v1'};assert sum(map(len,refs.values()))==14
manifest=dict(status='NEW_PRIVATE_QUALIFIED_RUNTIME_ENVELOPE_NOT_APPLIED_NOT_RUNTIME_QUALIFIED',new_source_path=str(new),new_source_sha256=hashlib.sha256(new.read_bytes()).hexdigest(),new_source_bytes=len(new.read_bytes()),original_finance_source_sha256=oldsha,original_finance_source_unchanged=True,derived_e1_body_sha256=hashlib.sha256(body.encode()).hexdigest(),derived_e1_body_bytes=len(body.encode()),exact_derived_guard_atom_edits=edits,grants=dict(required_from_main='Persistent postgres-only private namespace USAGE granted by RET owner, synchronized with complete-state manifest and cold/known-weak/strong-replay preflight.',temporary_schema=['CREATE to postgres'],temporary_function=['EXECUTE finance_target_guard_v1() to postgres'],introduced_permanent_schema_grants=[],introduced_app_or_auth_grants=[],role_membership_changes=False),restoration='Whole namespace pg_namespace row, whole target pg_proc row, PG/RET role attributes and their membership rows exactly restored; main PG-only namespace U survives, temporary CREATE and target EXECUTE do not.',runtime_five_private_predicates=helpers,runtime_fourteen_pg_definer_consumers=refs,capability_closure='Named private function lookup needs PG namespace U as well as PG EXECUTE; each of five callees is RET-owned SECURITY DEFINER with pg_catalog search_path. Four CREATE TRIGGER statements additionally need temporary target-function EXECUTE. Five new PG-owned private adapters retain exact ordinary source/security/config/owner and closed ACL.',prior_4812_blocked=True,published_037_and_e1_unchanged=True,qualification_required=['whole new atomic source two independent SOURCE reviews','genuine first commit and strong replay','exact target function/schema/role/membership restoration','all16targetguards and11bindings','late full rollback and metadata refusals'])
(out/'qualified-runtime-envelope-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(dict(source_sha256=manifest['new_source_sha256'],bytes=manifest['new_source_bytes'],manifest_sha256=hashlib.sha256((out/'qualified-runtime-envelope-manifest.json').read_bytes()).hexdigest(),guard_atoms_changed=len(edits),sql_statements=len(ast))))
