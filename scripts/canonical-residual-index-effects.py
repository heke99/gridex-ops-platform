#!/usr/bin/env python3
"""Verify finite DB1/DB2 index semantics, not IF NOT EXISTS name-only success.

Canonicalize the exact pinned DDL against empty temporary LIKE tables. Compare
keys, expressions, predicates, uniqueness, operator/collation/sort and validity.
No source SQL, production data, persistent table or public index is rewritten.
"""
import hashlib
import json
import re

DB1='migrations/20260522_db1_schema_repair_backfill_foundation.sql'
DB2='migrations/01_db2_full_view_preflight_schema_and_functions.sql'
PINS={DB1:'aff5a3e4fb3aae6ebe682081cbce4876c5731be1c124650b19d8151abf6efc73',
      DB2:'4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9'}
OBJECTS={DB1:('companies_slug','companies_org_number','company_memberships_company_user',
    'customers_customer_number','customers_personal_number','customers_email','customer_sites_facility',
    'metering_points_meter_id','powers_of_attorney_doc_hash','supplier_switch_requests_dedupe',
    'ediel_messages_inbound_interchange','ediel_messages_outbound_source','ediel_ack_dedupe',
    'billing_export_items_dedupe','outbound_request_active_dedupe'),
    DB2:('company_memberships_company_user_uidx','company_memberships_company_status_idx',
         'company_invitations_company_status_idx','company_invitations_email_status_idx')}
DATABASE='gridex_auth_legacy_replay'
CLONE='gridex_auth_legacy_atomic'


def declarations(relative,raw):
    if relative not in PINS or type(raw) is not bytes or hashlib.sha256(raw).hexdigest()!=PINS[relative]:
        raise ValueError('INDEX_EFFECT_SOURCE_MISMATCH')
    # This is finite literal extraction after a whole-file hash check, not a
    # general SQL parser. Double quotes in SQL string literals are unescaped once.
    pattern=r"select public\.gridex_db1_try_exec\('(dedupe_index|db2_v4_index)','([a-z_]+)',\s*'((?:[^']|'')*)'\);"
    found=re.findall(pattern,raw.decode())
    if tuple(row[1] for row in found)!=OBJECTS[relative]:
        raise ValueError('INDEX_EFFECT_DECLARATION_MISMATCH')
    result=[]
    for area,key,literal in found:
        sql=literal.replace("''", "'")
        m=re.fullmatch(r'create (unique )?index if not exists ([a-z_]+) on public\.([a-z_]+)(.*)',sql,re.S)
        if m is None or ';' in sql or '--' in sql or '/*' in sql:
            raise ValueError('INDEX_EFFECT_DECLARATION_MISMATCH')
        unique,name,table,tail=m.groups()
        result.append((key,name,table,unique or '',tail))
    return result


def shape(index):
    return f"""(SELECT jsonb_build_object(
        'unique',i.indisunique,'primary',i.indisprimary,'exclusion',i.indisexclusion,
        'immediate',i.indimmediate,'nullsNotDistinct',i.indnullsnotdistinct,
        'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
        'method',c.relam,'keyCount',i.indnkeyatts,'attributeCount',i.indnatts,
        'keys',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid,k,true) ORDER BY k)
                FROM generate_series(1,i.indnatts) k),
        'predicate',pg_get_expr(i.indpred,i.indrelid,true),
        'collations',to_jsonb(i.indcollation::oid[]),'opclasses',to_jsonb(i.indclass::oid[]),
        'options',to_jsonb(i.indoption::smallint[]))
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE i.indexrelid=to_regclass('{index}'))"""


def oracle(relative,raw):
    sql=['CREATE TEMP TABLE gridex_index_effects(index_name text PRIMARY KEY,matches boolean NOT NULL) ON COMMIT DROP;']
    for n,(_,name,table,unique,tail) in enumerate(declarations(relative,raw),1):
        temp_table='gridex_expected_index_table_'+str(n)
        temp_index='gridex_expected_index_'+str(n)
        sql.extend([
          f'CREATE TEMP TABLE {temp_table} (LIKE public.{table}) ON COMMIT DROP;',
          f'CREATE {unique}INDEX {temp_index} ON pg_temp.{temp_table}{tail};',
          f"""INSERT INTO pg_temp.gridex_index_effects VALUES ('{name}',
            coalesce(({shape('public.'+name)} = {shape('pg_temp.'+temp_index)})
            AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.{name}')
                       AND indrelid=to_regclass('public.{table}')),false));""",
          f'DROP TABLE pg_temp.{temp_table};'])
    sql.append("SELECT jsonb_agg(jsonb_build_object('index',index_name,'matches',matches) ORDER BY index_name) FROM pg_temp.gridex_index_effects;")
    return '\n'.join(sql)


def validate_result(relative,raw,rows):
    names={d[1] for d in declarations(relative,raw)}
    if (type(rows) is not list or len(rows)!=len(names) or any(
        type(r) is not dict or set(r)!={'index','matches'} or type(r['index']) is not str
        or r['index'] not in names or type(r['matches']) is not bool for r in rows)
        or {r['index'] for r in rows}!=names):
        raise ValueError('INDEX_EFFECT_RESULT_MISMATCH')
    return sorted(r['index'] for r in rows if not r['matches'])


def verify(target,database,relative,raw):
    if (database!=DATABASE or not getattr(target,'active',False)
        or getattr(target,'name',None) is None or target.name!=getattr(target,'_created_name',None)):
        raise ValueError('INDEX_EFFECT_OWNED_TARGET_REQUIRED')
    target.command(database)
    expected=declarations(relative,raw)
    query=oracle(relative,raw)
    before=target.catalog(database)
    missing=validate_result(relative,raw,json.loads(target.sql(database,query,'residual_index_effects')))
    if target.catalog(database)!=before:
        raise ValueError('INDEX_ORACLE_PERSISTENT_EFFECT')
    if missing:
        # Only authored, finite index names can appear; no SQL text or rows.
        print(json.dumps({'scope':'RESIDUAL_INDEX_EFFECTS','source':relative,
                          'mismatchedIndexes':missing,'accepted':False}),flush=True)
        raise ValueError('INDEX_SOURCE_EFFECT_MISMATCH')
    target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])
    target.docker(['exec',target.name,'createdb','-U','postgres','-T',database,CLONE])
    try:
        _,name,table,unique,tail=expected[0]
        # Retain the real name/keys/predicate but remove its uniqueness. Name-
        # existence checks pass; the canonical catalog comparison must reject it.
        if unique!='unique ':raise ValueError('INDEX_NEGATIVE_CONTROL_REQUIRED')
        target.sql(CLONE,f'DROP INDEX public.{name}; CREATE INDEX {name} ON public.{table}{tail};',
                   'residual_index_negative_setup')
        bad_before=target.catalog(CLONE)
        failures=validate_result(relative,raw,json.loads(target.sql(CLONE,query,'residual_index_negative')))
        if failures!=[name] or target.catalog(CLONE)!=bad_before:
            raise ValueError('INDEX_NEGATIVE_CONTROL_FAILED')
    finally:
        target.docker(['exec',target.name,'dropdb','-U','postgres','--if-exists','--force',CLONE])
    if target.catalog(database)!=before:
        raise ValueError('INDEX_PARENT_CHANGED')
    result={'source':relative,'sourceSha256':PINS[relative],'indexDefinitionsVerified':len(expected),
            'negativeControlVerified':True,'scope':'RESIDUAL_INDEX_EFFECTS',
            'completeSourceEffectsAccepted':False}
    print(json.dumps(result,sort_keys=True),flush=True)
    return result
