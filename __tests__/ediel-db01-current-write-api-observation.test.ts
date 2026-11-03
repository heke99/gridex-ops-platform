import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// Compile only the observer with synthetic source/catalog ports. This does not
// execute the workflow, psql, a backend, or a native public creator.
const harness = String.raw`
import ast, hashlib, json, pathlib, re, sys, tempfile, textwrap
case=json.loads(sys.argv[1]);lines=pathlib.Path('.github/workflows/ediel-db01-current-native.yml').read_text().splitlines()
start=next(i for i,line in enumerate(lines) if 'cat > "$DB01_PRIVATE/qualify-current-guards.py"' in line)+1
end=next(i for i in range(start,len(lines)) if lines[i].strip()=='PY')
tree=ast.parse(textwrap.dedent('\n'.join(lines[start:end])))
definition=next((node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='observe_current_write_api'),None)
if definition is None:raise RuntimeError('write_api_observer_missing')
root='public.gridex_enqueue_normal_supplier_switch_v1';guard='gridex_fixture.guard_v1'
functions={root:[(('public','FUNCTION','gridex_enqueue_normal_supplier_switch_v1(uuid)'),'p uuid','begin perform gridex_fixture.guard_v1(p); insert into public.ediel_outbox(id) values(p); end;')],guard:[(('gridex_fixture','FUNCTION','guard_v1(uuid)'),'p uuid','begin perform public.gridex_enqueue_normal_supplier_switch_v1(p); end;')]}
if case.get('unknown'):functions[root][0]=(functions[root][0][0],'p uuid','begin perform gridex_missing.rule_v1(p); end;')
if case.get('missingSource'):del functions[root]
if case.get('overload'):functions[guard].append((('gridex_fixture','FUNCTION','guard_v1(uuid, uuid)'),'a uuid, b uuid','begin return; end;'))
default=[{'schema':'gridex_fixture','name':'guard_v1','identity_arguments':'p uuid','body_sha256':'a'*64}]
rows=case.get('rows',default);queries=[]
def sql(query):queries.append(query);return json.dumps(rows)
def fail(message):raise RuntimeError(message)
with tempfile.TemporaryDirectory(prefix='gridex-db01-observer-unit-') as folder:
 path=pathlib.Path(folder)/'receipt.json';receipt={'checkout_sha':'synthetic-source','root_source':{'blobs':{'supabase/schema.sql':{'sha256':'b'*64}}}}
 namespace={'json':json,'re':re,'sha':lambda s:hashlib.sha256(s.encode()).hexdigest(),'sql':sql,'fail':fail,'source_functions':functions,'expected':{('public','TABLE','ediel_outbox'):'synthetic table'},'receipt':receipt,'receipt_path':path}
 exec(compile(ast.Module(body=[definition],type_ignores=[]),'<extracted-observer>','exec'),namespace)
 error=None
 try:namespace['observe_current_write_api']()
 except Exception as e:error=str(e)
 saved=pathlib.Path(folder)/'current-write-api-observation.json'
 print(json.dumps({'queries':queries,'error':error,'observation':json.loads(saved.read_text()) if saved.exists() else None,'receipt':json.loads(path.read_text()) if path.exists() else None}))
`
function observe(input: Record<string, unknown> = {}) {
  return JSON.parse(execFileSync('python3', ['-c', harness, JSON.stringify(input)], { encoding: 'utf8', timeout: 5000 })) as {
    queries: string[]; error: string | null;
    observation: { status: string; native_or_approval_credit: boolean; entry_name_present: boolean; missing_function_names: string[]; planned_function_names: string[]; canonical_function_definitions: unknown[]; observed_functions: Array<Record<string, unknown>>; relation_tokens: string[]; unresolved_source_names: string[] };
    receipt: { current_write_api_observation: unknown };
  }
}
const root = 'public.gridex_enqueue_normal_supplier_switch_v1'
describe('DB01 prospective current write API observation', () => {
  it('records absence and genuine metadata without granting native or approval credit', () => {
    const result = observe()
    expect(result.error).toBeNull()
    expect(result.observation).toMatchObject({ status: 'OBSERVED_ONLY', native_or_approval_credit: false, entry_name_present: false, missing_function_names: [root] })
    expect(result.observation.planned_function_names).toEqual(['gridex_fixture.guard_v1', root])
    expect(result.observation.relation_tokens).toEqual(['public.ediel_outbox'])
    expect(result.receipt.current_write_api_observation).toEqual(result.observation)
  })
  it('queries only pg_catalog metadata and never invokes or installs a prospective function', () => {
    const result = observe()
    expect(result.queries).toHaveLength(1)
    expect(result.queries[0].trim()).toMatch(/^select\s/i)
    expect(result.queries[0]).toContain('pg_catalog.pg_proc')
    expect(result.queries[0]).not.toMatch(/\b(?:insert|update|delete|create|alter|grant|revoke|truncate)\s/i)
    expect(result.queries[0]).not.toContain('private synthetic')
  })
  it('does not confuse a present entry name with dependency or behavioral qualification', () => {
    const result = observe({ rows: [{ schema: 'public', name: 'gridex_enqueue_normal_supplier_switch_v1', identity_arguments: 'p uuid', body_sha256: 'c'.repeat(64) }] })
    expect(result.observation).toMatchObject({ entry_name_present: true, status: 'OBSERVED_ONLY', native_or_approval_credit: false })
    expect(result.observation.missing_function_names).toEqual(['gridex_fixture.guard_v1'])
  })
  it('preserves overload definitions and every observed overload rather than choosing one', () => {
    const result = observe({ overload: true, rows: [{ schema: 'gridex_fixture', name: 'guard_v1', identity_arguments: 'p uuid', body_sha256: 'a'.repeat(64) }, { schema: 'gridex_fixture', name: 'guard_v1', identity_arguments: 'a uuid, b uuid', body_sha256: 'd'.repeat(64) }] })
    expect(result.observation.canonical_function_definitions).toHaveLength(3)
    expect(result.observation.observed_functions).toHaveLength(2)
  })
  it('does not silently discard unresolved source tokens or claim their qualification', () => {
    const result = observe({ unknown: true, rows: [] })
    expect(result.observation.unresolved_source_names).toEqual(['gridex_missing.rule_v1'])
    expect(result.observation.native_or_approval_credit).toBe(false)
  })
  it('fails closed when the frozen canonical coordinator source is absent', () => {
    expect(observe({ missingSource: true })).toMatchObject({ error: 'db01_current_write_api_source_missing', observation: null, queries: [] })
  })
  it('refuses an unexpected catalog result shape', () => {
    expect(observe({ rows: {} })).toMatchObject({ error: 'db01_current_write_api_observation_shape', observation: null })
  })
  it('refuses metadata outside its exact canonical prospective name set', () => {
    expect(observe({ rows: [{ schema: 'private_foreign', name: 'unexpected', body_sha256: 'a'.repeat(64) }] })).toMatchObject({ error: 'db01_current_write_api_observation_scope', observation: null })
  })
  it('does not expose arbitrary catalog fields or raw body/default/ACL/configuration values', () => {
    const result = observe({ rows: [{ schema: 'gridex_fixture', name: 'guard_v1', identity_arguments: 'p uuid', body_sha256: 'a'.repeat(64), raw_body: 'private synthetic body', defaults: 'private synthetic value', acl: 'private synthetic role', config: 'private synthetic config' }] })
    expect(JSON.stringify(result.observation)).not.toContain('private synthetic')
  })
})

