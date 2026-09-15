"""Remove only the owned lifecycle fixture through one genuine CLI ledger entry.

The fixture starts as lifecycle.FIRST. June 11 adds its otherwise absent RLS
policy and revokes PUBLIC/anon; June 12 wraps auth.uid in an initplan. Those
exact sources determine the admitted policy, not a captured arbitrary predicate.
Temporary expected metadata is created and removed in the same CLI transaction.
Any other final shape fails closed pending native evidence. Application rows,
including classification/audit rows mentioning this fixture, remain untouched.
This is synthetic cleanup, not a canonical source or schema/type acceptance.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
from types import SimpleNamespace

import canonical_native_historical_prefix as p
import canonical_native_timestamp_runtime as timestamp

ROOT = Path(__file__).resolve().parents[1]
TABLE = 'public.gridex_native_lifecycle_probe'
POLICY = 'gridex_linter_platform_only'
POLICY_KEY = 'policy/'+TABLE+'/'+POLICY
BASE_KEYS = ('relation/'+TABLE, 'column/'+TABLE+'/id',
             'constraint/'+TABLE+'/gridex_native_lifecycle_probe_pkey',
             'index/public.gridex_native_lifecycle_probe_pkey')
ROW_HASH = hashlib.md5(b'{"id": 1}').hexdigest()
PINS = {
    'supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql':
        'b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1',
    'supabase/migrations/20260612123000_performance_batches_1_to_3_db_acceleration.sql':
        '1711c1f0fb6a50a453db3c66c554c0a0bcd2d4c0b63f96996254707e05ea93a1',
}
POST = b"\nDO $cleanup_fault$ BEGIN RAISE EXCEPTION 'NATIVE_CLEANUP_POST_BODY' USING ERRCODE='PC001'; END $cleanup_fault$;\n"
POST_ERROR = b'ERROR: NATIVE_CLEANUP_POST_BODY (SQLSTATE PC001)'
LEDGER_ERROR = b'ERROR: NATIVE_CLEANUP_LEDGER_FAULT (SQLSTATE PC002)'
ABSENT = "to_regclass('public.gridex_native_lifecycle_probe') IS NULL"
GUARD_DROP = """BEGIN;
DROP TRIGGER gridex_native_cleanup_guard ON supabase_migrations.schema_migrations;
DROP FUNCTION gridex_native_cleanup_guard.reject_ledger();
DROP SCHEMA gridex_native_cleanup_guard;
SELECT to_json(true); COMMIT;
"""

# Explicit intrinsic closure: table, its single primary constraint/index, row and
# array types, and the one source-qualified policy. RESTRICT alone is not enough:
# an unknown AUTO dependent could otherwise disappear together with this table.
CLOSURE = """WITH root AS (SELECT c.oid,c.reltype,t.typarray FROM pg_class c
 JOIN pg_type t ON t.oid=c.reltype WHERE c.oid='public.gridex_native_lifecycle_probe'::regclass),
 owned(classid,objid) AS (
 SELECT 'pg_class'::regclass,oid FROM root UNION ALL
 SELECT 'pg_class'::regclass,indexrelid FROM pg_index WHERE indrelid=(SELECT oid FROM root) UNION ALL
 SELECT 'pg_constraint'::regclass,oid FROM pg_constraint WHERE conrelid=(SELECT oid FROM root) UNION ALL
 SELECT 'pg_type'::regclass,reltype FROM root UNION ALL SELECT 'pg_type'::regclass,typarray FROM root UNION ALL
 SELECT 'pg_policy'::regclass,oid FROM pg_policy WHERE polrelid=(SELECT oid FROM root))
"""
BODY = """LOCK TABLE public.gridex_native_lifecycle_probe IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE gridex_native_cleanup_shape (id integer PRIMARY KEY);
CREATE POLICY gridex_linter_platform_only ON pg_temp.gridex_native_cleanup_shape
 FOR ALL TO authenticated USING (__POLICY__) WITH CHECK (__POLICY__);
DO $cleanup_shape$
DECLARE target oid := 'public.gridex_native_lifecycle_probe'::regclass;
 expected oid := 'pg_temp.gridex_native_cleanup_shape'::regclass;
