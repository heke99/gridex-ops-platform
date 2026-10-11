// masterplan: DB-01, AT-DB-01
// Static native configuration admission over actual Git sources and a declared
// local-only status fixture. No database, native case or certification executes.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest'

type Input = {mode: string; git_blob_oid: string; sha256: string}
const root = resolve(__dirname, '..'), baseRevision = '56e58b95518ec4d5eef210ba16ba46228afb40ac'
const producer = 'lib/ediel/testing/agtEngine.ts', kernel = 'lib/ediel/core/kernel.ts'
const kernelLegacy = 'lib/ediel/core/kernelLegacy.ts'
const adoptedRevision = '231b9ef84e5a9c5e737c44dc9d72dd33edb0b56c'
const dependencies = [kernel, kernelLegacy, 'lib/ediel/core/outboundOwnerWitness.ts',
  'lib/ediel/rulebook/canonicalEdielFacade.ts', 'lib/ediel/testing/tgtCanonicalDraftRoute.ts',
  'lib/ediel/testing/agtRuntime.ts', 'lib/ediel/testing/agtRegistry.ts',
  'lib/ediel/testing/positiveFixtureAuthority.ts', 'lib/ediel/production/lifeEventCertificationSource.ts']
const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024})
const input = (revision: string, path: string): Input => {
  const metadata = git('ls-tree', revision, '--', path).split('\t')[0].split(' ')
  return {mode: metadata[0], git_blob_oid: metadata[2], sha256: createHash('sha256').update(git('show', `${revision}:${path}`)).digest('hex')}
}
const temp = mkdtempSync(join(tmpdir(), 'db01-source-basis-')), baseRoot = join(temp, 'base')
const receiptPath = join(temp, 'receipt.json'), statusPath = join(temp, 'status.json')
let receipt: Record<string, unknown>
let identities: Record<string, {base: Input; root: Input}>

