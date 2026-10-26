// masterplan: DB-01, AT-DB-01
// Static native configuration admission over actual Git sources and a declared
// local-only status fixture. No database, native case or certification executes.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {afterAll, afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest'

const s01DependencyExtensions = [
  {
    "name": "gridex_utilts_binding.esco_local_time_v1",
    "identity": [
      "gridex_utilts_binding",
      "FUNCTION",
      "esco_local_time_v1(text, text)"
    ],
    "body_sha256": "45b07776f975f4285e0691642071da7c722862577f9dd2872f13e8bc80350ed1"
  },
  {
    "name": "gridex_utilts_binding.require_s01_l359_basis_v1",
    "identity": [
      "gridex_utilts_binding",
      "FUNCTION",
      "require_s01_l359_basis_v1(uuid, uuid)"
    ],
    "body_sha256": "7e0f5b2674a1c6a9b23eac66f3e16873e76f00eb2057617458e5ecc954377269"
  },
  {
    "name": "gridex_utilts_binding.s01_l359_area_identity_v1",
    "identity": [
      "gridex_utilts_binding",
      "FUNCTION",
      "s01_l359_area_identity_v1(jsonb, text)"
    ],
    "body_sha256": "2a435fae6a521b93e327c2931af685a1527b6f2e360d75d1b92472665e702651"
  },
  {
    "name": "gridex_utilts_binding.s01_l359_item_matches_v1",
    "identity": [
      "gridex_utilts_binding",
      "FUNCTION",
      "s01_l359_item_matches_v1(jsonb, jsonb)"
    ],
    "body_sha256": "0c16b7b82ae38b73eed6c81f9249d1ec485bab4401885e2f00f1c632769f55c8"
  }
]

type Input = {mode: string; git_blob_oid: string; sha256: string}
const root = resolve(__dirname, '..'), baseRevision = '56e58b95518ec4d5eef210ba16ba46228afb40ac'
const producer = 'lib/ediel/testing/agtEngine.ts', kernel = 'lib/ediel/core/kernel.ts'
const kernelLegacy = 'lib/ediel/core/kernelLegacy.ts'
const facade = 'lib/ediel/rulebook/canonicalEdielFacade.ts'
const adoptedFacadeRevision = 'ca892c14643181656e842bf4d8ffa8b6d829dec2'
const expectedBaseFacade: Input = {mode: '100644', git_blob_oid: 'a170889bc7a9463e757302989cb596e30f527c6f',
  sha256: 'd395ebef617da8181879605aaf486cae889950316af7e1967d83525ece6a2d8f'}
