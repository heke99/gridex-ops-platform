#!/usr/bin/env python3
"""Read-only source/metadata planner. Never connects to or mutates a database.

Requires pglast==7.7 (an external parser tool, not a project runtime dependency).
Inputs: genuine current canonical SQL and independently fetched native metadata.
Outputs SQL statement locations and exact hashes; does not invent permissive RPCs.
"""
from __future__ import annotations
import argparse, bisect, hashlib, json, pathlib, re, subprocess
from collections import defaultdict, deque
from pglast import parser


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def strings(values):
    return [x.get('String', {}).get('sval') for x in values or []]


def qualified(values):
    parts = strings(values)
    return '.'.join(parts) if all(parts) else None


def relation(value):
    if not value:
        return None
    return (value.get('schemaname') or 'public') + '.' + value['relname']


def object_name(stmt):
    kind, value = next(iter(stmt.items()))
    if kind == 'CreateFunctionStmt':
        name = qualified(value['funcname'])
        return ('function', name if '.' in name else 'public.' + name)
    if kind in ('CreateStmt', 'ViewStmt'):
        return ('relation', relation(value.get('relation') or value.get('view')))
    if kind == 'CreateSchemaStmt':
        return ('schema', value['schemaname'])
    if kind in ('CreateEnumStmt', 'CompositeTypeStmt', 'CreateDomainStmt'):
        names = value.get('typeName') or value.get('domainname')
        return ('type', qualified(names) if names else relation(value.get('typevar')))
    if kind == 'CreateExtensionStmt':
        return ('extension', value['extname'])
    return (None, None)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', default='.')
    ap.add_argument('--native-metadata', required=True)
    ap.add_argument('--external-metadata', help='Optional read-only catalog evidence for Auth/storage prerequisites.')
    ap.add_argument('--output', required=True)
    ap.add_argument('--function', action='append', dest='function_names', help='Repeat to restrict closure to exact canonical function names (schema-qualified). Defaults to 51 missing preflight functions.')
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    native = json.loads(pathlib.Path(args.native_metadata).read_text())
    external_native = json.loads(pathlib.Path(args.external_metadata).read_text()) if args.external_metadata else None
    preflight = json.loads((root/'quality/audits/2026-10-12-ops-api-contracts/required-native-preflight-result.json').read_text())
    required = args.function_names or ['public.' + r['name'] for r in preflight['rows'] if r['missing']]
    required = [n if '.' in n else 'public.'+n for n in required]
    source_bytes = (root/'supabase/schema.sql').read_bytes()
    # Preserve original byte positions while removing psql dump control lines.
    clean_bytes = re.sub(rb'(?m)^\\[^\n]*', lambda m: b' ' * len(m[0]), source_bytes)
    parsed = json.loads(parser.parse_sql_json(clean_bytes.decode()))['stmts']
    newline_offsets = [m.start() for m in re.finditer(b'\n', source_bytes)]
    units = []
    definitions = defaultdict(list)
    functions = defaultdict(list)
    tables = {}
    adjuncts = defaultdict(list)
    for ordinal, item in enumerate(parsed):
        start = item.get('stmt_location', 0)
        length = item.get('stmt_len', 0) or len(source_bytes)-start
        sql = source_bytes[start:start+length].decode()
        stmt = item['stmt']; ast_kind = next(iter(stmt))
        kind, name = object_name(stmt)
        unit = {'id': f'canonical:{ordinal}', 'ast_kind': ast_kind, 'kind': kind,
                'name': name, 'byte_start': start, 'byte_length': length,
                'line': bisect.bisect_left(newline_offsets,start)+1,
                'sha256': hashlib.sha256(sql.encode()).hexdigest(), 'ast': stmt, 'sql': sql}
        units.append(unit)
        if kind and name:
            definitions[(kind, name)].append(unit)
            if kind == 'function': functions[name].append(unit)
            if kind == 'relation': tables[name] = unit
        value = next(iter(stmt.values()))
        target = None
        if ast_kind in ('AlterTableStmt','CreateTrigStmt','IndexStmt','CreatePolicyStmt','AlterPolicyStmt'):
            target = relation(value.get('relation') or value.get('table'))
        if ast_kind == 'GrantStmt':
            for obj in value.get('objects', []):
                if 'RangeVar' in obj:
                    adjuncts[relation(obj['RangeVar'])].append(unit)
                elif 'ObjectWithArgs' in obj:
                    n = qualified(obj['ObjectWithArgs'].get('objname'))
                    if n: adjuncts[n if '.' in n else 'public.'+n].append(unit)
                elif 'String' in obj:
                    adjuncts['schema:' + obj['String']['sval']].append(unit)
        if target: adjuncts[target].append(unit)
    native_functions = defaultdict(list)
    for f in native['functions']: native_functions[f['name']].append(f)
    native_relations = {r['name']:r for r in native['relations']}
    known_function_names = set(functions)
    known_relations = set(tables)
    # Qualify dynamic SELECT targets from exact source-owned immutable
    # catalogue literal rows; do not infer targets from arbitrary quoted text.
    migration_ast_cache={}
    catalog_target_rules={
      'gridex_contract_source_intake.kinds':('source_schema','source_table','public'),
      'gridex_ediel_retention.contract_copy_catalog':('source_schema','source_table','public'),
      'gridex_ediel_retention.decision_evidence_catalog':(None,'source_table','gridex_ediel_retention'),
      'gridex_ediel_retention.protected_copy_specs':(None,'view_name','gridex_ediel_retention'),
      'gridex_ediel_retention.record_class_catalog':(None,'source_table','public')}
    dynamic_catalog_targets=defaultdict(set)
    dynamic_catalog_proofs=defaultdict(list)
    for path in sorted((root/'supabase/migrations').glob('[0-9]*.sql')):
        raw=path.read_bytes()
        try: migration_ast_cache[path]=json.loads(parser.parse_sql_json(raw.decode()))['stmts']
        except Exception: continue
        for item in migration_ast_cache[path]:
            value=item['stmt'].get('InsertStmt')
            if not value:continue
            target=relation(value.get('relation'))
            if target not in catalog_target_rules:continue
            table=tables[target]['ast']['CreateStmt']
            cols=[c['ColumnDef']['colname'] for c in table.get('tableElts',[]) if 'ColumnDef' in c]
            if value.get('cols'):cols=[c['ResTarget']['name'] for c in value['cols']]
            schema_col,table_col,default_schema=catalog_target_rules[target]
            for row in value.get('selectStmt',{}).get('SelectStmt',{}).get('valuesLists',[]):
                values=row['List']['items'];data={}
                for col,v in zip(cols,values):
                    constant=v.get('A_Const',{})
                    if 'sval' in constant:data[col]=constant['sval']['sval']
                if table_col not in data:continue
                name=(data.get(schema_col) or default_schema)+'.'+data[table_col]
                if name in known_relations:
                    dynamic_catalog_targets[target].add(('relation',name))
                    dynamic_catalog_proofs[target].append({'target':name,'source':str(path.relative_to(root)),
                        'line':raw[:item.get('stmt_location',0)].count(b'\n')+1})
    dynamic_function_catalogs={
      'gridex_contract_source_intake.current_v1':'gridex_contract_source_intake.kinds',
      'gridex_ediel_retention.contract_copy_row_v1':'gridex_ediel_retention.contract_copy_catalog',
      'gridex_ediel_retention.decision_evidence_basis_v1':'gridex_ediel_retention.decision_evidence_catalog',
      'gridex_ediel_retention.protected_copy_row_v1':'gridex_ediel_retention.protected_copy_specs',
      'gridex_ediel_retention.record_basis_v1':'gridex_ediel_retention.record_class_catalog'}
    dependency_cache = {}
    parse_limits = []
    external_references=set()

    def classify_name(name, kind):
        if not name: return []
        registry = known_function_names if kind=='function' else known_relations
        if '.' in name:
            if name not in registry and name.split('.')[0] not in ('pg_catalog','information_schema'):
                external_references.add((kind,name))
            return [(kind, name)] if name in registry else []
        found = [n for n in registry if n == 'public.'+name]
        # Qualified source consistently uses private helper names. Do not guess
        # arbitrary private schemas for an unqualified builtin/identifier.
        return [(kind, n) for n in found]

    def ast_dependencies(ast):
        deps = set()
        for node in walk(ast):
            if 'FuncCall' in node:
                deps.update(classify_name(qualified(node['FuncCall'].get('funcname')), 'function'))
            if 'RangeVar' in node:
                ref=node['RangeVar'];n=relation(ref)
                if ref.get('schemaname') or n in known_relations:deps.update(classify_name(n,'relation'))
            if 'relname' in node:
                n=relation(node)
                if node.get('schemaname') or n in known_relations:deps.update(classify_name(n,'relation'))
            if 'funcname' in node:
                deps.update(classify_name(qualified(node.get('funcname')), 'function'))
            type_node = node.get('TypeName') or (node if 'names' in node and ('typemod' in node or 'pct_type' in node) else None)
            if type_node:
                n = qualified(type_node.get('names'))
                if n in known_relations: deps.add(('relation', n))
                elif ('type',n) in definitions: deps.add(('type',n))
        return deps

    def statement_dependencies(unit):
        key = unit['id']
        if key in dependency_cache: return dependency_cache[key]
        deps = ast_dependencies(unit['ast'])
        value = next(iter(unit['ast'].values()))
        if unit['ast_kind']=='CreateFunctionStmt':
            opts = {o['DefElem']['defname']:o['DefElem'].get('arg') for o in value.get('options', [])}
            language = (opts.get('language') or {}).get('String',{}).get('sval')
            body = ((opts.get('as') or {}).get('List',{}).get('items') or [{}])[0].get('String',{}).get('sval','')
            if language=='sql':
                try: deps |= ast_dependencies(json.loads(parser.parse_sql_json(body)))
                except Exception as exc: parse_limits.append({'unit':key,'kind':'sql_body','error':str(exc)})
            elif language=='plpgsql':
                try:
                    # Standalone PLpgSQL parser has no native composite row
                    # catalog. Normalize only assignment targets for analysis;
                    # actual release SQL bytes stay entirely unchanged.
                    parse_sql = re.sub(r'(\b\w+)\.\w+(\s*:=)', r'\1\2', unit['sql'])
                    record_variables=set(re.findall(r'\b(\w+)\s+(?:[\w.]+%rowtype|record)\b', unit['sql'], re.I))
                    def normalize_record_into(match):
                        return match[1]+match[2] if match[2] in record_variables else match[0]
                    parse_sql = re.sub(r'(\bINTO\s+(?:STRICT\s+)?)(\w+)\.\w+', normalize_record_into, parse_sql, flags=re.I)
                    pl = json.loads(parser.parse_plpgsql_json(parse_sql))
                    for node in walk(pl):
                        if 'PLpgSQL_type' in node:
                            typ = node['PLpgSQL_type'].get('typname','').replace('"','')
                            typ = re.sub(r'%(?:ROWTYPE|TYPE)$','',typ,flags=re.I)
                            if typ in known_relations: deps.add(('relation',typ))
                            elif '.' in typ and typ.split('.')[0] not in ('pg_catalog','information_schema'):external_references.add(('rowtype',typ))
                        expr=node.get('PLpgSQL_expr') or (node if 'query' in node and 'parseMode' in node else None)
                        if not expr:continue
                        query=expr.get('query','')
                        if expr.get('parseMode')==2:
                            query='SELECT '+query
                        elif expr.get('parseMode')!=0:
                            query='SELECT '+re.sub(r'^\s*\w+(?:\.\w+)?\s*(?::=|=)\s*','',query)
                        try: deps |= ast_dependencies(json.loads(parser.parse_sql_json(query)))
                        except Exception as exc:
                            # Exact failed expression is retained for explicit
                            # review; no lexical dependency assertion substitutes.
                            parse_limits.append({'unit':key,'kind':'plpgsql_expression','query':query[:1000],'error':str(exc)})
                except Exception as exc: parse_limits.append({'unit':key,'kind':'plpgsql_body','error':str(exc)})
        if unit['name'] in dynamic_function_catalogs:
            deps |= dynamic_catalog_targets[dynamic_function_catalogs[unit['name']]]
        if unit['name']=='gridex_ediel_retention.contract_copy_source_before_intake_v1':
            deps |= {('relation',n) for n in ('gridex_customer_masterdata.signed_declarations','gridex_metering_method_changes.contract_request_declarations','gridex_metering_method_changes.events')}
        deps.discard((unit['kind'],unit['name']))
        dependency_cache[key]=deps
        return deps

    missing_source_names=[n for n in required if n not in functions]
    if missing_source_names:raise SystemExit('No exact canonical source definition for '+', '.join(missing_source_names))
    selected=set(('function',n) for n in required)
    queue=deque(selected)
    reasons=defaultdict(set)
    for x in selected: reasons[x].add('explicit custom source function' if args.function_names else 'direct missing RPC in independently reviewed preflight')
    while queue:
        kind,name=queue.popleft()
        for unit in definitions.get((kind,name),[]):
            linked=list(statement_dependencies(unit))
            if kind=='relation' and name not in native_relations:
                # Current actual table constraints, indexes, immutable triggers,
                # policies and grants are inseparable security/schema units.
                for adj in adjuncts.get(name,[]): linked.extend(statement_dependencies(adj))
            for dep in linked:
                reasons[dep].add(kind+':'+name)
                if dep not in selected: selected.add(dep);queue.append(dep)
    schemas=sorted({n.split('.')[0] for k,n in selected if '.' in n})
    chosen=[]
    for kind,name in sorted(selected):
        for unit in definitions.get((kind,name),[]): chosen.append(unit)
        if kind=='function' or kind=='relation' and name not in native_relations: chosen.extend(adjuncts.get(name,[]))
    for name in schemas:
        chosen.extend(definitions.get(('schema',name),[]))
        chosen.extend(adjuncts.get('schema:'+name,[]))
    chosen=list({u['id']:u for u in chosen}.values())
    by_id={u['id']:u for u in chosen}

    # Definition phases avoid pretending runtime call cycles are compile-time
    # orders. Row types require table foundations; SQL bodies additionally need
    # their referenced functions before creation. Exact cycles are surfaced.
    objects=[]
    for kind,name in sorted(selected):
        existing = bool(native_functions.get(name)) if kind=='function' else name in native_relations if kind=='relation' else None
        if kind=='type':existing=next((t['exists'] for t in native.get('types',[]) if t['name']==name),None)
        source=definitions.get((kind,name),[])
        record={'kind':kind,'name':name,'exists_in_ops':existing,'required_by':sorted(reasons[(kind,name)]),
                'definition_units':[u['id'] for u in source],
                'exact_source_dependencies':sorted({k+':'+n for u in source for k,n in statement_dependencies(u)}),
                'adjunct_units':[u['id'] for u in adjuncts.get(name,[])]}
        if kind=='function' and existing:
            record['native_signatures']=native_functions[name]
            record['action']='compare exact effective body/signature/ACL before replacement; do not keep or replace blindly'
        elif kind=='function':record['action']='add exact source-owned function after compile prerequisites; preserve canonical ownership/ACL'
        elif kind=='relation' and existing:
            current=native_relations[name]
            columns=source[-1]['ast'].get('CreateStmt',{}).get('tableElts',[]) if source else []
            source_cols={c['ColumnDef']['colname']:c['ColumnDef'] for c in columns if 'ColumnDef' in c}
            native_cols={c['name']:c for c in current.get('columns') or []}
            record['missing_source_columns']=sorted(set(source_cols)-set(native_cols))
            record['native_metadata_file']=str(pathlib.Path(args.native_metadata).resolve())
            record['native_column_count']=len(native_cols)
            record['native_constraint_names']=[c['name'] for c in current.get('constraints') or []]
            record['action']='reconcile only required missing source columns/constraints/triggers; do not replay CREATE TABLE or reset present data'
        elif kind=='relation':record['action']='create exact source-owned empty table/view with complete constraints, indexes, immutability, RLS and ACL'
        objects.append(record)

    # Function definition dependency SCCs: runtime recursion cannot be blindly
    # flattened into a single compile order or hidden by check_function_bodies.
    graph={n:set() for k,n in selected if k=='function'}
    for name in graph:
        graph[name]={n for u in functions[name] for k,n in statement_dependencies(u) if k=='function' and n in graph}
    visited=set();order=[]
    def dfs(n):
        if n in visited:return
        visited.add(n)
        for dep in sorted(graph[n]):dfs(dep)
        order.append(n)
    for n in sorted(graph):dfs(n)
    inverse=defaultdict(set)
    for n,ds in graph.items():
        for dep in ds:inverse[dep].add(n)
    visited=set();components=[]
    def collect(n,out):
        if n in visited:return
        visited.add(n);out.append(n)
        for dep in sorted(inverse[n]):collect(dep,out)
    for n in reversed(order):
        if n not in visited:
            comp=[];collect(n,comp);components.append(sorted(comp))
    # Exact compile order is narrower than the runtime graph: SQL-language
    # function bodies need callees at CREATE time; PLpgSQL call edges are
    # runtime edges once their parameter/local row types exist.
    function_languages={}
    for n,us in functions.items():
        options=us[-1]['ast']['CreateFunctionStmt'].get('options',[])
        function_languages[n]=next((o['DefElem']['arg']['String']['sval'] for o in options if o['DefElem']['defname']=='language'),None)
    compile_graph={n:(graph[n] if function_languages[n]=='sql' else set()) for n in graph}
    compile_state={};compile_order=[];compile_cycles=[]
    def compile_dfs(n,stack):
        if compile_state.get(n)==2:return
        if compile_state.get(n)==1:
            compile_cycles.append(stack[stack.index(n):]+[n]);return
        compile_state[n]=1
        for dep in sorted(compile_graph[n]):compile_dfs(dep,stack+[n])
        compile_state[n]=2;compile_order.append(n)
    for n in sorted(compile_graph):compile_dfs(n,[])
    pretable=set()
    for kind,name in selected:
        if kind=='relation' and name not in native_relations:
            for u in definitions[(kind,name)]:
                pretable |= {n for k,n in statement_dependencies(u) if k=='function'}
    pending=list(pretable)
    while pending:
        name=pending.pop()
        for dep in compile_graph[name]:
            if dep not in pretable:pretable.add(dep);pending.append(dep)
    pretable_order=[n for n in compile_order if n in pretable]
    def unit_record(u):
        record={k:u[k] for k in ('id','ast_kind','kind','name','byte_start','byte_length','line','sha256')}
        record['source']='supabase/schema.sql'
        record['dependencies']=sorted(k+':'+n for k,n in statement_dependencies(u))
        if u['ast_kind'] in ('AlterTableStmt','CreateTrigStmt','IndexStmt','CreatePolicyStmt','AlterPolicyStmt','GrantStmt'):
            record['exact_sql']=u['sql'].strip()+';'
        return record
    # The canonical schema is schema-only: real source migrations also own
    # catalogue rows, permission definitions, NOLOGIN owners and ownership.
    # Preserve their exact bytes as review inputs, never execute them here.
    source_locations = defaultdict(list)
    source_control_units = []
    source_parse_limits = []
    selected_names = {n for k,n in selected}
    for path in sorted((root/'supabase/migrations').glob('[0-9]*.sql')):
        raw = path.read_bytes(); text = raw.decode()
        try: statements = migration_ast_cache[path] if path in migration_ast_cache else json.loads(parser.parse_sql_json(text))['stmts']
        except Exception as exc:
            source_parse_limits.append({'file':str(path.relative_to(root)),'error':str(exc)})
            continue
        for i,item in enumerate(statements):
            ast=item['stmt']; ast_kind=next(iter(ast)); kind,name=object_name(ast)
            start=item.get('stmt_location',0); length=item.get('stmt_len',0) or len(raw)-start
            sql=raw[start:start+length].decode()
            ref={'file':str(path.relative_to(root)),'line':raw[:start].count(b'\n')+1,
                 'byte_start':start,'byte_length':length,'sha256':hashlib.sha256(sql.encode()).hexdigest()}
            if kind and (kind,name) in selected:
                source_locations[(kind,name)].append(ref)
            value=next(iter(ast.values()))
            if ast_kind=='RenameStmt' and value.get('renameType')=='OBJECT_FUNCTION':
                obj=value.get('object',{}).get('ObjectWithArgs',{})
                old=qualified(obj.get('objname'))
                if old and value.get('newname'):
                    renamed=old.rsplit('.',1)[0]+'.'+value['newname'] if '.' in old else 'public.'+value['newname']
                    if ('function',renamed) in selected:source_locations[('function',renamed)].append({**ref,'renamed_from':old})
            target=relation(value.get('relation')) if ast_kind=='InsertStmt' else None
            literal_catalog_seed = target and ('relation',target) in selected and re.search(r'(catalog|specs?|profiles?|registry)$',target)
            permission_seed = target=='public.permissions'
            if literal_catalog_seed or permission_seed:
                select=value.get('selectStmt',{}).get('SelectStmt',{})
                has_values=bool(select.get('valuesLists'))
                source_control_units.append({**ref,'ast_kind':ast_kind,'target':target,
                    'classification':'literal additive control seed' if has_values else 'source control seed requires row-impact review',
                    'review_required':not has_values or not value.get('onConflictClause'),
                    'exact_sql':sql.strip()+';'})
            if ast_kind=='DoStmt' and any(n in sql for n in selected_names if not n.startswith('public.')):
                for selected_kind,selected_name in selected:
                    if selected_name in sql:
                        source_locations[(selected_kind,selected_name)].append({**ref,'source_kind':'procedural source generator/body rewrite reference; inspect exact producer block'})
                if re.search(r'(OWNER TO|CREATE ROLE|ALTER ROLE|GRANT|REVOKE)',sql,re.I):
                    source_control_units.append({**ref,'ast_kind':ast_kind,
                        'classification':'source ownership/ACL/control block; project onto selected objects after exact review',
                        'review_required':True,'exact_sql':sql.strip()+';'})
    for o in objects:
        o['source_migration_definitions_or_renames']=source_locations[(o['kind'],o['name'])]
    dynamic_execution_units=[]
    for u in chosen:
        if u['kind']=='function' and re.search(r'\bEXECUTE\b',u['sql'],re.I):
            dynamic_execution_units.append({'unit':u['id'],'name':u['name'],
                'review':'Contains runtime dynamic SQL; inspect exact source-owned format/catalog allowlists. SQL AST of static queries alone is not a complete dynamic-target proof.'})
    result={'schema':'ops_api_native_reconciliation_plan_v1','native_checked_at_utc':native['checked_at'],
            'catalog_supplement_checked_at_utc':native.get('catalog_supplement_checked_at'),
            'native_record_class_rows':native.get('record_class_catalog_rows'),
            'project':'piidsfebjqjmnepdpnas','source_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
            'source_schema_sha256':hashlib.sha256(source_bytes).hexdigest(),
            'authority':'Current genuine canonical SQL statement bytes + PostgreSQL AST/PLpgSQL query AST + independently fetched read-only actual native catalogs. No tests or native writes.',
            'required_missing_functions':required,'objects':objects,'exact_sql_units':[unit_record(u) for u in sorted(chosen,key=lambda u:u['byte_start'])],
            'schema_prerequisites':[{'name':n,'exists_in_ops':n in native['schemas'],'definition_units':[u['id'] for u in definitions.get(('schema',n),[])]} for n in schemas],
            'function_dependency_components':components,'dependency_first_function_order':order,
            'compile_order':{'pre_table_function_names':pretable_order,'after_table_function_names':[n for n in compile_order if n not in pretable],
                'sql_language_compile_cycles':compile_cycles,'function_languages':{n:function_languages[n] for n in graph},
                'note':'Table foundations precede row-typed functions. These ordered names map to exact definition_units. SQL callees compile before callers; runtime PLpgSQL SCCs are installed together before any invocation.'},
            'parse_limits':parse_limits,'source_migration_parse_limits':source_parse_limits,
            'source_owned_catalog_permission_owner_units':source_control_units,
            'dynamic_execution_review_units':dynamic_execution_units,
            'source_catalog_qualified_dynamic_targets':dict(dynamic_catalog_proofs),
            'external_native_prerequisite_observations':external_native,
            'external_native_prerequisite_references':[{'kind':k,'name':n,'qualification':'Actual qualified AST reference outside the public/gridex canonical definition set; inspect real Supabase catalog and provide matching source-owned prerequisite in isolated PG.'} for k,n in sorted(external_references)],
            'separate_owned_retention_packet':{'plan':'retention-guards-plan.json','sql':'retention-guards-forward.sql','deduplicate_function_names':['gridex_ediel_retention.record_basis_v1','public.ediel_require_customer_record_available_v1','public.ediel_require_contract_records_available_v1','public.ediel_require_portal_retention_access_v1','public.ediel_require_invoice_file_copy_available_v1','public.ediel_require_source_bytes_available_v1']},
            'status':'concrete exact-source reconciliation input; dynamic execution, existing conflicts and source ownership blocks require root review/isolated native qualification before application',
            'release_phases':[
                'Assert explicit OPS project and metadata/source hashes; reconcile existing objects before any production application.',
                'Create missing schemas with canonical ownership and revoked public access. Resolve exact enum/composite/extension prerequisites.',
                'Create missing table foundations, separating column defaults/FK/check constraints only if needed for compile cycles, inside one atomic forward migration. Existing tables require explicit reviewed additive ALTER, not CREATE replacement.',
                'Install current exact function bodies in dependency-first compile order. SQL-language references must compile. PLpgSQL runtime SCCs require their real row types and final helpers; no permissive stub or disabled body validation.',
                'Install complete canonical FK/check/unique/index/immutability trigger/policy/RLS/owner/ACL adjuncts and source-owned catalog/permission seed units. Extract exact bytes/hashes listed below and compare existing units; no wholesale historical replay.',
                'Root qualifies the complete SQL in isolated native PostgreSQL, then applies reviewed forward migration and rechecks effective OPS definitions/ACLs. Canonical GEN remains with C2.'
            ],
            'limitations':[
                'Conditional calls are structurally real dependencies, but this plan covers complete function behavior rather than asserting every branch runs on every request.',
                'Dependency-only PLpgSQL parsing normalizes record.field := assignment targets to record := because standalone parser lacks native row-type fields. Extracted actual SQL bytes are never changed.',
                'Existing table source adjuncts are review candidates, not mandatory new-object installation units; current native triggers/policies must be independently compared where their behavior matters.',
                'Dynamic EXECUTE-generated SQL, role/permission and other INSERT catalog seeds, ALTER FUNCTION ownership and all global schema grant forms require explicit remaining review; parse limits are not suppressed.',
                'Function-name dependency indexing includes all source overloads when a call name has multiple signatures; exact overload resolution must be confirmed during isolated native compilation.',
                'Exact statement references are reviewable SQL units, not authorization to replay every canonical adjunct on present data. Runtime recursion/components and existing-table shape conflicts are explicit blockers until resolved.'
            ]}
    pathlib.Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'required':len(required),'objects':len(objects),'sql_units':len(chosen),'missing_functions':sum(o['kind']=='function' and not o['exists_in_ops'] for o in objects),'missing_relations':sum(o['kind']=='relation' and not o['exists_in_ops'] for o in objects),'parser_limits':len(parse_limits),'function_runtime_cycles':sum(len(c)>1 for c in components)}))

if __name__=='__main__':main()