beforeAll(() => {
  for (const path of dependencies) {mkdirSync(dirname(join(baseRoot, path)), {recursive: true}); writeFileSync(join(baseRoot, path), git('show', `${baseRevision}:${path}`))}
  writeFileSync(statusPath, JSON.stringify({API_URL: 'http://127.0.0.1:54321', SERVICE_ROLE_KEY: 'unit-configuration-only', ANON_KEY: 'unit-configuration-only'}))
})
beforeEach(() => {
  // Parse the actual workflow's declared input lists; do not synthesize a native
  // execution receipt or assert that an inventory/case ran in this fixture.
  const declarations = execFileSync('python3', ['-c', `import ast,json,pathlib,textwrap
s=pathlib.Path('.github/workflows/ediel-db01-current-native.yml').read_text()
s=textwrap.dedent(s.split("python3 - <<'PY'\\n",1)[1].split('\\n          PY',1)[0])
n={}
for x in ast.parse(s).body:
 if isinstance(x,ast.FunctionDef):break
 if isinstance(x,ast.Assign) and len(x.targets)==1 and isinstance(x.targets[0],ast.Name):
  k=x.targets[0].id
  if k in ['current_read_manifest','current_read_forwards','current_reader_callers','forwards','repair','repair_unit','producer','producer_unit','canonical_dependencies','required','current_only','required_base']:
   n[k]=eval(compile(ast.Expression(x.value),'<declared-inputs>','eval'),{},n)
print(json.dumps({'root':n['required'],'base':n['required_base'],'reader':n['current_read_manifest']}))`], {cwd: root, encoding: 'utf8'})
  const declared = JSON.parse(declarations) as {root: string[]; base: string[]; reader: Array<Input & {path: string}>}
  identities = Object.fromEntries(dependencies.map(path => [path, {base: input(baseRevision, path), root: input('HEAD', path)}]))
  const rootInputs = {...Object.fromEntries(dependencies.map(path => [path, identities[path].root])), [producer]: input('HEAD', producer), 'supabase/schema.sql': input('HEAD', 'supabase/schema.sql'),
    ...Object.fromEntries(declared.reader.map(item => [item.path, input('HEAD', item.path)]))}
  const historical = {kind: 'reconstructed_public_births', default_alias: 'BASE56',
    module_overrides: [{specifier: '@/lib/ediel/testing/agtEngine', path: producer, source: 'ROOT', revision: git('rev-parse', 'HEAD').trim(), ...rootInputs[producer]}],
    canonical_dependency_identity: identities,
    kernel_basis: {source_revision: adoptedRevision, path: kernel,
      historical_alias: 'BASE56', current_alias: 'ROOT', ...identities[kernel]},
    kernel_legacy_basis: {source_revision: adoptedRevision, path: kernelLegacy,
      historical_alias: 'BASE56', current_alias: 'ROOT', ...identities[kernelLegacy]},
    public_creator_input: {source: 'BASE56', port: 'createEdielMessage', field: 'partyAddressId', when: 'historical_AGT_Z09_L7_before_INSERT',
      value_origin: 'existing_prospective_legacy_fixture_UUID', mutation: 'ONLY_partyAddressId',
      scope: 'one_exact_company_actor_profile_route_birth', restore: 'finally', authority: 'NO_authority_or_accepted_fact'}}
  receipt = {root_path: root, base_path: baseRoot, checkout_sha: git('rev-parse', 'HEAD').trim(), base_sha: baseRevision,
    required_input_paths: declared.root, required_base_input_paths: declared.base,
    root_source: {blobs: rootInputs}, base_source: {blobs: Object.fromEntries(dependencies.map(path => [path, identities[path].base]))},
    historical_source_basis: historical, current_source_basis: 'ROOT_only_no_legacy_hint_wrapper',
    current_database_basis: {kind: 'BASE56_repair_two_forwards_plus_delivered_reader_guard_closure', forwards: declared.reader, schema_path: 'supabase/schema.sql'},
    current_guard_result: {status: 'PASS', source_sha: git('rev-parse', 'HEAD').trim(), reader_function_names: 233, helper_function_names: 371, function_definitions: 371, delivered_relation_objects: 18, mismatches: [],
      source_schema_sha256: createHash('sha256').update(readFileSync(join(root, 'supabase/schema.sql'))).digest('hex')},
    current_api_schema_result: {status: 'PASS', source_sha: git('rev-parse', 'HEAD').trim(),
      rpc_paths: ['/rpc/ediel_read_prodat_h_accepted_original_v1', '/rpc/ediel_read_prodat_customer_masterdata_original_v1']},
    phases: Object.fromEntries(['current_guard_preparation', 'current_read_forwards', 'current_guard_qualification', 'current_api_schema'].map(name => [name, {status: 'PASS', exit_code: 0}]))}
  vi.stubEnv('GRIDEX_DB01_NATIVE_RECEIPT', receiptPath); vi.stubEnv('GRIDEX_NATIVE_STATUS', statusPath)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'prior-unit-only'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'prior-unit-only')
})
afterEach(() => {vi.unstubAllEnvs(); vi.resetModules()})
afterAll(() => {rmSync(temp, {recursive: true, force: true})})
async function load(phase: 'historical' | 'current') {
  writeFileSync(receiptPath, JSON.stringify(receipt))
  vi.stubEnv('GRIDEX_DB01_NATIVE_PHASE', phase); vi.stubEnv('GRIDEX_DB01_SOURCE_ROOT', phase === 'historical' ? baseRoot : root)
  vi.resetModules()
  return (await import('../scripts/ediel-db01-current-native.config')).default
}

it.each(['historical', 'current'] as const)('admits only the declared %s aliases and exact historical/current kernel pair', async phase => {
  expect(identities[kernel].base).not.toEqual(identities[kernel].root)
  expect(identities[kernelLegacy].base).not.toEqual(identities[kernelLegacy].root)
  for (const path of dependencies.filter(path => path !== kernel && path !== kernelLegacy)) expect(identities[path].base).toEqual(identities[path].root)
  const config = await load(phase)
  expect(config.resolve?.alias).toContainEqual({find: '@', replacement: phase === 'historical' ? baseRoot : root})
})
it.each(['mode', 'git_blob_oid', 'sha256'] as const)('refuses a changed kernel %s even with self-consistent forged receipt fields', async field => {
  identities[kernel].root[field] = field === 'mode' ? '100755' : 'f'.repeat(field === 'sha256' ? 64 : 40)
  await expect(load('current')).rejects.toThrow('db01_native_exact_kernel_basis_required')
})
it('refuses a different adopted revision and a changed non-kernel dependency', async () => {
  const basis = receipt.historical_source_basis as {kernel_basis: {source_revision: string}}
  basis.kernel_basis.source_revision = baseRevision
  await expect(load('current')).rejects.toThrow('db01_native_exact_kernel_basis_required')
  basis.kernel_basis.source_revision = adoptedRevision
  identities[dependencies[2]].root.sha256 = 'f'.repeat(64)
  await expect(load('current')).rejects.toThrow('db01_native_BASE_canonical_dependency_mismatch')
})
it('refuses changed historical kernel bytes without modifying the original source', async () => {
  const path = join(baseRoot, kernel), before = readFileSync(path)
  try {writeFileSync(path, Buffer.concat([before, Buffer.from('\nchanged')])); await expect(load('historical')).rejects.toThrow('db01_native_BASE_canonical_dependency_mismatch')}
  finally {writeFileSync(path, before)}
})