const expectedCurrentFacade: Input = {mode: '100644', git_blob_oid: '541351571064dc40e4df379dfcadb642e0b6d46b',
  sha256: '8b635d22a53729d8321fe6f1677d41137dc300736e51a7d85f32c2f87390d053'}
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
  if k in ['current_read_manifest','current_read_forwards','current_reader_callers','current_writer_inputs','forwards','repair','repair_unit','producer','producer_unit','canonical_dependencies','s01_current_owner','required','current_only','required_base']:
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
    canonical_facade_basis: {source_revision: adoptedFacadeRevision, path: facade,
      historical_alias: 'BASE56', current_alias: 'ROOT', ...identities[facade]},
    public_creator_input: {source: 'BASE56', port: 'createEdielMessage', field: 'partyAddressId', when: 'historical_AGT_Z09_L7_before_INSERT',
      value_origin: 'existing_prospective_legacy_fixture_UUID', mutation: 'ONLY_partyAddressId',
      scope: 'one_exact_company_actor_profile_route_birth', restore: 'finally', authority: 'NO_authority_or_accepted_fact'}}
  receipt = {root_path: root, base_path: baseRoot, checkout_sha: git('rev-parse', 'HEAD').trim(), base_sha: baseRevision,
    required_input_paths: declared.root, required_base_input_paths: declared.base,
    root_source: {blobs: rootInputs}, base_source: {blobs: Object.fromEntries(dependencies.map(path => [path, identities[path].base]))},
    historical_source_basis: historical, current_source_basis: 'ROOT_only_no_legacy_hint_wrapper',
    current_database_basis: {kind: 'BASE56_repair_two_forwards_plus_delivered_reader_guard_closure', forwards: declared.reader, schema_path: 'supabase/schema.sql'},
    current_s01_source_install: {"donor_path": "supabase/migrations/20261023201053_ediel_s01_area_aggregate_identity.sql", "donor_sha256": "ae647d1d240a2e3cfa202906766eed3b13f6d5d15a0afd14885fe36b63da4a5d", source_schema_sha256: createHash('sha256').update(readFileSync(join(root, 'supabase/schema.sql'))).digest('hex'), "predecessor_definition_sha256": "11de04c3af4dd571693cfe8b249d3a30fc163848a78d1e7aee287ab3c093a7b6", "sql_sha256": "deafe7916db6e2c82f7c66cacc9560f1fd44d539e6a9129e115dce658864580b", "status": "PASS", "exit_code": 0},
    current_guard_result: {status: 'PASS', source_sha: git('rev-parse', 'HEAD').trim(), reader_function_names: 233, helper_function_names: 377, function_definitions: 377, source_qualified_dependency_extensions: s01DependencyExtensions.map(item => ({...item, identity: [...item.identity]})), delivered_relation_objects: 18, mismatches: [],
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
  expect(identities[facade].base).toEqual(expectedBaseFacade)
  expect(identities[facade].root).toEqual(expectedCurrentFacade)
  expect(identities[facade].base).not.toEqual(identities[facade].root)
  for (const path of dependencies.filter(path => path !== kernel && path !== kernelLegacy && path !== facade)) expect(identities[path].base).toEqual(identities[path].root)
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


// The changed facade has a separate, exactly adopted lineage. These operate
// on the real configuration admission, never a native execution receipt.
it.each(['absent', 'extra'] as const)('refuses %s canonical facade basis shape', async kind => {
  const historical = receipt.historical_source_basis as Record<string, unknown>
  if (kind === 'absent') delete historical.canonical_facade_basis
  else (historical.canonical_facade_basis as Record<string, unknown>).unqualified = true
  await expect(load('current')).rejects.toThrow('db01_native_exact_canonical_facade_basis_required')
})
it.each(['path', 'source_revision', 'historical_alias', 'current_alias'] as const)('refuses changed canonical facade basis %s', async field => {
  const historical = receipt.historical_source_basis as {canonical_facade_basis: Record<string, unknown>}
  historical.canonical_facade_basis[field] = field === 'source_revision' ? baseRevision : 'unqualified'
  await expect(load('current')).rejects.toThrow('db01_native_exact_canonical_facade_basis_required')
})
it.each(['mode', 'git_blob_oid', 'sha256'] as const)('refuses forged current facade %s with agreeing receipt copies', async field => {
  identities[facade].root[field] = field === 'mode' ? '100755' : 'f'.repeat(field === 'sha256' ? 64 : 40)
  await expect(load('current')).rejects.toThrow('db01_native_exact_canonical_facade_basis_required')
})
it.each(['mode', 'git_blob_oid', 'sha256'] as const)('refuses forged BASE facade %s with agreeing receipt copies', async field => {
  identities[facade].base[field] = field === 'mode' ? '100755' : 'f'.repeat(field === 'sha256' ? 64 : 40)
  await expect(load('historical')).rejects.toThrow('db01_native_exact_canonical_facade_basis_required')
})
it('refuses changed historical facade bytes and restores the original disposable fixture', async () => {
  const path = join(baseRoot, facade), before = readFileSync(path)
  try {writeFileSync(path, Buffer.concat([before, Buffer.from('\nchanged')])); await expect(load('historical')).rejects.toThrow('db01_native_BASE_canonical_dependency_mismatch')}
  finally {writeFileSync(path, before)}
})

// Execute each workflow's actual Python basis checks with declared inventory
// inputs. These are admission/refusal tests, never native execution receipts.
const changes = ['valid', 'kernel-mode', 'kernel-git_blob_oid', 'kernel-sha256',
  'legacy-mode', 'legacy-git_blob_oid', 'legacy-sha256', 'unchanged-sha256',
  'facade-mode', 'facade-git_blob_oid', 'facade-sha256',
  'facadeBase-mode', 'facadeBase-git_blob_oid', 'facadeBase-sha256',
  'facadeBasis-path', 'facadeBasis-source_revision', 'facadeBasis-historical_alias', 'facadeBasis-current_alias', 'facadeBasis-absent'] as const
it.each((['admission', 'qualification'] as const).flatMap(stage => changes.map(change => [stage, change] as const)))(
  'keeps workflow %s strict for %s across changed kernels and unchanged dependencies', (stage, change) => {
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
if stage=='admission':print(json.dumps(env['canonical_facade_basis']))
`
  const declared = structuredClone(receipt) as typeof receipt
  if (change !== 'valid') {
    const [target, field] = change.split('-')
    const historical = declared.historical_source_basis as {canonical_dependency_identity: Record<string, {base: Input; root: Input}>;
      kernel_basis: {root: Input}; kernel_legacy_basis: {root: Input};
      canonical_facade_basis: {base: Input; root: Input} & Record<string, unknown>}
    if (target === 'facadeBasis') {
      if (field === 'absent') delete (historical as unknown as Record<string, unknown>).canonical_facade_basis
      else historical.canonical_facade_basis[field] = field === 'source_revision' ? baseRevision : 'unqualified'
    } else {
      const path = target === 'kernel' ? kernel : target === 'legacy' ? kernelLegacy
        : target === 'facade' || target === 'facadeBase' ? facade : dependencies[2]
      const side = target === 'facadeBase' ? 'base' : 'root'
      const inputs = declared[side === 'base' ? 'base_source' : 'root_source'] as {blobs: Record<string, Input>}
      const inputField = field as keyof Input
      const forged = inputField === 'mode' ? '100755' : 'f'.repeat(inputField === 'sha256' ? 64 : 40)
      inputs.blobs[path][inputField] = forged
      historical.canonical_dependency_identity[path][side][inputField] = forged
      if (target === 'kernel') historical.kernel_basis.root[inputField] = forged
      if (target === 'legacy') historical.kernel_legacy_basis.root[inputField] = forged
      if (target === 'facade' || target === 'facadeBase') historical.canonical_facade_basis[side][inputField] = forged
    }
  }
  const execute = () => {
    const output = execFileSync('python3', ['-c', python, stage], {cwd: root, input: JSON.stringify(declared), stdio: ['pipe', 'pipe', 'pipe']})
    if (stage === 'admission') {
      // Admission creates a fresh pinned receipt; it does not consume a
      // caller's basis. Qualification independently rejects forged copies.
      expect(JSON.parse(output.toString())).toEqual((receipt.historical_source_basis as Record<string, unknown>).canonical_facade_basis)
    }
    return output
  }
  if (change === 'valid' || (stage === 'admission' && change.startsWith('facadeBasis-'))) expect(execute, `${stage} actual source identities`).not.toThrow()
  else expect(execute, `${stage} refuses self-consistent ${change}`).toThrow()
})

// The actual e9 national case failed before legal/archive guards because its
// current reader RPC was absent from the reconstructed historical database.
it.each(['missing', 'failed', 'donor', 'schema', 'predecessor', 'sql'] as const)('refuses unqualified S01 read-side install %s despite clean guard counters', async shape => {
  const installed = receipt.current_s01_source_install as Record<string, unknown>
  if (shape === 'missing') delete receipt.current_s01_source_install
  if (shape === 'failed') installed.exit_code = 1
  if (shape === 'donor') installed.donor_sha256 = 'f'.repeat(64)
  if (shape === 'schema') installed.source_schema_sha256 = 'f'.repeat(64)
  if (shape === 'predecessor') installed.predecessor_definition_sha256 = 'f'.repeat(64)
  if (shape === 'sql') installed.sql_sha256 = 'f'.repeat(64)
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
})

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
const u5CurrentForwardPaths = [
  'supabase/migrations/20261021052940_ediel_swedish_utilts25a5_registry_and_source_editions.sql',
  'supabase/migrations/20261021094313_ediel_swedish_utilts25a5_inbound_profile_supersession.sql',
] as const
it.each(u5CurrentForwardPaths)('refuses a missing whole U5 current forward %s', async path => {
  const basis = receipt.current_database_basis as {forwards: Array<Input & {path: string}>}
  basis.forwards = basis.forwards.filter(item => item.path !== path)
  await expect(load('current')).rejects.toThrow('db01_native_current_reader_guard_basis_required')
})
it.each(u5CurrentForwardPaths.flatMap(path => (['mode', 'git_blob_oid', 'sha256'] as const).map(field => ({path, field}))))(
  'refuses a forged U5 forward $field for $path even with matching receipt inputs', async ({path, field}) => {
    const basis = receipt.current_database_basis as {forwards: Array<Input & {path: string}>}
    const forward = basis.forwards.find(item => item.path === path)!
    forward[field] = field === 'mode' ? '100755' : 'f'.repeat(field === 'sha256' ? 64 : 40)
    const inputs = receipt.root_source as {blobs: Record<string, Input>}
    inputs.blobs[path][field] = forward[field]
    await expect(load('current')).rejects.toThrow('db01_native_current_reader_guard_basis_required')
  })
it('refuses reversed U5 registry and inbound-selector forward order', async () => {
  const basis = receipt.current_database_basis as {forwards: Array<Input & {path: string}>}
  const registryIndex = basis.forwards.findIndex(item => item.path === u5CurrentForwardPaths[0])
  const inboundIndex = basis.forwards.findIndex(item => item.path === u5CurrentForwardPaths[1])
  ;[basis.forwards[registryIndex], basis.forwards[inboundIndex]] = [basis.forwards[inboundIndex], basis.forwards[registryIndex]]
  await expect(load('current')).rejects.toThrow('db01_native_current_reader_guard_basis_required')
})
it.each(['helper_function_names', 'function_definitions'] as const)('refuses a changed exact guard counter %s', async field => {
  const guard = receipt.current_guard_result as Record<string, unknown>
  for (const count of [373, 376, 378]) {
    guard[field] = count
    await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
  }
})
it.each(['missing', 'removed', 'body', 'identity', 'extra'] as const)('refuses an unqualified S01 dependency extension %s despite exact counters', async shape => {
  const guard = receipt.current_guard_result as Record<string, unknown>
  const extensions = guard.source_qualified_dependency_extensions as Array<{name: string; identity: string[]; body_sha256: string}>
  if (shape === 'missing') delete guard.source_qualified_dependency_extensions
  if (shape === 'removed') extensions.pop()
  if (shape === 'body') extensions[0].body_sha256 = 'f'.repeat(64)
  if (shape === 'identity') extensions[0].identity[2] = 'wrong_signature()'
  if (shape === 'extra') extensions.push({name: 'gridex_utilts_binding.unqualified_extra_v1', identity: ['gridex_utilts_binding', 'FUNCTION', 'unqualified_extra_v1()'], body_sha256: 'f'.repeat(64)})
  await expect(load('current')).rejects.toThrow('db01_native_actual_current_guard_qualification_required')
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
assert len(e['reader_names'])==233 and len(e['relation_keys'])==18 and len(e['names'])==377 and len(e['function_keys'])==377
expected=e['expected']; compare=e['logical_mismatches']
assert len(e['s01_dependency_extensions'])==4
for dependency in e['s01_dependency_extensions']:
 assert tuple(dependency['identity']) in e['function_keys']
 assert dependency['name'] in e['names']
assert compare(dict(expected))==[]
keys=[('gridex_ediel_source_rules','FUNCTION','pack_superseded_by_swedish_utilts25a5_v1(text, text, text, text, date)'),
 ('gridex_ediel_source_rules','FUNCTION','pack_effective_v1(uuid, text, date)'),
 ('public','FUNCTION','gridex_bind_inbound_ediel_rule_pack_evidence()'),
 ('gridex_ediel_technical_ack','FUNCTION','require_contrl_v1(public.ediel_messages)'),
 ('public','FUNCTION','ediel_read_prodat_h_accepted_original_v1(uuid, uuid, uuid)'),
 ('public','ACL','FUNCTION ediel_read_prodat_h_accepted_original_v1(p_company_id uuid, p_message_id uuid, p_actor_user_id uuid)'),
 ('gridex_customer_masterdata','CONSTRAINT','preparations customer_masterdata_preparation_actor_operation_key'),
 ('gridex_customer_masterdata','FK CONSTRAINT','preparations preparations_cancellation_origin_id_fkey'),
 ('gridex_ediel_header_negative_birth','ROW SECURITY','receipts'),
 ('public','TRIGGER','ediel_messages assigned_prodat_negative_original_immutable')]
keys += [tuple(item['identity']) for item in e['s01_dependency_extensions']]
extension_names={item['name'] for item in e['s01_dependency_extensions']}
extension_acl_keys=[key for key in e['function_acl_keys'] if key[0]+'.'+key[2][9:].split('(')[0] in extension_names]
assert len(extension_acl_keys)==4
keys += extension_acl_keys
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


// Exercise both actual inventory branches before any backend/native work. The
// existing declaration parser alone cannot detect a stale runtime count.
it.each((['admission', 'qualification'] as const).flatMap(stage =>
  (['valid', 'duplicate', 'missing', 'extra', 'missing-git-blob'] as const).map(change => [stage, change] as const))) (
  'executes workflow runtime inventory %s with actual Git blobs for %s', (stage, change) => {
  const python = String.raw`import ast,hashlib,json,pathlib,re,subprocess,sys,textwrap
receipt=json.loads(sys.stdin.read())
workflow=pathlib.Path('.github/workflows/ediel-db01-current-native.yml').read_text()
stage,change=sys.argv[1:3]
programs=[ast.parse(textwrap.dedent(x)) for x in re.findall(r"<<'PY'[^\n]*\n([\s\S]*?)\n {10}PY(?:\n|$)",workflow)]
# Evaluate the actual runtime If and its refusal body, not a copied predicate.
if stage=='admission':
 matches=[node for program in programs for node in program.body if isinstance(node,ast.If) and 'len(required)' in ast.unparse(node.test)]
else:
 matches=[node for program in programs for node in program.body if isinstance(node,ast.If) and "len(receipt['required_input_paths'])" in ast.unparse(node.test)]
assert len(matches)==1,(stage,len(matches))
metadata=subprocess.check_output(['git','ls-tree','-r','-z','--full-tree','HEAD'])
blobs={}
for entry in metadata.split(b'\0'):
 if not entry:continue
 fields,name=entry.split(b'\t',1);mode,kind,oid=fields.decode().split()
 if kind=='blob':blobs[name.decode()]={'mode':mode,'git_blob_oid':oid}
producer='lib/ediel/testing/agtEngine.ts'
blobs[producer]['sha256']=hashlib.sha256(subprocess.check_output(['git','show','HEAD:'+producer])).hexdigest()
receipt['root_source']['blobs']=blobs
basis=receipt['historical_source_basis']
env={'required':receipt['required_input_paths'],'current':receipt['root_source'],'receipt':receipt,'basis':basis,'producer':producer}
# Qualification source constants are taken from the same actual runtime program.
if stage=='qualification':
 for program in programs:
  for node in program.body:
   if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id in ('expected_overlay','dependencies'):
    exec(compile(ast.Module(body=[node],type_ignores=[]),'<actual-runtime-source-constant>','exec'),env)
if change=='duplicate':env['required'][-1]=env['required'][0]
if change=='missing':env['required'].pop()
if change=='extra':env['required'].append(next(x for x in blobs if x not in env['required']))
if change=='missing-git-blob':del blobs[producer if stage=='qualification' else env['required'][-1]]
try:
 exec(compile(ast.Module(body=matches,type_ignores=[]),'<actual-runtime-inventory-'+stage+'>','exec'),env)
 print(json.dumps({'admitted':True,'requiredCount':len(env['required']),'uniqueRequiredCount':len(set(env['required'])),'actualGitBlobs':len(blobs)}))
except (RuntimeError,KeyError) as error:
 print(json.dumps({'admitted':False,'reason':str(error),'requiredCount':len(env['required']),'uniqueRequiredCount':len(set(env['required'])),'actualGitBlobs':len(blobs)}))
`
  const observed = JSON.parse(execFileSync('python3', ['-c', python, stage, change], {
    cwd: root, encoding: 'utf8', input: JSON.stringify(receipt), maxBuffer: 32 * 1024 * 1024,
  })) as {admitted: boolean; requiredCount: number; uniqueRequiredCount: number; actualGitBlobs: number}
  expect(observed.admitted).toBe(change === 'valid')
  expect(observed.actualGitBlobs).toBeGreaterThan(59)
  if (change === 'valid') {
    expect(observed.requiredCount).toBe(59)
    expect(observed.uniqueRequiredCount).toBe(59)
  }
})

// Execute the actual workflow dependency admission statements, before backend
// work, over committed package bytes and explicit installed-version fixtures.
it.each((['ediel-db01-current-native.yml', 'ediel-sc071-native.yml'] as const).flatMap(workflow =>
  (['valid', 'wrong-scope', 'wrong-version', 'wrong-integrity', 'wrong-resolved', 'extra-dependency',
    'extra-lock-field', 'missing-override', 'unknown-override', 'zod-change', 'changed-base', 'wrong-installed-version'] as const)
    .map(change => [workflow, change] as const)))(
  'executes dependency admission %s and rejects unqualified %s', (workflow, change) => {
  const python = String.raw`import ast,copy,hashlib,json,pathlib,re,subprocess,sys,tempfile,textwrap,types
repo=pathlib.Path.cwd();packet=repo;workflow=sys.argv[1];shape=sys.argv[2]
path='.github/workflows/'+workflow
s=(packet/path).read_text();programs=[textwrap.dedent(x) for x in re.findall(r"python3 - <<'PY'[^\n]*\n(.*?)\n          PY",s,re.S)]
isdb=workflow=='ediel-db01-current-native.yml';program=programs[0] if isdb else next(x for x in programs if 'sc071_candidate_dependency_inputs_unqualified' in x)
tree=ast.parse(program);nodes=[];active=False
for n in tree.body:
 if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id==('dependency_paths' if isdb else 'paths'):active=True
 if active:
  if isdb and isinstance(n,ast.For) and ast.unparse(n.iter)=='expected_sql_hashes.items()':break
  if not isdb and isinstance(n,ast.Expr) and 'dependency-inputs.json' in ast.unparse(n):break
  nodes.append(n)
a=json.loads(subprocess.check_output(['git','show','3244da112d35ca2b8660e920cde849fce6b17732:package.json'],cwd=repo));b=json.loads(subprocess.check_output(['git','show','3244da112d35ca2b8660e920cde849fce6b17732:package-lock.json'],cwd=repo))
if shape=='wrong-scope':a['overrides']['other']=a['overrides'].pop('mailauth')
if shape=='wrong-version':a['overrides']['mailauth']['undici']='8.12.3';b['packages']['node_modules/undici']['version']='8.12.3'
if shape=='wrong-integrity':b['packages']['node_modules/undici']['integrity']='sha512-wrong'
if shape=='wrong-resolved':b['packages']['node_modules/undici']['resolved']='https://example.invalid/undici-8.12.2.tgz'
if shape=='extra-dependency':a['dependencies']['unexpected']='1.0.0'
if shape=='extra-lock-field':b['packages']['node_modules/undici']['unexpected']=True
if shape=='missing-override':del a['overrides']['mailauth']
if shape=='unknown-override':a['overrides']['undici']='8.12.2'
if shape=='zod-change':a['dependencies']['zod']='4.6.8'
with tempfile.TemporaryDirectory(prefix='undici-admission-fixture-') as d:
 root=pathlib.Path(d);base=root/'base';base.mkdir();evidence=root/'evidence';evidence.mkdir()
 for p,v in [('package.json',a),('package-lock.json',b)]:
  # Positive uses actual committed bytes, mutations intentionally recompute identities.
  (root/p).write_bytes(subprocess.check_output(['git','show','3244da112d35ca2b8660e920cde849fce6b17732:'+p],cwd=repo) if shape in ('valid','changed-base','wrong-installed-version') else (json.dumps(v,indent=2)+'\n').encode())
  if isdb:
   oid={'package.json':'bf3a30b706a96bacf8dbcf158ed99ae405881689','package-lock.json':'0e19ad13ea476c169f63f0cb8f6c4d2164c13847'}[p]
   prior=subprocess.check_output(['git','show',oid],cwd=repo)
  else:
   revision=json.loads((repo/'quality/audits/ediel-masterplan-v2/sc071-revocation/export-feedback-inputs.json').read_text())['base_sha']
   prior=subprocess.check_output(['git','show',revision+':'+p],cwd=repo)
  (base/p).write_bytes(prior)
 def meta(data):return {'mode':'100644','git_blob_oid':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),'sha256':hashlib.sha256(data).hexdigest()}
 blobs={p:meta((root/p).read_bytes()) for p in ['package.json','package-lock.json']};baseblobs={p:meta((base/p).read_bytes()) for p in blobs}
 if shape=='changed-base':
  (base/'package.json').write_text('{}');baseblobs['package.json']=meta(b'{}')
 for name,version in {'source-map-js':'1.2.2','mailauth':'7.3.1','pdf-lib':'1.17.1','xlsx':'0.20.3','zod':'4.6.7','undici':('8.12.3' if shape=='wrong-installed-version' else '8.12.2')}.items():
  p=root/'node_modules'/name/'package.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps({'version':version}))
 def check_output(args,**kw):
  if args[:3]==['git','cat-file','blob']:return subprocess.check_output(args,cwd=repo)
  if args==['node','--version']:return 'v22.19.0\n'
  if args[:2]==['node','-p']:
   if 'sharp' in args[2]:return '0.35.5\n'
   if 'source-map-js' in args[2]:return '1.2.2\n'
  raise RuntimeError('Unexpected subprocess '+repr(args))
 env={'hashlib':hashlib,'json':json,'subprocess':types.SimpleNamespace(check_output=check_output),'root':root,'candidate':root,'base':base,'pathlib':pathlib,'re':re,'baseline':{'blobs':baseblobs},'current':{'blobs':blobs},'os':types.SimpleNamespace(environ={'SC071_EVIDENCE':str(evidence)})}
 try:
  exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual-dependency-admission>','exec'),env);result={'accepted':True}
 except (RuntimeError,AssertionError,KeyError) as e:result={'accepted':False,'error':str(e)}
 # Exact semantic normalizer is independently executed on each mutation too,
 # ensuring refusal is not only an opaque pair-hash outcome.
 if 'qualify_mailauth_undici' in env:
  try:env['qualify_mailauth_undici'](root);result['normalizerAccepted']=True
  except (RuntimeError,AssertionError,KeyError) as e:result.update(normalizerAccepted=False,normalizerError=str(e))
 print(json.dumps(result))
`
  const observed = JSON.parse(execFileSync('python3', ['-c', python, workflow, change], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })) as {accepted: boolean; normalizerAccepted?: boolean}
  expect(observed.accepted).toBe(change === 'valid')
  if (change !== 'changed-base' && change !== 'wrong-installed-version') {
    expect(observed.normalizerAccepted).toBe(change === 'valid')
  }
})


it('fetches only the frozen dependency predecessor before SC071 qualification on a shallow checkout', () => {
  const python = String.raw`import hashlib,json,pathlib,re,shlex,subprocess,sys,tempfile
repo=pathlib.Path.cwd();workflow=(repo/'.github/workflows/ediel-sc071-native.yml').read_text()
fetches=re.findall(r'^          (git fetch --no-tags --depth=1 origin [0-9a-f]{40})$',workflow,re.M)
assert len(fetches)==1,'sc071_qualified_dependency_fetch_required'
assert workflow.index(fetches[0])<workflow.index('def qualify_mailauth_undici('),'sc071_dependency_fetch_after_qualification'
expected={'7f0baef1da8ff1aa410a40d0835346749281a506':'52af42e9b40c440622dd09ad15126968278ad121f9fa66451c2fac68783f0f38','a6e86ff9b2dff932b18afcd0963c3d3fae12de58':'d0501a03422daaa93721fc7813751eb5eee12a85ae85a6ff6902d48546d2edc4'}
with tempfile.TemporaryDirectory(prefix='sc071-shallow-dependencies-') as d:
 root=pathlib.Path(d)
 def git(*args,check=True):return subprocess.run(['git',*args],cwd=root,check=check,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 git('init','--quiet');git('remote','add','origin',repo.as_uri())
 git('fetch','--quiet','--no-tags','--depth=1','origin','3244da112d35ca2b8660e920cde849fce6b17732')
 missing=[git('cat-file','blob',oid,check=False).returncode!=0 for oid in expected]
 assert all(missing),'sc071_shallow_negative_not_exercised'
 git(*shlex.split(fetches[0])[1:])
 for oid,digest in expected.items():assert hashlib.sha256(git('cat-file','blob',oid).stdout).hexdigest()==digest,'sc071_fetched_dependency_identity_mismatch'
 print(json.dumps({'missingBefore':len(missing),'qualifiedAfter':len(expected)}))
`
  const observed = JSON.parse(execFileSync('python3', ['-c', python], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 25_000,
  })) as {missingBefore: number; qualifiedAfter: number}
  expect(observed).toEqual({missingBefore: 2, qualifiedAfter: 2})
}, 30_000)

// Execute the separate writer-input guards without altering the historical
// 59-reader/35-BASE native contract or synthesizing native execution credit.
it.each((['freeze', 'qualification'] as const).flatMap(stage =>
  (['valid', 'missing', 'duplicate', 'extra', 'changed-input'] as const).map(change => [stage, change] as const)))(
  'executes separate current writer input guard %s for %s', (stage, change) => {
    const python = String.raw`import ast,json,pathlib,re,sys,textwrap
stage,change=sys.argv[1:];s=pathlib.Path('.github/workflows/ediel-db01-current-native.yml').read_text()
programs=[ast.parse(textwrap.dedent(x)) for x in re.findall(r"python3 - <<'PY'[^\n]*\n(.*?)\n          PY",s,re.S)]
initial=next(p for p in programs if any(isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='current_writer_inputs' for t in n.targets) for n in p.body))
declaration=next(n for n in initial.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='current_writer_inputs' for t in n.targets))
paths=ast.literal_eval(declaration.value)
assert len(paths)==5 and len(set(paths))==5
blobs={p:{'mode':'100644','git_blob_oid':'synthetic-input','sha256':'synthetic-hash'} for p in paths}
env={'current_writer_inputs':list(paths),'current':{'blobs':dict(blobs)},'required':[]}
if stage=='freeze':
 guard=next(n for n in initial.body if isinstance(n,ast.If) and 'len(current_writer_inputs)' in ast.unparse(n.test))
 if change=='missing':env['current_writer_inputs'].pop()
 if change=='duplicate':env['current_writer_inputs'][-1]=paths[0]
 if change=='extra':env['current_writer_inputs'].append('unqualified/extra.ts')
 if change=='changed-input':del env['current']['blobs'][paths[0]]
else:
 final=next(p for p in programs if any(isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='writer_paths' for t in n.targets) for n in p.body))
 declaration=next(n for n in final.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='writer_paths' for t in n.targets))
 assert ast.literal_eval(declaration.value)==paths
 env={'writer_paths':paths,'receipt':{'root_source':{'blobs':blobs}},'writer_sources':[{'path':p,**blobs[p]} for p in paths]}
 guard=next(n for n in final.body if isinstance(n,ast.If) and 'writer_sources' in ast.unparse(n.test))
 if change=='missing':env['writer_sources'].pop()
 if change=='duplicate':env['writer_sources'][-1]=env['writer_sources'][0]
 if change=='extra':env['writer_sources'].append({'path':'unqualified/extra.ts'})
 if change=='changed-input':env['writer_sources'][0]['sha256']='unqualified-source'
try:
 exec(compile(ast.Module(body=[guard],type_ignores=[]),'<actual-writer-source-guard>','exec'),env)
 admitted=True
except (RuntimeError,KeyError):admitted=False
print(json.dumps({'admitted':admitted,'writerInputs':len(paths)}))`
    const result = JSON.parse(execFileSync('python3', ['-c', python, stage, change], {cwd: root, encoding: 'utf8', timeout: 5000})) as {admitted: boolean; writerInputs: number}
    expect(result).toEqual({admitted: change === 'valid', writerInputs: 5})
  })
