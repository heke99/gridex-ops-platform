/**
 * Controlled preparation of retained inputs for the frozen c8c SQL proof.
 * Input JSON describes expected observations; it grants no runtime authority.
 * The real adapter must authenticate an existing live producer claim and observe
 * source/build/environment/backend identities before any auth or business call.
 * No seeds, approvals, migrations, provision/start/reset or native run occur here.
 */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export const NATIVE_SOURCE = Object.freeze({
  productCommit: '5217a7aac4b7062d5f7dcf928135ce5879cb9609',
  proofCommit: 'c8c4244d7224c46baf83695ca80fa2fe9f52f83e',
  migrationPath: 'supabase/migrations/20261101115115_invoice_approval_atomic.sql',
  migrationSha256: '1052f7157b250ac8a004c7da36c24c1cd1a44a4feebe303fb4a31b17732a433f',
  testPath: 'scripts/invoice-approval-atomic-native.test.ts',
  testSha256: 'a7b2b243265114fbb21d4c899ae8669fca31fda5cc2ca0671f5b6ad6bb766f0f',
  configPath: 'scripts/invoice-approval-atomic-native.config.ts',
  configSha256: '7c0e2362574a92a9f719a5fd3035659ad4121649ac5bdd298642b21e8c0c8a80',
  preparePath: '/api/internal/invoice-exports/create',
})
const names = ['concurrent', 'contextDrift', 'rollback']
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const sha = /^[a-f0-9]{64}$/
const git = /^[a-f0-9]{40}$/
export class PreparationError extends Error {
  constructor(code) { super(code); this.code = code }
}
export const preparationFailureCode = (error) => error instanceof PreparationError
  && /^[a-z][a-z0-9_]{2,90}$/.test(error.code) ? error.code : 'unclassified_preparation_failure'
const must = (condition, label) => { if (!condition) throw new PreparationError(label) }
export const canonicalPreparationJson = (value) => Array.isArray(value) ? `[${value.map(canonicalPreparationJson).join(',')}]` :
  value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalPreparationJson(value[key])}`).join(',')}}` : JSON.stringify(value)
const digest = (value) => createHash('sha256').update(canonicalPreparationJson(value)).digest('hex')
const sorted = (values) => [...values].sort()
const equal = isDeepStrictEqual

export function preparationProducerScope(input) {
  return { kind: 't4-atomic-native-preparation', nativeResource: input.producer.nativeResource,
    inputEpoch: input.producer.inputEpoch, appCommit: input.source.commit, appTree: input.source.tree,
    proofCommit: NATIVE_SOURCE.proofCommit, backendSha256: digest(input.backend),
    cohortSha256: input.cohort.sha256, targetsSha256: digest(input.targets), toolsSha256: digest(input.tools), harnessSha256: digest(input.harness),
    expiresAt: input.expiresAt, outputHomeSha256: digest(input.producer.outputHome), prepareBudget: new Set(names.map((name) => input.targets[name].billingMonth)).size }
}

