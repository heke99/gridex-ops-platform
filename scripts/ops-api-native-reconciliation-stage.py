#!/usr/bin/env python3
"""Transport the exact independently approved B3 SQL, then install it atomically.

This offline generator connects to no database. Outputs are source migration
proposals, not ledger writes. Each proposal must be CLI-created and applied as a
real migration. The private transport contains source bytes only, no business
rows; the final migration verifies the entire approved byte stream before DDL.
Requires pglast==7.7 solely to verify outer transaction token/AST preservation.
"""
from __future__ import annotations
import argparse, hashlib, json, pathlib
from pglast import ast, parser, parse_sql

APPROVED_SHA = 'bacf8944718c984d117f0400ed19fadd978feed6613ea9196784eff4591ac600'
SCHEMA = 'ops_api_sql_transport_20261013'
TABLE = SCHEMA + '.payload_parts'
PART_BYTES = 128 * 1024


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def normalized(value):
    if isinstance(value, list): return [normalized(x) for x in value]
    if not isinstance(value, dict): return value
    return {k: normalized(v) for k, v in value.items()
            if k not in ('location', 'stmt_location', 'stmt_len')}


def shape_guard() -> str:
    """Only the exact owner-only private table and its automatic objects exist."""
    return f"""
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_namespace n WHERE n.nspname={quote(SCHEMA)} AND n.nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')) THEN RAISE EXCEPTION 'ops_sql_transport_schema_owner_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_namespace n CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a WHERE n.nspname={quote(SCHEMA)} AND (a.grantee<>n.nspowner OR a.grantor<>n.nspowner OR a.is_grantable)) THEN RAISE EXCEPTION 'ops_sql_transport_schema_acl_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_roles r WHERE r.rolname IN('anon','authenticated','service_role') AND pg_catalog.pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres'),'MEMBER')) THEN RAISE EXCEPTION 'ops_sql_transport_app_owner_membership'; END IF;
 IF (SELECT array_agg(c.relname||':'||c.relkind::text ORDER BY c.relname COLLATE "C") FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname={quote(SCHEMA)}) IS DISTINCT FROM ARRAY['payload_parts:r','payload_parts_pkey:i']::text[] THEN RAISE EXCEPTION 'ops_sql_transport_relation_set_drift'; END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_class c WHERE c.oid={quote(TABLE)}::regclass AND c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres') AND c.relrowsecurity AND c.relforcerowsecurity AND NOT c.relispartition AND c.reltablespace=0 AND c.reloptions IS NULL AND c.relam=(SELECT oid FROM pg_catalog.pg_am WHERE amname='heap')) THEN RAISE EXCEPTION 'ops_sql_transport_table_shape_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE c.oid={quote(TABLE)}::regclass AND (a.grantee<>c.relowner OR a.grantor<>c.relowner OR a.is_grantable)) THEN RAISE EXCEPTION 'ops_sql_transport_table_acl_drift'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_array(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid={quote(TABLE)}::regclass AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '[["part_no","integer",true,"",""],["payload","bytea",true,"",""],["part_sha256","text",true,"",""]]'::jsonb OR EXISTS(SELECT FROM pg_catalog.pg_attribute WHERE attrelid={quote(TABLE)}::regclass AND attnum>0 AND (attisdropped OR atthasdef OR attacl IS NOT NULL)) THEN RAISE EXCEPTION 'ops_sql_transport_column_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_attribute a WHERE a.attrelid={quote(TABLE)}::regclass AND a.attnum>0 AND (a.attndims<>0 OR a.atttypmod<>-1 OR a.attcompression<>'' OR a.atttypid<>CASE a.attname WHEN 'part_no' THEN 'pg_catalog.int4'::regtype WHEN 'payload' THEN 'pg_catalog.bytea'::regtype WHEN 'part_sha256' THEN 'pg_catalog.text'::regtype ELSE 0::oid END OR a.attcollation<>CASE WHEN a.attname='part_sha256' THEN 'pg_catalog."default"'::regcollation ELSE 0::oid END OR a.attstorage<>CASE WHEN a.attname='part_no' THEN 'p'::"char" ELSE 'x'::"char" END)) THEN RAISE EXCEPTION 'ops_sql_transport_column_type_collation_drift'; END IF;
 IF (SELECT jsonb_agg(jsonb_build_array(c.conname,c.contype,pg_catalog.pg_get_constraintdef(c.oid,false),c.convalidated,c.condeferrable,c.condeferred) ORDER BY c.conname COLLATE "C") FROM pg_catalog.pg_constraint c WHERE c.conrelid={quote(TABLE)}::regclass) IS DISTINCT FROM '[["payload_parts_pkey","p","PRIMARY KEY (part_no)",true,false,false]]'::jsonb THEN RAISE EXCEPTION 'ops_sql_transport_constraint_drift'; END IF;
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_index i WHERE i.indexrelid={quote(SCHEMA+'.payload_parts_pkey')}::regclass AND i.indrelid={quote(TABLE)}::regclass AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready AND i.indexprs IS NULL AND i.indpred IS NULL AND pg_catalog.pg_get_indexdef(i.indexrelid)={quote('CREATE UNIQUE INDEX payload_parts_pkey ON '+TABLE+' USING btree (part_no)')}) THEN RAISE EXCEPTION 'ops_sql_transport_index_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_trigger WHERE tgrelid={quote(TABLE)}::regclass) OR EXISTS(SELECT FROM pg_catalog.pg_policy WHERE polrelid={quote(TABLE)}::regclass) OR EXISTS(SELECT FROM pg_catalog.pg_rewrite WHERE ev_class={quote(TABLE)}::regclass) OR EXISTS(SELECT FROM pg_catalog.pg_inherits WHERE inhrelid={quote(TABLE)}::regclass OR inhparent={quote(TABLE)}::regclass) THEN RAISE EXCEPTION 'ops_sql_transport_execution_adjunct_drift'; END IF;
 IF (SELECT array_agg(t.typname||':'||t.typtype::text ORDER BY t.typname COLLATE "C") FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname={quote(SCHEMA)}) IS DISTINCT FROM ARRAY['_payload_parts:b','payload_parts:c']::text[] THEN RAISE EXCEPTION 'ops_sql_transport_type_set_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname={quote(SCHEMA)} AND t.typowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')) OR EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname={quote(SCHEMA)} AND c.relowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')) THEN RAISE EXCEPTION 'ops_sql_transport_internal_owner_drift'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_operator p JOIN pg_catalog.pg_namespace n ON n.oid=p.oprnamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_collation p JOIN pg_catalog.pg_namespace n ON n.oid=p.collnamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_conversion p JOIN pg_catalog.pg_namespace n ON n.oid=p.connamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_statistic_ext p JOIN pg_catalog.pg_namespace n ON n.oid=p.stxnamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_ts_config p JOIN pg_catalog.pg_namespace n ON n.oid=p.cfgnamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_ts_dict p JOIN pg_catalog.pg_namespace n ON n.oid=p.dictnamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_ts_parser p JOIN pg_catalog.pg_namespace n ON n.oid=p.prsnamespace WHERE n.nspname={quote(SCHEMA)}) OR EXISTS(SELECT FROM pg_catalog.pg_ts_template p JOIN pg_catalog.pg_namespace n ON n.oid=p.tmplnamespace WHERE n.nspname={quote(SCHEMA)}) THEN RAISE EXCEPTION 'ops_sql_transport_unknown_namespace_object'; END IF;
"""