it.each(['mode', 'git_blob_oid', 'sha256'] as const)('refuses a forged legacy kernel %s even when both receipt copies agree', async field => {
  identities[kernelLegacy].root[field] = field === 'mode' ? '100755' : 'f'.repeat(field === 'sha256' ? 64 : 40)
  await expect(load('current')).rejects.toThrow('db01_native_exact_kernel_legacy_basis_required')
})
it.each(['path', 'source_revision', 'historical_alias', 'current_alias'] as const)('refuses a changed legacy basis %s', async field => {
  const historical = receipt.historical_source_basis as {kernel_legacy_basis: Record<string, unknown>}
  historical.kernel_legacy_basis[field] = field === 'source_revision' ? baseRevision : 'unqualified'
  await expect(load('current')).rejects.toThrow('db01_native_exact_kernel_legacy_basis_required')
})
it('refuses an absent legacy basis', async () => {
  delete (receipt.historical_source_basis as Record<string, unknown>).kernel_legacy_basis
  await expect(load('current')).rejects.toThrow('db01_native_exact_kernel_legacy_basis_required')
})
it('refuses changed historical legacy bytes and restores the original fixture', async () => {
  const path = join(baseRoot, kernelLegacy), before = readFileSync(path)
  try {writeFileSync(path, Buffer.concat([before, Buffer.from('\nchanged')])); await expect(load('historical')).rejects.toThrow('db01_native_BASE_canonical_dependency_mismatch')}
  finally {writeFileSync(path, before)}
})

// Execute each workflow's actual Python basis checks with declared inventory
// inputs. These are admission/refusal tests, never native execution receipts.
const changes = ['valid', 'kernel-mode', 'kernel-git_blob_oid', 'kernel-sha256',
  'legacy-mode', 'legacy-git_blob_oid', 'legacy-sha256', 'unchanged-sha256'] as const
it.each(['admission', 'qualification'] as const)('keeps workflow %s strict for both changed kernels and unchanged dependencies', stage => {
  const python = `import json,pathlib,subprocess,sys,textwrap
receipt=json.loads(sys.stdin.read())
workflow=pathlib.Path('.github/workflows/ediel-db01-current-native.yml').read_text()
stage=sys.argv[1]
if stage=='admission':
 code=textwrap.dedent('          kernel_path ='+workflow.split('          kernel_path =',1)[1].split('          receipt =',1)[0])
else:
 code=textwrap.dedent('          expected_kernel_basis='+workflow.split('          expected_kernel_basis=',1)[1].split("          if receipt.get('unrepaired_BASE_failure')",1)[0])
basis=receipt['historical_source_basis']
env={'subprocess':subprocess,'head':receipt['checkout_sha'],'baseline':receipt['base_source'],'current':receipt['root_source'],
 'canonical_dependencies':list(basis['canonical_dependency_identity']),'receipt':receipt,'basis':basis,
 'dependencies':set(basis['canonical_dependency_identity'])}
exec(compile(code,'<actual-workflow-basis-'+stage+'>','exec'),env)
`
  for (const change of changes) {
    const declared = structuredClone(receipt) as typeof receipt
    if (change !== 'valid') {
      const [target, field] = change.split('-')
      const path = target === 'kernel' ? kernel : target === 'legacy' ? kernelLegacy : dependencies[2]
      const rootInputs = declared.root_source as {blobs: Record<string, Input>}
      const historical = declared.historical_source_basis as {canonical_dependency_identity: Record<string, {base: Input; root: Input}>;
        kernel_basis: {root: Input}; kernel_legacy_basis: {root: Input}}
      const inputField = field as keyof Input
      const forged = inputField === 'mode' ? '100755' : 'f'.repeat(inputField === 'sha256' ? 64 : 40)
      rootInputs.blobs[path][inputField] = forged
      historical.canonical_dependency_identity[path].root[inputField] = forged
      if (target === 'kernel') historical.kernel_basis.root[inputField] = forged
      if (target === 'legacy') historical.kernel_legacy_basis.root[inputField] = forged
    }
    const execute = () => execFileSync('python3', ['-c', python, stage], {cwd: root, input: JSON.stringify(declared), stdio: ['pipe', 'pipe', 'pipe']})
    if (change === 'valid') expect(execute, `${stage} actual source identities`).not.toThrow()
    else expect(execute, `${stage} refuses self-consistent ${change}`).toThrow()
  }
})