const installHarness = String.raw`
import ast, copy, hashlib, json, pathlib, re, sys, tempfile, textwrap, types
case=json.loads(sys.argv[1]);actual_root=pathlib.Path.cwd()
lines=(actual_root/'.github/workflows/ediel-db01-current-native.yml').read_text().splitlines()
start=next(i for i,line in enumerate(lines) if 'cat > "$DB01_PRIVATE/qualify-current-guards.py"' in line)+1
end=next(i for i in range(start,len(lines)) if lines[i].strip()=='PY')
tree=ast.parse(textwrap.dedent('\n'.join(lines[start:end])))
names={'current_write_api_install_spec','build_current_write_api_sql','install_current_write_api_projection'}
definitions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names]
if {node.name for node in definitions}!=names:raise RuntimeError('closed_write_api_projection_missing')
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
def fail(message):raise RuntimeError(message)
namespace={'hashlib':hashlib,'json':json,'re':re,'sha':sha,'fail':fail}
exec(compile(ast.Module(body=definitions,type_ignores=[]),'<closed-projection>','exec'),namespace)
original_spec=namespace['current_write_api_install_spec']()
actor=('public','FUNCTION','ediel_retention_lock_auth_actor_v1(uuid)')
projection=('public','FUNCTION','ediel_project_accepted_source_state_v1(uuid, text, uuid, uuid, text)')
coordinator=('public','FUNCTION','gridex_enqueue_normal_supplier_switch_v1(uuid, uuid, uuid, uuid, uuid, uuid, text)')
acl=('public','ACL','FUNCTION gridex_enqueue_normal_supplier_switch_v1(p_company_id uuid, p_switch_id uuid, p_intent_id uuid, p_message_id uuid, p_outbound_request_id uuid, p_actor_user_id uuid, p_expected_payload_hash text)')
stable=('public','TABLE','synthetic_preserved_relation')
expected={actor:'canonical actor',projection:'canonical projection',coordinator:'canonical coordinator',acl:'canonical acl',stable:'unchanged relation'}
before_catalog={actor:'old actor',projection:'old projection',stable:'unchanged relation'}
after_catalog=dict(expected)
before_rows=[{'schema':'public','name':'ediel_project_accepted_source_state_v1','body_sha256':original_spec['projection_old_body']},{'schema':'public','name':'ediel_retention_lock_auth_actor_v1','body_sha256':original_spec['actor_old_body']}]
after_rows=copy.deepcopy(before_rows)
after_rows[0]['body_sha256']=original_spec['projection_new_body'];after_rows[1]['body_sha256']=original_spec['actor_new_body']
after_rows.append({'schema':'public','name':'gridex_enqueue_normal_supplier_switch_v1','body_sha256':original_spec['coordinator_body']})
definitions_meta=[{'identity':list(key),'body_sha256':'f'*64} for key in [actor,projection,coordinator]]
observation={'schema':'db01_current_write_api_observation_v1','status':'OBSERVED_ONLY','native_or_approval_credit':False,'source_sha':'synthetic-head','source_schema_sha256':original_spec['schema_sha256'],'entry_name_present':False,'planned_function_names':['public.ediel_project_accepted_source_state_v1','public.ediel_retention_lock_auth_actor_v1','public.gridex_enqueue_normal_supplier_switch_v1'],'canonical_function_definitions':definitions_meta,'observed_functions':before_rows,'missing_function_names':['public.gridex_enqueue_normal_supplier_switch_v1'],'relation_tokens':[],'unresolved_source_names':[]}
spec=copy.deepcopy(original_spec);spec['before_catalog_sha256']=sha(json.dumps(before_rows,sort_keys=True,separators=(',',':')));spec['function_count']=3;spec['canonical_definitions_sha256']=sha(json.dumps(definitions_meta,sort_keys=True,separators=(',',':')))
if case.get('preimageDrift'):before_rows[0]['body_sha256']='0'*64
if case.get('metadataDrift'):after_rows[0]['unexpected_flag']=True
if case.get('surroundingDrift'):after_catalog[stable]='changed unrelated relation'
if case.get('sourceAfterDrift'):after_catalog[coordinator]='not canonical'
if case.get('extraOverload'):after_rows.append(dict(after_rows[-1],identity_arguments='extra overload'))
runs=[];observe_calls=0;roles_calls=0;auth_calls=0;owner_calls=0
def observe_catalog():
 global observe_calls
 observe_calls+=1
 return (before_catalog if observe_calls==1 else after_catalog),{'system_identifier':'same synthetic database'}
def post_observation():
 current=copy.deepcopy(observation);current.update(entry_name_present=True,observed_functions=after_rows,missing_function_names=[])
 receipt['current_write_api_observation']=current
def roles():
 global roles_calls
 roles_calls+=1;return {'roles':'changed' if case.get('roleDrift') and roles_calls>1 else 'unchanged'}
def auth():
 global auth_calls
 auth_calls+=1;return {'definition':'changed' if case.get('authDrift') and auth_calls>1 else 'unchanged'}
def owners():
 global owner_calls
 owner_calls+=1
 rows=[{'kind':'FUNCTION','schema':'public','identity':'existing()','owner':'postgres'}]
 if case.get('ownerDrift') and owner_calls>1:rows[0]['owner']='unexpected'
 if owner_calls>1:rows.append({'kind':'FUNCTION','schema':'public','identity':'gridex_enqueue_normal_supplier_switch_v1(p uuid)','owner':'postgres'})
 return rows
def run(args,**kwargs):
 runs.append({'args':args,'sql':kwargs['input'].decode()})
 if case.get('unknownOutcome'):raise TimeoutError('synthetic opaque timeout')
 return types.SimpleNamespace(returncode=17 if case.get('ddlFailure') else 0)
with tempfile.TemporaryDirectory(prefix='gridex-closed-write-api-unit-') as folder:
 root=pathlib.Path(folder);evidence=root/'evidence';evidence.mkdir();path=evidence/'receipt.json';blobs={'supabase/schema.sql':{'sha256':original_spec['schema_sha256']}}
 for donor in original_spec['donors']:
  target=root/donor['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((actual_root/donor['path']).read_bytes());blobs[donor['path']]={key:donor[key] for key in ['mode','git_blob_oid','sha256']}
 if case.get('fileDrift'):(root/original_spec['donors'][0]['path']).write_text('unqualified source')
 if case.get('manifestDrift'):blobs[original_spec['donors'][0]['path']]['sha256']='0'*64
 if case.get('schemaDrift'):blobs['supabase/schema.sql']['sha256']='0'*64
 receipt={'checkout_sha':'synthetic-head','root_source':{'blobs':blobs},'current_write_api_observation':observation}
 namespace.update(root=root,receipt=receipt,receipt_path=path,private=root,url='postgresql://postgres:postgres@127.0.0.1:54322/postgres',subprocess=types.SimpleNamespace(run=run),schemas={'public'},expected=expected,observe=observe_catalog,role_graph=roles,auth_uid=auth,catalog_owners=owners,observe_current_write_api=post_observation)
 if case.get('builder'):
  try:
   sql,donors=namespace['build_current_write_api_sql'](original_spec);result={'error':None,'sql':sql,'donors':donors,'spec':original_spec}
  except Exception as error:result={'error':str(error)}
 else:
  namespace['current_write_api_install_spec']=lambda:spec
  error=None
  try:namespace['install_current_write_api_projection']()
  except Exception as e:error=str(e)
  result={'error':error,'runs':len(runs),'receipt':receipt,'schemas':sorted(namespace['schemas'])}
 print(json.dumps(result))
`
function installProbe(input: Record<string, unknown> = {}) {
  return JSON.parse(execFileSync('python3', ['-c', installHarness, JSON.stringify(input)], { encoding: 'utf8', timeout: 5000 })) as {
    error: string | null; runs: number; schemas: string[]; sql: string;
    donors: unknown[]; spec: { before_catalog_sha256: string; preimage_artifact_id: number };
    receipt: { current_write_api_projection?: { status: string; native_or_approval_credit: boolean } };
  }
}
describe('DB01 closed current write API source projection', () => {
  it('pins the genuine preimage and uses only the three existing canonical source donors', () => {
    const result = installProbe({ builder: true })
    expect(result.error).toBeNull()
    expect(result.spec).toMatchObject({ before_catalog_sha256: '709e4839c481dec2667da1f26110c5593e631a19ea3bfe4809afcc61a0d4d58d', preimage_artifact_id: 12655280424 })
    expect(result.donors).toHaveLength(3)
    expect(result.sql).toMatch(/^BEGIN;/)
    expect(result.sql.trim()).toMatch(/COMMIT;$/)
    expect(result.sql).toContain('ediel_source_bound_ack_projection_unreviewed_preimage')
    expect(result.sql).toContain('db01_write_actor_metadata_changed')
    expect(result.sql).not.toContain('CREATE OR REPLACE FUNCTION public.ediel_pseudonymise_customer_retention_v1')
  })
  it.each(['fileDrift', 'manifestDrift'])('refuses %s before executing any DDL', key => {
    expect(installProbe({ builder: true, [key]: true }).error).toBe('db01_current_write_api_donor_changed')
  })
  it('qualifies the actual after-state and leaves the original dump schema set restored', () => {
    const result = installProbe()
    expect(result.error).toBeNull()
    expect(result.runs).toBe(1)
    expect(result.schemas).toEqual(['public'])
    expect(result.receipt.current_write_api_projection).toMatchObject({ status: 'PASS', native_or_approval_credit: false })
  })
  it.each([
    ['preimageDrift', 'db01_current_write_api_unqualified_preimage'],
    ['schemaDrift', 'db01_current_write_api_unqualified_preimage'],
  ])('refuses %s before any DDL', (key, code) => {
    const result = installProbe({ [key]: true })
    expect(result.error).toBe(code);expect(result.runs).toBe(0)
  })
  it('does not retry an unknown DDL outcome or grant qualification', () => {
    const result = installProbe({ unknownOutcome: true })
    expect(result.error).toBe('db01_current_write_api_install_outcome_unknown');expect(result.runs).toBe(1)
    expect(result.receipt.current_write_api_projection?.status).not.toBe('PASS')
  })
  it('propagates a failed atomic installation without a second execution', () => {
    const result = installProbe({ ddlFailure: true })
    expect(result.error).toBe('db01_current_write_api_install_failed');expect(result.runs).toBe(1)
    expect(result.receipt.current_write_api_projection?.status).not.toBe('PASS')
  })
  it.each([
    ['metadataDrift', 'db01_current_write_api_metadata_changed'],
    ['surroundingDrift', 'db01_current_write_api_surroundings_changed'],
    ['sourceAfterDrift', 'db01_current_write_api_catalog_mismatch'],
    ['extraOverload', 'db01_current_write_api_coordinator_scope'],
    ['roleDrift', 'db01_current_write_api_authority_changed'],
    ['authDrift', 'db01_current_write_api_authority_changed'],
    ['ownerDrift', 'db01_current_write_api_authority_changed'],
  ])('never qualifies an unexpected %s', (key, code) => {
    const result = installProbe({ [key]: true })
    expect(result.error).toBe(code);expect(result.runs).toBe(1)
    expect(result.schemas).toEqual(['public'])
    expect(result.receipt.current_write_api_projection?.status).not.toBe('PASS')
  })
})

