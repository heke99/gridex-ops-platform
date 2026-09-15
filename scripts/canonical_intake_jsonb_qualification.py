"""Owned PostgreSQL qualification of source-authored intake JSONB string-array contract.
No migration or general non-string JSON/text-array equivalence is asserted.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import weakref
import canonical_policy_actor_qualification as actors
import canonical_forward_portable as snapshots
ROOT=Path(__file__).resolve().parents[1]
DATABASE='gridex_auth_legacy_replay'
COLUMNS=('intake_missing_fields','intake_warnings')
# Only main registers the fresh object it creates; full-parent callers still need
# the existing published-reference and live-replay admission.
_STANDALONE=weakref.WeakSet()
PINS={'supabase/migrations/20260521_batch_customer_intake_debug_hardening.sql': '562c2447554c43a3aef96bbbcd88a9f36ad1cc884ba97268ca96bc455ec54e80', 'supabase/migrations/20260521_batch_customer_intake_batch2_hardening.sql': 'ab4bcf98d9baba596e3badde07ea8c035224512979104f6716d1fe39bbbb2594', 'supabase/migrations/20260526_batch_3a_3b_customer_intake_blockers_documents.sql': 'fad2a3336c1bab86cd67d05d5f965643589864c259b500eb67bbafbcaa78cba8', 'supabase/migrations/20260610123000_customer_application_review_flow.sql': '55bdc0a98d9a601437738f58cc1380b2828bf817d979e586e038331e0a622caf', 'supabase/migrations/20260610171000_customer_application_status_hardening.sql': '92c3c134200a9efa9279cf93e76522f55109e7801a6da331c29c057492ddd69f', 'lib/website/applicationReview.ts': '1848c38cafa3438b29ec3e49233a6db91ec5ae4840d85220393072ca0c18d37a', 'lib/website/customerApplicationShared.ts': 'a77d450b793e2dbfaac038c0f98aa9d60be5e80ac6c5923e7b46f518123aa19e', 'app/admin/website-applications/actions.ts': 'fc9ce4f8dd2b44a2db51f39b45617c22321b41c38482c09d9e7520cf465f63ad', 'lib/customers/getCustomers.ts': '10b2aa3048cfb9bdb2053673d5045b8038f7172c6764e7b0d92eadb0da2ab9ea'}


def retain(root=ROOT):
    root=Path(root)
    rows=[]
    for path,digest in PINS.items():
        p=root/path
        if p.resolve()!=p or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:
            raise ValueError('INTAKE_SOURCE_PIN_REQUIRED')
        rows.append((path,digest,p.read_bytes()))
    return tuple(rows)


def contract(retained):
    if (type(retained) is not tuple or len(retained)!=len(PINS)
        or tuple((p,h) for p,h,_ in retained)!=tuple(PINS.items())
        or any(type(raw) is not bytes or hashlib.sha256(raw).hexdigest()!=h for p,h,raw in retained)):
        raise ValueError('INTAKE_RETAINED_SOURCE_REQUIRED')
    texts=[raw.decode() for _,_,raw in retained]
    # Exact original complete statements, including their conditional ADD semantics.
    statements=[]
    for index in (0,1,2):
        matches=re.findall(r'alter table public\.customers add column if not exists intake_(?:missing_fields|warnings) [^;]+;',texts[index])
        if len(matches)!=(1 if index==0 else 2):raise ValueError('INTAKE_DECLARATIONS_REQUIRED')
        statements.extend(matches)
    # June10 first source uses a multi-column ALTER; retain the complete statement.
    m=re.search(r'alter table if exists public\.customers\s+add column if not exists intake_status text,.*?;',texts[3],re.S)
    if not m:raise ValueError('INTAKE_DECLARATIONS_REQUIRED')
    statements.append(m.group())
    # Later source uses two complete conditional blocks instead of IF NOT EXISTS ADD.
    for name in COLUMNS:
        matches=re.findall(r"if not exists \(\s*select 1\s*from information_schema.columns\s*where table_schema = 'public'\s*and table_name = 'customers'\s*and column_name = '"+name+r"'\s*\) then\s*alter table public.customers add column "+name+r" text\[\] not null default '\{\}'::text\[\];\s*end if;",texts[4])
        if len(matches)!=1:raise ValueError('INTAKE_DECLARATIONS_REQUIRED')
        statements.append('DO $intake_source$ BEGIN '+matches[0]+' END $intake_source$;')
    for text in texts[6:8]:
        if 'intake_missing_fields: readiness.missingFields' not in text or 'intake_warnings: readiness.warnings' not in text:
            raise ValueError('INTAKE_WRITERS_REQUIRED')
    if 'missingFields: string[]' not in texts[5] or 'warnings: string[]' not in texts[5] or 'intake_missing_fields?: unknown' not in texts[8]:
        raise ValueError('INTAKE_CALLER_CONTRACT_REQUIRED')
    return tuple(statements)


METADATA="""SELECT count(*)=2 AND bool_and(a.atttypid='jsonb'::regtype AND a.attnotnull
 AND a.attidentity='' AND a.attgenerated='' AND a.atttypmod=-1
 AND pg_get_expr(d.adbin,d.adrelid)='''[]''::jsonb')
 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=to_regclass('public.customers') AND a.attnum>0 AND NOT a.attisdropped
 AND a.attname IN ('intake_missing_fields','intake_warnings');"""


def render(retained):
    contract(retained)
    # Real JSON input conversion used by a record-based API boundary. No public rows touched.
    return """BEGIN;
CREATE TEMP TABLE intake_jsonb(missing jsonb NOT NULL DEFAULT '[]'::jsonb, warnings jsonb NOT NULL DEFAULT '[]'::jsonb) ON COMMIT DROP;
CREATE TEMP TABLE intake_text(missing text[] NOT NULL DEFAULT '{}'::text[], warnings text[] NOT NULL DEFAULT '{}'::text[]) ON COMMIT DROP;
DO $intake_behavior$
DECLARE payload jsonb; j intake_jsonb; t intake_text; cases integer:=0; rejected integer:=0;
BEGIN
 FOR payload IN SELECT value FROM jsonb_array_elements($cases$[
  {"missing":[],"warnings":[]},
  {"missing":["customer.email","site"],"warnings":["manual_review"]},
  {"missing":["duplicate","duplicate",""],"warnings":["åäö","quote\\\"","backslash\\\\","comma,brace{}"]}
 ]$cases$::jsonb)
 LOOP
  SELECT * INTO j FROM jsonb_populate_record(NULL::intake_jsonb,payload);
  SELECT * INTO t FROM jsonb_populate_record(NULL::intake_text,payload);
  INSERT INTO intake_jsonb VALUES(j.*); INSERT INTO intake_text VALUES(t.*);
  IF to_jsonb(j)<>payload OR to_jsonb(t)<>payload THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INTAKE_STRING_ARRAY_ROUNDTRIP_REQUIRED'; END IF;
  cases:=cases+1;
 END LOOP;
 INSERT INTO intake_jsonb DEFAULT VALUES; INSERT INTO intake_text DEFAULT VALUES;
 IF NOT EXISTS(SELECT 1 FROM intake_jsonb WHERE missing='[]'::jsonb AND warnings='[]'::jsonb)
 OR NOT EXISTS(SELECT 1 FROM intake_text WHERE missing='{}'::text[] AND warnings='{}'::text[])
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INTAKE_DEFAULT_REQUIRED'; END IF;
 BEGIN INSERT INTO intake_jsonb(missing) VALUES(NULL); EXCEPTION WHEN not_null_violation THEN rejected:=rejected+1; END;
 BEGIN INSERT INTO intake_jsonb(warnings) VALUES(NULL); EXCEPTION WHEN not_null_violation THEN rejected:=rejected+1; END;
 BEGIN INSERT INTO intake_text(missing) VALUES(NULL); EXCEPTION WHEN not_null_violation THEN rejected:=rejected+1; END;
 BEGIN INSERT INTO intake_text(warnings) VALUES(NULL); EXCEPTION WHEN not_null_violation THEN rejected:=rejected+1; END;
 IF rejected<>4 OR cases<>3 OR (SELECT count(*) FROM intake_jsonb)<>4 OR (SELECT count(*) FROM intake_text)<>4
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INTAKE_CASE_COUNTS_REQUIRED'; END IF;
END $intake_behavior$;
SELECT true;
ROLLBACK;"""


def load_legacy():
    spec=importlib.util.spec_from_file_location('intake_owner',ROOT/'scripts/canonical-auth-provisioning-replay.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.load_batch()


def admit(target):
    if target not in _STANDALONE:
        return actors._admit(target)
    legacy=load_legacy()
    if (type(target) is not legacy.OwnedPostgres
        or getattr(target.command,'__func__',None) is not legacy.OwnedPostgres.command
        or getattr(target.verify_logging,'__func__',None) is not legacy.OwnedPostgres.verify_logging):
        raise ValueError('INTAKE_OWNED_TARGET_REQUIRED')
    actors._controller().load_repair().require_owned(target,reference=False)
    return DATABASE,False


def query(target,sql,label):
    database,native=admit(target)
    if native:return target.sql(database,sql,label,transaction=False).strip()
    legacy=load_legacy()
    if type(target) is not legacy.OwnedPostgres:raise ValueError('INTAKE_OWNED_TARGET_REQUIRED')
    target.verify_logging()
    result=subprocess.run(target.command(database,(),transaction=False)+['-f','-'],input=sql.encode(),capture_output=True,timeout=120,env=legacy.clean_environment())
    admit(target);target.verify_logging()
    receipt=legacy.safe_receipt(result.stderr.decode(errors='replace'),result.returncode,label)
    if result.returncode!=0 or receipt['sqlstate']!='00000':raise ValueError('INTAKE_SQL_QUALIFICATION_REQUIRED')
    return result.stdout.decode().strip()


def execute(target,retained):
    contract(retained)
    database,native=admit(target)
    before=actors._snapshot(target,database,native)
    if query(target,METADATA,'intake_metadata')!='t':raise ValueError('INTAKE_TWO_JSONB_COLUMNS_REQUIRED')
    if query(target,render(retained),'intake_behavior')!='t':raise ValueError('INTAKE_BEHAVIOR_REQUIRED')
    if actors._snapshot(target,database,native)!=before:raise ValueError('INTAKE_STATE_PRESERVATION_REQUIRED')
    contract(retained)
    return dict(scope='SOURCE_AUTHORED_INTAKE_JSONB_STRING_ARRAYS_ONLY',sourcePins=dict(PINS),
        columns=list(COLUMNS),metadataVerified=True,stringArrayCases=3,nullRejections=4,
        defaultEmptyArraysVerified=True,catalogAndRowsPreserved=True,nativeTarget=native,
        nonStringPayloadsQualified=False,postgrestHttpVerified=False,schemaAccepted=False)


def main():
    if sys.argv[1:]:raise ValueError('INTAKE_NO_EXTERNAL_TARGET_OR_OPTIONS')
    retained=retain();statements=contract(retained);legacy=load_legacy()
    with legacy.OwnedPostgres() as target:
        directory=Path(target.directory.name);target.reset(DATABASE)
        _STANDALONE.add(target)
        try:
            if query(target,"select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999;",'intake_pg17')!='t':raise ValueError('INTAKE_PG17_REQUIRED')
            query(target,'CREATE TABLE public.customers(id integer PRIMARY KEY);\n'+'\n'.join(statements),'intake_source_declarations')
            result=execute(target,retained)
        finally:
            _STANDALONE.discard(target)
    if target.active or target.directory is not None or directory.exists():raise ValueError('INTAKE_CLEANUP_REQUIRED')
    result['cleanupVerified']=True
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':main()
