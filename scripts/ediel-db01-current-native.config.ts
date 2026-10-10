import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync, realpathSync} from 'node:fs'
import {isAbsolute, resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// Reconstructed historical composition: BASE source/default alias + snapshot
// repair + one committed ROOT AGT producer over fixed BASE canonical
// dependencies. The current kernel is separately pinned to delivered main656.
// Its BASE public creator alone receives a prospective legacy
// DTO hint. Two forwards and fresh ROOT owners remain distinct proof phases.
const root = realpathSync(resolve(__dirname, '..'))
const phase = process.env.GRIDEX_DB01_NATIVE_PHASE
const receiptPath = process.env.GRIDEX_DB01_NATIVE_RECEIPT
const statusPath = process.env.GRIDEX_NATIVE_STATUS
const sourcePath = process.env.GRIDEX_DB01_SOURCE_ROOT
if (!receiptPath || !statusPath || !sourcePath || !isAbsolute(sourcePath) || !['historical', 'current'].includes(phase ?? '')) {
  throw new Error('db01_owned_native_phase_inputs_required')
}
type GitInput = {mode: string; git_blob_oid: string; sha256: string}
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
  root_path: string; base_path: string; checkout_sha: string; base_sha: string
  required_input_paths: string[]; required_base_input_paths: string[]
  root_source: {blobs: Record<string, GitInput>}; base_source: {blobs: Record<string, GitInput>}
  historical_source_basis: {kind: string; default_alias: string;
    module_overrides: Array<GitInput & {specifier: string; path: string; source: string; revision: string}>;
    canonical_dependency_identity: Record<string, {base: GitInput; root: GitInput}>;
    kernel_basis: {source_revision: string; path: string; historical_alias: string; current_alias: string; base: GitInput; root: GitInput};
    public_creator_input: Record<string, string>}
  current_source_basis: string
}
const sourceRoot = realpathSync(sourcePath)
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim()
if (receipt.root_path !== root || receipt.checkout_sha !== head || receipt.base_sha !== '56e58b95518ec4d5eef210ba16ba46228afb40ac' ||
    sourceRoot !== realpathSync(phase === 'historical' ? receipt.base_path : root)) {
  throw new Error('db01_native_source_identity_mismatch')
}
const producerPath = 'lib/ediel/testing/agtEngine.ts'
const producerHash = '3bcda79a6daf7da078484dd814e939dea85e1f3f7cab9292ff0a1efc5e875cc6'
const producerOid = 'eaf3f28312e2d90131c4edaae5ed2cb70823194e'
const dependencies = ['lib/ediel/core/kernel.ts', 'lib/ediel/core/kernelLegacy.ts', 'lib/ediel/core/outboundOwnerWitness.ts',
  'lib/ediel/rulebook/canonicalEdielFacade.ts', 'lib/ediel/testing/tgtCanonicalDraftRoute.ts',
  'lib/ediel/testing/agtRuntime.ts', 'lib/ediel/testing/agtRegistry.ts',
  'lib/ediel/testing/positiveFixtureAuthority.ts', 'lib/ediel/production/lifeEventCertificationSource.ts']
const declaredInput = {source: 'BASE56', port: 'createEdielMessage', field: 'partyAddressId', when: 'historical_AGT_Z09_L7_before_INSERT',
  value_origin: 'existing_prospective_legacy_fixture_UUID', mutation: 'ONLY_partyAddressId',
  scope: 'one_exact_company_actor_profile_route_birth', restore: 'finally', authority: 'NO_authority_or_accepted_fact'}
const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const sameInput = (a: GitInput | undefined, b: GitInput | undefined) => !!a && !!b && a.mode === b.mode &&
  a.git_blob_oid === b.git_blob_oid && a.sha256 === b.sha256