const contrlHarness = String.raw`
import ast, copy, hashlib, json, pathlib, re, sys, tempfile, textwrap, types
case=json.loads(sys.argv[1]);repo=pathlib.Path.cwd()
lines=(repo/'.github/workflows/ediel-db01-current-native.yml').read_text().splitlines()
start=next(i for i,line in enumerate(lines) if 'cat > "$DB01_PRIVATE/qualify-current-guards.py"' in line)+1
end=next(i for i in range(start,len(lines)) if lines[i].strip()=='PY')
tree=ast.parse(textwrap.dedent('\n'.join(lines[start:end])))
required={'blocks','current_contrl_source_spec','current_contrl_catalog','apply_current_contrl_source'}
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in required]
if {n.name for n in nodes}!=required:
 print(json.dumps({'error':'db01_current_contrl_source_installer_missing','runs':0,'receipt':{}}));sys.exit(0)
donor='supabase/migrations/20261030130400_ediel_contrl_retained_source_linear.sql'
digest='118237935cf39160870272f9a8fc384a435218613309994294793bfe416c2f75'
pre='142f25b2cfdb260e7183a2ceb5fcb309498bd0bc9b86ce297738743f9434707e'
post='e1ce86e1838a96ecb8b17b70c32c1b21e662ca37d173627a9722f6b76ca00ffa'
schema='032ec47d9f7215e28518eb2afa0fb7ee309be89f4fee19ea05a39f70ad679e5f'
sha=lambda value:hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()
def fail(message):raise RuntimeError(message)
before={'oid':'12345','metadata_sha256':'a'*64,'body_sha256':pre}
after={**before,'body_sha256':post}
if case.get('preimageDrift'):before['body_sha256']='0'*64
if case.get('metadataShape'):before['metadata_sha256']='invalid'
if case.get('postimageDrift'):after['body_sha256']='0'*64
if case.get('metadataDrift'):after['metadata_sha256']='b'*64
if case.get('oidDrift'):after['oid']='54321'
runs=[];queries=[];events=[];forward_items=[]
if case.get('phase'):
 source=(repo/'.github/workflows/ediel-db01-current-native.yml').read_text()
 initial=ast.parse(textwrap.dedent(source.split("python3 - <<'PY'\n",1)[1].split('\n          PY',1)[0]))
 declaration=next(n for n in initial.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='current_read_manifest' for t in n.targets))
 forward_items=ast.literal_eval(declaration.value)
def sql(query):
 queries.append(query)
 if case.get('missingCatalog') and len(queries)==1:return 'null'
 return json.dumps(before if len(queries)==1 else after)
def run(args,**kwargs):
 if case.get('phase') and args[-1]!=str(root/donor):
  item=next(item for item in forward_items if str(root/item['path'])==args[-1])
  assert sha((root/item['path']).read_bytes())==item['sha256'];events.append('legacy-forward')
  return types.SimpleNamespace(returncode=0)
 assert args==['psql','postgresql://postgres:postgres@127.0.0.1:54322/postgres','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-f',str(root/donor)]
 events.append('contrl')
 runs.append({'sqlSha256':sha((root/donor).read_bytes()),'timeout':kwargs.get('timeout')})
 if case.get('unknownOutcome'):raise TimeoutError('synthetic opaque outcome')
 return types.SimpleNamespace(returncode=17 if case.get('ddlFailure') else 0)
with tempfile.TemporaryDirectory(prefix='db01-current-contrl-unit-') as folder:
 root=pathlib.Path(folder);private=root/'private';private.mkdir();receipt_path=private/'receipt.json'
 for name in [donor,'supabase/schema.sql',*[item['path'] for item in forward_items]]:
  target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((repo/name).read_bytes())
 blobs={donor:{'mode':'100644','git_blob_oid':'5855a585e4fedfbd13122471e77baff118224a7d','sha256':digest},'supabase/schema.sql':{'sha256':schema}}
 if case.get('fileDrift'):(root/donor).write_bytes((root/donor).read_bytes()+b'\n-- unqualified drift\n')
 if case.get('manifestDrift'):blobs[donor]['sha256']='0'*64
 if case.get('schemaDrift'):blobs['supabase/schema.sql']['sha256']='0'*64
 if case.get('schemaFileDrift'):(root/'supabase/schema.sql').write_bytes((root/'supabase/schema.sql').read_bytes()+b'\n-- drift\n')
 receipt={'checkout_sha':'synthetic-head','root_source':{'blobs':blobs}}
 namespace={'hashlib':hashlib,'json':json,'re':re,'sha':sha,'fail':fail,'root':root,'private':private,'receipt':receipt,'receipt_path':receipt_path,'url':'postgresql://postgres:postgres@127.0.0.1:54322/postgres','sql':sql,'subprocess':types.SimpleNamespace(run=run)}
 exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual-contrl-source-installer>','exec'),namespace)
 namespace['expected']=namespace['blocks']((root/'supabase/schema.sql').read_text())
 error=None
 try:
  if case.get('phase'):
   receipt['current_database_basis']={'forwards':forward_items}
   namespace.update(sys=sys,forward_prerequisites={},apply_current_api_projection=lambda:events.append('api'),apply_s01_current_source=lambda:events.append('s01'))
   modes=next(n for n in tree.body if isinstance(n,ast.If) and ast.unparse(n.test)=="mode == 'before'")
   phase=modes.orelse[0];assert ast.unparse(phase.test)=="mode == 'forwards'"
   exec(compile(ast.Module(body=phase.body,type_ignores=[]),'<actual-forwards-phase>','exec'),namespace)
  else:namespace['apply_current_contrl_source']()
 except Exception as e:error=str(e)
 print(json.dumps({'error':error,'runs':len(runs),'executions':runs,'queries':queries,'events':events,'receipt':receipt}))
`
type ContrlResult = {
  error: string | null; runs: number; executions: Array<{sqlSha256: string; timeout: number}>; queries: string[]; events: string[];
  receipt: {current_contrl_source_install?: {status: string; exit_code?: number; native_or_approval_credit: boolean}};
}
function contrlProbe(input: Record<string, unknown> = {}): ContrlResult {
  return JSON.parse(execFileSync('python3', ['-c', contrlHarness, JSON.stringify(input)], {encoding: 'utf8', timeout: 10_000}))
}
describe('DB01 current CONTRL source installation', () => {
  it('runs the preserved sixteen forwards and API/S01 sources before the exact current CONTRL installation', () => {
    const result = contrlProbe({phase: true})
    expect(result.error).toBeNull()
    expect(result.events).toEqual([...Array(16).fill('legacy-forward'), 'api', 's01', 'contrl'])
    expect(result.runs).toBe(1)
    expect(result.receipt.current_contrl_source_install?.status).toBe('PASS')
  })
  it('executes the unchanged canonical 949 migration once before qualifying its actual catalog transition', () => {
    const result = contrlProbe()
    expect(result.error).toBeNull()
    expect(result.runs).toBe(1)
    expect(result.executions).toEqual([{sqlSha256: '118237935cf39160870272f9a8fc384a435218613309994294793bfe416c2f75', timeout: 120}])
    expect(result.receipt.current_contrl_source_install).toMatchObject({status: 'PASS', exit_code: 0, native_or_approval_credit: false})
    expect(result.queries).toHaveLength(2)
    expect(result.queries.every(query => query.trim().toLowerCase().startsWith('select'))).toBe(true)
  })
  it.each(['fileDrift', 'manifestDrift', 'schemaDrift', 'schemaFileDrift'])('refuses %s before any installation', change => {
    const result = contrlProbe({[change]: true})
    expect(result.error).toBe('db01_current_contrl_source_unqualified')
    expect(result.runs).toBe(0)
  })
  it.each(['preimageDrift', 'metadataShape', 'missingCatalog'])('refuses catalog %s before any installation', change => {
    const result = contrlProbe({[change]: true})
    expect(result.error).toBe('db01_current_contrl_preimage_unqualified')
    expect(result.runs).toBe(0)
  })
  it.each(['postimageDrift', 'metadataDrift', 'oidDrift'])('cannot qualify %s after execution', change => {
    const result = contrlProbe({[change]: true})
    expect(result.error).toBe('db01_current_contrl_catalog_changed')
    expect(result.runs).toBe(1)
    expect(result.receipt.current_contrl_source_install?.status).not.toBe('PASS')
  })
  it.each([['ddlFailure', 'db01_current_contrl_install_failed'], ['unknownOutcome', 'db01_current_contrl_install_outcome_unknown']])('does not retry or qualify %s', (change, error) => {
    const result = contrlProbe({[change]: true})
    expect(result.error).toBe(error)
    expect(result.runs).toBe(1)
    expect(result.receipt.current_contrl_source_install?.status).not.toBe('PASS')
  })
})

