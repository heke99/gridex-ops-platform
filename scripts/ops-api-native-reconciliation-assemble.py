#!/usr/bin/env python3
"""Build a reviewed portable OPS reconciliation proposal with --portable-delivery.

Requires pglast==7.7. No database connection, Docker call, business RPC or native
mutation is performed. Output is a review proposal, never an automatic deploy.
Existing objects are preserved unless their exact source/native drift is recorded.
The original main() is historical audit reconstruction only. Its first output
was superseded and is not a deployment proposal. Portable delivery consumes the
independently reviewed exact OPS branch and explicit complete-state manifests;
it never silently promotes an original unreviewed source reconstruction.
"""
from __future__ import annotations
import argparse, collections, copy, hashlib, json, pathlib, re
from pglast import ast, parser, parse_sql
from pglast.stream import RawStream


def walk(x):
    if isinstance(x,dict):
        yield x
        for value in x.values(): yield from walk(value)
    elif isinstance(x,list):
        for value in x: yield from walk(value)


def text_names(x):
    return '.'.join(v['String']['sval'] for v in x or [])


def rv(x):
    return (x.get('schemaname') or 'public')+'.'+x['relname'] if x else None


def ident(x): return '"'+x.replace('"','""')+'"'
def name_sql(x): return '.'.join(ident(v) for v in x.split('.'))
def quote(x): return "'"+x.replace("'","''")+"'"


def signature(sql):
    node=parse_sql(sql)[0].stmt
    return '.'.join(v.sval for v in node.funcname)+'('+', '.join(RawStream()(p.argType) for p in node.parameters or [] if str(p.mode) not in ('o','t') and getattr(p.mode,'name','') not in ('FUNC_PARAM_OUT','FUNC_PARAM_TABLE'))+')'


def body(sql):
    node=json.loads(parser.parse_sql_json(sql))['stmts'][0]['stmt']['CreateFunctionStmt']
    opts={v['DefElem']['defname']:v['DefElem'].get('arg') for v in node.get('options',[])}
    return opts['as']['List']['items'][0]['String']['sval']


def const(node):
    if not node:return None
    if 'A_Const' in node:
        v=node['A_Const']
        if 'sval' in v:return v['sval']['sval']
        if 'ival' in v:return v['ival']['ival']
        if 'boolval' in v:return v['boolval']['boolval']
        if v.get('isnull'):return None
    if 'TypeCast' in node:return const(node['TypeCast']['arg'])
    if 'String' in node:return node['String']['sval']
    raise ValueError('Not a literal: '+str(node)[:180])


def evaluate_where(node,name):
    """Closed evaluator for actual owner-selector namespace/name predicates."""
    if not node:return True
    if 'BoolExpr' in node:
        b=node['BoolExpr'];values=[evaluate_where(x,name) for x in b['args']]
        if b['boolop']=='AND_EXPR':return all(values)
        if b['boolop']=='OR_EXPR':return any(values)
        if b['boolop']=='NOT_EXPR':return not values[0]
    if 'ColumnRef' in node:
        field=text_names(node['ColumnRef']['fields']).split('.')[-1]
        if field=='nspname':return name.split('.')[0]
        if field=='proname':return name.split('.')[1]
        raise ValueError('Unsupported owner selector column '+field)
    if 'A_Const' in node:return const(node)
    if 'List' in node:return [evaluate_where(x,name) for x in node['List']['items']]
    if 'A_Expr' in node:
        n=node['A_Expr'];op=text_names(n['name']);lhs=evaluate_where(n['lexpr'],name);rhs=evaluate_where(n['rexpr'],name)
        if n['kind']=='AEXPR_IN':return (lhs in rhs) if op=='=' else (lhs not in rhs)
        if op=='=':return lhs==rhs
        if op in ('<>','!='):return lhs!=rhs
        if op in ('~','!~','~*','!~*'):
            yes=bool(re.search(rhs,lhs,re.I if '*' in op else 0));return not yes if op.startswith('!') else yes
        if op in ('~~','!~~'):
            regex='^'+re.escape(rhs).replace(r'\%', '.*').replace(r'\_','.')+'$'
            regex=regex.replace('%','.*').replace('_','.')
            yes=bool(re.match(regex,lhs));return yes if op=='~~' else not yes
    if 'TypeCast' in node:return evaluate_where(node['TypeCast']['arg'],name)
    raise ValueError('Unsupported owner selector '+str(node)[:200])


def normalized_ast(sql):
    value=json.loads(parser.parse_sql_json(sql))['stmts'][0]['stmt']
    def norm(x):
        if isinstance(x,list):return [norm(v) for v in x]
        if not isinstance(x,dict):return x
        result={k:norm(v) for k,v in x.items() if k not in ('location','stmt_location','stmt_len')}
        if 'relname' in result:result.setdefault('schemaname','public')
        if 'funcname' in result and len(result['funcname'])==1:result['funcname'].insert(0,{'String':{'sval':'public'}})
        return result
    return norm(value)


def normalized_index(sql,digest_schema=None):
    """Qualify only catalog-proved equivalent deparser differences."""
    def norm(x):
        if isinstance(x,list):return [norm(v) for v in x]
        if not isinstance(x,dict):return x
        value={k:norm(v) for k,v in x.items()}
        call=value.get('FuncCall')
        if call and digest_schema and text_names(call['funcname']) in ('public.digest',digest_schema+'.digest'):
            call['funcname']=[{'String':{'sval':digest_schema}},{'String':{'sval':'digest'}}]
        expr=value.get('A_Expr')
        if expr and text_names(expr.get('name'))=='=' and expr.get('rexpr')=={'A_Const':{'boolval':{'boolval':True}}}:
            return expr['lexpr']
        return value
    return norm(normalized_ast(sql))