// The actual e9 national case failed before legal/archive guards because its
// current reader RPC was absent from the reconstructed historical database.
it('refuses current native admission without qualified delivered reader dependencies', async () => {
  delete receipt.current_database_basis
  await expect(load('current')).rejects.toThrow('db01_native_current_reader_guard_basis_required')
})

it('refuses a dropped predecessor and a forged reader SQL identity', async () => {
  const basis = receipt.current_database_basis as {forwards: Array<Input & {path: string}>}
  const original = structuredClone(basis.forwards)
  basis.forwards.splice(0, 1)
  await expect(load('current')).rejects.toThrow('db01_native_current_reader_guard_basis_required')
  basis.forwards = original
  const reader = basis.forwards.find(item => item.path.endsWith('_ediel_prodat_customer_masterdata_original_read.sql'))!
  reader.sha256 = 'f'.repeat(64)
  const inputs = receipt.root_source as {blobs: Record<string, Input>}
  inputs.blobs[reader.path].sha256 = 'f'.repeat(64)
  await expect(load('current')).rejects.toThrow('db01_native_current_reader_guard_basis_required')
})
it.each(['current_guard_preparation', 'current_read_forwards', 'current_guard_qualification', 'current_api_schema'])('refuses failed or unexecuted actual current phase %s', async name => {
  const phases = receipt.phases as Record<string, {status: string; exit_code: number | null}>
  phases[name] = {status: 'NOT_RUN', exit_code: null}
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
  phases[name] = {status: 'FAIL', exit_code: 1}
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
})
it('does not use a guard result for another source or a different schema', async () => {
  const result = receipt.current_guard_result as Record<string, unknown>
  result.source_sha = baseRevision
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
  result.source_sha = git('rev-parse', 'HEAD').trim(); result.source_schema_sha256 = 'f'.repeat(64)
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
})

it('qualifies current function definitions, ACLs and exact delivered guard objects independently of native cases', () => {
  writeFileSync(receiptPath, JSON.stringify(receipt))
  const python = String.raw`import os,pathlib,textwrap
s=pathlib.Path('.github/workflows/ediel-db01-current-native.yml').read_text()
s=s.split('cat > "$DB01_PRIVATE/qualify-current-guards.py" <<\'PY\'\n',1)[1].split('\n          PY',1)[0]
e={}
exec(textwrap.dedent(s).split('mode=sys.argv[1]',1)[0],e)
assert len(e['reader_names'])==233 and len(e['relation_keys'])==18 and len(e['names'])==371 and len(e['function_keys'])==371
expected=e['expected']; compare=e['logical_mismatches']
assert compare(dict(expected))==[]
keys=[('gridex_ediel_technical_ack','FUNCTION','require_contrl_v1(public.ediel_messages)'),
 ('public','FUNCTION','ediel_read_prodat_h_accepted_original_v1(uuid, uuid, uuid)'),
 ('public','ACL','FUNCTION ediel_read_prodat_h_accepted_original_v1(p_company_id uuid, p_message_id uuid, p_actor_user_id uuid)'),
 ('gridex_customer_masterdata','CONSTRAINT','preparations customer_masterdata_preparation_actor_operation_key'),
 ('gridex_customer_masterdata','FK CONSTRAINT','preparations preparations_cancellation_origin_id_fkey'),
 ('gridex_ediel_header_negative_birth','ROW SECURITY','receipts'),
 ('public','TRIGGER','ediel_messages assigned_prodat_negative_original_immutable')]
for key in keys:
 assert key in expected
 actual=dict(expected);del actual[key];assert compare(actual),('missing',key)
 actual=dict(expected);actual[key]+='\nchanged logical guard';assert compare(actual),('changed',key)
# Framing normalization never erases an actual function/constraint/ACL body.
assert e['blocks']('\n--\n-- Name: t; Type: TABLE; Schema: s; Owner: -\n--\nCREATE TABLE s.t(id uuid);\n--\n-- PostgreSQL database dump complete\n--\n\\unrestrict random\n')=={('s','TABLE','t'):'CREATE TABLE s.t(id uuid);'}
`
  expect(() => execFileSync('python3', ['-c', python], {cwd: root, env: {...process.env, CURRENT_ROOT: root,
    GRIDEX_DB01_NATIVE_RECEIPT: receiptPath}, stdio: ['pipe', 'pipe', 'pipe']})).not.toThrow()
})

it('refuses mismatched guard surroundings and missing actual reader API visibility', async () => {
  const result = receipt.current_guard_result as Record<string, unknown>
  result.mismatches = [{identity: ['gridex_customer_masterdata', 'TABLE', 'preparations']}]
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
  result.mismatches = []
  const api = receipt.current_api_schema_result as {rpc_paths: string[]}
  api.rpc_paths.splice(0, 1)
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
})