const contrlQualificationHarness = String.raw`
import ast, copy, json, pathlib, re, sys, textwrap
case=sys.argv[1];source=pathlib.Path('.github/workflows/ediel-db01-current-native.yml').read_text()
programs=[ast.parse(textwrap.dedent(x)) for x in re.findall(r"python3 - <<'PY'[^\n]*\n(.*?)\n          PY",source,re.S)]
module=next(tree for tree in programs if any(isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='expected_historical' for t in n.targets) for n in tree.body))
definitions=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name=='qualify_current_contrl_execution']
calls=[n for n in module.body if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='qualify_current_contrl_execution']
if len(definitions)!=1 or len(calls)!=1:
 print(json.dumps({'error':'db01_current_contrl_qualifier_missing'}));sys.exit(0)
donor={'path':'supabase/migrations/20261030130400_ediel_contrl_retained_source_linear.sql','mode':'100644','git_blob_oid':'5855a585e4fedfbd13122471e77baff118224a7d','sha256':'118237935cf39160870272f9a8fc384a435218613309994294793bfe416c2f75'}
pre='142f25b2cfdb260e7183a2ceb5fcb309498bd0bc9b86ce297738743f9434707e';post='e1ce86e1838a96ecb8b17b70c32c1b21e662ca37d173627a9722f6b76ca00ffa';schema='032ec47d9f7215e28518eb2afa0fb7ee309be89f4fee19ea05a39f70ad679e5f'
before={'oid':'12345','metadata_sha256':'a'*64,'body_sha256':pre};after={**before,'body_sha256':post}
record={'schema':'db01_current_contrl_source_v1','status':'PASS','exit_code':0,'native_or_approval_credit':False,'source_sha':'synthetic-head','source_schema_sha256':schema,'donor':donor,'preimage_sha256':pre,'postimage_sha256':post,'expected_definition_sha256':'72f56c36a939142fd80ea0630a90c002fcec206437238010634530e46f34927d','catalog_before':before,'catalog_after':after}
receipt={'checkout_sha':'synthetic-head','root_source':{'blobs':{donor['path']:{k:v for k,v in donor.items() if k!='path'},'supabase/schema.sql':{'sha256':schema}}},'current_contrl_source_install':record}
if case=='missing':del receipt['current_contrl_source_install']
if case=='failed':record['status']='EXECUTED_UNQUALIFIED'
if case=='wrong-exit':record['exit_code']=17
if case=='wrong-head':record['source_sha']='different-head'
if case=='wrong-schema':record['source_schema_sha256']='0'*64
if case=='wrong-donor':record['donor']={**donor,'sha256':'0'*64}
if case=='wrong-preimage':record['catalog_before']={**before,'body_sha256':'0'*64}
if case=='wrong-postimage':record['catalog_after']={**after,'body_sha256':'0'*64}
if case=='wrong-metadata':record['catalog_after']={**after,'metadata_sha256':'b'*64}
if case=='wrong-oid':record['catalog_after']={**after,'oid':'54321'}
if case=='fake-credit':record['native_or_approval_credit']=True
namespace={'receipt':receipt,'re':re}
error=None
try:exec(compile(ast.Module(body=definitions+calls,type_ignores=[]),'<actual-final-contrl-qualification>','exec'),namespace)
except Exception as e:error=str(e)
print(json.dumps({'error':error}))
`
it.each(['valid', 'missing', 'failed', 'wrong-exit', 'wrong-head', 'wrong-schema', 'wrong-donor', 'wrong-preimage', 'wrong-postimage', 'wrong-metadata', 'wrong-oid', 'fake-credit'])(
  'requires an exact executed CONTRL receipt in final workflow qualification: %s', change => {
    const result = JSON.parse(execFileSync('python3', ['-c', contrlQualificationHarness, change], {encoding: 'utf8', timeout: 5000}))
    expect(result.error).toBe(change === 'valid' ? null : 'db01_current_contrl_execution_required')
  })