def infer_owners(root,all_function_names,all_relation_names):
    fn={n:'postgres' for n in all_function_names};table={n:'postgres' for n in all_relation_names}
    evidence={};limits=[]
    for path in sorted((root/'supabase/migrations').glob('[0-9]*.sql')):
        s=path.read_text();raw=s.encode()
        try: stmts=json.loads(parser.parse_sql_json(s))['stmts']
        except Exception as exc:limits.append({'file':str(path),'error':str(exc)});continue
        for item in stmts:
            node=item['stmt'];kind=next(iter(node));value=node[kind]
            start=item.get('stmt_location',0);length=item.get('stmt_len',0) or len(raw)-start
            sql=raw[start:start+length].decode();proof={'file':str(path.relative_to(root)),'line':raw[:start].count(b'\n')+1}
            # Literal ALTER OWNER is exact source authority.
            if kind=='AlterOwnerStmt':
                owner=value.get('newowner',{}).get('rolename');obj=value.get('object') or value.get('relation')
                name=None
                if value.get('relation'):name=rv(value['relation'])
                elif obj:
                    if 'ObjectWithArgs' in obj:obj=obj['ObjectWithArgs']
                    if isinstance(obj,dict) and 'objname' in obj:name=text_names(obj['objname'])
                    elif isinstance(obj,dict) and 'List' in obj:name=text_names(obj['List']['items'])
                if owner and name:
                    target=fn if name in fn else table
                    if name in target:target[name]=owner;evidence[name]=proof
            if kind!='DoStmt':continue
            # Closed generated guard targets inherit a fixed source owner;
            # compute literal tuple targets or actual table+suffix assignments,
            # retaining PostgreSQL's 63-byte identifier truncation.
            fixed_generated=re.search(r'ALTER\s+FUNCTION\s+(gridex_\w+)\.%I\(\)\s+OWNER\s+TO\s+(\w+)',sql,re.I)
            if fixed_generated and re.search(r'CREATE\s+FUNCTION',sql,re.I):
                schema,role=fixed_generated.groups()
                literals=re.findall(r"'([a-z_][a-z_0-9]*)'",sql)
                candidates=set(v[:63] for v in literals)
                suffixes=re.findall(r"(?:name|new_name)\s*:=\s*(?:\w+\.)?\w+\s*\|\|\s*'([_a-z0-9]+)'",sql,re.I)
                relation_bases={n.split('.')[-1] for n in all_relation_names}
                candidates|={(v+suffix)[:63] for v in literals if v in relation_bases for suffix in suffixes}
                for candidate in candidates:
                    target=schema+'.'+candidate
                    if target in fn:fn[target]=role;evidence[target]={**proof,'generated_guard_target':candidate}
            # Explicit copied-function parent/child pairs inherit actual source
            # owner at the copy epoch, not a blanket namespace owner.
            for parent,child in re.findall(r"\(\s*'((?:public|gridex_\w+)\.[^']+\([^']*\))'\s*,\s*'((?:public|gridex_\w+)\.[^']+)'",sql):
                parent=parent.split('(')[0]
                if child in fn and parent in fn:fn[child]=fn[parent];evidence[child]={**proof,'inherited_from':parent}
            for child,parent in re.findall(r"helper\s*:=\s*'((?:public|gridex_\w+)\.[^']+)';\s*definition\s*:=\s*replace\(f\.definition,'FUNCTION ((?:public|gridex_\w+)\.[^(']+)\(",sql,re.I):
                if child in fn and parent in fn:fn[child]=fn[parent];evidence[child]={**proof,'inherited_from':parent}
            # Source FOREACH literal table arrays with a constant owner.
            for match in re.finditer(r"FOREACH\s+(\w+)\s+IN\s+ARRAY\s+ARRAY\s*\[([^]]+)\]\s+LOOP([\s\S]*?)END\s+LOOP",sql,re.I):
                variable,array,loop=match.groups()
                for schema,owner in re.findall(r"ALTER\s+(?:TABLE|VIEW)\s+(gridex_\w+)\.%I\s+OWNER\s+TO\s+(\w+)",loop,re.I):
                    for target in re.findall(r"'([^']+)'",array):
                        name=schema+'.'+target
                        if name in table:table[name]=owner;evidence[name]=proof
            # Scope actual function owner cursor predicates exactly. The source
            # templates here assign constant roles; no generator block is run.
            for match in re.finditer(r"FOR\s+(\w+)\s+IN\s+(SELECT[\s\S]*?)\s+LOOP([\s\S]*?)END\s+LOOP",sql,re.I):
                variable,query,loop=match.groups()
                owner_match=re.search(r"ALTER\s+FUNCTION\s+%s\s+OWNER\s+TO\s+(\w+)",loop,re.I)
                if not owner_match:continue
                if 'pg_proc' not in query:continue
                try:
                    q=json.loads(parser.parse_sql_json(query))['stmts'][0]['stmt']['SelectStmt']
                    owner=owner_match[1]
                    for name in fn:
                        if evaluate_where(q.get('whereClause'),name):fn[name]=owner;evidence[name]=proof
                except Exception as exc:limits.append({**proof,'kind':'owner cursor','query':query,'error':str(exc)})
    return fn,table,evidence,limits


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root',default='.')
    ap.add_argument('--plan',required=True)
    ap.add_argument('--native-metadata',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--receipt',required=True)
    ap.add_argument('--baseline-output')
    ap.add_argument('--external-metadata')
    ap.add_argument('--baseline-policy-functions',help='Exact read-only native policy helper definitions for empty isolated baseline only.')
    ap.add_argument('--extension-metadata',help='Read-only native extension/schema metadata; never infer extension placement from a deparsed name.')
    ap.add_argument('--baseline-external-keys',help='Actual auth/storage primary/unique constraints and owner roles, only for the empty isolated baseline.')
    ap.add_argument('--baseline-only',action='store_true',help='Rebuild bounded isolated baseline while requiring and preserving exact frozen proposal bytes.')
    ap.add_argument('--baseline-default-functions',help='Exact actual native default/generated helper definitions and sequence DDL metadata; never invoked.')
    ap.add_argument('--legacy-containment-metadata',help='Actual legacy-table relation metadata plus verified absent runtime callers, for same-OID source-faithful DB01 containment.')
    ap.add_argument('--baseline-constraint-trigger-functions',help='Actual native constraint-trigger callback definitions for isolated baseline only.')
    ap.add_argument('--baseline-fixed-bilateral-controls',help='Exact actual immutable global grammar siblings and capabilities; no tenant/provider/user rows.')
    ap.add_argument('--baseline-policy-support',help='Exact actual recursive pg_policy relation-dependency closure, isolated only; no policy substitution.')
    ap.add_argument('--permission-catalog-metadata',help='Read-only current immutable permission catalog fingerprint; no role or user assignments.')
    ap.add_argument('--baseline-permission-catalog',help='Exact fixed global permission catalog rows for empty isolated compilation only, no assignments.')
    args=ap.parse_args();root=pathlib.Path(args.root).resolve()
    plan=json.load(open(args.plan));native=json.load(open(args.native_metadata))
    legacy_metadata=json.load(open(args.legacy_containment_metadata)) if args.legacy_containment_metadata else {}
    extension_metadata=json.load(open(args.extension_metadata)) if args.extension_metadata else {}
    digest_schemas={v['schema'] for v in extension_metadata.get('digest_signatures',[])}
    digest_schema=next(iter(digest_schemas)) if len(digest_schemas)==1 else None
    source=(root/'supabase/schema.sql').read_bytes()
    if hashlib.sha256(source).hexdigest()!=plan['source_schema_sha256']:raise SystemExit('Canonical source hash changed; rebuild reviewed planner first.')
    clean=re.sub(rb'(?m)^\\[^\n]*',lambda m:b' '*len(m[0]),source)
    statements=json.loads(parser.parse_sql_json(clean.decode()))['stmts']
    all_units=[];fn_units={};table_units={};schema_units={};enum_units={}
    for i,item in enumerate(statements):
        start=item.get('stmt_location',0);length=item.get('stmt_len',0) or len(source)-start
        sql=source[start:start+length].decode().strip()+';';node=item['stmt'];kind=next(iter(node));value=node[kind]
        unit={'id':f'canonical:{i}','kind':kind,'node':node,'sql':sql,'start':start,'length':length}
        all_units.append(unit)
        if kind=='CreateFunctionStmt':fn_units[text_names(value['funcname'])]=unit
        if kind=='CreateStmt':table_units[rv(value['relation'])]=unit
        if kind=='ViewStmt':table_units[rv(value['view'])]=unit
        if kind=='CreateSchemaStmt':schema_units[value['schemaname']]=unit
        if kind=='CreateEnumStmt':enum_units[text_names(value['typeName'])]=unit
    fn_overloads=collections.defaultdict(list)
    for unit in all_units:
        if unit['kind']=='CreateFunctionStmt':fn_overloads[text_names(unit['node']['CreateFunctionStmt']['funcname'])].append(unit)
    def signature_key(sql):
        return signature(sql).replace('public.','').replace('pg_catalog.','')
    # Match exact overloads instead of silently choosing the last catalog row.
    native_by_signature={signature_key(f['definition']):f for f in native['functions']}
    native_fn={name:native_by_signature[signature_key(unit['sql'])] for name,unit in fn_units.items() if signature_key(unit['sql']) in native_by_signature}
    native_extra=[f for f in native['functions'] if f not in native_fn.values()]
    by_id={u['id']:u for u in all_units};native_table={t['name']:t for t in native['relations']};native_schema={s['name']:s for s in native['schemas']}
    selected_fn={o['name'] for o in plan['objects'] if o['kind']=='function'};selected_rel={o['name'] for o in plan['objects'] if o['kind']=='relation'}
    new_fn=selected_fn-set(native_fn);new_rel=selected_rel-set(native_table);new_schema={s['name'] for s in plan['schema_prerequisites']}-set(native_schema)
    fn_owner,table_owner,owner_evidence,owner_limits=infer_owners(root,set(fn_units),set(table_units))
    # Current native functions are retained byte-for-byte unless exact current
    # source drift is observed; replacements preserve existing owners/ACL.
    # Source equality is not permission to overwrite a scoped forward fix
    # already installed after the canonical capture. Reconcile only the four
    # independently reviewed pre-existing native helper-body discrepancies.
    confirmed_body_replacements={
        'gridex_received_sources.closure_wire_tokens_v1',
        'gridex_utilts_binding.stored_contract_v1',
        'gridex_utilts_binding.supported_point_v1',
        'gridex_utilts_binding.validate_contract_v1'}
    body_drift={n for n in selected_fn&set(native_fn) if body(fn_units[n]['sql']).strip()!=native_fn[n]['body'].strip()}
    replace_fn=body_drift&confirmed_body_replacements
    matching_fn=(selected_fn&set(native_fn))-replace_fn
    changed_columns=[];constraints=[];indexes=[];triggers=[];policies=[];rls=[];grants=[];seed_units=[];blocks=[];warnings=[]
    for name in sorted(body_drift-replace_fn):
        warnings.append({'kind':'actual existing function body preserved; current forward fix may postdate source capture','function':name,'actual_body_md5':hashlib.md5(native_fn[name]['body'].encode()).hexdigest(),'source_body_md5':hashlib.md5(body(fn_units[name]['sql']).encode()).hexdigest()})
    phases=collections.OrderedDict((p,[]) for p in ['preflight','roles_schemas','primitive_functions','table_foundations','existing_column_reconciliation','views','remaining_functions','legacy_address_containment','constraints_indexes','existing_index_reconciliation','latest_triggers_policies_rls','source_owned_catalog_rows','owners_grants','postflight'])
    def emit(phase,sql,proof=None):
        phases[phase].append((('-- '+proof+'\n') if proof else '')+sql.strip().rstrip(';')+';')
    emit('preflight',"SET LOCAL lock_timeout = '10s'")
    emit('preflight',"SET LOCAL statement_timeout = '15min'")
    # Fingerprint all existing dependencies; stale metadata cannot be used for
    # a quiet overwrite. This is a catalog assertion, not a business RPC.
    checks=[]
    for f in sorted(native['functions'],key=lambda f:signature(f['definition'])):
        sig=signature(f['definition']);digest=hashlib.md5(f['body'].encode()).hexdigest()
        checks.append(f"IF coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure({quote(sig)})),'absent') <> {quote(digest)} THEN RAISE EXCEPTION 'ops_native_existing_function_drift: %', {quote(sig)}; END IF;")
    emit('preflight','DO $ops_native_preflight$ BEGIN\n'+'\n'.join(checks)+'\nEND $ops_native_preflight$')
    permission_catalog=json.load(open(args.permission_catalog_metadata)) if args.permission_catalog_metadata else None
    required_permission_keys=['communication.write','ediel.source.review','ediel.ai_purpose.review','ediel.bilateral_profile.review','ediel.network_registry.review','ediel.regulated_supply.review','ediel.supply_rescission.review']
    permission_source_expected={}
    if permission_catalog:
        for control in plan['source_owned_catalog_permission_owner_units']:
            if control['ast_kind']!='InsertStmt':continue
            insert=json.loads(parser.parse_sql_json(control['exact_sql']))['stmts'][0]['stmt']['InsertStmt']
            if rv(insert['relation'])!='public.permissions':continue
            cols=[x['ResTarget']['name'] for x in insert.get('cols',[])]
            selection=insert.get('selectStmt',{}).get('SelectStmt',{})
            rows=selection.get('valuesLists') or [{'List':{'items':[x['ResTarget']['val'] for x in selection.get('targetList',[])]}}]
            for row in rows:
                try:values=[const(x) for x in row['List']['items']]
                except (KeyError,ValueError):continue
                expected_row=dict(zip(cols,values));key=expected_row.get('key')
                if key in required_permission_keys:
                    # Active/disabled is an operator control; existing flags
                    # remain protected by the unchanged-row fingerprint.
                    permission_source_expected[key]={k:v for k,v in expected_row.items() if k!='is_active'}
        if set(permission_source_expected)!=set(required_permission_keys):raise SystemExit('Every required permission key must have exact literal canonical source metadata; no guessed registration allowed.')
    if permission_catalog:
        emit('preflight','LOCK TABLE public.permissions IN SHARE ROW EXCLUSIVE MODE','Serialize exact source metadata registration; permission reads remain available')
        expected=permission_catalog['catalog_md5']
        key_list=','.join(quote(k) for k in required_permission_keys)
        emit('preflight',"DO $permission_catalog_pre$ BEGIN IF (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.key COLLATE \"C\")::text,'[]')) FROM public.permissions p WHERE p.key NOT IN ("+key_list+")) IS DISTINCT FROM "+quote(expected)+" THEN RAISE EXCEPTION 'ops_permission_catalog_stale'; END IF; END $permission_catalog_pre$",'Fresh pre-existing catalogue fingerprint with explicit stable collation; seven independently registered exact source keys may already exist and their flags are preserved')
        emit('preflight','CREATE TEMP TABLE ops_api_permission_catalog_before ON COMMIT DROP AS SELECT p.key,to_jsonb(p) AS row_value FROM public.permissions p','Only fixed global metadata, no company/user/role data')
        for key,row in sorted(permission_source_expected.items()):
            fields=quote(json.dumps(row,separators=(',',':'),ensure_ascii=False))+'::jsonb'
            emit('preflight',"DO $permission_source_pre$ BEGIN IF EXISTS(SELECT FROM public.permissions p WHERE p.key="+quote(key)+" AND NOT(to_jsonb(p) @> "+fields+")) THEN RAISE EXCEPTION 'ops_existing_permission_source_metadata_conflict: %',"+quote(key)+"; END IF; END $permission_source_pre$",'Exact source field comparison; preserves existing is_active controls and row identity')
    # Roles are source-owned NOLOGIN identities, never tenant/user membership.
    needed_roles={fn_owner[n] for n in new_fn}|{table_owner[n] for n in new_rel}
    for unit in all_units:
        if unit['kind']!='GrantStmt':continue
        v=unit['node']['GrantStmt'];relevant=False
        for obj in v.get('objects',[]):
            if 'RangeVar' in obj:relevant|=rv(obj['RangeVar']) in selected_rel
            elif 'ObjectWithArgs' in obj:relevant|=text_names(obj['ObjectWithArgs']['objname']) in selected_fn
            elif 'String' in obj:relevant|=obj['String']['sval'] in {x['name'] for x in plan['schema_prerequisites']}
        if relevant:
            needed_roles|={r['RoleSpec']['rolename'] for r in v.get('grantees',[]) if r.get('RoleSpec',{}).get('rolename')}
    needed_roles-={'postgres','anon','authenticated','service_role'}
    for role in sorted(needed_roles):
        if role not in {r['name'] for r in native['roles']}:
            definition=None
            for p in sorted((root/'supabase/migrations').glob('[0-9]*.sql')):
                m=re.search(r'CREATE ROLE\s+'+re.escape(role)+r'\s+([^;]+);',p.read_text(),re.I)
                if m:definition='CREATE ROLE '+ident(role)+' '+m[1];break
            if not definition:blocks.append({'kind':'missing exact role source','role':role});continue
            emit('roles_schemas',definition,'Exact source NOLOGIN role; no membership/activation is seeded')
    owner_public_transfers=any(n.startswith('public.') and fn_owner[n]=='gridex_ediel_retention_owner' for n in new_fn)
    if owner_public_transfers:
        if not native.get('ownership_privileges',{}).get('postgres_retention_member'):
            blocks.append({'kind':'native owner membership missing','role':'gridex_ediel_retention_owner'})
        if not native.get('ownership_privileges',{}).get('retention_public_create'):
            emit('roles_schemas','GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner','Exact temporary source owner-transfer capability; original CREATE state restored at end')
    for schema in sorted(new_schema):
        emit('roles_schemas',schema_units[schema]['sql'],schema_units[schema]['id'])
        emit('roles_schemas',f'REVOKE ALL ON SCHEMA {ident(schema)} FROM PUBLIC,anon,authenticated,service_role','Seal new private namespace immediately')
    if any('EXCLUDE USING gist' in unit['sql'] and rv(unit['node'].get('AlterTableStmt',{}).get('relation')) in selected_rel for unit in all_units):
        if not extension_metadata:blocks.append({'kind':'native btree_gist extension presence/namespace unqualified'})
        elif not any(e['name']=='btree_gist' for e in extension_metadata['extensions']):
            proof='supabase/migrations/20261004223219_ediel_tenant_profile_interval_guard.sql:40; confirmed absent actual extension required by canonical exclusion constraints'
            emit('roles_schemas','CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions',proof)
        emit('roles_schemas','SET LOCAL search_path = pg_catalog, public, extensions','Exact source exclusion-constraint lookup path; qualified private objects retained')
    # Enum is already installed in OPS; baseline includes exact source enum.
    # Table column/default CHECK helpers have no row-type cycle in this graph.
    primitive=plan['compile_order']['pre_table_function_names']
    fn_order=primitive+plan['compile_order']['after_table_function_names']
    for name in primitive:
        if name in new_fn:
            for unit in fn_overloads[name]:
                emit('primitive_functions',unit['sql'],unit['id'])
                emit('primitive_functions',f'REVOKE ALL ON FUNCTION {signature(unit["sql"])} FROM PUBLIC,anon,authenticated,service_role')
        elif name in replace_fn:
            emit('primitive_functions',re.sub(r'CREATE\s+FUNCTION','CREATE OR REPLACE FUNCTION',fn_units[name]['sql'],count=1,flags=re.I),fn_units[name]['id']+'; confirmed existing body drift; ownership/ACL retained')
    for name in sorted(new_rel):
        unit=table_units[name]
        if unit['kind']=='CreateStmt':emit('table_foundations',unit['sql'],unit['id'])
    # Existing column additions are exact canonical ColumnDef clauses. Existing
    # values are never rewritten; non-null defaults are explicit source rules.
    for name in sorted(selected_rel&set(native_table)):
        unit=table_units[name]
        if unit['kind']!='CreateStmt':continue
        node=parse_sql(unit['sql'])[0].stmt;present={c['name']:c for c in native_table[name].get('columns') or []}
        for column in node.tableElts or []:
            if not isinstance(column,ast.ColumnDef) or column.colname in present:continue
            sql=f'ALTER TABLE {name_sql(name)} ADD COLUMN '+RawStream()(column)
            emit('existing_column_reconciliation',sql,unit['id']+'; actual missing source column; no old values rewritten')
            changed_columns.append({'relation':name,'column':column.colname,'sql':sql})
    for name in plan['compile_order']['after_table_function_names']:
        if name in new_fn:
            for unit in fn_overloads[name]:
                emit('remaining_functions',unit['sql'],unit['id'])
                emit('remaining_functions',f'REVOKE ALL ON FUNCTION {signature(unit["sql"])} FROM PUBLIC,anon,authenticated,service_role')
        elif name in replace_fn:
            emit('remaining_functions',re.sub(r'CREATE\s+FUNCTION','CREATE OR REPLACE FUNCTION',fn_units[name]['sql'],count=1,flags=re.I),fn_units[name]['id']+'; confirmed existing body drift; ownership/ACL retained')
    for name in sorted(new_rel):
        if table_units[name]['kind']=='ViewStmt':emit('views',table_units[name]['sql'],table_units[name]['id'])
    if legacy_metadata:
        observed=legacy_metadata['reference_metadata']
        if observed.get('native_function_references') or observed.get('public_creators'):
            blocks.append({'kind':'legacy archive live caller/cutover state changed; must inspect native definitions'})
        required_creators=['public.ediel_create_bilateral_prodat_original_v1','public.ediel_create_national_supply_rescission_original_v1']
        if any(n not in selected_fn or n not in new_fn for n in required_creators):
            raise SystemExit('Source-faithful legacy containment requires both missing original creators in the complete source graph.')
        checks=[]
        for name in required_creators:
            digest=hashlib.md5(body(fn_units[name]['sql']).encode()).hexdigest()
            checks.append("IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure("+quote(signature(fn_units[name]['sql']))+")) IS DISTINCT FROM "+quote(digest)+" THEN RAISE EXCEPTION 'legacy_latest_retired_creator_body_required'; END IF;")
        emit('legacy_address_containment','DO $latest_creators$ BEGIN\n'+'\n'.join(checks)+'\nEND $latest_creators$','Exact latest creator bodies already retire fresh address hints; do not replay old body replacement')
        path=root/'supabase/migrations/20261006210116_ediel_db01_legacy_address_containment.sql';raw=path.read_bytes()
        for item in json.loads(parser.parse_sql_json(raw.decode()))['stmts']:
            node=item['stmt'];kind=next(iter(node));start=item.get('stmt_location',0);length=item.get('stmt_len',0) or len(raw)-start
            sql=raw[start:start+length].decode()
            if kind in ('TransactionStmt','VariableSetStmt','CreateSchemaStmt','CreateFunctionStmt','CreateTrigStmt'):continue
            if kind=='DoStmt' and '$retire_fresh_hints$' in sql:continue
            # Schema/function ACLs are already sealed by canonical new-object
            # phases. The intentional archive table retirement remains exact.
            if kind=='GrantStmt' and node[kind]['objtype']!='OBJECT_TABLE':continue
            emit('legacy_address_containment',sql,str(path.relative_to(root))+':'+str(raw[:start].count(b'\n')+1)+'; same relation/type/OIDs, exact protected rows/FKs/indexes/policies, intentional legacy API retirement')
    # Include exact current canonical adjuncts for selected new objects, and
    # explicitly reconcile observed same-name drift on existing relations.
    for unit in all_units:
        kind=unit['kind'];value=next(iter(unit['node'].values()));target=None
        if kind in ('AlterTableStmt','CreateTrigStmt','IndexStmt','CreatePolicyStmt','AlterPolicyStmt'):
            target=rv(value.get('relation') or value.get('table'))
        if target not in selected_rel:continue
        exists=target in native_table
        if kind=='AlterTableStmt':
            node=parse_sql(unit['sql'])[0].stmt
            for cmd in node.cmds or []:
                command=cmd.subtype.name
                if command=='AT_AddConstraint':
                    definition=cmd.def_;cname=definition.conname
                    old=next((c for c in native_table.get(target,{}).get('constraints') or [] if c['name']==cname),None)
                    clause=RawStream()(definition)
                    if old:
                        # Match PostgreSQL deparsed constraint definitions via
                        # SQL AST normalization where possible; formatting alone
                        # is not a reason to replace a native constraint.
                        oldsql='ALTER TABLE '+name_sql(target)+' ADD CONSTRAINT '+ident(cname)+' '+old['definition']
                        if legacy_metadata and cname in ('ediel_messages_party_address_id_fkey','ediel_route_profiles_party_address_id_fkey'):
                            node=parse_sql(oldsql)[0].stmt
                            constraint=node.cmds[0].def_
                            if constraint.pktable and constraint.pktable.relname=='ediel_party_addresses' and constraint.pktable.schemaname in (None,'public'):
                                constraint.pktable.schemaname='gridex_ediel_legacy_archive'
                                oldsql=RawStream()(node)
                        try:oldclause=RawStream()(parse_sql(oldsql)[0].stmt.cmds[0].def_)
                        except Exception:oldclause=old['definition']
                        old_cmp='ALTER TABLE '+name_sql(target)+' ADD '+oldclause
                        new_cmp='ALTER TABLE '+name_sql(target)+' ADD '+clause
                        if normalized_ast(old_cmp)==normalized_ast(new_cmp):continue
                        emit('constraints_indexes',f'ALTER TABLE {name_sql(target)} DROP CONSTRAINT {ident(cname)}',unit['id']+'; confirmed same-name constraint definition drift')
                    sql=f'ALTER TABLE {name_sql(target)} ADD '+clause
                    emit('constraints_indexes',sql,unit['id'])
                    constraints.append({'relation':target,'name':cname,'replaces_existing':bool(old),'source':unit['id'],**({'actual':old['definition'],'source_definition':clause} if old else {})})
                elif command in ('AT_EnableRowSecurity','AT_ForceRowSecurity'):
                    native_flag='rls' if command=='AT_EnableRowSecurity' else 'force_rls'
                    if exists and native_table[target][native_flag]:continue
                    emit('latest_triggers_policies_rls',unit['sql'],unit['id']);rls.append({'relation':target,'flag':native_flag})
                elif command in ('AT_ColumnDefault','AT_SetNotNull','AT_DropNotNull','AT_AddIdentity'):
                    if not exists:emit('constraints_indexes',unit['sql'],unit['id'])
                    else:warnings.append({'kind':'existing column alteration requires separate review','relation':target,'unit':unit['id'],'sql':unit['sql']})
                else:
                    if not exists:emit('constraints_indexes',unit['sql'],unit['id'])
                    else:warnings.append({'kind':'existing table adjunct preserved','relation':target,'unit':unit['id'],'command':command})
        elif kind=='IndexStmt':
            name=value.get('idxname');old=next((i for i in native_table.get(target,{}).get('indexes') or [] if i['name']==name),None)
            if old:
                if normalized_index(old['definition'],digest_schema)!=normalized_index(unit['sql'],digest_schema):
                    # Only these independently observed, ordinary indexes are
                    # reconciled. None is a constraint-owned/FK-reference index:
                    # four are nonunique and the one unique index has expressions.
                    confirmed_index_drift={
                        ('public.customers','customers_company_customer_number_idx'),
                        ('public.customers','customers_company_email_idx'),
                        ('public.customers','customers_company_email_lower_idx'),
                        ('public.customers','customers_company_intake_status_idx'),
                        ('public.ediel_messages','ux_ediel_outbound_source'),
                        # Source market/application tuple is a strict superset
                        # of the actual valid unique key. Actual pg_constraint
                        # confirms no constraint/FK dependency on this index.
                        ('public.platform_actor_routes','platform_actor_routes_uidx'),
                        ('public.contract_offer_versions','contract_offer_versions_company_offer_idx')}
                    # PostgreSQL inserts this binary-compatible varchar->text
                    # coercion when deparsing the actual index. Actual ediel_id
                    # is text and actor_ediel_id varchar(5), same collation; the
                    # source coalesce already coerces to text implicitly.
                    if (target,name)==('public.ediel_actor_settings','ediel_actor_settings_unique_active_production_ediel_idx'):
                        equivalent=re.sub(r'\(actor_ediel_id\)::text', 'actor_ediel_id',old['definition'])
                        if normalized_index(equivalent,digest_schema)==normalized_index(unit['sql'],digest_schema):
                            warnings.append({'kind':'existing index semantically equivalent varchar/text deparse preserved','relation':target,'index':name,'actual':old['definition']})
                            continue
                    if (target,name) not in confirmed_index_drift:
                        blocks.append({'kind':'same-name index definition drift requires explicit review','relation':target,'name':name,'actual':old['definition'],'source_sql':unit['sql']})
                        continue
                    emit('existing_index_reconciliation','DROP INDEX '+name_sql(target.split('.')[0]+'.'+name),unit['id']+'; confirmed native index drift, constraints installed first, no CASCADE')
                    emit('existing_index_reconciliation',unit['sql'],unit['id']+'; exact latest source index, same transaction; existing rows preserved')
                    indexes.append({'relation':target,'name':name,'replaces_existing':True,'actual':old['definition'],'source_sql':unit['sql']})
                continue
            emit('constraints_indexes',unit['sql'],unit['id']);indexes.append({'relation':target,'name':name})
        elif kind=='CreateTrigStmt':
            name=value['trigname'];old=next((t for t in native_table.get(target,{}).get('triggers') or [] if t['name']==name),None)
            if old:
                try:oldsql=RawStream()(parse_sql(old['definition'])[0].stmt);source_sql=RawStream()(parse_sql(unit['sql'])[0].stmt)
                except Exception:oldsql=old['definition'];source_sql=unit['sql']
                if normalized_ast(oldsql)==normalized_ast(source_sql):continue
                sql=re.sub(r'CREATE\s+(CONSTRAINT\s+)?TRIGGER',lambda m:'CREATE OR REPLACE '+(m[1] or '')+'TRIGGER',unit['sql'],count=1,flags=re.I)
                if value.get('isconstraint'):
                    emit('latest_triggers_policies_rls',f'DROP TRIGGER {ident(name)} ON {name_sql(target)}',unit['id']+'; confirmed exact constraint-trigger drift')
                    sql=unit['sql']
            else:sql=unit['sql']
            emit('latest_triggers_policies_rls',sql,unit['id']+'; full latest transition semantics, no simpler rejection replacement')
            if old and old['enabled']!='O':
                state={'A':'ENABLE ALWAYS','R':'ENABLE REPLICA','D':'DISABLE'}[old['enabled']]
                emit('latest_triggers_policies_rls',f'ALTER TABLE {name_sql(target)} {state} TRIGGER {ident(name)}','Preserve actual trigger enable state')
            triggers.append({'relation':target,'name':name,'replaces_existing':bool(old),'source':unit['id']})
        elif kind=='CreatePolicyStmt':
            name=value['policy_name'];old=next((p for p in native_table.get(target,{}).get('policies') or [] if p['name']==name),None)
            if old:
                commands={'*':'ALL','r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE'}
                oldsql='CREATE POLICY '+ident(name)+' ON '+name_sql(target)+' AS '+('PERMISSIVE' if old['permissive'] else 'RESTRICTIVE')+' FOR '+commands[old['command']]+' TO '+', '.join('PUBLIC' if r=='PUBLIC' else ident(r) for r in old['roles'])
                if old.get('using'):oldsql+=' USING ('+old['using']+')'
                if old.get('check'):oldsql+=' WITH CHECK ('+old['check']+')'
                if normalized_ast(oldsql)==normalized_ast(unit['sql']):continue
                # Canonical permissive policy text can be weaker than the
                # actual deployed authorization boundary. New internal service
                # RPCs need no direct app write widening. Preserve every actual
                # existing policy identity, command, roles and predicates.
                policies.append({'relation':target,'name':name,'replaces_existing':False,'preserved_existing':True,'actual':oldsql,'source_sql':unit['sql'],'reason':'Actual existing authorization preserved; canonical equality does not authorize expansion'})
                continue
            elif exists:
                # Source lifecycle writes intersect the preserved actual admin
                # permissive policies. The helper's actual body requires an
                # allowed session and active/onboarding tenant; NULL company
                # global direct DML is denied while protected definer RPCs keep
                # their existing authorization path. Do not add SELECT filters.
                lifecycle_writes={'tenant_lifecycle_insert_guard','tenant_lifecycle_update_guard','tenant_lifecycle_delete_guard'}
                if target=='public.user_permission_overrides' and name in lifecycle_writes and parse_sql(unit['sql'])[0].stmt.permissive is False and value.get('cmd_name','').lower() in ('insert','update','delete'):
                    emit('latest_triggers_policies_rls',unit['sql'],unit['id']+'; confirmed missing source RESTRICTIVE lifecycle write intersection, preserved stronger actual admin policy, no read restriction')
                    policies.append({'relation':target,'name':name,'replaces_existing':False,'restrictive_write_added':True,'source_sql':unit['sql'],'qualification':'Source/actual helper requires allowed session and active/onboarding tenant. Global NULL company direct authenticated DML is denied; existing SECURITY DEFINER admin RPC authorization is preserved.'})
                    continue
                policies.append({'relation':target,'name':name,'replaces_existing':False,'preserved_existing':True,'actual':None,'source_sql':unit['sql'],'reason':'Existing complete policy set preserved; no new permissive app path or unreviewed restrictive change for service-only RPC installation'})
            else:emit('latest_triggers_policies_rls',unit['sql'],unit['id']);policies.append({'relation':target,'name':name,'replaces_existing':False})
    # Source-controlled literal catalogue seeds. No issuer keys, company/customer
    # rows, role grants or business data are created. Existing control keys win.
    for control in plan['source_owned_catalog_permission_owner_units']:
        if control['ast_kind']!='InsertStmt':continue
        sql=control['exact_sql'];node=parse_sql(sql)[0].stmt;target=rv(json.loads(parser.parse_sql_json(sql))['stmts'][0]['stmt']['InsertStmt']['relation'])
        if target not in selected_rel and target!='public.permissions':continue
        insert=json.loads(parser.parse_sql_json(sql))['stmts'][0]['stmt']['InsertStmt'];selection=insert.get('selectStmt',{}).get('SelectStmt',{})
        if not selection.get('valuesLists'):
            if legacy_metadata and control['file']=='supabase/migrations/20261002233600_ediel_bilateral_prodat_carrier_profiles.sql' and target=='public.ediel_message_profiles':
                continue  # Exact bounded carrier frame is emitted with its source pre/postconditions below.
            # These three source statements project only fixed literal permission
            # keys, or the immutable source-owned decision evidence catalog. They
            # neither assign permissions to users/roles nor update an existing key.
            fixed_permission_sources={
                'supabase/migrations/20260930232100_ediel_requested_change_source_intake_and_review.sql',
                'supabase/migrations/20261001000500_ediel_artifact_retention_decision_and_purge.sql',
                'supabase/migrations/20261001064500_ediel_retention_decision_original_class_workflows.sql'}
            if target=='public.permissions' and control['file'] in fixed_permission_sources:
                canonical=RawStream()(node)
                if node.onConflictClause is None:canonical+=' ON CONFLICT DO NOTHING'
                emit('source_owned_catalog_rows',canonical,control['file']+':'+str(control['line'])+'; exact fixed permission projection, no role assignment or existing-key update')
                seed_units.append({'target':target,'source':control['file'],'line':control['line'],'fixed_permission_projection':True})
                continue
            warnings.append({'kind':'nonliteral source control seed omitted pending row-impact review','target':target,'source':control['file'],'sql':sql});continue
        cols=[c['ResTarget']['name'] for c in insert.get('cols',[])]
        if not cols:
            create=table_units[target]['node']['CreateStmt'];cols=[x['ColumnDef']['colname'] for x in create['tableElts'] if 'ColumnDef' in x]
        if any(c in cols for c in ('company_id','customer_id','user_id','role_id','permission_id','actor_user_id','submitted_by','issuer_key_id','signing_key','receipt_signing_key')):
            blocks.append({'kind':'business/secret-sensitive control seed rejected','target':target,'source':control['file']});continue
        # Always use conflict DO NOTHING for the proposal; preserved operators'
        # existing active/disabled permission values and fixed catalogue keys.
        if node.onConflictClause is not None:
            canonical=RawStream()(node)
            canonical=re.sub(r'\s+ON CONFLICT[\s\S]*$','',canonical,flags=re.I)
        else:canonical=RawStream()(node)
        sql=canonical+' ON CONFLICT DO NOTHING'
        emit('source_owned_catalog_rows',sql,control['file']+':'+str(control['line'])+'; fixed literal control rows, existing keys preserved')
        seed_units.append({'target':target,'source':control['file'],'line':control['line']})
    if legacy_metadata:
        path=root/'supabase/migrations/20261002233600_ediel_bilateral_prodat_carrier_profiles.sql';raw=path.read_bytes()
        for item in json.loads(parser.parse_sql_json(raw.decode()))['stmts']:
            node=item['stmt'];kind=next(iter(node));start=item.get('stmt_location',0);length=item.get('stmt_len',0) or len(raw)-start;sql=raw[start:start+length].decode()
            if kind=='InsertStmt' and rv(node[kind]['relation']) in ('public.ediel_message_profiles','public.ediel_runtime_capabilities'):
                emit('source_owned_catalog_rows',sql,str(path.relative_to(root))+':'+str(raw[:start].count(b'\n')+1)+'; four exact globally immutable grammar carriers/capabilities, no provider activation, tenant role or source authority')
                seed_units.append({'target':rv(node[kind]['relation']),'source':str(path.relative_to(root)),'line':raw[:start].count(b'\n')+1,'bounded_bilateral_frame':True})
            elif kind=='DoStmt' and ('$pre$' in sql or '$cap$' in sql):emit('source_owned_catalog_rows',sql,str(path.relative_to(root))+'; exact four-sibling predecessor / four-capability postcondition')
    # New objects take exact source-resolved owners. Existing owners never move.
    for name in sorted(new_rel):
        obj='VIEW' if table_units[name]['kind']=='ViewStmt' else 'TABLE'
        emit('owners_grants',f'ALTER {obj} {name_sql(name)} OWNER TO {ident(table_owner[name])}','Resolved source owner: '+json.dumps(owner_evidence.get(name,{'migration_runner':'postgres'})))
    for name in sorted(new_fn):
        for unit in fn_overloads[name]:
            emit('owners_grants',f'ALTER FUNCTION {signature(unit["sql"])} OWNER TO {ident(fn_owner[name])}','Resolved source owner: '+json.dumps(owner_evidence.get(name,{'migration_runner':'postgres'})))
    # Canonical ACL statements are split per object. Existing grants are retained:
    # add source-required grants but never broad-revoke present objects/functions.
    for unit in all_units:
        if unit['kind']!='GrantStmt':continue
        value=unit['node']['GrantStmt'];objects=[];supported=[]
        for obj in value.get('objects',[]):
            if 'RangeVar' in obj:
                n=rv(obj['RangeVar']);keep=n in selected_rel or n in ('storage.objects','auth.users');fresh=n in new_rel
            elif 'ObjectWithArgs' in obj:
                n=text_names(obj['ObjectWithArgs']['objname']);keep=n in selected_fn;fresh=n in new_fn
            elif 'String' in obj:
                n=obj['String']['sval'];keep=n in {x['name'] for x in plan['schema_prerequisites']};fresh=n in new_schema
            else:continue
            if keep and (value.get('is_grant') or fresh):supported.append(obj);objects.append(n)
        if not supported:continue
        # Split function ACLs by new/existing object even in mixed canonical
        # GRANT statements. Existing app EXECUTE privileges must not widen just
        # because another object in the same statement is newly installed.
        groups=[(objects,supported,False)]
        if value.get('is_grant'):
            fresh_names=new_fn|new_rel|new_schema
            groups=[([n for n in objects if n in fresh_names],[o for n,o in zip(objects,supported) if n in fresh_names],False),
                    ([n for n in objects if n not in fresh_names],[o for n,o in zip(objects,supported) if n not in fresh_names],True)]
        for group_names,group_objects,owners_only in groups:
            if not group_objects:continue
            node=parse_sql(unit['sql'])[0].stmt
            positions=[i for i,o in enumerate(value['objects']) if o in group_objects]
            node.objects=tuple(node.objects[i] for i in positions)
            if owners_only:
                node.grantees=tuple(g for g in node.grantees if getattr(g,'rolename',None) in needed_roles)
                if not node.grantees:continue
            sql=RawStream()(node)
            emit('owners_grants',sql,unit['id']+'; canonical new-object ACL/additive existing privilege')
            grants.append({'objects':group_names,'grant':value.get('is_grant',False),'source':unit['id'],'sealed_dependency_owners_only':owners_only})
    if owner_public_transfers and not native.get('ownership_privileges',{}).get('retention_public_create'):
        emit('owners_grants','REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner','Restore actual prior schema CREATE privilege after source owner transfer')
    # Auth/storage schema grants are absent from public/gridex-only dumps.
    # Project exact original source GRANT statements onto sealed dependency
    # owners and actual external objects. No user or tenant role is activated.
    for path in sorted((root/'supabase/migrations').glob('[0-9]*.sql')):
        raw=path.read_bytes()
        try: original=json.loads(parser.parse_sql_json(raw.decode()))['stmts']
        except Exception:continue
        for item in original:
            v=item['stmt'].get('GrantStmt')
            if not v or not v.get('is_grant'):continue
            grantees=[g for g in v.get('grantees',[]) if g.get('RoleSpec',{}).get('rolename')=='gridex_ediel_retention_owner']
            if not grantees:continue
            keep=[]
            for i,obj in enumerate(v.get('objects',[])):
                if 'RangeVar' in obj and rv(obj['RangeVar']) in ('auth.users','storage.objects'):keep.append(i)
                if 'ObjectWithArgs' in obj and text_names(obj['ObjectWithArgs']['objname']) in ('auth.uid','auth.role'):keep.append(i)
                if 'String' in obj and obj['String']['sval'] in ('auth','storage'):keep.append(i)
            if not keep:continue
            start=item.get('stmt_location',0);length=item.get('stmt_len',0) or len(raw)-start
            node=parse_sql(raw[start:start+length].decode())[0].stmt
            node.objects=tuple(node.objects[i] for i in keep);node.grantees=tuple(g for g in node.grantees if getattr(g,'rolename',None)=='gridex_ediel_retention_owner')
            emit('owners_grants',RawStream()(node),str(path.relative_to(root))+':'+str(raw[:start].count(b'\n')+1)+'; exact missing external owner prerequisite')
    emit('owners_grants','GRANT USAGE ON SCHEMA storage TO gridex_ediel_retention_owner','Confirmed actual prerequisite: record_basis reads storage.objects; table privilege alone lacks schema USAGE in actual OPS')
    # Preserve exact body/owner/ACL of every unchanged installed function.
    post=[]
    if permission_catalog:
        post.append("IF EXISTS(SELECT FROM ops_api_permission_catalog_before b LEFT JOIN public.permissions p USING(key) WHERE to_jsonb(p) IS DISTINCT FROM b.row_value) THEN RAISE EXCEPTION 'ops_existing_permission_catalog_changed'; END IF;")
        for key in required_permission_keys:
            fields=quote(json.dumps(permission_source_expected[key],separators=(',',':'),ensure_ascii=False))+'::jsonb'
            post.append("IF NOT EXISTS(SELECT FROM public.permissions p WHERE p.key="+quote(key)+" AND to_jsonb(p) @> "+fields+") THEN RAISE EXCEPTION 'ops_required_permission_registration_missing: %',"+quote(key)+"; END IF;")
    for name in sorted(matching_fn):
        f=native_fn[name];sig=signature(f['definition']);digest=hashlib.md5(f['body'].encode()).hexdigest()
        post.append(f"IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure({quote(sig)})) <> {quote(digest)} THEN RAISE EXCEPTION 'ops_native_preserved_function_changed: %',{quote(sig)}; END IF;")
    for f in sorted(native['functions'],key=lambda f:signature(f['definition'])):
        sig=signature(f['definition'])
        name=f['name']
        if f in native_extra:
            digest=hashlib.md5(f['body'].encode()).hexdigest()
            post.append(f"IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure({quote(sig)})) <> {quote(digest)} THEN RAISE EXCEPTION 'ops_native_preserved_overload_changed: %',{quote(sig)}; END IF;")
        post.append(f"IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure({quote(sig)})) <> {quote(f['owner'])} THEN RAISE EXCEPTION 'ops_native_existing_owner_changed: %',{quote(sig)}; END IF;")
        for role,key in [('anon','anon_execute'),('authenticated','authenticated_execute'),('service_role','service_execute')]:
            expected='TRUE' if f[key] else 'FALSE'
            post.append(f"IF has_function_privilege({quote(role)},{quote(sig)},'EXECUTE') IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'ops_native_existing_app_execute_changed: % %',{quote(sig)},{quote(role)}; END IF;")
    for name in plan['required_missing_functions']:
        for unit in fn_overloads[name]:
            sig=signature(unit['sql']);post.append(f"IF to_regprocedure({quote(sig)}) IS NULL THEN RAISE EXCEPTION 'ops_native_required_function_absent: %',{quote(sig)}; END IF;")
    emit('postflight','DO $ops_native_postflight$ BEGIN\n'+'\n'.join(post)+'\nEND $ops_native_postflight$')
    emit('postflight',"NOTIFY pgrst, 'reload schema'")
    header='-- OPS additive native reconciliation proposal; NOT APPLIED.\n-- Explicit target: piidsfebjqjmnepdpnas; Gridex Web excluded.\n-- Fresh native metadata: '+native['checked_at']+'; source hash '+plan['source_schema_sha256']+'\n-- No business/provider RPC, no canonical GEN, no historical replay.\n'
    sql=header+'BEGIN;\n'+''.join('\n-- PHASE '+p+'\n'+'\n\n'.join(values)+'\n' for p,values in phases.items())+'\nCOMMIT;\n'
    if args.baseline_only:
        frozen=json.load(open(args.receipt))['sql_sha256']
        if hashlib.sha256(pathlib.Path(args.output).read_bytes()).hexdigest()!=frozen:raise SystemExit('Frozen proposal bytes differ from recorded custody hash; no files changed.')
    else:pathlib.Path(args.output).write_text(sql)
    receipt={'schema':'ops_native_additive_assembly_v1','status':'REVIEW_PROPOSAL_NOT_APPLIED','project':'piidsfebjqjmnepdpnas','native_checked_at':native['checked_at'],'latest_registered_migration':native['latest_registered_migration'],'source_schema_sha256':plan['source_schema_sha256'],'sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),'sql_bytes':len(sql.encode()),'statement_count':len(parse_sql(sql)),'new_schemas':sorted(new_schema),'new_relations':sorted(new_rel),'new_functions':sorted(new_fn),'confirmed_function_body_replacements':sorted(replace_fn),'preserved_existing_functions':sorted(matching_fn),'existing_column_additions':changed_columns,'constraint_reconciliation':constraints,'trigger_reconciliation':triggers,'indexes_added':indexes,'policies_added':policies,'rls_changes':rls,'source_catalog_seed_units':seed_units,'source_owner_map':{n:fn_owner[n] for n in new_fn},'source_table_owner_map':{n:table_owner[n] for n in new_rel},'owner_resolution_limits':owner_limits,'blocks':blocks,'review_warnings':warnings,'grants':grants,'phases':{p:len(values) for p,values in phases.items()},'safety':{'native_writes':0,'business_rpcs':0,'tests':0,'gen':0,'existing_data_rewritten':False,'historical_migrations_changed':False},'qualification':'Actual source and read-only native catalog. Source gaps/warnings must be resolved before native application; isolated PG compilation and two independent peers are still required.'}
    receipt['extension_metadata']=extension_metadata
    receipt['assembly_input_hashes']={key:hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest() for key,path in {
        'plan':args.plan,'native_metadata':args.native_metadata,'external_metadata':args.external_metadata,
        'baseline_policy_functions':args.baseline_policy_functions,'extension_metadata':args.extension_metadata,
        'baseline_external_keys':args.baseline_external_keys}.items() if path}
    if args.baseline_only:receipt=json.load(open(args.receipt))
    else:pathlib.Path(args.receipt).write_text(json.dumps(receipt,indent=2)+'\n')
    if args.baseline_output:
        external=json.load(open(args.external_metadata)) if args.external_metadata else {}
        external_keys=json.load(open(args.baseline_external_keys)) if args.baseline_external_keys else {}
        default_helpers=json.load(open(args.baseline_default_functions)) if args.baseline_default_functions else {}
        trigger_helpers=json.load(open(args.baseline_constraint_trigger_functions)) if args.baseline_constraint_trigger_functions else {}
        policy_support=json.load(open(args.baseline_policy_support)) if args.baseline_policy_support else {}
        baseline_tables=dict(native_table)
        for table in policy_support.get('relations') or []:
            for column in table['columns']:
                if column.get('generated')=='s':column['generation_expression']=column['default']
            baseline_tables[table['name']]=table
        base=['-- Empty actual OPS catalog baseline for isolated compilation ONLY; NOT canonical GEN or production SQL.','BEGIN;']
        for schema in sorted(set(native_schema)|{'auth','storage'}|{s['name'] for s in external_keys.get('schemas',[])}):base.append(f'CREATE SCHEMA IF NOT EXISTS {ident(schema)};')
        for ext in extension_metadata.get('extensions',[]):
            base.append('CREATE SCHEMA IF NOT EXISTS '+ident(ext['schema'])+';')
            base.append('CREATE EXTENSION IF NOT EXISTS '+ident(ext['name'])+' WITH SCHEMA '+ident(ext['schema'])+';')
        base.append('SET LOCAL search_path = pg_catalog, public, extensions;')
        for role in native['roles']+external_keys.get('roles',[]):
            if role['name'] in ('postgres','anon','authenticated','service_role'):continue
            base.append(f"DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname={quote(role['name'])}) THEN CREATE ROLE {ident(role['name'])} {'SUPERUSER' if role.get('superuser') else 'NOSUPERUSER'} {'LOGIN' if role['login'] else 'NOLOGIN'} {'INHERIT' if role['inherit'] else 'NOINHERIT'} {'BYPASSRLS' if role['bypassrls'] else 'NOBYPASSRLS'} {'CREATEROLE' if role.get('create_role') else 'NOCREATEROLE'} {'CREATEDB' if role.get('create_db') else 'NOCREATEDB'} {'REPLICATION' if role.get('replication') else 'NOREPLICATION'}; END IF; END $$;")
        for schema in native['schemas']+external_keys.get('schemas',[]):
            base.append('ALTER SCHEMA '+ident(schema['name'])+' OWNER TO '+ident(schema['owner'])+';')
            if schema.get('acl') is None:continue
            base.append('REVOKE ALL ON SCHEMA '+ident(schema['name'])+' FROM PUBLIC,anon,authenticated,service_role,gridex_ediel_retention_owner;')
            for item in schema['acl']:
                grantee,rest=item.split('=',1);rights=rest.split('/',1)[0]
                role='PUBLIC' if not grantee else ident(grantee)
                for code,privilege in [('U','USAGE'),('C','CREATE')]:
                    if code in rights:base.append('GRANT '+privilege+' ON SCHEMA '+ident(schema['name'])+' TO '+role+(' WITH GRANT OPTION' if code+'*' in rights else '')+';')
        for enum in enum_units.values():base.append(enum['sql'])
        for sequence in default_helpers.get('sequences',[]):
            for key in ('start','increment','min','max','cache'):
                if not isinstance(sequence[key],str) or not re.fullmatch(r'-?\d+',sequence[key]):
                    raise SystemExit('Sequence catalog integers must be fetched as exact SQL ::text strings; refusing lossy JSON numbers: '+sequence['name']+'.'+key)
            base.append('CREATE SEQUENCE '+name_sql(sequence['name'])+' AS '+sequence['type']+' INCREMENT BY '+str(sequence['increment'])+' MINVALUE '+str(sequence['min'])+' MAXVALUE '+str(sequence['max'])+' START WITH '+str(sequence['start'])+' CACHE '+str(sequence['cache'])+(' CYCLE' if sequence['cycle'] else ' NO CYCLE')+';')
            base.append('ALTER SEQUENCE '+name_sql(sequence['name'])+' OWNER TO '+ident(sequence['owner'])+';')
        external_tables={r['name']:r for r in external.get('relations',[])}
        # pg_get_functiondef may deparse public composite types without their
        # schema prefix. Match both exact qualified and public-visible names,
        # checking every declared parameter and return type before table DDL.
        relation_types=set(baseline_tables)|set(external_tables)
        relation_types|={n.split('.',1)[1] for n in relation_types if n.startswith('public.')}
        generated_functions=set()
        for t in list(baseline_tables.values())+list(external_tables.values()):
            for c in t['columns']:
                if c.get('generated')!='s':continue
                for v in walk(json.loads(parser.parse_sql_json('SELECT '+c['generation_expression']))):
                    if 'FuncCall' in v:
                        target=text_names(v['FuncCall']['funcname'])
                        generated_functions.add(target if '.' in target else 'public.'+target)
        early_fn=[]
        for f in native['functions']:
            # Only real generated-column prerequisites belong before table
            # creation. Every other actual helper waits for its tables/callees.
            if f['name'] not in generated_functions:continue
            name=signature(f['definition'])
            fn=parse_sql(f['definition'])[0].stmt
            declared_types=[p.argType for p in fn.parameters or []]+([fn.returnType] if fn.returnType else [])
            if any('.'.join(x.sval for x in typ.names or []) in relation_types for typ in declared_types):continue
            if re.search(r'%rowtype|\bFROM\s+(?:public|gridex_|auth|storage)\.',f['body'],re.I):continue
            if f['definition'].lower().find('language sql')>=0 and re.search(r'\bFROM\s+(?:public|gridex_|auth|storage)\.',f['body'],re.I):continue
            early_fn.append(name)
        for name in early_fn:
            f=next(f for f in native['functions'] if signature(f['definition'])==name)
            base.append(f['definition'].rstrip(';')+';')
        for name,t in sorted({**external_tables,**baseline_tables}.items()):
            if t.get('kind') in ('v','m'):continue
            columns=[]
            for c in t['columns']:
                col=ident(c['name'])+' '+c['type']
                # Restore actual defaults after their actual helper functions
                # exist; no permissive function stub is used.
                if c.get('generated')=='s':col+=' GENERATED ALWAYS AS ('+c['generation_expression']+') STORED'
                elif c.get('identity'):col+=' GENERATED '+('ALWAYS' if c['identity']=='a' else 'BY DEFAULT')+' AS IDENTITY'
                if c['not_null']:col+=' NOT NULL'
                columns.append(col)
            base.append(f'CREATE TABLE IF NOT EXISTS {name_sql(name)} (\n '+',\n '.join(columns)+'\n);')
        for table in external_keys.get('relations',[]):
            for constraint in table.get('constraints') or []:
                base.append('ALTER TABLE '+name_sql(table['name'])+' ADD CONSTRAINT '+ident(constraint['name'])+' '+constraint['definition']+';')
            owned={c['name'] for c in table.get('constraints') or []}
            for index in table.get('indexes') or []:
                if index['name'] not in owned:base.append(index['definition'].rstrip(';')+';')
            base.append('ALTER TABLE '+name_sql(table['name'])+' OWNER TO '+ident(table['owner'])+';')
        for f in external.get('functions',[]):base.append(f['definition'].rstrip(';')+';')
        baseline_views={}
        for name,t in sorted(baseline_tables.items()):
            if t.get('kind') not in ('v','m'):continue
            if t['kind']=='m':raise SystemExit('Bounded baseline must qualify actual materialized view storage; no table substitute is allowed.')
            opts=' WITH ('+', '.join(t.get('options') or [])+')' if t.get('options') else ''
            baseline_views[name]='CREATE VIEW '+name_sql(name)+opts+' AS '+t['view_definition'].rstrip(';')+';'
        # All actual row types now exist. Restore genuine policy helpers and
        # SQL dependency order; never substitute permissive fake helpers.
        baseline_fn={signature(f['definition']):f for f in native['functions']}
        baseline_fn.update({signature(f['definition']):f for f in default_helpers.get('functions',[])})
        baseline_fn.update({signature(f['definition']):f for f in trigger_helpers.get('functions',[])})
        if args.baseline_policy_functions:
            baseline_fn.update({signature(f['definition']):f for f in json.load(open(args.baseline_policy_functions))})
        baseline_by_name=collections.defaultdict(set)
        for sig,f in baseline_fn.items():baseline_by_name[f['name']].add(sig)
        depgraph={}
        def catalog_dependencies(tree):
            deps=set()
            for v in walk(tree):
                if 'FuncCall' in v:
                    target=text_names(v['FuncCall']['funcname']);target=target if '.' in target else 'public.'+target
                    deps.update(baseline_by_name.get(target,set()))
                if 'RangeVar' in v or ('relname' in v and 'relpersistence' in v):
                    target=rv(v.get('RangeVar',v))
                    if target in baseline_views:deps.add('view:'+target)
            return deps
        for name,f in baseline_fn.items():
            node=json.loads(parser.parse_sql_json(f['definition']))['stmts'][0]['stmt']['CreateFunctionStmt']
            language=next((o['DefElem']['arg']['String']['sval'] for o in node['options'] if o['DefElem']['defname']=='language'),None)
            deps=set()
            if language=='sql':
                try:deps|=catalog_dependencies(json.loads(parser.parse_sql_json(body(f['definition']))))
                except Exception:pass
            # Declared composite view parameters/returns and PLpgSQL %ROWTYPE
            # declarations also require the exact view type before creation.
            for view in baseline_views:
                short=view.split('.',1)[1]
                if re.search(r'\b'+re.escape(view)+r'%ROWTYPE\b',f['definition'],re.I):deps.add('view:'+view)
                fn=parse_sql(f['definition'])[0].stmt
                for typ in [p.argType for p in fn.parameters or []]+([fn.returnType] if fn.returnType else []):
                    typename='.'.join(v.sval for v in typ.names or [])
                    if typename==view or (view.startswith('public.') and typename==short):deps.add('view:'+view)
            depgraph[name]=deps-{name}
        for name,sql in baseline_views.items():depgraph['view:'+name]=catalog_dependencies(json.loads(parser.parse_sql_json(sql)))-{'view:'+name}
        baseline_order=[];visited=set()
        def visit(n):
            if n in visited:return
            visited.add(n)
            for dep in sorted(depgraph[n]):visit(dep)
            baseline_order.append(n)
        for name in sorted(depgraph):visit(name)
        for name in baseline_order:
            if name.startswith('view:'):base.append(baseline_views[name[5:]])
            elif name not in early_fn:base.append(baseline_fn[name]['definition'].rstrip(';')+';')
        for name,f in baseline_fn.items():
            sig=signature(f['definition'])
            if f.get('acl') is not None:
                base.append(f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated,service_role;')
                for item in f['acl']:
                    grantee,rest=item.split('=',1);rights=rest.split('/',1)[0]
                    if 'X' not in rights:continue
                    role='PUBLIC' if not grantee else ident(grantee)
                    base.append(f'GRANT EXECUTE ON FUNCTION {sig} TO {role}'+(' WITH GRANT OPTION' if 'X*' in rights else '')+';')
            base.append(f'ALTER FUNCTION {sig} OWNER TO {ident(f["owner"])};')
        for name,t in sorted(baseline_tables.items()):
            for policy in t.get('policies') or []:
                commands={'*':'ALL','r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE'}
                sql='CREATE POLICY '+ident(policy['name'])+' ON '+name_sql(name)+' AS '+('PERMISSIVE' if policy['permissive'] else 'RESTRICTIVE')+' FOR '+commands[policy['command']]+' TO '+', '.join('PUBLIC' if r=='PUBLIC' else ident(r) for r in policy['roles'])
                if policy.get('using'):sql+=' USING ('+policy['using']+')'
                if policy.get('check'):sql+=' WITH CHECK ('+policy['check']+')'
                base.append(sql+';')
            if t['rls']:base.append('ALTER TABLE '+name_sql(name)+' ENABLE ROW LEVEL SECURITY;')
            if t['force_rls']:base.append('ALTER TABLE '+name_sql(name)+' FORCE ROW LEVEL SECURITY;')
        for name,t in sorted(baseline_tables.items()):
            for c in t['columns']:
                if c.get('default') and not c.get('generated') and not c.get('identity'):base.append(f'ALTER TABLE {name_sql(name)} ALTER COLUMN {ident(c["name"])} SET DEFAULT '+c['default']+';')
        baseline_skips=[]
        known_rel=set(baseline_tables)|set(external_tables)
        baseline_fk=[]
        for name,t in sorted(baseline_tables.items()):
            for c in t.get('constraints') or []:
                if c['type']=='t':continue
                refs=re.findall(r'REFERENCES\s+(?:(\w+)\.)?(\w+)\(',c['definition'],re.I)
                external_refs=[(schema or 'public')+'.'+table for schema,table in refs if (schema or 'public')+'.'+table not in known_rel]
                if external_refs:baseline_skips.append({'relation':name,'constraint':c['name'],'external_references':external_refs});continue
                sql=f'ALTER TABLE {name_sql(name)} ADD CONSTRAINT {ident(c["name"])} '+c['definition']+';'
                # Foreign keys require every referenced native primary/unique
                # key first, irrespective of relation/name catalog sort order.
                if c['type']=='f':baseline_fk.append(sql)
                else:base.append(sql)
            base.append(f'ALTER TABLE {name_sql(name)} OWNER TO {ident(t["owner"])};')
        for name,t in sorted(baseline_tables.items()):
            constraints_idx={c['name'] for c in t.get('constraints') or [] if c['type'] in ('p','u','x')}
            for index in t.get('indexes') or []:
                if index['name'] not in constraints_idx:base.append(index['definition'].rstrip(';')+';')
        base.extend(baseline_fk)
        for name,t in sorted(baseline_tables.items()):
            constraint_triggers={c['name'] for c in t.get('constraints') or [] if c['type']=='t'}
            for trigger in t.get('triggers') or []:
                if trigger['name'] in constraint_triggers:
                    base.append(trigger['definition'].rstrip(';')+';')
                    if trigger['enabled']!='O':base.append('ALTER TABLE '+name_sql(name)+' '+{'A':'ENABLE ALWAYS','R':'ENABLE REPLICA','D':'DISABLE'}[trigger['enabled']]+' TRIGGER '+ident(trigger['name'])+';')
        # Current fixed control catalogue rows are the only cloned rows.
        # They carry no customer, company, issuer/signing or actor data.
        rows=native.get('record_class_catalog_rows') or []
        for row in rows:
            cols=list(row);values=[]
            for col in cols:
                v=row[col]
                if v is None:values.append('NULL')
                elif isinstance(v,(dict,list)):values.append(quote(json.dumps(v,separators=(',',':')))+'::jsonb')
                elif isinstance(v,bool):values.append('TRUE' if v else 'FALSE')
                elif isinstance(v,(int,float)):values.append(str(v))
                else:values.append(quote(str(v)))
            base.append('INSERT INTO gridex_ediel_retention.record_class_catalog ('+', '.join(ident(c) for c in cols)+') VALUES ('+', '.join(values)+') ON CONFLICT DO NOTHING;')
        if args.baseline_fixed_bilateral_controls:
            controls=json.load(open(args.baseline_fixed_bilateral_controls))
            for key,table in [('rule_packs','public.ediel_rule_packs'),('profiles','public.ediel_message_profiles'),('capabilities','public.ediel_runtime_capabilities')]:
                for row in controls[key]:
                    values=[]
                    for v in row.values():
                        if v is None:values.append('NULL')
                        elif isinstance(v,(dict,list)):values.append(quote(json.dumps(v,separators=(',',':')))+'::jsonb')
                        elif isinstance(v,bool):values.append('TRUE' if v else 'FALSE')
                        elif isinstance(v,(int,float)):values.append(str(v))
                        else:values.append(quote(str(v)))
                    base.append('INSERT INTO '+name_sql(table)+' ('+', '.join(ident(c) for c in row)+') VALUES ('+', '.join(values)+');')
        if args.baseline_permission_catalog:
            catalogue=json.load(open(args.baseline_permission_catalog))
            for row in catalogue['rows']:
                if set(row)&{'user_id','role_id','company_id','customer_id','permission_id'}:raise SystemExit('Fixed permission baseline must contain only global catalogue metadata, not grants or business rows.')
                values=[]
                for v in row.values():
                    if v is None:values.append('NULL')
                    elif isinstance(v,(dict,list)):values.append(quote(json.dumps(v,separators=(',',':')))+'::jsonb')
                    elif isinstance(v,bool):values.append('TRUE' if v else 'FALSE')
                    elif isinstance(v,(int,float)):values.append(str(v))
                    else:values.append(quote(str(v)))
                base.append('INSERT INTO public.permissions ('+', '.join(ident(c) for c in row)+') VALUES ('+', '.join(values)+');')
        base.append('COMMIT;');baseline='\n\n'.join(base)+'\n';pathlib.Path(args.baseline_output).write_text(baseline)
        receipt['isolated_baseline']={'file':args.baseline_output,'sha256':hashlib.sha256(baseline.encode()).hexdigest(),'bytes':len(baseline),'external_fk_constraints_not_recreated':baseline_skips,'limits':'Empty actual native table columns/defaults/generated expressions, actual selected function bodies/owners/ACL, actual selected policies/RLS and fixed catalog rows. All available native primary/unique constraints precede foreign keys. Existing native triggers and table ACL are recorded but not restored in this bounded baseline; listed external foreign keys are omitted. No permissive substitutes or business rows. Complete deployed readiness requires actual OPS catalog/postapply verification.'}
        pathlib.Path(args.receipt).write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({k:receipt[k] for k in ('sql_bytes','statement_count','confirmed_function_body_replacements')},ensure_ascii=False))
    print(json.dumps({'new_functions':len(new_fn),'new_relations':len(new_rel),'new_schemas':len(new_schema),'missing_columns':len(changed_columns),'owner_limits':len(owner_limits),'blocks':len(blocks),'warnings':len(warnings)}))

def portable_delivery_main():
    """Dispatch exact guarded OPS upgrade or already-complete source state.

    The complete-state contract contains no business rows, OIDs, catalogue UUIDs
    or sequence current values. Unknown/partial states retain the OPS guards.
    """
    ap=argparse.ArgumentParser(description=portable_delivery_main.__doc__)
    ap.add_argument('--ops-sql',required=True)
    ap.add_argument('--probe',required=True)
    ap.add_argument('--manifest',required=True)
    ap.add_argument('--existing-probe',required=True)
    ap.add_argument('--existing-variants',required=True)
    ap.add_argument('--policy-predicates',required=True)
    ap.add_argument('--helper-upgrades',help='Exact reviewed four source helper before/after contracts and CREATE statements.')
    ap.add_argument('--output',required=True)
    ap.add_argument('--receipt',required=True)
    args=ap.parse_args()
    ops=pathlib.Path(args.ops_sql).read_text()
    statements=parse_sql(ops)
    if not isinstance(statements[0].stmt,ast.TransactionStmt) or not isinstance(statements[-1].stmt,ast.TransactionStmt):raise SystemExit('OPS branch must retain its exact reviewed BEGIN/COMMIT frame.')
    # Strip only the top-level transaction statements; the outer frame now owns
    # the same atomic transaction. All inner source statement bytes are retained.
    raw=ops.encode();parsed=json.loads(parser.parse_sql_json(ops))['stmts']
    start=parsed[0].get('stmt_location',0)+parsed[0].get('stmt_len',0)+1
    end=parsed[-1].get('stmt_location',0)
    ops_body=raw[start:end].decode()
    def query(path):
        s=pathlib.Path(path).read_text()
        return re.sub(r'^SET search_path=pg_catalog,public,extensions;\s*','',s).strip().rstrip(';')
    probe=query(args.probe);existing_probe=query(args.existing_probe)
    manifest_text=pathlib.Path(args.manifest).read_text().strip()
    manifest=json.loads(manifest_text)
    expected_hash=hashlib.md5(manifest_text.encode()).hexdigest()
    variants=json.load(open(args.existing_variants))
    policy_predicates=json.load(open(args.policy_predicates))
    encoded_variants=json.dumps(variants,separators=(',',':'),ensure_ascii=False)
    helper_contracts=json.load(open(args.helper_upgrades)) if args.helper_upgrades else []
    helper_normalize=[];helper_apply=[]
    if helper_contracts and len(helper_contracts)!=4:raise SystemExit('The bounded scoped-helper repair requires exactly four explicit contracts.')
    for contract in helper_contracts:
        before=contract['before'];after=contract['after'];statement=contract['sql']
        if before['signature']!=after['signature'] or {k:v for k,v in before.items() if k!='body_md5'}!={k:v for k,v in after.items() if k!='body_md5'}:raise SystemExit('Scoped helper changes must retain every non-body attribute.')
        if len(parse_sql(statement))!=1 or not isinstance(parse_sql(statement)[0].stmt,ast.CreateFunctionStmt):raise SystemExit('Scoped helper repair requires one exact CREATE function statement.')
        if after not in manifest['functions']:raise SystemExit('Strong helper contract is missing from the complete-state manifest.')
        fixed=contract['fixed_pg_proc_attributes']
        fields="jsonb_build_object('cost',p.procost,'rows',p.prorows,'language',(SELECT lanname FROM pg_language WHERE oid=p.prolang),'arguments_count',p.pronargs,'binary',p.probin,'sql_body',p.prosqlbody::text,'support',CASE WHEN p.prosupport=0 THEN NULL ELSE p.prosupport::regprocedure::text END,'variadic',CASE WHEN p.provariadic=0 THEN NULL ELSE p.provariadic::regtype::text END,'transforms',CASE WHEN p.protrftypes IS NULL THEN NULL ELSE (SELECT jsonb_agg(t::regtype::text ORDER BY ordinal) FROM unnest(p.protrftypes) WITH ORDINALITY a(t,ordinal)) END)"
        full_guard="IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure("+quote(before['signature'])+") AND "+fields+"="+quote(json.dumps(fixed,separators=(',',':'),ensure_ascii=False))+"::jsonb) THEN RAISE EXCEPTION 'ops_portable_scoped_helper_full_attributes_drift: %',"+quote(before['signature'])+"; END IF;"
        snapshot="helper_before:=helper_before||jsonb_build_object("+quote(before['signature'])+",(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=to_regprocedure("+quote(before['signature'])+")));"
        old=quote(json.dumps(before,separators=(',',':'),ensure_ascii=False))+'::jsonb'
        new=quote(json.dumps(after,separators=(',',':'),ensure_ascii=False))+'::jsonb'
        helper_normalize.append("IF EXISTS(SELECT FROM jsonb_array_elements(observed->'functions') f WHERE f="+old+" OR f="+new+") THEN "+full_guard+" END IF; IF EXISTS(SELECT FROM jsonb_array_elements(observed->'functions') f WHERE f="+old+") THEN "+snapshot+" helper_repairs:=array_append(helper_repairs,"+quote(statement)+"); observed:=jsonb_set(observed,'{functions}',(SELECT jsonb_agg(CASE WHEN f="+old+" THEN "+new+" ELSE f END ORDER BY ordinal) FROM jsonb_array_elements(observed->'functions') WITH ORDINALITY a(f,ordinal))); END IF;")
    if helper_contracts:
        helper_apply.append("FOREACH repair_sql IN ARRAY helper_repairs LOOP EXECUTE repair_sql; END LOOP;")
        helper_apply.append("FOR repair_signature,repair_attributes IN SELECT key,value FROM jsonb_each(helper_before) LOOP IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=to_regprocedure(repair_signature)) IS DISTINCT FROM repair_attributes THEN RAISE EXCEPTION 'ops_portable_scoped_helper_metadata_changed: %',repair_signature; END IF; END LOOP;")
        helper_apply.append("EXECUTE "+quote(probe)+" INTO observed; IF md5(observed::text)<>"+quote(expected_hash)+" THEN RAISE EXCEPTION 'ops_portable_scoped_helper_poststate_drift'; END IF;")
    # Resolving a composite function argument before its table exists raises,
    # rather than returning NULL. Check namespace/relation/function names first
    # so an exact partial OPS baseline reaches its reviewed preconditions.
    schemas=[x['name'] for x in manifest['schemas']]
    relations=[x['name'] for x in manifest['relations']]
    fn_names=sorted({x['signature'].split('(',1)[0] for x in manifest['functions']})
    candidates="SELECT NOT EXISTS(SELECT FROM unnest(ARRAY["+','.join(map(quote,schemas))+"]::text[]) s WHERE NOT EXISTS(SELECT FROM pg_namespace WHERE nspname=s)) AND NOT EXISTS(SELECT FROM unnest(ARRAY["+','.join(map(quote,relations))+"]::text[]) r WHERE to_regclass(r) IS NULL) AND NOT EXISTS(SELECT FROM unnest(ARRAY["+','.join(map(quote,fn_names))+"]::text[]) f WHERE NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=f))"
    tag='$ops_exact_'+hashlib.sha256(ops_body.encode()).hexdigest()[:20]+'$'
    if tag in ops_body:raise SystemExit('Unexpected delimiter collision; refuse to alter OPS statement bytes.')
    metadata_units=[]
    metadata_pre=re.findall(r'DO \$permission_source_pre\$.*?END \$permission_source_pre\$;',ops,re.S)
    if len(metadata_pre)!=7:raise SystemExit('Exact reviewed seven source permission guards required.')
    for item in parsed:
        node=item['stmt'].get('InsertStmt')
        if not node:continue
        target=rv(node['relation'])
        # The two bounded four-carrier projections have their own complete-key
        # verification below; replaying their predecessor precondition is wrong.
        if target in ('public.ediel_message_profiles','public.ediel_runtime_capabilities'):continue
        location=item.get('stmt_location',0);length=item.get('stmt_len',0)
        metadata_units.append(raw[location:location+length].decode().strip().rstrip(';')+';')
    metadata_preserve="LOCK TABLE public.permissions IN SHARE ROW EXCLUSIVE MODE; CREATE TEMP TABLE ops_api_complete_permission_before ON COMMIT DROP AS SELECT key,to_jsonb(p) row_value FROM public.permissions p;"
    metadata_after="DO $permission_complete_post$ BEGIN IF EXISTS(SELECT FROM ops_api_complete_permission_before b LEFT JOIN public.permissions p USING(key) WHERE to_jsonb(p) IS DISTINCT FROM b.row_value) THEN RAISE EXCEPTION 'ops_complete_permission_rows_changed'; END IF; IF (SELECT count(*) FROM public.permissions WHERE key IN ('communication.write','ediel.source.review','ediel.ai_purpose.review','ediel.bilateral_profile.review','ediel.network_registry.review','ediel.regulated_supply.review','ediel.supply_rescission.review'))<>7 THEN RAISE EXCEPTION 'ops_complete_source_permissions_required'; END IF; END $permission_complete_post$;"
    # This predicate is copied from the actual authenticated write policies,
    # intersected with an explicit non-global company. It does not replace or
    # broaden an existing permissive policy or add any application privilege.
    admin="(company_id IS NOT NULL AND (SELECT public.gridex_user_is_platform_admin()))"
    policies=[]
    for command in ('INSERT','UPDATE','DELETE'):
        name='ops_api_platform_admin_'+command.lower()+'_guard'
        clauses=(' WITH CHECK ('+admin+')' if command=='INSERT' else ' USING ('+admin+')'+(' WITH CHECK ('+admin+')' if command=='UPDATE' else ''))
        policies.append((name,command,'CREATE POLICY '+ident(name)+' ON public.user_permission_overrides AS RESTRICTIVE FOR '+command+' TO authenticated'+clauses))
    for command in ('INSERT','UPDATE','DELETE'):
        name='tenant_lifecycle_'+command.lower()+'_guard'
        predicate='public.gridex_can_write_company(company_id)'
        clauses=(' WITH CHECK ('+predicate+')' if command=='INSERT' else ' USING ('+predicate+')'+(' WITH CHECK ('+predicate+')' if command=='UPDATE' else ''))
        policies.append((name,command,'CREATE POLICY '+ident(name)+' ON public.user_permission_overrides AS RESTRICTIVE FOR '+command+' TO authenticated'+clauses))
    policy_sql=[]
    for name,command,create in policies:
        # Exact policy text is independently compiled to generate pg_get_expr
        # form in the bounded fixture. Existing identity drift must never pass.
        expected=policy_predicates[name]
        using='NULL' if expected['using'] is None else quote(expected['using'])
        check='NULL' if expected['check'] is None else quote(expected['check'])
        policy_sql.append("IF NOT EXISTS(SELECT FROM pg_policy WHERE polrelid='public.user_permission_overrides'::regclass AND polname="+quote(name)+") THEN EXECUTE "+quote(create)+"; ELSE IF EXISTS(SELECT FROM pg_policy WHERE polrelid='public.user_permission_overrides'::regclass AND polname="+quote(name)+" AND (polpermissive OR polcmd<>"+quote({'INSERT':'a','UPDATE':'w','DELETE':'d'}[command])+" OR polroles<>ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')] OR pg_get_expr(polqual,polrelid) IS DISTINCT FROM "+using+" OR pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM "+check+")) THEN RAISE EXCEPTION 'ops_portable_restrictive_policy_drift: %',"+quote(name)+"; END IF; END IF;")
    sql="-- Portable OPS API module delivery; guarded exact OPS upgrade or exact complete source state.\n-- No historical replay, business rows, catalogue UUID identity or new application grant.\nBEGIN;\nSET LOCAL search_path=pg_catalog,public,extensions;\nSET LOCAL lock_timeout='10s';\nSET LOCAL statement_timeout='15min';\nDO $ops_portable_delivery$\nDECLARE\n observed jsonb; existing jsonb; item jsonb; candidate boolean;\n allowed constant jsonb := "+quote(encoded_variants)+"::jsonb;\nBEGIN\n EXECUTE "+quote(candidates)+" INTO candidate;\n IF candidate THEN EXECUTE "+quote(probe)+" INTO observed; END IF;\n IF md5(observed::text)="+quote(expected_hash)+" THEN\n  EXECUTE "+quote(existing_probe)+" INTO existing;\n  FOR item IN SELECT value FROM jsonb_array_elements(existing) LOOP\n   IF NOT coalesce((allowed->(item->>'signature')) @> jsonb_build_array(item),false) THEN RAISE EXCEPTION 'ops_portable_existing_function_drift: %',item->>'signature'; END IF;\n  END LOOP;\n  -- Source-only immutable global metadata registration. Existing IDs/flags win.\n  EXECUTE "+quote(metadata_preserve+'\n'+'\n'.join(metadata_pre+metadata_units+metadata_pre)+ '\n'+metadata_after)+";\n  IF (SELECT count(*) FROM public.ediel_message_profiles p WHERE p.profile_key IN ('PRODAT:Z03:H:26.A:r3','PRODAT:Z04:H:26.A:r3','PRODAT:Z05:H:26.A:r3','PRODAT:Z08:LK:26.A:r3') AND p.profile->>'bilateralCarrierOnly'='true')<>4 THEN RAISE EXCEPTION 'ops_portable_bilateral_carrier_metadata_required'; END IF;\n  IF (SELECT count(*) FROM public.ediel_runtime_capabilities c JOIN public.ediel_message_profiles p ON p.rule_pack_id=c.rule_pack_id AND p.message_code=c.message_code AND p.transaction_subtype=c.transaction_subtype AND p.direction=c.direction WHERE p.profile->>'bilateralCarrierOnly'='true' AND p.profile_key IN ('PRODAT:Z03:H:26.A:r3','PRODAT:Z04:H:26.A:r3','PRODAT:Z05:H:26.A:r3','PRODAT:Z08:LK:26.A:r3'))<>4 THEN RAISE EXCEPTION 'ops_portable_bilateral_capabilities_required'; END IF;\n  RAISE NOTICE 'ops_api_delivery_complete_source_state';\n ELSE\n  EXECUTE "+tag+ops_body+tag+";\n  RAISE NOTICE 'ops_api_delivery_guarded_ops_upgrade';\n END IF;\n -- Both branches retain stricter actual authorization and deny global direct DML.\n "+'\n '.join(policy_sql)+"\nEND $ops_portable_delivery$;\nCOMMIT;\n"
    if helper_contracts:
        sql=sql.replace('observed jsonb; existing jsonb; item jsonb; candidate boolean;',"observed jsonb; existing jsonb; item jsonb; candidate boolean; helper_repairs text[]:=ARRAY[]::text[]; repair_sql text; helper_before jsonb:='{}'::jsonb; repair_signature text; repair_attributes jsonb;")
        sql=sql.replace('IF candidate THEN EXECUTE '+quote(probe)+' INTO observed; END IF;','IF candidate THEN EXECUTE '+quote(probe)+' INTO observed; '+ '\n '.join(helper_normalize)+' END IF;')
        sql=sql.replace('  -- Source-only immutable global metadata registration.', '  '+ '\n  '.join(helper_apply)+'\n  -- Source-only immutable global metadata registration.')
    pathlib.Path(args.output).write_text(sql)
    receipt={'schema':'ops_api_portable_delivery_proposal_v1','status':'PROTOTYPE_NOT_NATIVE_APPLIED','sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),'bytes':len(sql.encode()),'ops_source_sha256':hashlib.sha256(raw).hexdigest(),'ops_inner_source_sha256':hashlib.sha256(ops_body.encode()).hexdigest(),'complete_manifest_md5':expected_hash,'probe_sha256':hashlib.sha256(probe.encode()).hexdigest(),'existing_variants':len(variants),'metadata_insert_units_complete_branch':len(metadata_units),'new_restrictive_admin_policies':[x[0] for x in policies[:3]],'qualified_scope':'Exact current OPS-shaped guarded upgrade and recognized complete source module only; not proof of all historical migration clean replay. Unknown partial or code/structure/owner/ACL drift refuses complete branch and remains subject to exact OPS guards.'}
    receipt['scoped_helper_upgrade_signatures']=[x['after']['signature'] for x in helper_contracts]
    pathlib.Path(args.receipt).write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))

if __name__=='__main__':
    import sys
    if '--portable-delivery' in sys.argv:
        sys.argv.remove('--portable-delivery');portable_delivery_main()
    elif '--historical-audit-only' in sys.argv:
        sys.argv.remove('--historical-audit-only');main()
    else:
        raise SystemExit('Use --portable-delivery for the reviewed portable proposal; legacy reconstruction requires explicit --historical-audit-only and must not be applied.')