const basis = receipt.historical_source_basis, overlay = basis?.module_overrides?.[0]
if (receipt.required_input_paths?.length !== 40 || new Set(receipt.required_input_paths).size !== 40 ||
    receipt.required_base_input_paths?.length !== 35 || new Set(receipt.required_base_input_paths).size !== 35 ||
    basis?.kind !== 'reconstructed_public_births' || basis.default_alias !== 'BASE56' || basis.module_overrides?.length !== 1 ||
    overlay?.specifier !== '@/lib/ediel/testing/agtEngine' || overlay.path !== producerPath || overlay.source !== 'ROOT' ||
    overlay.revision !== head || overlay.mode !== '100644' || overlay.git_blob_oid !== producerOid || overlay.sha256 !== producerHash ||
    !sameInput(overlay, receipt.root_source?.blobs?.[producerPath]) || fileHash(resolve(root, producerPath)) !== producerHash ||
    execFileSync('git', ['rev-parse', `HEAD:${producerPath}`], {cwd: root, encoding: 'utf8'}).trim() !== producerOid ||
    receipt.current_source_basis !== 'ROOT_only_no_legacy_hint_wrapper' ||
    Object.keys(basis.public_creator_input ?? {}).length !== Object.keys(declaredInput).length ||
    Object.entries(declaredInput).some(([key, value]) => basis.public_creator_input?.[key] !== value) ||
    Object.keys(basis.canonical_dependency_identity ?? {}).length !== dependencies.length) {
  throw new Error('db01_native_reconstructed_birth_basis_required')
}
const kernelPath = 'lib/ediel/core/kernel.ts'
const kernelRevision = '231b9ef84e5a9c5e737c44dc9d72dd33edb0b56c'
const expectedBaseKernel: GitInput = {mode: '100644', git_blob_oid: 'e768195621f24838e59274ea09b50031d00a978f',
  sha256: 'e375037eccec1bd140faeee524b86cc5ff9eec8b165e63c0cc9e8f4dcd5cc7b1'}
const expectedCurrentKernel: GitInput = {mode: '100644', git_blob_oid: '35cc6e4f3f60fe2893f13aa145260181def1aba9',
  sha256: '3273e28234a17da8da4bd0d0326b22d14a9ec7cb361ccf34d4391e013167a931'}
const kernelBasis = basis.kernel_basis
if (!kernelBasis || Object.keys(kernelBasis).length !== 6 || kernelBasis.source_revision !== kernelRevision ||
    kernelBasis.path !== kernelPath || kernelBasis.historical_alias !== 'BASE56' || kernelBasis.current_alias !== 'ROOT' ||
    !sameInput(kernelBasis.base, expectedBaseKernel) || !sameInput(kernelBasis.root, expectedCurrentKernel)) {
  throw new Error('db01_native_exact_kernel_basis_required')
}
execFileSync('git', ['merge-base', '--is-ancestor', kernelRevision, head], {cwd: root})
for (const path of dependencies) {
  const input = basis.canonical_dependency_identity[path], baseInput = receipt.base_source?.blobs?.[path], rootInput = receipt.root_source?.blobs?.[path]
  const exactPair = path === kernelPath ? sameInput(baseInput, expectedBaseKernel) && sameInput(rootInput, expectedCurrentKernel)
    : sameInput(baseInput, rootInput)
  if (!input || !sameInput(input.base, baseInput) || !sameInput(input.root, rootInput) || !exactPair ||
      baseInput?.mode !== '100644' || !receipt.required_input_paths.includes(path) || !receipt.required_base_input_paths.includes(path) ||
      fileHash(resolve(receipt.base_path, path)) !== baseInput.sha256 || fileHash(resolve(root, path)) !== rootInput?.sha256) {
    throw new Error(`db01_native_BASE_canonical_dependency_mismatch:${path}`)
  }
}
const status = JSON.parse(readFileSync(statusPath, 'utf8')) as Record<string, string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.SERVICE_ROLE_KEY || !status.ANON_KEY) throw new Error('owned_local_supabase_required')
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY

export default defineConfig({
  resolve: {alias: [...(phase === 'historical' ? [{find: /^@\/lib\/ediel\/testing\/agtEngine$/, replacement: resolve(root, producerPath)}] : []),
    {find: '@', replacement: sourceRoot},
    {find: /^server-only$/, replacement: resolve(root, 'node_modules/next/dist/compiled/server-only/empty.js')}]},
  test: {environment: 'node', include: ['scripts/ediel-db01-legacy-address-containment-native.test.ts'],
    setupFiles: [resolve(sourceRoot, 'scripts/helpers/ediel-native-permission-catalog.setup.ts')],
    testTimeout: 240000, hookTimeout: 240000, fileParallelism: false},
})