it('admits the genuine T4 successor only with the unchanged 251-function writer closure', () => {
  const python = String.raw`
import ast, hashlib, json, pathlib, re, subprocess, tempfile, textwrap
repo=pathlib.Path.cwd();lines=(repo/'.github/workflows/ediel-db01-current-native.yml').read_text().splitlines()
start=next(i for i,line in enumerate(lines) if 'cat > "$DB01_PRIVATE/qualify-current-guards.py"' in line)+1
end=next(i for i in range(start,len(lines)) if lines[i].strip()=='PY')
tree=ast.parse(textwrap.dedent('\n'.join(lines[start:end])))
names={'blocks','functions','observe_current_write_api','current_write_api_install_spec'}
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
sha=lambda value:hashlib.sha256(value.encode()).hexdigest()
def fail(message):raise RuntimeError(message)
namespace={'json':json,'re':re,'hashlib':hashlib,'sha':sha,'fail':fail}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual-writer-source-closure>','exec'),namespace)
spec=namespace['current_write_api_install_spec']();results=[]
old=subprocess.check_output(['git','show','14007c0938af0e0d7de136fe76748b3589822ca6:supabase/schema.sql'],text=True)
new=(repo/'supabase/schema.sql').read_text()
with tempfile.TemporaryDirectory(prefix='db01-writer-source-closure-') as folder:
 path=pathlib.Path(folder)/'receipt.json'
 for source in [old,new]:
  catalog=namespace['blocks'](source);receipt={'checkout_sha':'source-only','root_source':{'blobs':{'supabase/schema.sql':{'sha256':sha(source)}}}}
  namespace.update(expected=catalog,source_functions=namespace['functions'](catalog),receipt=receipt,receipt_path=path,sql=lambda query:'[]')
  namespace['observe_current_write_api']();observation=receipt['current_write_api_observation']
  results.append({'schema':sha(source),'definitions':observation['canonical_function_definitions'],'names':observation['planned_function_names'],'catalog':catalog})
 changed=[list(key) for key in sorted(set(results[0]['catalog'])|set(results[1]['catalog'])) if results[0]['catalog'].get(key)!=results[1]['catalog'].get(key)]
 print(json.dumps({'schemaPin':spec['schema_sha256'],'oldSchema':results[0]['schema'],'newSchema':results[1]['schema'],'changedObjects':changed,'writerCounts':[len(x['names']) for x in results],'writerDefinitionDigests':[sha(json.dumps(x['definitions'],sort_keys=True,separators=(',',':'))) for x in results],'definitionsIdentical':results[0]['definitions']==results[1]['definitions'],'949InWriter':any('gridex_ack_authority.read_outbound_originals_v1' in x['names'] for x in results),'beforeCatalogPin':spec['before_catalog_sha256']}))
`
  const result = JSON.parse(execFileSync('python3', ['-c', python], {encoding: 'utf8', timeout: 10_000}))
  expect(result).toEqual({
    schemaPin: '032ec47d9f7215e28518eb2afa0fb7ee309be89f4fee19ea05a39f70ad679e5f',
    oldSchema: 'bf4370087bed7d9ed8ff754a9c3468443b60d05442f7f9b85d42dc77a0f5538b',
    newSchema: '032ec47d9f7215e28518eb2afa0fb7ee309be89f4fee19ea05a39f70ad679e5f',
    changedObjects: [
      ['gridex_ack_authority', 'FUNCTION', 'read_outbound_originals_v1(uuid, text)'],
      ['public', 'ACL', 'FUNCTION gridex_approve_invoice_export_item_v1(p_company_id uuid, p_export_item_id uuid, p_actor_user_id uuid, p_expected_context jsonb, p_review_hash text)'],
      ['public', 'COMMENT', 'FUNCTION gridex_approve_invoice_export_item_v1(p_company_id uuid, p_export_item_id uuid, p_actor_user_id uuid, p_expected_context jsonb, p_review_hash text)'],
      ['public', 'FUNCTION', 'gridex_approve_invoice_export_item_v1(uuid, uuid, uuid, jsonb, text)'],
    ],
    writerCounts: [251, 251],
    writerDefinitionDigests: Array(2).fill('23866bb938ea1230a1f623073c436ae3d6583b5518378d0ee8eabd403eeb383d'),
    definitionsIdentical: true, '949InWriter': false,
    beforeCatalogPin: '709e4839c481dec2667da1f26110c5593e631a19ea3bfe4809afcc61a0d4d58d',
  })
})

