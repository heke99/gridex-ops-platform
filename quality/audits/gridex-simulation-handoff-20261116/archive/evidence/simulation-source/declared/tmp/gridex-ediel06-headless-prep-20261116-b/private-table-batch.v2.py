"""Exact saved-TOC private-table readback; pure renderer plus bounded result validation.
No import-time SQL, sockets, subprocesses, writes, Auth, or catalog mutation.
"""
import hashlib,json,pathlib,re
DB='gridex_local_partner_http_20261113_a'
TOC=pathlib.Path('/tmp/gridex-ediel06-headless-prep-20261116-a/TRUSTED3443-RESTORE-TOC.private.txt')
TOC_SHA256='3a5f47578b8be9d9f4f8553d33a24124085de415f3bba4d50e840c5a4c29e034'
CATALOG_TABLE_COUNT=388
RESULT_BYTES_MAX=8*1024*1024
COVERED_PRIVATE=frozenset({'gridex_controlled_test_receiver.registrations','gridex_controlled_test_receiver.revocations'})
CUSTODY=frozenset({'gridex_unattributed_intake.raw_births','gridex_ediel_inbound_receptions.technical_mailbox_births'})
IDENT=re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
TOC_TABLE=re.compile(r'^\d+; \d+ \d+ TABLE (gridex_\S+) (\S+) \S+$',re.MULTILINE)
CATALOG_SQL="""SET statement_timeout='8s';SET lock_timeout='5s';
SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname)ORDER BY n.nspname,c.relname),'[]')
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN('r','p')AND n.nspname LIKE 'gridex\\_%' ESCAPE '\\';"""
def need(v,m):
 if not v:raise AssertionError(m)
def canonical_catalog(toc_bytes=None):
 if toc_bytes is None:
  need(TOC.is_file() and not TOC.is_symlink() and TOC.resolve()==TOC and TOC.stat().st_size<=4*1024*1024,'EXACT_REAL_BOUNDED_TOC_REQUIRED')
  toc_bytes=TOC.read_bytes()
 need(isinstance(toc_bytes,bytes)and hashlib.sha256(toc_bytes).hexdigest()==TOC_SHA256,'TRUSTED_TOC_HASH_REQUIRED')
 pairs=TOC_TABLE.findall(toc_bytes.decode('utf-8'))
 need(len(pairs)==CATALOG_TABLE_COUNT and len(set(pairs))==CATALOG_TABLE_COUNT,'EXACT_388_UNIQUE_TOC_TABLES_REQUIRED')
 need(all(IDENT.fullmatch(s)and IDENT.fullmatch(t)for s,t in pairs),'SAFE_TOC_IDENTIFIERS_REQUIRED')
 return tuple(sorted(pairs))
def validate_catalog(actual,toc_bytes=None):
 expected=canonical_catalog(toc_bytes)
 need(isinstance(actual,list),'READONLY_ACTUAL_CATALOG_ARRAY_REQUIRED')
 pairs=[]
 for r in actual:
  need(isinstance(r,dict)and set(r)=={'schema','table'},'EXACT_ACTUAL_CATALOG_FIELDS_REQUIRED')
  s,t=r['schema'],r['table']
  need(isinstance(s,str)and isinstance(t,str)and IDENT.fullmatch(s)and IDENT.fullmatch(t),'SAFE_ACTUAL_CATALOG_IDENTIFIERS_REQUIRED')
  pairs.append((s,t))
 need(len(pairs)==len(set(pairs))and tuple(sorted(pairs))==expected,'ACTUAL_CATALOG_MUST_EQUAL_ALL_388_TOC_TABLES')
 return expected
