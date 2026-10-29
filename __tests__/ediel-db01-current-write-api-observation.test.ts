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
spec=copy.deepcopy(original_spec);spec['before_catalog_sha256']=sha(json.dumps(before_rows,sort_keys=True,separators=(',',':')));spec['function_count']=3
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