export function validatePreparationInput(input, now) {
  must(input?.format === 't4_atomic_native_preparation_input_v1', 'preparation_input_format_required')
  must(input.appUrl === 'http://127.0.0.1:3104', 'fixed_local_app_required')
  must(Number.isFinite(Date.parse(input.expiresAt)) && Date.parse(input.expiresAt) > now,
    'preparation_input_expired')
  must(git.test(input.source?.commit) && git.test(input.source?.tree)
    && sha.test(input.source?.buildEvidenceSha256), 'exact_source_build_binding_required')
  must(['supabase/schema.sql', 'supabase/database.types.ts', 'supabase/schema.fingerprint.json',
    'scripts/migration-history-manifest.json', 'scripts/supabase-types-manifest.json']
    .every((path) => sha.test(input.source.genArtifacts?.[path])), 'exact_gen_artifacts_required')
  must(typeof input.harness?.root === 'string' && input.harness.root.startsWith('/')
    && git.test(input.harness.commit) && git.test(input.harness.tree)
    && ['scripts/simulation/track4/lib/atomicNativePreparation.mjs',
      'scripts/simulation/track4/prepare-atomic-native.mjs',
      '__tests__/simulation-track4-atomic-native-preparation.test.ts'].every((path) => sha.test(input.harness.files?.[path])),
  'exact_preparation_harness_binding_required')
  must(typeof input.tools?.supabaseCli?.path === 'string' && input.tools.supabaseCli.path.startsWith('/')
    && sha.test(input.tools.supabaseCli.sha256), 'bound_supabase_cli_required')
  must(uuid.test(input.companyId) && uuid.test(input.otherCompanyId)
    && input.companyId !== input.otherCompanyId, 'distinct_companies_required')
  const actors = ['a', 'a2', 'b'].map((key) => input.actors?.[key])
  must(actors.every((actor) => actor && uuid.test(actor.id) && typeof actor.email === 'string'
    && actor.email.length > 0 && typeof actor.password === 'string' && actor.password.length > 0)
    && new Set(actors.map((actor) => actor.id)).size === 3, 'three_real_fixture_actors_required')
  must(names.every((name) => uuid.test(input.targets?.[name]?.underlayId)
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.targets[name].billingMonth))
    && new Set(names.map((name) => input.targets[name].underlayId)).size === 3,
  'three_distinct_retained_underlays_required')
  must(typeof input.cohort?.path === 'string' && sha.test(input.cohort.sha256), 'retained_cohort_reference_required')
  must(/^producer-t4-atomic-native-[a-z0-9-]+$/.test(input.producer?.nativeResource)
    && input.producer.ref === `refs/tags/agent-claims/masterplan/${input.producer.nativeResource}`
    && typeof input.producer.inputEpoch === 'string' && input.producer.inputEpoch.length > 0
    && typeof input.producer.outputHome === 'string' && input.producer.outputHome.startsWith('/')
    && git.test(input.producer?.receipt) && sha.test(input.producer?.bodySha256)
    && typeof input.producer.attempt?.path === 'string' && input.producer.attempt.path.startsWith('/')
    && sha.test(input.producer.attempt?.sha256)
    && typeof input.producer.agent === 'string' && input.producer.agent.length > 0
    && typeof input.producer.slot === 'string' && input.producer.slot.length > 0,
  'existing_producer_binding_required')
  const backend = input.backend
  must(backend && ['daemonId', 'dockerRootDir', 'driver', 'databaseContainerId', 'apiContainerId',
    'databaseSystemIdentifier', 'socketPath', 'socketDev', 'socketIno', 'appStartTicks']
    .every((key) => typeof backend[key] === 'string' && backend[key].length > 0)
    && ['containerIds', 'networkIds', 'volumeNames'].every((key) => Array.isArray(backend[key])
      && backend[key].every((id) => typeof id === 'string' && id.length > 0))
    && Number.isSafeInteger(backend.appPid) && backend.appPid > 0 && backend.appPort === 3104,
  'actual_backend_process_binding_required')
}

function verifyHost(input, observation) {
  must(equal(input.harness, observation.harness), 'preparation_harness_binding_changed')
  must(equal(input.source, observation.source), 'source_build_binding_changed')
  must(equal(input.backend, observation.backend), 'backend_identity_changed')
  const minimumDisk = observation.backend.driver === 'vfs' ? 40 :
    ['overlay2', 'overlayfs'].includes(observation.backend.driver) ? 15 : null
  must(minimumDisk !== null && observation.effectiveRamBytes >= 8 * 2 ** 30
    && observation.freeDockerBytes >= minimumDisk * 2 ** 30, 'owned_capacity_hold')
  must(observation.appStartedAfterBuild === true, 'fresh_bound_app_process_required')
  must(observation.appBuildAndEnvironmentBound === true, 'app_build_environment_binding_required')
}
function verifyTarget(input, cohort, name, observed, allowPrepared = false) {
  const expected = input.targets[name]
  must(observed.companyId === input.companyId && observed.underlayId === expected.underlayId
    && observed.billingMonth === expected.billingMonth && observed.ready === true
    && observed.sourceQualified === true && observed.allSourcesFinal === true
    && Number.isSafeInteger(observed.finalSourceCount) && observed.finalSourceCount > 0,
  'retained_final_underlay_required')
  must(equal(observed.provenance, cohort.targets[name].provenance), 'retained_cohort_provenance_changed')
  must(sha.test(observed.graphHash) && Array.isArray(observed.graphs), 'observed_graph_binding_required')
  if (!allowPrepared) must(observed.graphs.length === 0, 'fresh_unreserved_underlay_required')
}