def render(actual_catalog,snapshot_rows,toc_bytes=None):
 pairs=validate_catalog(actual_catalog,toc_bytes)
 need(isinstance(snapshot_rows,dict),'QUALIFIED_SNAPSHOT_ROWS_REQUIRED')
 captured={k for k in snapshot_rows if isinstance(k,str)and k.startswith('gridex_')}
 need(captured==COVERED_PRIVATE,'EXACT_TWO_PRIVATE_TABLES_ALREADY_IN_522_REQUIRED')
 missing=[(s,t)for s,t in pairs if s+'.'+t not in captured]
 keys=[s+'.'+t for s,t in missing]
 need(len(keys)==386 and CUSTODY<=set(keys),'ALL_386_MISSING_PRIVATE_TABLES_AND_CUSTODY_REQUIRED')
 pieces=[]
 for s,t in missing:
  key=s+'.'+t
  value="jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v)ORDER BY to_jsonb(v)::text),'[]'::jsonb)::text,'UTF8')),'hex'))"
  if key in CUSTODY:
   value+="||jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(v)ORDER BY v.inbound_email_message_id),'[]'::jsonb))"
  pieces.append("SELECT '"+key+"'::text AS table_key,"+value+' AS value FROM "'+s+'"."'+t+'" v')
 # Expected identities are closed ASCII identifiers from the byte-pinned TOC.
 expected_json=json.dumps(pairs,separators=(',',':'))
 sql="""SET statement_timeout='8s';SET lock_timeout='5s';
WITH observed_catalog AS MATERIALIZED(
 SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname)ORDER BY n.nspname::text COLLATE "C",c.relname::text COLLATE "C"),'[]')AS value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN('r','p')AND n.nspname LIKE 'gridex\\_%' ESCAPE '\\'
),table_fences AS MATERIALIZED(
"""+'\nUNION ALL\n'.join(pieces)+"""
),payload AS MATERIALIZED(
 SELECT jsonb_build_object('state','EXACT_PRIVATE_TABLE_BATCH','database',current_database(),
 'catalogMatches',(SELECT value='"""+expected_json+"""'::jsonb FROM observed_catalog),
 'catalogTables',388,'hashedTables',count(*),'outputOverflow',false,
 'results',coalesce(jsonb_object_agg(table_key,value ORDER BY table_key),'{}'::jsonb))AS value FROM table_fences
)
SELECT CASE WHEN octet_length(value::text)>8388608 THEN
 jsonb_build_object('state','PRIVATE_TABLE_BATCH_OUTPUT_OVERFLOW','outputOverflow',true,'complete',false,'resultBytes',octet_length(value::text))
 ELSE value END FROM payload;
"""
 return {'sql':sql,'catalogTables':388,'hashedTables':386,'keys':keys,'custodyKeys':sorted(CUSTODY),'tocSHA256':TOC_SHA256,'statementTimeoutSeconds':8,'lockTimeoutSeconds':5,'resultBytesMax':RESULT_BYTES_MAX}
def decode_batch(raw,plan):
 need(isinstance(raw,(str,bytes)),'ACTUAL_BATCH_WIRE_REQUIRED')
 data=raw.encode('utf-8')if isinstance(raw,str)else raw
 need(len(data)<=RESULT_BYTES_MAX,'PRIVATE_BATCH_WIRE_CAP_EXCEEDED')
 v=json.loads(data)
 need(isinstance(v,dict)and v.get('state')=='EXACT_PRIVATE_TABLE_BATCH'and v.get('outputOverflow')is False,'COMPLETE_BOUNDED_PRIVATE_BATCH_REQUIRED')
 need(v.get('database')==DB and v.get('catalogMatches')is True and v.get('catalogTables')==388 and v.get('hashedTables')==386,'SAME_STATEMENT_EXACT_388_CATALOG_REQUIRED')
 result=v.get('results');need(isinstance(result,dict)and set(result)==set(plan['keys']),'EVERY_MISSING_PRIVATE_TABLE_EXACTLY_ONCE_REQUIRED')
 for key,row in result.items():
  need(isinstance(row,dict)and set(row)==({'count','sha256','rows'}if key in CUSTODY else {'count','sha256'}),'EXACT_BATCH_ROW_FIELDS_REQUIRED')
  need(type(row['count'])is int and row['count']>=0 and isinstance(row['sha256'],str)and re.fullmatch('[0-9a-f]{64}',row['sha256']),'FULL_COUNT_AND_CANONICAL_SHA_REQUIRED')
  if key in CUSTODY:
   need(isinstance(row['rows'],list)and len(row['rows'])==row['count'],'COMPLETE_CUSTODY_ROWS_REQUIRED')
   need(all(isinstance(x,dict)and isinstance(x.get('inbound_email_message_id'),str)for x in row['rows']),'NATIVE_CUSTODY_ROWS_REQUIRED')
   need(len({x['inbound_email_message_id']for x in row['rows']})==len(row['rows']),'UNIQUE_CUSTODY_SOURCE_ROWS_REQUIRED')
 return result
def capture(sql,database,snapshot):
 """Two readonly calls per phase: exact catalog, then ONE 386-table UNION ALL.
 The latter rechecks the entire catalog in its own snapshot; never a 386-call loop.
 """
 need(database==DB,'EXACT_OWN_DATABASE_REQUIRED')
 actual=json.loads(sql(database,CATALOG_SQL))
 plan=render(actual,snapshot['rows'])
 return decode_batch(sql(database,plan['sql']),plan)
