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