const genuineT4ClosureHarness = String.raw`
import ast,hashlib,json,pathlib,re,textwrap
root=pathlib.Path.cwd();lines=(root/'.github/workflows/ediel-db01-current-native.yml').read_text().splitlines()
start=next(i for i,line in enumerate(lines) if 'cat > "$DB01_PRIVATE/qualify-current-guards.py"' in line)+1
end=next(i for i in range(start,len(lines)) if lines[i].strip()=='PY')
tree=ast.parse(textwrap.dedent('\n'.join(lines[start:end])))
nodes=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in {'blocks','functions','current_write_api_install_spec'}]
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
def fail(s):raise RuntimeError(s)
ns={'re':re,'sha':sha,'fail':fail};exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual-workflow>','exec'),ns)
schema=(root/'supabase/schema.sql').read_text();catalog=ns['blocks'](schema);functions=ns['functions'](catalog)
pending=['public.gridex_enqueue_normal_supplier_switch_v1'];names=set()
while pending:
 name=pending.pop()
 if name in names or name=='auth.uid' or name not in functions:continue
 names.add(name)
 for key,signature,body in functions[name]:pending.extend(re.findall(r'\b((?:public|gridex_[a-z0-9_]+|auth)\.[a-z0-9_]+)\s*\(',body))
definitions=[{'identity':key,'body_sha256':sha(body)} for name in sorted(names) for key,signature,body in functions[name]]
print(json.dumps({'schema_sha256':sha(schema),'selected_count':len(names),'selected_definitions_sha256':sha(json.dumps(definitions,sort_keys=True,separators=(',',':'))),'approval_in_selected_closure':'public.gridex_approve_invoice_export_item_v1' in names,'approval_present_in_capture':'public.gridex_approve_invoice_export_item_v1' in functions,'spec':ns['current_write_api_install_spec']()}))
`
describe('DB01 genuine T4 capture applicability', () => {
  it('pins the actual selected writer closure rather than admitting an arbitrary new schema hash', () => {
    const result = JSON.parse(execFileSync('python3', ['-c', genuineT4ClosureHarness], { encoding: 'utf8', timeout: 10000 }))
    expect(result).toMatchObject({ schema_sha256: '032ec47d9f7215e28518eb2afa0fb7ee309be89f4fee19ea05a39f70ad679e5f',
      selected_count: 251, selected_definitions_sha256: '23866bb938ea1230a1f623073c436ae3d6583b5518378d0ee8eabd403eeb383d',
      approval_present_in_capture: true, approval_in_selected_closure: false })
    expect(result.spec).toMatchObject({ schema_sha256: result.schema_sha256, function_count: result.selected_count,
      canonical_definitions_sha256: result.selected_definitions_sha256,
      before_catalog_sha256: '709e4839c481dec2667da1f26110c5593e631a19ea3bfe4809afcc61a0d4d58d', preimage_artifact_id: 12655280424 })
  })
})