def frame(body: str) -> str:
    return "-- Source-byte transport only; CLI-create/apply as a real migration.\nBEGIN;\nSET LOCAL search_path=pg_catalog;\nSET LOCAL lock_timeout='10s';\nSET LOCAL statement_timeout='15min';\n" + body + '\nCOMMIT;\n'


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source',required=True)
    ap.add_argument('--output-dir',required=True)
    args=ap.parse_args()
    source=pathlib.Path(args.source).read_bytes()
    if hashlib.sha256(source).hexdigest()!=APPROVED_SHA:
        raise SystemExit('Refuse any payload other than the independently approved exact B3 bytes.')
    text=source.decode('utf-8');stmts=parse_sql(text)
    if not isinstance(stmts[0].stmt,ast.TransactionStmt) or stmts[0].stmt.kind.name!='TRANS_STMT_BEGIN' or not isinstance(stmts[-1].stmt,ast.TransactionStmt) or stmts[-1].stmt.kind.name!='TRANS_STMT_COMMIT':
        raise SystemExit('Expected the exact approved outer BEGIN/COMMIT frame.')
    tokens=[x for x in parser.scan(text) if x.name!='SQL_COMMENT']
    if tokens[0].name!='BEGIN_P' or tokens[1].name!='ASCII_59' or tokens[-2].name!='COMMIT' or tokens[-1].name!='ASCII_59':
        raise SystemExit('Outer transaction tokens are not exactly recognized.')
    # pglast scanner positions are Python character offsets, while parser JSON
    # locations are UTF-8 byte offsets. Convert explicitly, never slice Unicode
    # payload bytes with character offsets. Preserve both comments and whitespace.
    b0=len(text[:tokens[0].start].encode());b1=len(text[:tokens[1].end+1].encode())
    c0=len(text[:tokens[-2].start].encode());c1=len(text[:tokens[-1].end+1].encode())
    executable=source[:b0]+source[b1:c0]+source[c1:]
    original_ast=json.loads(parser.parse_sql_json(text))['stmts'][1:-1]
    exec_ast=json.loads(parser.parse_sql_json(executable.decode('utf-8')))['stmts']
    if normalized(original_ast)!=normalized(exec_ast):raise SystemExit('Removing outer transaction changed an executable AST.')
    inner_sha=hashlib.sha256(executable).hexdigest()
    parts=[source[i:i+PART_BYTES] for i in range(0,len(source),PART_BYTES)]
    out=pathlib.Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    guard=shape_guard();manifest={'schema':'ops_api_exact_sql_byte_transport_v1','approved_source_sha256':APPROVED_SHA,'source_bytes':len(source),'chunk_bytes':PART_BYTES,'chunk_count':len(parts),'executable_sha256':inner_sha,'executable_bytes':len(executable),'outer_transaction_byte_ranges_removed':[[b0,b1],[c0,c1]],'source_ast_preserved':True,'transport_schema':SCHEMA,'transport_table':TABLE,'owner':'postgres','app_grants':False,'business_rows':False,'native_applied_by_generator':False,'GEN':False,'files':[]}
    def write(name,sql,kind,extra=None):
        parse_sql(sql)
        (out/name).write_text(sql)
        row={'file':name,'kind':kind,'bytes':len(sql.encode()),'sql_sha256':hashlib.sha256(sql.encode()).hexdigest()}
        if extra:row.update(extra)
        manifest['files'].append(row)
    bootstrap=frame(f"""DO $ops_transport_bootstrap$
DECLARE grantee record;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_namespace WHERE nspname={quote(SCHEMA)}) THEN
  CREATE SCHEMA {SCHEMA} AUTHORIZATION postgres;
  CREATE TABLE {TABLE}(part_no integer PRIMARY KEY,payload bytea NOT NULL,part_sha256 text NOT NULL) USING heap;
  ALTER TABLE {TABLE} OWNER TO postgres;
  ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY;
  -- Fresh task-owned objects only. Unknown existing objects are never repaired.
  FOR grantee IN SELECT DISTINCT a.grantee,r.rolname FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE c.oid={quote(TABLE)}::regclass AND a.grantee<>c.relowner LOOP
   EXECUTE 'REVOKE ALL ON TABLE {TABLE} FROM '||CASE WHEN grantee.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(grantee.rolname) END;
  END LOOP;
  REVOKE ALL ON SCHEMA {SCHEMA} FROM PUBLIC,anon,authenticated,service_role;
 END IF;
 LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE;
 {guard}
END $ops_transport_bootstrap$;""")
    write('000-bootstrap.sql',bootstrap,'bootstrap')
    expected=[]
    for index,part in enumerate(parts,1):
        sha=hashlib.sha256(part).hexdigest();expected.append((index,len(part),sha))
        sql=frame(f"""DO $ops_transport_part$
DECLARE part constant bytea := pg_catalog.decode({quote(part.hex())},'hex');
BEGIN
 LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE;
 {guard}
 IF pg_catalog.octet_length(part)<>{len(part)} OR pg_catalog.encode(pg_catalog.sha256(part),'hex')<>{quote(sha)} THEN RAISE EXCEPTION 'ops_sql_transport_source_part_invalid: %',{index}; END IF;
 IF EXISTS(SELECT FROM {TABLE} WHERE part_no={index}) THEN
  IF EXISTS(SELECT FROM {TABLE} WHERE part_no={index} AND (payload IS DISTINCT FROM part OR part_sha256 IS DISTINCT FROM {quote(sha)})) THEN RAISE EXCEPTION 'ops_sql_transport_existing_part_conflict: %',{index}; END IF;
 ELSE
  INSERT INTO {TABLE}(part_no,payload,part_sha256) VALUES({index},part,{quote(sha)});
 END IF;
END $ops_transport_part$;""")
        write(f'{index:03d}-part.sql',sql,'part',{'part_no':index,'payload_bytes':len(part),'payload_sha256':sha})
    values=','.join(f'({i},{n},{quote(h)})' for i,n,h in expected)
    install=frame(f"""DO $ops_transport_atomic_install$
DECLARE source bytea; executable bytea;
BEGIN
 LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE;
 {guard}
 IF (SELECT array_agg(part_no ORDER BY part_no) FROM {TABLE}) IS DISTINCT FROM ARRAY[{','.join(str(i) for i,_,_ in expected)}]::integer[] THEN RAISE EXCEPTION 'ops_sql_transport_missing_or_extra_parts'; END IF;
 IF EXISTS(WITH expected(part_no,bytes,sha256) AS(VALUES {values}) SELECT FROM expected e LEFT JOIN {TABLE} p USING(part_no) WHERE pg_catalog.octet_length(p.payload) IS DISTINCT FROM e.bytes OR p.part_sha256 IS DISTINCT FROM e.sha256 OR pg_catalog.encode(pg_catalog.sha256(p.payload),'hex') IS DISTINCT FROM e.sha256) THEN RAISE EXCEPTION 'ops_sql_transport_part_hash_invalid'; END IF;
 SELECT pg_catalog.string_agg(payload,''::bytea ORDER BY part_no) INTO source FROM {TABLE};
 IF pg_catalog.octet_length(source)<>{len(source)} OR pg_catalog.encode(pg_catalog.sha256(source),'hex')<>{quote(APPROVED_SHA)} THEN RAISE EXCEPTION 'ops_sql_transport_approved_source_hash_invalid'; END IF;
 executable:=pg_catalog.substring(source,1,{b0})||pg_catalog.substring(source,{b1+1},{c0-b1})||pg_catalog.substring(source,{c1+1});
 IF pg_catalog.octet_length(executable)<>{len(executable)} OR pg_catalog.encode(pg_catalog.sha256(executable),'hex')<>{quote(inner_sha)} THEN RAISE EXCEPTION 'ops_sql_transport_executable_hash_invalid'; END IF;
 -- The entire unchanged approved semantic installation runs in this final
 -- transaction. No business code runs while bytes are staged in prior steps.
 EXECUTE pg_catalog.convert_from(executable,'UTF8');
 {guard}
 -- RESTRICT only. Unknown references/objects abort the entire installation;
 -- no cascade, other schema, relation, business row or grant is removed.
 DROP TABLE {TABLE};
 DROP SCHEMA {SCHEMA};
END $ops_transport_atomic_install$;""")
    write('999-atomic-install.sql',install,'atomic_install')
    manifest['maximum_packet_sql_bytes']=max(x['bytes'] for x in manifest['files'])
    manifest['delivery_order']=[x['file'] for x in manifest['files']]
    manifest['registration']='Every bootstrap/part/final is a genuine source migration; root CLI-creates and applies exact file bytes. No fabricated ledger insertion.'
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:manifest[k] for k in ('approved_source_sha256','chunk_count','source_bytes','executable_sha256','source_ast_preserved','maximum_packet_sql_bytes')}))


if __name__=='__main__': main()
