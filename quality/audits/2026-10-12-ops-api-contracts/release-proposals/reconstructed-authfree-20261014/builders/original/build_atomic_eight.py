from pathlib import Path
import sys,json,re,hashlib
sys.path.insert(0,'/tmp/gridex-api-rebuild-20261014/reconstruction-inventory/python-deps')
from pglast import parse_sql,scan
OUT=Path(__file__).parent
BASE=Path('/tmp/gridex-ops-final/quality/audits/2026-10-12-ops-api-contracts/release-proposals')
original=(BASE/'variant-extra-z02-forward.sql').read_text()
m=re.search(r"prerequisites constant jsonb := '(.*?)'::jsonb",original)
items=json.loads(m.group(1).replace("''","'"))
record=[x for x in items if x['signature']=='gridex_ediel_retention.record_permission_v1(uuid,uuid,text)']
assert len(record)==1 and record[0]['body_md5s']==['4e85ddcbe6d2ca6b1ac46067fb3023a5']
record[0]['body_md5s']=['eefef257bac12b0742e3c1d0381889b7']
replacement=json.dumps(items,separators=(',',':')).replace("'","''")
derived=original[:m.start(1)]+replacement+original[m.end(1):]
guard="""
-- Exact strong canonical record-permission prerequisite, including the full
-- ABI/owner/security/configuration/ACL and non-body pg_proc attributes.
DO $ops_z02_record_permission_exact$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure('gridex_ediel_retention.record_permission_v1(uuid,uuid,text)')
 AND p.prokind='f' AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='gridex_ediel_retention_owner')
 AND p.proargtypes=ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid]::oidvector
 AND p.pronargs=3 AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.proargnames=ARRAY['c','actor','k']::text[]
 AND p.prorettype='boolean'::regtype AND NOT p.proretset AND p.pronargdefaults=0 AND p.proargdefaults IS NULL
 AND p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
 AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND l.lanname='plpgsql' AND p.procost=100 AND p.prorows=0
 AND p.provariadic=0 AND p.prosupport=0 AND p.protrftypes IS NULL AND p.probin IS NULL AND p.prosqlbody IS NULL
 AND p.proacl=ARRAY['gridex_ediel_retention_owner=X/gridex_ediel_retention_owner']::aclitem[]
 AND md5(p.prosrc)='eefef257bac12b0742e3c1d0381889b7') THEN RAISE EXCEPTION 'ops_z02_strong_record_permission_full_metadata_required'; END IF;
END $ops_z02_record_permission_exact$;
"""
pos=derived.index('BEGIN;')+len('BEGIN;')
derived=derived[:pos]+guard+derived[pos:]
parse_sql(derived)
(OUT/'derived-z02-strong-record-prerequisite.sql').write_text(derived)

paths=[OUT/'auth-free-main-envelope.sql',BASE/'variant-part1-forward.sql',BASE/'variant-part2-forward.sql',OUT/'derived-z02-strong-record-prerequisite.sql',BASE/'variant-existing-trigger-forward.sql',BASE/'installer-capability/004-qualified-retention-install.sql',Path('/tmp/gridex-api-rebuild-20261014/finance-proposal/five-adapters-four-target-guards.sql'),BASE/'semantic-forward-metadata-integrity.sql']
def strip_tx(s):
 ast=parse_sql(s)
 if not any(type(x.stmt).__name__=='TransactionStmt' for x in ast):return s,[]
 assert type(ast[0].stmt).__name__=='TransactionStmt' and type(ast[-1].stmt).__name__=='TransactionStmt'
 assert ast[0].stmt.kind.name=='TRANS_STMT_BEGIN' and ast[-1].stmt.kind.name=='TRANS_STMT_COMMIT'
 assert sum(type(x.stmt).__name__=='TransactionStmt' for x in ast)==2
 tokens=[x for x in scan(s) if x.name not in ('SQL_COMMENT','C_COMMENT')]
 assert tokens[0].name=='BEGIN_P' and tokens[1].name=='ASCII_59'
 assert tokens[-2].name=='COMMIT' and tokens[-1].name=='ASCII_59'
 bounds=[(tokens[0].start,tokens[1].end+1),(tokens[-2].start,tokens[-1].end+1)]
 result=s
 for lo,hi in reversed(bounds):result=result[:lo]+result[hi:]
 assert [x.stmt for x in parse_sql(result)]==[x.stmt for x in ast[1:-1]]
 return result,[{'start_byte':len(s[:lo].encode()),'end_byte':len(s[:hi].encode()),'deleted':s[lo:hi]} for lo,hi in bounds]
components=[];parts=[]
for i,path in enumerate(paths,1):
 text=path.read_text();body,bounds=strip_tx(text)
 components.append({'order':i,'path':str(path),'bytes':len(text.encode()),'sha256':hashlib.sha256(text.encode()).hexdigest(),'executable_sha256':hashlib.sha256(body.encode()).hexdigest(),'transaction_tokens_removed':bounds})
 parts.append('\n-- Atomic component '+str(i)+': '+path.name+'\n'+body)
signing_snapshot="""
-- Metadata only: preserve the existing active signature API across all eight inputs.
CREATE TEMP TABLE ops_api_atomic_active_signing_before ON COMMIT DROP AS
 SELECT to_jsonb(p) AS row_value FROM pg_catalog.pg_proc p
 WHERE p.oid=to_regprocedure('public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)');
REVOKE ALL ON TABLE ops_api_atomic_active_signing_before FROM PUBLIC,anon,authenticated,service_role,authenticator;
"""
signing_preserve="""
DO $ops_atomic_active_signing_preserve$
BEGIN
 IF (SELECT count(*) FROM ops_api_atomic_active_signing_before)<>1
 OR (SELECT row_value FROM ops_api_atomic_active_signing_before) IS DISTINCT FROM
 (SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)'))
 THEN RAISE EXCEPTION 'ops_atomic_active_signing_full_row_changed'; END IF;
END $ops_atomic_active_signing_preserve$;
DROP TABLE ops_api_atomic_active_signing_before;
"""
atomic='-- New private OPS atomic eight-input proposal; not frozen A6 and not applied.\nBEGIN;\n'+signing_snapshot+''.join(parts)+signing_preserve+'\nCOMMIT;\n'
ast=parse_sql(atomic)
assert sum(type(x.stmt).__name__=='TransactionStmt' for x in ast)==2
(OUT/'atomic-eight-input-proposal.sql').write_text(atomic)
receipt={'status':'NEW_PRIVATE_PROPOSAL_NOT_REVIEWED_NOT_APPLIED','components':components,'atomic_sha256':hashlib.sha256(atomic.encode()).hexdigest(),'atomic_bytes':len(atomic.encode()),'outer_transactions':1,'stripping':'Only BEGIN/COMMIT keyword and semicolon token byte spans; complete other ASTs and comments preserved.','native_apply_performed':False,'separate_semantic_child_ledger_entries_claimed':False,'original_z02_sha256':hashlib.sha256(original.encode()).hexdigest(),'derived_z02_sha256':hashlib.sha256(derived.encode()).hexdigest(),'z02_body_pins_changed':1,'z02_full_abi_guard_added':True,'active_signing_full_pg_proc_row_preserved_across_all_eight_inputs':True,'outer_temporary_metadata_only_snapshot':True}
(OUT/'atomic-eight-input-manifest.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'atomic_sha256':receipt['atomic_sha256'],'atomic_bytes':receipt['atomic_bytes'],'components':8,'z02_sha256':receipt['derived_z02_sha256']}))
