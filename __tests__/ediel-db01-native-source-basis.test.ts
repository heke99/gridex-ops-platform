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
const dependencies = [kernel, 'lib/ediel/core/kernelLegacy.ts', 'lib/ediel/core/outboundOwnerWitness.ts',
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
  if k in ['forwards','repair','repair_unit','producer','producer_unit','canonical_dependencies','required','current_only','required_base']:
   n[k]=eval(compile(ast.Expression(x.value),'<declared-inputs>','eval'),{},n)
print(json.dumps({'root':n['required'],'base':n['required_base']}))`], {cwd: root, encoding: 'utf8'})
  const declared = JSON.parse(declarations) as {root: string[]; base: string[]}
  identities = Object.fromEntries(dependencies.map(path => [path, {base: input(baseRevision, path), root: input('HEAD', path)}]))
  const rootInputs = {...Object.fromEntries(dependencies.map(path => [path, identities[path].root])), [producer]: input('HEAD', producer)}
  const historical = {kind: 'reconstructed_public_births', default_alias: 'BASE56',
    module_overrides: [{specifier: '@/lib/ediel/testing/agtEngine', path: producer, source: 'ROOT', revision: git('rev-parse', 'HEAD').trim(), ...rootInputs[producer]}],
    canonical_dependency_identity: identities,
    kernel_basis: {source_revision: '5b150f18adaf0b8d82ba2651696421d3e34884fe', path: kernel,
      historical_alias: 'BASE56', current_alias: 'ROOT', ...identities[kernel]},
    public_creator_input: {source: 'BASE56', port: 'createEdielMessage', field: 'partyAddressId', when: 'historical_AGT_Z09_L7_before_INSERT',
      value_origin: 'existing_prospective_legacy_fixture_UUID', mutation: 'ONLY_partyAddressId',
      scope: 'one_exact_company_actor_profile_route_birth', restore: 'finally', authority: 'NO_authority_or_accepted_fact'}}
  receipt = {root_path: root, base_path: baseRoot, checkout_sha: git('rev-parse', 'HEAD').trim(), base_sha: baseRevision,
    required_input_paths: declared.root, required_base_input_paths: declared.base,
    root_source: {blobs: rootInputs}, base_source: {blobs: Object.fromEntries(dependencies.map(path => [path, identities[path].base]))},
    historical_source_basis: historical, current_source_basis: 'ROOT_only_no_legacy_hint_wrapper'}
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

it.each(['historical', 'current'] as const)('admits only the declared %s aliases and two genuine fixed kernel identities', async phase => {
  expect(identities[kernel].base).not.toEqual(identities[kernel].root)
  for (const path of dependencies.filter(path => path !== kernel)) expect(identities[path].base).toEqual(identities[path].root)
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
  basis.kernel_basis.source_revision = '5b150f18adaf0b8d82ba2651696421d3e34884fe'
  identities[dependencies[1]].root.sha256 = 'f'.repeat(64)
  await expect(load('current')).rejects.toThrow('db01_native_BASE_canonical_dependency_mismatch')
})
it('refuses changed historical kernel bytes without modifying the original source', async () => {
  const path = join(baseRoot, kernel), before = readFileSync(path)
  try {writeFileSync(path, Buffer.concat([before, Buffer.from('\nchanged')])); await expect(load('historical')).rejects.toThrow('db01_native_BASE_canonical_dependency_mismatch')}
  finally {writeFileSync(path, before)}
})
