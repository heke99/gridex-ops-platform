import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync, realpathSync} from 'node:fs'
import {isAbsolute, resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// Reconstructed historical composition: BASE source/default alias + snapshot
// repair + one committed ROOT AGT producer over byte-identical BASE canonical
// dependencies. Its BASE public creator alone receives a prospective legacy
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
const producerHash = '42b157970dff6cfb094c7f8e683f0b0e41adbd20c00e152fe3a01dffbc25af9a'
const producerOid = 'b156d14903c6c14d450d4b8c4088a3e14ea42997'
const dependencies = ['lib/ediel/core/kernel.ts', 'lib/ediel/core/kernelLegacy.ts', 'lib/ediel/core/outboundOwnerWitness.ts',
  'lib/ediel/rulebook/canonicalEdielFacade.ts', 'lib/ediel/testing/tgtCanonicalDraftRoute.ts',
  'lib/ediel/testing/agtRuntime.ts', 'lib/ediel/testing/agtRegistry.ts']
const declaredInput = {source: 'BASE56', port: 'createEdielMessage', field: 'partyAddressId', when: 'historical_AGT_Z09_L7_before_INSERT',
  value_origin: 'existing_prospective_legacy_fixture_UUID', mutation: 'ONLY_partyAddressId',
  scope: 'one_exact_company_actor_profile_route_birth', restore: 'finally', authority: 'NO_authority_or_accepted_fact'}
const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const sameInput = (a: GitInput | undefined, b: GitInput | undefined) => !!a && !!b && a.mode === b.mode &&
  a.git_blob_oid === b.git_blob_oid && a.sha256 === b.sha256
const basis = receipt.historical_source_basis, overlay = basis?.module_overrides?.[0]
if (receipt.required_input_paths?.length !== 38 || new Set(receipt.required_input_paths).size !== 38 ||
    receipt.required_base_input_paths?.length !== 33 || new Set(receipt.required_base_input_paths).size !== 33 ||
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
for (const path of dependencies) {
  const input = basis.canonical_dependency_identity[path], baseInput = receipt.base_source?.blobs?.[path], rootInput = receipt.root_source?.blobs?.[path]
  if (!input || !sameInput(input.base, baseInput) || !sameInput(input.root, rootInput) || !sameInput(baseInput, rootInput) ||
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
