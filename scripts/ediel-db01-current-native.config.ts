import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync, realpathSync} from 'node:fs'
import {isAbsolute, resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// Reconstructed historical composition: BASE source/default alias + snapshot
// repair + one committed ROOT AGT producer over fixed BASE canonical
// dependencies. The current kernel pair is separately pinned to delivered
// source231b9ef8; neither current file replaces the historical BASE aliases.
// Its BASE public creator alone receives a prospective legacy
// DTO hint. Two containment forwards and eleven delivered current reader/guard
// forwards remain separately receipted phases before fresh ROOT owners.
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
    kernel_legacy_basis: {source_revision: string; path: string; historical_alias: string; current_alias: string; base: GitInput; root: GitInput};
    public_creator_input: Record<string, string>}
  current_database_basis: {kind: string; forwards: Array<GitInput & {path: string}>; schema_path: string}
  current_guard_result?: {status: string; source_sha: string; source_schema_sha256: string; reader_function_names: number; helper_function_names: number; function_definitions: number; delivered_relation_objects: number; mismatches: unknown[]}
  current_api_schema_result?: {status: string; source_sha: string; rpc_paths: string[]}
  phases?: Record<string, {status: string; exit_code: number | null}>
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
if (receipt.required_input_paths?.length !== 53 || new Set(receipt.required_input_paths).size !== 53 ||
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
const kernelLegacyPath = 'lib/ediel/core/kernelLegacy.ts'
const expectedBaseKernelLegacy: GitInput = {mode: '100644', git_blob_oid: '7310ae00ef55e89ea85ef785a7f2540a7baf871d',
  sha256: 'b6680e10b8b743678b895804661a6e497740893bf778b274b871bfa34c3bab21'}
const expectedCurrentKernelLegacy: GitInput = {mode: '100644', git_blob_oid: '40bcab025c7012ac6bd16d400ed7fc0ec17e93f4',
  sha256: 'cfaa59c86e58b1a5272d1b69ef576acb3c904706dadca1f5d6c9a00396f82fb4'}
const kernelBasis = basis.kernel_basis
if (!kernelBasis || Object.keys(kernelBasis).length !== 6 || kernelBasis.source_revision !== kernelRevision ||
    kernelBasis.path !== kernelPath || kernelBasis.historical_alias !== 'BASE56' || kernelBasis.current_alias !== 'ROOT' ||
    !sameInput(kernelBasis.base, expectedBaseKernel) || !sameInput(kernelBasis.root, expectedCurrentKernel)) {
  throw new Error('db01_native_exact_kernel_basis_required')
}
const kernelLegacyBasis = basis.kernel_legacy_basis
if (!kernelLegacyBasis || Object.keys(kernelLegacyBasis).length !== 6 || kernelLegacyBasis.source_revision !== kernelRevision ||
    kernelLegacyBasis.path !== kernelLegacyPath || kernelLegacyBasis.historical_alias !== 'BASE56' || kernelLegacyBasis.current_alias !== 'ROOT' ||
    !sameInput(kernelLegacyBasis.base, expectedBaseKernelLegacy) || !sameInput(kernelLegacyBasis.root, expectedCurrentKernelLegacy)) {
  throw new Error('db01_native_exact_kernel_legacy_basis_required')
}
execFileSync('git', ['merge-base', '--is-ancestor', kernelRevision, head], {cwd: root})
for (const path of dependencies) {
  const input = basis.canonical_dependency_identity[path], baseInput = receipt.base_source?.blobs?.[path], rootInput = receipt.root_source?.blobs?.[path]
  const exactPair = path === kernelPath ? sameInput(baseInput, expectedBaseKernel) && sameInput(rootInput, expectedCurrentKernel)
    : path === kernelLegacyPath ? sameInput(baseInput, expectedBaseKernelLegacy) && sameInput(rootInput, expectedCurrentKernelLegacy)
    : sameInput(baseInput, rootInput)
  if (!input || !sameInput(input.base, baseInput) || !sameInput(input.root, rootInput) || !exactPair ||
      baseInput?.mode !== '100644' || !receipt.required_input_paths.includes(path) || !receipt.required_base_input_paths.includes(path) ||
      fileHash(resolve(receipt.base_path, path)) !== baseInput.sha256 || fileHash(resolve(root, path)) !== rootInput?.sha256) {
    throw new Error(`db01_native_BASE_canonical_dependency_mismatch:${path}`)
  }
}
// Pin delivered SQL independently of self-consistent receipt fields. A current
// TS caller over BASE SQL is insufficient: actual functions, surrounding guard
// relations/ACL/triggers and PostgREST visibility must qualify before admission.
export const currentReaderForwards: Array<GitInput & {path: string}> = [
  {
    "path": "supabase/migrations/20261006173100_ediel_customer_wire_partition_headers_arrays.sql",
    "mode": "100644",
    "git_blob_oid": "cda02a8b4998e001bf89291caf48ec6b90e637d4",
    "sha256": "c55df843fa1275d2ee2899e57866c85520f36d8ace1ac65da671b118bd79b7d3"
  },
  {
    "path": "supabase/migrations/20261006231000_ediel_confirmed_death_final_response.sql",
    "mode": "100644",
    "git_blob_oid": "9ba1b75ede091e2440218e872e7e149c39a4e686",
    "sha256": "8075ab1d97959b9a74df61a1d6bb83a9c157090494c0bcc0f5958588b3fbd47e"
  },
  {
    "path": "supabase/migrations/20261006235000_ediel_confirmed_death_application_scope.sql",
    "mode": "100644",
    "git_blob_oid": "3b6300acfaeab51d4d699b88c8cb1cd9b775daa4",
    "sha256": "59dc29a939be1351f45581361076599e09619b09b1fc8510fcda17e03dbc91bd"
  },
  {
    "path": "supabase/migrations/20261007000503_ediel_technical_ack_long_reference_prefix.sql",
    "mode": "100644",
    "git_blob_oid": "20a12d8ef68fb804b3b1c909bf50c6e1e56b721e",
    "sha256": "2800d3c35da6edf5ef4f3715b2876bd96fe8d05fd55e921f8c7ca4704316d22e"
  },
  {
    "path": "supabase/migrations/20261007132500_ediel_switch_cancellation_original_method.sql",
    "mode": "100644",
    "git_blob_oid": "e6a631ccbd666851a8c0a876095ea8815a39484a",
    "sha256": "9f64ac10d037d5084520d22706fa3d351621d091f5ece54ad8896105223e4086"
  },
  {
    "path": "supabase/migrations/20261009082553_ediel_switch_cancellation_customer_masterdata_preparation.sql",
    "mode": "100644",
    "git_blob_oid": "aab9565e638c6025c8db76c99fafed59486b28ad",
    "sha256": "d1d5ed8a3731f281826de39e4ebd4868a3090016dfef4544d6964352242cf351"
  },
  {
    "path": "supabase/migrations/20261010102349_ediel_assigned_prodat_header_negative_birth.sql",
    "mode": "100644",
    "git_blob_oid": "7bba19fa06cef4d8c60abb4349ed3c4f5a7a1320",
    "sha256": "0c745ddeef89c0ca3021ad73354bc0cc16b32b2ae4cb99b171003538bf26c372"
  },
  {
    "path": "supabase/migrations/20261010102455_ediel_prodat_customer_masterdata_original_read.sql",
    "mode": "100644",
    "git_blob_oid": "730afffea8c8d3f06e1ea88c16b752ddd3dffd3d",
    "sha256": "3e22786c3c3c7ea329ecba218bbfa7ec70dfd7b8124f8db867e639e8e9e7b91f"
  },
  {
    "path": "supabase/migrations/20261010120209_ediel_consumed_header_update_and_ack_scope_replay.sql",
    "mode": "100644",
    "git_blob_oid": "f2df4c8a99fbdda30e715dcc008f0f132dabdaf2",
    "sha256": "a4d898895b04153e463712272e7d6dff525f312784fdce86e9fa2482d2f29191"
  },
  {
    "path": "supabase/migrations/20261010124755_ediel_assigned_negative_ack_arrival_date_scope.sql",
    "mode": "100644",
    "git_blob_oid": "5947d86893b3104468f62440b61f7ba7873ef432",
    "sha256": "8a12e539c58ede63b61105bcff6c94ae63c6d22927362f53cc1c823a02267158"
  },
  {
    "path": "supabase/migrations/20261010140411_ediel_common_header_negative_domain_owner_scope.sql",
    "mode": "100644",
    "git_blob_oid": "a38e12fe74d831ad5f79ae8ed5b563d28e9a2fdb",
    "sha256": "e615bbf4d0c4a46628284a6dcdb84d973b6732c9d0662f7e20fa52925df51457"
  }
]
const currentDatabase = receipt.current_database_basis
if (!currentDatabase || Object.keys(currentDatabase).length !== 3 || currentDatabase.kind !== 'BASE56_repair_two_forwards_plus_delivered_reader_guard_closure' ||
    currentDatabase.schema_path !== 'supabase/schema.sql' || currentDatabase.forwards?.length !== currentReaderForwards.length ||
    currentReaderForwards.some((expected, index) => {
      const declared = currentDatabase.forwards[index]
      return !declared || Object.keys(declared).length !== 4 || declared.path !== expected.path || !sameInput(declared, expected) ||
        !sameInput(receipt.root_source?.blobs?.[expected.path], expected) || !receipt.required_input_paths.includes(expected.path) ||
        fileHash(resolve(root, expected.path)) !== expected.sha256 ||
        execFileSync('git', ['rev-parse', `HEAD:${expected.path}`], {cwd: root, encoding: 'utf8'}).trim() !== expected.git_blob_oid
    })) {
  throw new Error('db01_native_current_reader_guard_basis_required')
}
if (phase === 'current' && (['current_guard_preparation', 'current_read_forwards', 'current_guard_qualification', 'current_api_schema'].some(name =>
    receipt.phases?.[name]?.status !== 'PASS' || receipt.phases[name].exit_code !== 0) ||
    receipt.current_guard_result?.status !== 'PASS' || receipt.current_guard_result.source_sha !== head ||
    receipt.current_guard_result.reader_function_names !== 233 || receipt.current_guard_result.helper_function_names !== 371 ||
    receipt.current_guard_result.function_definitions !== 371 || receipt.current_guard_result.delivered_relation_objects !== 18 ||
    !Array.isArray(receipt.current_guard_result.mismatches) || receipt.current_guard_result.mismatches.length !== 0 ||
    receipt.current_api_schema_result?.status !== 'PASS' || receipt.current_api_schema_result.source_sha !== head ||
    JSON.stringify(receipt.current_api_schema_result.rpc_paths) !== JSON.stringify([
      '/rpc/ediel_read_prodat_h_accepted_original_v1', '/rpc/ediel_read_prodat_customer_masterdata_original_v1']) ||
    receipt.current_guard_result.source_schema_sha256 !== fileHash(resolve(root, currentDatabase.schema_path)))) {
  throw new Error('db01_native_actual_current_guard_qualification_required')
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