export async function prepareAtomicNative(input, io) {
  validatePreparationInput(input, io.now())
  const producer = await io.verifyProducer(input)
  must(producer.ref === input.producer.ref && producer.receipt === input.producer.receipt
    && producer.bodySha256 === input.producer.bodySha256 && producer.agent === input.producer.agent
    && producer.slot === input.producer.slot && producer.source === input.source.commit
    && producer.epoch === 'gridex-five-agent-20261012'
    && producer.protocol === 'masterplan-reservation-v1' && producer.neutralVerified === true
    && producer.attemptVerified === true
    && equal(producer.scope, preparationProducerScope(input)), 'live_producer_binding_changed')
  const host = await io.observeHost(input)
  verifyHost(input, host) // Must precede psql, Auth or other backend work.
  const database = await io.observeDatabase(input)
  must(database.databaseSystemIdentifier === input.backend.databaseSystemIdentifier
    && database.majorVersion === 17 && database.approvalSourceBound === true,
  'installed_database_source_binding_required')
  must(database.status?.API_URL === 'http://127.0.0.1:54321'
    && typeof database.status.SERVICE_ROLE_KEY === 'string' && database.status.SERVICE_ROLE_KEY
    && typeof database.status.ANON_KEY === 'string' && database.status.ANON_KEY,
  'actual_local_status_required')
  const cohort = await io.verifyCohort(input)
  must(cohort?.format === 't4_retained_atomic_native_cohort_v1' && git.test(cohort.sourceCommit)
    && cohort.companyId === input.companyId && names.every((name) =>
      cohort.targets?.[name]?.underlayId === input.targets[name].underlayId
      && cohort.targets[name].billingMonth === input.targets[name].billingMonth
      && sha.test(cohort.targets[name].provenance?.normalizedIdsSha256)
      && sha.test(cohort.targets[name].provenance?.sourceBasisSha256)
      && Array.isArray(cohort.targets[name].provenance?.sourceMessages)
      && cohort.targets[name].provenance.sourceMessages.length > 0
      && cohort.targets[name].provenance.sourceMessages.every((source) => uuid.test(source.id) && sha.test(source.payloadSha256))),
  'qualified_retained_cohort_facts_required')
  await io.evidence({ phase: 'observed-source-backend', source: input.source,
    backend: input.backend, harness: input.harness, producerReceipt: input.producer.receipt,
    host: { effectiveRamBytes: host.effectiveRamBytes, freeDockerBytes: host.freeDockerBytes,
      cpu: host.cpu ?? null, toolVersions: host.toolVersions ?? null } })
  const sessions = []
  const observed = {}
  let result
  try {
    for (const key of ['a', 'a2', 'b']) {
      const session = await io.signIn(key, input, database.status)
      sessions.push(session)
      must(session.userId === input.actors[key].id, 'actual_auth_actor_mismatch')
      const ownCompany = key === 'b' ? input.otherCompanyId : input.companyId
      const permission = await io.permissions(session, ownCompany, input)
      must(permission.authorized === true && permission.userId === session.userId,
        'actual_actor_company_permission_required')
      if (key === 'b') {
        const foreign = await io.permissions(session, input.companyId, input)
        must(foreign.authorized === false, 'other_company_actor_must_be_denied')
      }
    }
    for (const name of names) {
      observed[name] = await io.observeTarget(name, input)
      verifyTarget(input, cohort, name, observed[name])
    }
    const months = sorted(new Set(names.map((name) => input.targets[name].billingMonth)))
    for (const month of months) {
      const selected = names.filter((name) => input.targets[name].billingMonth === month)
      const expectedIds = sorted(selected.map((name) => input.targets[name].underlayId))
      // The normal endpoint has company/month scope, not underlay/customer scope.
      // Re-read immediately before POST and refuse any additional eligible input.
      for (const name of selected) {
        const current = await io.observeTarget(name, input)
        verifyTarget(input, cohort, name, current)
        must(equal(sorted(current.eligibleUnderlayIds), expectedIds), 'month_scope_not_exclusive')
      }
      verifyHost(input, await io.observeHost(input))
      const currentProducer = await io.verifyProducer(input)
      must(currentProducer.receipt === producer.receipt && currentProducer.bodySha256 === producer.bodySha256
        && currentProducer.protocol === 'masterplan-reservation-v1' && currentProducer.neutralVerified === true
        && currentProducer.attemptVerified === true
        && equal(currentProducer.scope, preparationProducerScope(input)), 'live_producer_binding_changed')
      must(Date.parse(input.expiresAt) > io.now(), 'preparation_input_expired')
      await io.evidence({ phase: 'prepare-intent', month, expectedIds })
      const reconcile = async (phase) => {
        const readback = []
        for (const name of selected) {
          try { readback.push({ name, observation: await io.observeTarget(name, input) }) }
          catch { readback.push({ name, readbackUnavailable: true }) }
        }
        await io.evidence({ phase, month, readback })
      }
      let response
      try { response = await io.prepareMonth(sessions[0], month, input) }
      catch {
        await reconcile('prepare-unknown-readback')
        throw new PreparationError('prepare_outcome_unqualified_no_retry')
      }
      await io.evidence({ phase: 'prepare-response', month, status: response.status,
        bodySha256: response.bodySha256 })
      const data = response.body?.data
      const qualified = response.status === 200 && response.body.mode === 'prepare_only'
        && response.body.approval_required === true && data?.created === selected.length
        && data.failed === 0 && data.alreadyPrepared === 0 && data.blocked === 0
      if (!qualified) {
        await reconcile('prepare-unqualified-readback')
        throw new PreparationError('normal_prepare_response_unqualified_no_retry')
      }
      for (const name of selected) {
        observed[name] = await io.observeTarget(name, input)
        verifyTarget(input, cohort, name, observed[name], true)
        const graphs = observed[name].graphs
        must(graphs.length === 1 && uuid.test(graphs[0].exportItemId)
          && graphs[0].underlayId === input.targets[name].underlayId
          && graphs[0].pending === true && graphs[0].mirrorDraft === true
          && graphs[0].lockedPricing === true && graphs[0].initialApprovalEvents === 0
          && graphs[0].initialOutboxRows === 0 && sha.test(graphs[0].graphHash),
        'actual_prepared_graph_required')
      }
    }
    const graphIds = names.map((name) => observed[name].graphs[0].exportItemId)
    must(new Set(graphIds).size === 3, 'three_distinct_prepared_graphs_required')
    const preparationEvidence = Object.fromEntries(names.map((name) => [name, {
      input: input.targets[name], observed: observed[name], source: input.source, harness: input.harness,
      backend: input.backend, cohortSha256: input.cohort.sha256,
    }]))
    const graphs = Object.fromEntries(names.map((name) => [name, {
      exportItemId: observed[name].graphs[0].exportItemId,
      preparationEvidenceSha256: digest(preparationEvidence[name]),
    }]))
    result = {
      state: 'PREPARED_INPUTS_NOT_NATIVE_ACCEPTANCE',
      fixture: { format: 't4_invoice_approval_native_fixture_v1', companyId: input.companyId,
        otherCompanyId: input.otherCompanyId, permittedActorIds: [input.actors.a.id, input.actors.a2.id],
        otherCompanyActorId: input.actors.b.id, graphs },
      status: database.status,
      command: ['node', 'node_modules/vitest/vitest.mjs', 'run', '--config', NATIVE_SOURCE.configPath],
      nativeExecuted: false, preparationEvidence,
    }
  } finally {
    const cleanup = await Promise.allSettled(sessions.map((session) => io.signOut(session)))
    must(cleanup.every((item) => item.status === 'fulfilled'), 'owned_session_cleanup_failed')
  }
  await io.evidence({ phase: 'prepared-inputs-not-native-acceptance', fixtureSha256: digest(result.fixture) })
  return result
}