BEGIN
 IF NOT EXISTS (SELECT FROM pg_class c WHERE c.oid=target AND c.relkind='r'
  AND c.relowner='postgres'::regrole AND c.relpersistence='p' AND c.relrowsecurity
  AND NOT c.relforcerowsecurity AND NOT c.relispartition AND c.reltoastrelid=0
  AND c.reloptions IS NULL AND c.reltablespace=0 AND c.relreplident='d'
  AND c.relam=(SELECT oid FROM pg_am WHERE amname='heap') AND c.relnatts=1)
  OR (SELECT count(*) FROM pg_attribute WHERE attrelid=target AND attnum>0)<>1
  OR NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid=target AND attnum=1 AND attname='id'
   AND atttypid='integer'::regtype AND atttypmod=-1 AND attnotnull AND NOT attisdropped
   AND NOT atthasdef AND attidentity='' AND attgenerated='' AND attcollation=0
   AND attacl IS NULL AND attoptions IS NULL AND attfdwoptions IS NULL)
  OR EXISTS (SELECT FROM pg_attrdef WHERE adrelid=target)
  OR EXISTS (SELECT FROM pg_trigger WHERE tgrelid=target)
  OR EXISTS (SELECT FROM pg_rewrite WHERE ev_class=target)
  OR EXISTS (SELECT FROM pg_inherits WHERE inhrelid=target OR inhparent=target)
  OR EXISTS (SELECT FROM pg_seclabel WHERE classoid='pg_class'::regclass AND objoid=target)
  OR EXISTS (SELECT FROM pg_description WHERE classoid='pg_class'::regclass AND objoid=target)
  OR (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.gridex_native_lifecycle_probe t)
       IS DISTINCT FROM '[{"id":1}]'::jsonb
 THEN RAISE EXCEPTION 'NATIVE_CLEANUP_SHAPE' USING ERRCODE='PC009'; END IF;

 IF (SELECT count(*) FROM pg_constraint WHERE conrelid=target)<>1
  OR NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid=target
   AND conname='gridex_native_lifecycle_probe_pkey' AND contype='p' AND conkey=ARRAY[1]::smallint[]
   AND convalidated AND NOT condeferrable AND NOT condeferred AND conislocal AND coninhcount=0
   AND pg_get_constraintdef(oid,false)='PRIMARY KEY (id)')
  OR (SELECT count(*) FROM pg_index WHERE indrelid=target)<>1
  OR (SELECT to_jsonb(i)-'indexrelid'-'indrelid' FROM pg_index i WHERE indrelid=target)
     IS DISTINCT FROM (SELECT to_jsonb(i)-'indexrelid'-'indrelid' FROM pg_index i WHERE indrelid=expected)
  OR NOT EXISTS (SELECT FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid
    JOIN pg_constraint k ON k.conindid=c.oid WHERE i.indrelid=target AND k.conrelid=target
    AND c.relname='gridex_native_lifecycle_probe_pkey' AND c.relkind='i'
    AND c.relowner='postgres'::regrole AND c.reloptions IS NULL AND c.relacl IS NULL
    AND c.reltablespace=0 AND c.relam=(SELECT oid FROM pg_am WHERE amname='btree'))
 THEN RAISE EXCEPTION 'NATIVE_CLEANUP_PRIMARY_KEY' USING ERRCODE='PC009'; END IF;

 IF (SELECT count(*) FROM pg_class c,LATERAL aclexplode(c.relacl) a WHERE c.oid=target)<>24
  OR EXISTS (SELECT FROM pg_class c,LATERAL aclexplode(c.relacl) a WHERE c.oid=target
   AND (a.grantor<>'postgres'::regrole OR a.grantee NOT IN
       ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
    OR a.is_grantable OR a.privilege_type NOT IN
       ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')))
  OR (SELECT count(DISTINCT (a.grantee,a.privilege_type)) FROM pg_class c,
     LATERAL aclexplode(c.relacl) a WHERE c.oid=target)<>24
 THEN RAISE EXCEPTION 'NATIVE_CLEANUP_ACL' USING ERRCODE='PC009'; END IF;

 IF (SELECT count(*) FROM pg_policy WHERE polrelid=target)<>1
  OR (SELECT jsonb_build_array(polname,polcmd,polpermissive,polroles,
      pg_get_expr(polqual,polrelid,false),pg_get_expr(polwithcheck,polrelid,false))
      FROM pg_policy WHERE polrelid=target)
     IS DISTINCT FROM (SELECT jsonb_build_array(polname,polcmd,polpermissive,polroles,
      pg_get_expr(polqual,polrelid,false),pg_get_expr(polwithcheck,polrelid,false))
      FROM pg_policy WHERE polrelid=expected)
 THEN RAISE EXCEPTION 'NATIVE_CLEANUP_POLICY' USING ERRCODE='PC009'; END IF;
END $cleanup_shape$;
DO $cleanup_dependencies$ BEGIN
 IF EXISTS (__CLOSURE__ SELECT FROM pg_depend d JOIN owned r
   ON r.classid=d.refclassid AND r.objid=d.refobjid
   WHERE NOT EXISTS (SELECT FROM owned o WHERE o.classid=d.classid AND o.objid=d.objid))
 OR EXISTS (__CLOSURE__ SELECT FROM pg_depend d JOIN owned o
   ON o.classid=d.classid AND o.objid=d.objid
   WHERE NOT EXISTS (SELECT FROM owned r WHERE r.classid=d.refclassid AND r.objid=d.refobjid)
   AND NOT (d.refclassid='pg_namespace'::regclass AND d.refobjid='public'::regnamespace AND d.deptype='n')
   AND NOT (d.classid='pg_policy'::regclass AND EXISTS (
    SELECT FROM pg_depend e JOIN pg_policy ep ON e.classid='pg_policy'::regclass AND e.objid=ep.oid
    WHERE ep.polrelid='pg_temp.gridex_native_cleanup_shape'::regclass
     AND (e.refclassid,e.refobjid,e.refobjsubid,e.deptype)=(d.refclassid,d.refobjid,d.refobjsubid,d.deptype))))
 OR EXISTS (__CLOSURE__ SELECT FROM pg_shdepend d JOIN owned o
   ON o.classid=d.classid AND o.objid=d.objid
   WHERE d.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND (d.refclassid<>'pg_authid'::regclass OR d.refobjid NOT IN
      ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)))
 OR EXISTS (__CLOSURE__ SELECT FROM pg_description d JOIN owned o ON o.classid=d.classoid AND o.objid=d.objoid)
 OR EXISTS (__CLOSURE__ SELECT FROM pg_seclabel d JOIN owned o ON o.classid=d.classoid AND o.objid=d.objoid)
 OR EXISTS (__CLOSURE__ SELECT FROM pg_type t JOIN owned o ON o.classid='pg_type'::regclass AND o.objid=t.oid
   WHERE t.typacl IS NOT NULL OR t.typowner<>'postgres'::regrole)
 THEN RAISE EXCEPTION 'NATIVE_CLEANUP_DEPENDENCY' USING ERRCODE='PC009'; END IF;
END $cleanup_dependencies$;
DROP TABLE pg_temp.gridex_native_cleanup_shape RESTRICT;
DROP TABLE public.gridex_native_lifecycle_probe RESTRICT;
DO $cleanup_absent$ BEGIN
 IF to_regclass('public.gridex_native_lifecycle_probe') IS NOT NULL THEN
  RAISE EXCEPTION 'NATIVE_CLEANUP_ABSENCE' USING ERRCODE='PC009'; END IF;
END $cleanup_absent$;
"""

# The only variable identities returned are dependencies of this fixed policy.
# Their definitions and dependency edges are independently admitted inside BODY.
DEPENDENCIES = """SELECT coalesce(jsonb_agg('dependency/'||pg_describe_object(d.classid,d.objid,d.objsubid)||'/'||
 pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)||'/'||d.deptype::text ORDER BY d.refclassid,d.refobjid,d.refobjsubid),'[]')
 FROM pg_depend d JOIN pg_policy pol ON d.classid='pg_policy'::regclass AND d.objid=pol.oid
 WHERE pol.polrelid='public.gridex_native_lifecycle_probe'::regclass AND pol.polname='gridex_linter_platform_only';"""


def program():
    retained=[]
    for name, sha in PINS.items():
        path=ROOT/name
        if path.resolve()!=path or not path.is_file() or path.stat().st_size>100_000:
            raise ValueError('NATIVE_CLEANUP_SOURCE_REQUIRED')
        raw=path.read_bytes()
        if p.sha(raw)!=sha: raise ValueError('NATIVE_CLEANUP_SOURCE_REQUIRED')
        retained.append(raw.decode())
    match=re.findall(r"  platform_expr text := '((?:''|[^'])*)';", retained[0])
    if len(match)!=1 or "v := replace(v, 'auth.uid()', '(select auth.uid())');" not in retained[1]:
        raise ValueError('NATIVE_CLEANUP_POLICY_SOURCE_REQUIRED')
    expression=match[0].replace("''", "'").replace('auth.uid()', '(select auth.uid())')
    body=BODY.replace('__POLICY__',expression).replace('__CLOSURE__',CLOSURE).encode()
    return SimpleNamespace(name='gridex_native_probe_cleanup_'+p.sha(body)[:12], sql=body)


def expected_after(before, keys):
    ((catalog,rows), events)=before
    if (type(keys) is not list or len(keys)!=len(set(keys)) or len(keys)>40
            or not set(BASE_KEYS+(POLICY_KEY,))<=set(keys)
            or any(key not in catalog for key in keys)
            or any(key not in BASE_KEYS+(POLICY_KEY,) and not key.startswith(tuple(
                'dependency/policy '+POLICY+' on table '+name+'/'
                for name in (TABLE,TABLE.removeprefix('public.')))) for key in keys)
            or rows.get(TABLE)!=[1,ROW_HASH]):
        raise ValueError('NATIVE_CLEANUP_EXACT_REMOVAL_REQUIRED')
    remaining={key:value for key,value in catalog.items() if key not in keys}
    if any(key.startswith(prefix+TABLE+'/') for key in remaining
           for prefix in ('column/','constraint/','policy/','trigger/','rule/')):
        raise ValueError('NATIVE_CLEANUP_UNRECOGNIZED_OBJECT_REQUIRED')
    return ((remaining,{key:value for key,value in rows.items() if key!=TABLE}),copy.deepcopy(events))


def ledger_hash(entries):
    return p.sha(json.dumps(entries,sort_keys=True,separators=(',',':')).encode())


def admit_completed(runner, parent):
    """Rebind the separate cleanup receipt before a subsequent type/schema gate."""
    unit=program()
    receipt=parent.get('syntheticProbeCleanup',{})
    if (type(runner) is not timestamp.Runner or len(runner.entries)!=len(runner.retained)
            or len(runner.entries)<2 or receipt.get('actualLedgerRows')!=len(runner.entries)
            or receipt.get('priorLedgerRows')!=len(runner.entries)-1
            or receipt.get('priorLedgerSha256')!=ledger_hash(runner.entries[:-1])
            or receipt.get('sourcePins')!=PINS or receipt.get('syntheticCleanupEntriesExecuted')!=1
            or any(receipt.get(k) is not True for k in ('verified','probeAbsent','allOtherCatalogAndRowsPreserved',
                'providerEventsPreserved','noOpRepeatVerified','unchangedEarlierLedger'))
            or receipt.get('originalHistoricalVersionMarkedApplied') is not False
            or receipt.get('cases')!=[
                dict(expectedSqlstate=state,programSha256=p.sha(body),catalogAndRowsRestored=True,ledgerUnchanged=True)
                for state,body in [('PC001',unit.sql+POST),('PC002',unit.sql)]]):
        raise ValueError('NATIVE_CLEANUP_RECEIPT_REQUIRED')
    runner.target.assert_native_owned()
    runner.unchanged()
    path,raw,physical=runner.retained[-1]
    p.verify_private(path,unit.sql,physical)
    p.verify_entry(runner.entries[-1],path.name,unit)
    if (raw!=unit.sql or receipt.get('cliFile')!=path.name or receipt.get('programSha256')!=p.sha(unit.sql)
            or receipt.get('ledgerStatementsSha256')!=p.sha(json.dumps(
                runner.entries[-1]['statements'],separators=(',',':')).encode())
            or runner.sql('SELECT to_json('+ABSENT+');') is not True):
        raise ValueError('NATIVE_CLEANUP_LEDGER_BYTES_REQUIRED')


def negative(runner, unit, *, ledger):
    body=unit.sql if ledger else unit.sql+POST
    probe=SimpleNamespace(name='gridex_native_probe_cleanup_'+p.sha(body)[:12],sql=body)
    before=timestamp.native_snapshot(runner.target)
    files={path.name for path in runner.directory.iterdir()}
    path,physical=runner.create(probe)
    installed=False
    try:
        if ledger:
            guard=("BEGIN; CREATE SCHEMA gridex_native_cleanup_guard; "
             "REVOKE ALL ON SCHEMA gridex_native_cleanup_guard FROM PUBLIC,anon,authenticated,service_role; "
             "CREATE FUNCTION gridex_native_cleanup_guard.reject_ledger() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN "
             "IF NEW.name IS DISTINCT FROM '"+probe.name+"' OR NOT ("+ABSENT+") THEN "
             "RAISE EXCEPTION 'NATIVE_CLEANUP_BOUNDARY' USING ERRCODE='PC009'; END IF; "
             "RAISE EXCEPTION 'NATIVE_CLEANUP_LEDGER_FAULT' USING ERRCODE='PC002'; END $guard$; "
             "REVOKE ALL ON FUNCTION gridex_native_cleanup_guard.reject_ledger() FROM PUBLIC,anon,authenticated,service_role; "
             "CREATE TRIGGER gridex_native_cleanup_guard BEFORE INSERT ON supabase_migrations.schema_migrations "
             "FOR EACH ROW EXECUTE FUNCTION gridex_native_cleanup_guard.reject_ledger(); SELECT to_json(true); COMMIT;")
            if runner.sql(guard) is not True: raise ValueError('NATIVE_CLEANUP_GUARD_REQUIRED')
            installed=True
        result=runner.native('migration','up','--local',timeout=420,allow_failure=True)
        p.verify_private(path,body,physical)
        errors=[line.rstrip(b' ') for line in result.stderr.splitlines() if line.startswith(b'ERROR:')]
        if result.returncode==0 or errors!=[LEDGER_ERROR if ledger else POST_ERROR]:
            raise ValueError('NATIVE_CLEANUP_FAILURE_CONTROL_REQUIRED')
        runner.unchanged()
    finally:
        if installed and runner.sql(GUARD_DROP) is not True:
            raise ValueError('NATIVE_CLEANUP_GUARD_DISPOSAL_REQUIRED')
        p.verify_private(path,body,physical)
        path.unlink()
    if timestamp.native_snapshot(runner.target)!=before or {path.name for path in runner.directory.iterdir()}!=files:
        raise ValueError('NATIVE_CLEANUP_ROLLBACK_REQUIRED')
    return dict(expectedSqlstate='PC002' if ledger else 'PC001',programSha256=p.sha(body),
                catalogAndRowsRestored=True,ledgerUnchanged=True)


def execute(runner, retained_forward, parent):
    from canonical_native_final_sql import admit_forward, PINS as FINAL_PINS
    admit_forward(runner,retained_forward,parent)
    final=parent.get('nativeFinalSql',{})
    if (final.get('verified') is not True
            or [(r.get('source'),r.get('sourceSha256')) for r in final.get('checks',[])]!=list(FINAL_PINS.items())
            or any(any(r.get(k) is not True for k in ('verified','catalogAndRowsPreserved','ledgerUnchanged'))
                   for r in final.get('checks',[])) or 'syntheticProbeCleanup' in parent):
        raise ValueError('NATIVE_CLEANUP_FINAL_SQL_REQUIRED')
    unit=program()
    before=timestamp.native_snapshot(runner.target)
    dependencies=runner.sql(DEPENDENCIES)
    if type(dependencies) is not list: raise ValueError('NATIVE_CLEANUP_DEPENDENCIES_REQUIRED')
    keys=list(BASE_KEYS)+[POLICY_KEY]+dependencies
    expected=expected_after(before,keys)
    earlier=copy.deepcopy(runner.entries)
    receipt=dict(scope='SYNTHETIC_FIXTURE_CLEANUP_NOT_CANONICAL_SOURCE_OR_SCHEMA_ACCEPTANCE',
                 verified=False,sourcePins=dict(PINS),schemaAccepted=False,generatedTypesVerified=False)
    parent['syntheticProbeCleanup']=receipt
    receipt['cases']=[negative(runner,unit,ledger=False),negative(runner,unit,ledger=True)]
    receipt.update(runner.apply(unit))
    if (runner.entries[:-1]!=earlier or len(runner.entries)!=len(earlier)+1
            or runner.sql('SELECT to_json('+ABSENT+');') is not True
            or timestamp.native_snapshot(runner.target)!=expected):
        raise ValueError('NATIVE_CLEANUP_EXACT_STATE_REQUIRED')
    runner.repeat()
    path,raw,physical=runner.retained[-1]
    p.verify_private(path,unit.sql,physical)
    p.verify_entry(runner.entries[-1],path.name,unit)
    if raw!=unit.sql or receipt.get('cliFile')!=path.name:
        raise ValueError('NATIVE_CLEANUP_LEDGER_BYTES_REQUIRED')
    receipt.update(verified=True,probeAbsent=True,allOtherCatalogAndRowsPreserved=True,
                   providerEventsPreserved=True,noOpRepeatVerified=True,actualLedgerRows=len(runner.entries),
                   priorLedgerRows=len(earlier),priorLedgerSha256=ledger_hash(earlier),syntheticCleanupEntriesExecuted=1,
                   removedCatalogKeys=sorted(keys),removedCatalogSha256=p.sha(json.dumps(
                       {k:before[0][0][k] for k in keys},sort_keys=True,separators=(',',':')).encode()))
    admit_completed(runner,parent)
    return receipt
