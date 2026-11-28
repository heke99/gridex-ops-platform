'use strict'

const repository = 'heke99/gridex-ops-platform'
const repositoryId = 1190539955
const owner = 'heke99'
const branches = Object.freeze({
  1269: 'codex/gridex-ops-integrated-verification-20261124-0640',
  1270: 'codex/gridex-ops-qualification-21e392e7',
})
const workflows = {
  protected: '.github/workflows/ediel-completed-reading-clock-native.yml',
  fg: '.github/workflows/ediel-fg-composition-native.yml',
  z10m: '.github/workflows/ediel-z10m-supplier-native.yml',
}
const pins = {
  [workflows.protected]: '5a59882d24431e143fe11bbee341e492ad7b778f03a0ecc35f15f4390f551883',
  [workflows.fg]: '16534ee45bbbf538b9a2189bfcdcddba7f107927212c849bcceea02493cacbab',
  [workflows.z10m]: '47f1ae2eb69b24cc8daf75a7237020fcfd8c96af4a683616d8aa1725d0cad6e2',
  'scripts/helpers/compose-ediel-completed-reading-clock.py': 'd7ae5d7c9bfe9d7a325cf0a910774a4a30c210ae606b15b8687139f9c9529e27',
}
const acceptanceFile = kind => 'scripts/ediel-at-z06' + kind.toLowerCase() + '-supplier-acceptance-native.test.ts'
const z10mFile = 'scripts/ediel-at-z10m-supplier-acceptance-native.test.ts'
const compositionFile = 'scripts/ediel-at-z09fg-supplier-composition-native.test.ts'
const preparationFile = 'scripts/helpers/ediel-z09fg-composition-inputs-native-producer.ts'
const followupFile = 'scripts/ediel-z06f-reading-followup-native.test.ts'
const udFalse = 'F first case approval versions only its original structure; physical extra UD=false never changes customer identity'
const z10mCases = [
  'first genuine two-register Z10 is staged, reviewed, applied and physically acknowledged once',
  'a contradictory prior meter obtains no positive first effect or final ACK authority',
  'Z10 adds its own effective-boundary version, preserves the accepted Z04 baseline and replays as a no-op',
  'a Z10 with swapped FR/DO parties obtains no receipt, positive APERAK or final plan',
  'UTILTS readings bind the old meter to the Z04 baseline and the new meter to the Z10 version across the change minute',
]
const compositionCases = [
  'native Z09F own desired receipt/dispatch/physical ACKs precede independent dated Z06 first application',
  'native Z09G own desired receipt/dispatch/physical ACKs precede independent dated Z06 first application',
  'finite composition wire retains independent G Z01/L917 confirmation, exact date, national306 and rejects impossible receipt order',
  'finite composition physical ACK rendering binds the supplied original and an unknown reference cannot qualify it',
]
const acceptanceCases = ['F', 'G'].flatMap(kind => [
  'already-applied ' + kind + ' source reaches real inbound case, own physical ACK/outbox and immutable retained replay',
  kind + ' case refuses foreign tenant/actor/graph selections and invalid own LIN scopes without new effects',
  kind + ' first case approval versions only its original structure; physical extra UD=false never changes customer identity',
  kind + ' first case approval versions only its original structure; physical extra UD=true never changes customer identity',
  kind + ' physical missing fields/correlation and wrong legal parties cannot establish a first structural effect',
  kind + ' cannot borrow a foreign physical point, admit outbound source input or mutate a sealed deferred original',
].map(name => [acceptanceFile(kind), name]))
const suites = [
  ['fg', acceptanceFile('F'), udFalse, ['persisted']],
  ['z10m', z10mFile, z10mCases[4], ['persisted', 'persisted', 'structural_err']],
  ['z06f-followup-own', followupFile,
    'actual F apply creates own pending expectation; accepted physical AES/MG/QTY220/DTM597 persist fulfills only that source without extra market request', ['persisted']],
  ...['register', 'meter', 'agency', 'date', 'quantity'].map(variant =>
    ['z06f-followup-' + variant, followupFile,
      "actual misaligned or missing own reading ('" + variant + "') cannot fulfill F or borrow sibling evidence", ['unfulfilled']]),
]

const sha = /^[0-9a-f]{40}$/
const digest = /^[0-9a-f]{64}$/
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const syncServices = ['systemd-timesyncd', 'chrony', 'chronyd', 'ntp', 'ntpd']
const syncStates = [
  'active', 'inactive', 'activating', 'deactivating', 'failed', 'reloading', 'maintenance', 'refreshing', 'unknown', 'not-found',
]
const positiveId = value => Number.isSafeInteger(value) && value > 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const ordered = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  expected.every((value, index) => actual[index] === value)
const equality = (actual, expected) => ordered(Array.isArray(actual) ? [...actual].sort() : actual, [...expected].sort())
function requireEvidence(condition, reason) {
  if (!condition) throw Error('completed_reading_admission:' + reason)
}
function readJson(read, name) {
  const data = JSON.parse(read(name))
  requireEvidence(object(data), 'json_shape')
  return data
}
function checkJUnit(junitCases, read, path, expected, allowOtherSkipped = false) {
  const cases = junitCases(read(path))
  requireEvidence(Array.isArray(cases) && cases.every(test => object(test) &&
    typeof test.classname === 'string' && typeof test.name === 'string' &&
    !Object.hasOwn(test, 'failure') && !Object.hasOwn(test, 'error')), 'junit_unsuccessful')
  const passed = cases.filter(test => !Object.hasOwn(test, 'skipped'))
  requireEvidence(passed.length === expected.length && (allowOtherSkipped || cases.length === passed.length) &&
    expected.every(([file, name]) => cases.filter(test => test.classname === file && test.name === name).length === 1 &&
      passed.some(test => test.classname === file && test.name === name)), 'junit_scope')
}

function baseReceipt(receipt, source, run) {
  requireEvidence(receipt.checkout_sha === source.candidateSha && receipt.checkout_tree === source.candidateTree &&
    receipt.workflow_run_id === String(run.id) && receipt.workflow_run_attempt === String(run.run_attempt) &&
    receipt.ordinary_required_gates === 'NOT_REPLACED', 'receipt_checkout_or_run')
}
function protectedMode(read, prefix, source, run, suite, mode) {
  const receipt = readJson(read, prefix + '/receipt.json')
  baseReceipt(receipt, source, run)
  requireEvidence(receipt.schema === 'completed_reading_boundary_workflow_receipt_v1' && receipt.mode === mode &&
    receipt.repository === repository && receipt.repository_id === String(repositoryId) &&
    receipt.job_id === 'completed-reading-native' && receipt.suite === suite &&
    receipt.exit_code === 0 && receipt.restoration_verified === true && receipt.whole_approval === false, 'protected_receipt')
  const restore = readJson(read, prefix + '/clock-restoration.json')
  requireEvidence(restore.schema === 'completed_reading_clock_restoration_v1' && restore.mode === mode &&
    restore.repository === repository && restore.checkout_sha === source.candidateSha &&
    restore.workflow_run_id === receipt.workflow_run_id && restore.workflow_run_attempt === '1' &&
    restore.job_id === receipt.job_id && restore.restored === true &&
    restore.backend_and_workers_stopped_before_backward_restore === true && restore.shared_advance_restore_lock === true &&
    restore.trusted_normal_reference_verified === true && ['yes', 'no'].includes(restore.prior_ntp) &&
    restore.prior_ntp === restore.restored_ntp && object(restore.prior_sync_services) &&
    object(restore.restored_sync_services) && equality(Object.keys(restore.prior_sync_services), syncServices) &&
    equality(Object.keys(restore.restored_sync_services), syncServices) && syncServices.every(service =>
      syncStates.includes(restore.prior_sync_services[service]) &&
      restore.prior_sync_services[service] === restore.restored_sync_services[service]) &&
    [restore.actual_normal_realtime_ms, restore.target_normal_realtime_ms, restore.trusted_normal_reference_s]
      .every(value => Number.isFinite(value) && value > 0), 'clock_restoration')
}
function verifyProtected(read, junitCases, source, run, suite, file, name, outcomes) {
  const preflight = 'completed_reading-clock-preflight-evidence'
  const native = 'completed_reading-native-evidence'
  protectedMode(read, preflight, source, run, suite, 'preflight')
  protectedMode(read, native, source, run, suite, 'native')
  const capability = readJson(read, preflight + '/clock-capability.json')
  requireEvidence(capability.product_execution === false && capability.actual_forward_days === 21 &&
    Number.isFinite(capability.actual_realtime_ms) && Number.isFinite(capability.target_realtime_ms) &&
    Math.abs(capability.actual_realtime_ms - capability.target_realtime_ms) <= 3000 &&
    Number.isFinite(capability.monotonic_elapsed_s) && capability.monotonic_elapsed_s >= 0 &&
    capability.monotonic_elapsed_s < 20, 'clock_preflight')
  const result = readJson(read, native + '/product-boundary-receipt.json')
  const before = result.phase?.before?.postgres_new_transaction, after = result.after?.postgres_new_transaction
  requireEvidence(result.schema === 'completed_reading_native_v1' && result.suite === suite &&
    [result.companyId, result.switchId, result.baselineSourceId, result.structuralSourceId].every(value => uuid.test(value)) &&
    result.authority?.company_id === result.companyId && result.authority.authenticated_current_context === true &&
    result.authority.phase_auth_readiness?.ready === true && result.controllerReceipt?.shared_restore_lock === true &&
    Number.isFinite(result.phase?.targetRealtimeMs) && result.phase.targetRealtimeMs === result.controllerReceipt.target_realtime_ms &&
    Number.isFinite(result.phase.latestRegistrationMs) && result.phase.targetRealtimeMs > result.phase.latestRegistrationMs &&
    Number.isFinite(result.controllerReceipt.actual_realtime_ms) &&
    Math.abs(result.controllerReceipt.actual_realtime_ms - result.phase.targetRealtimeMs) <= 5000 &&
    typeof before?.system_identifier === 'string' && /^\d+$/.test(before.system_identifier) &&
    before.system_identifier === after?.system_identifier && typeof before.postmaster_started_at === 'string' &&
    before.postmaster_started_at === after.postmaster_started_at &&
    Number.isFinite(before.clock_ms) && before.clock_ms < result.phase.targetRealtimeMs &&
    Number.isFinite(after.clock_ms) && after.clock_ms >= result.phase.latestRegistrationMs &&
    Math.abs(after.clock_ms - result.controllerReceipt.actual_realtime_ms) <= 5000, 'native_clock_or_authority')
  requireEvidence(Array.isArray(result.sources) && result.sources.length === outcomes.length &&
    new Set(result.sources.map(row => row?.id)).size === outcomes.length &&
    result.sources.every((row, index) => object(row) && uuid.test(row.id) && digest.test(row.payloadHash) &&
      row.outcome === outcomes[index] && Number.isFinite(Date.parse(row.receivedAt)) &&
      Number.isFinite(Date.parse(row.registrationAt))), 'product_outcome')
  checkJUnit(junitCases, read, native + '/native-junit.xml', [[file, name]], true)
  return { suite, cases: [name], outcomes }
}

function verifyOrdinary(kind, read, junitCases, source, run) {
  const receipt = readJson(read, 'receipt.json')
  baseReceipt(receipt, source, run)
  requireEvidence(receipt.purpose === 'supplemental_actual_native_feedback' && receipt.native_exit_code === 0, 'ordinary_receipt')
  if (kind === 'z10m') {
    requireEvidence(receipt.canonical_replay === 'PASS' && receipt.input_restoration === 'EXACT' &&
      receipt.backend_cleanup === 'QUALIFIED' && ordered(receipt.test_scope, [z10mFile]) &&
      equality(receipt.test_case_names, z10mCases), 'z10m_receipt')
    checkJUnit(junitCases, read, 'native-junit.xml', z10mCases.map(name => [z10mFile, name]))
    return { cases: z10mCases }
  }
  requireEvidence(receipt.repository === repository && receipt.repository_id === String(repositoryId) &&
    receipt.preparation_exit_code === 0 && receipt.acceptance_exit_code === 0 &&
    receipt.input_identity === 'immutable_checkout_before_replay' &&
    ordered(receipt.preparation_scope, [preparationFile]) && ordered(receipt.test_scope, [compositionFile]) &&
    equality(receipt.acceptance_scope, ['F', 'G'].map(acceptanceFile)) &&
    equality(receipt.actual_registered_case_names, compositionCases) &&
    equality(receipt.actual_acceptance_case_names, acceptanceCases.map(parts => parts.join(' :: '))) &&
    readJson(read, 'preparation-proof.json').stage === 'READY_FOR_IMMUTABLE_CONSUMER', 'fg_receipt')
  checkJUnit(junitCases, read, 'preparation-junit.xml', [[preparationFile,
    'prepares fresh SYNTHETIC F/G original inputs through authenticated public owners without Z09 prequeue']])
  checkJUnit(junitCases, read, 'native-junit.xml', compositionCases.map(name => [compositionFile, name]))
  checkJUnit(junitCases, read, 'acceptance-junit.xml', acceptanceCases)
  return { cases: [...compositionCases, ...acceptanceCases.map(([, name]) => name)] }
}

// The certificate supplies the authenticated GitHub and immutable checkout
// readers. Select the latest run before checking its outcome or artifact.
function selectCompletedReadingRun(runs, kind, source, pullNumber, identity) {
  const branch = branches[pullNumber], workflow = workflows[kind]
  requireEvidence(branch && workflow, 'review_scope')
  const candidates = runs.filter(run => run.path === workflow && run.event === 'pull_request')
  requireEvidence(candidates.length > 0 && candidates.every(run => positiveId(run.run_number)), kind + '_run_missing')
  const latest = Math.max(...candidates.map(run => run.run_number))
  const selected = candidates.filter(run => run.run_number === latest)
  requireEvidence(selected.length === 1, kind + '_run_ambiguous')
  const run = selected[0]
  requireEvidence(identity(run, workflow) && run.repository?.id === repositoryId && run.head_repository?.id === repositoryId &&
    run.head_sha === source.candidateSha && run.head_branch === branch &&
    Array.isArray(run.pull_requests) && (run.pull_requests.length === 0 ||
      run.pull_requests.some(pr => pr.number === pullNumber && pr.head?.ref === branch && pr.head?.repo?.id === repositoryId &&
        pr.base?.ref === 'main' && pr.base?.repo?.id === repositoryId)), kind + '_run_identity')
  if (kind === 'protected') requireEvidence(run.actor?.login === owner && run.triggering_actor?.login === owner &&
    run.run_attempt === 1, 'protected_owner_or_attempt')
  return run
}

function verifyCompletedReadingAdmission({ source, pullNumber, api, inventory, identity, successfulJob, readArtifact, sourceMatches, junitCases }) {
  const branch = branches[pullNumber]
  requireEvidence(branch && source.checkoutClean && sha.test(source.candidateSha) && sha.test(source.candidateTree), 'review_scope')
  const pr = api('pulls/' + pullNumber)
  requireEvidence(pr.number === pullNumber && pr.state === 'open' && pr.draft === true && pr.user?.login === owner &&
    pr.base?.ref === 'main' && pr.base?.repo?.full_name === repository && pr.base?.repo?.id === repositoryId &&
    pr.head?.ref === branch && pr.head?.sha === source.candidateSha && pr.head?.repo?.full_name === repository &&
    pr.head?.repo?.id === repositoryId, 'review_pr')
  requireEvidence(Array.isArray(pr.labels) && pr.labels.filter(label =>
    label?.name === 'e66-clock-' + source.candidateSha).length === 1, 'review_label_missing')
  const commit = api('git/commits/' + source.candidateSha)
  requireEvidence(commit.sha === source.candidateSha && commit.tree?.sha === source.candidateTree, 'review_tree')
  for (const [file, fingerprint] of Object.entries(pins)) {
    requireEvidence(sourceMatches(file, fingerprint), 'review_producer_source')
  }
  const runs = inventory('actions/runs?head_sha=' + source.candidateSha + '&per_page=100', 'workflow_runs')
  const selected = {}
  for (const kind of Object.keys(workflows)) {
    const run = selectCompletedReadingRun(runs, kind, source, pullNumber, identity)
    requireEvidence(run.status === 'completed' && run.conclusion === 'success', kind + '_run_unsuccessful')
    selected[kind] = run
  }
  requireEvidence(new Set(Object.values(selected).map(run => run.id)).size === 3, 'run_reused')
  const artifacts = new Set(), jobs = new Set()
  function consume(run, jobName, artifactName, check) {
    const job = successfulJob(run, jobName)
    requireEvidence(job.name === jobName && job.run_id === run.id && job.run_attempt === run.run_attempt &&
      job.status === 'completed' && job.conclusion === 'success' && positiveId(job.id) && !jobs.has(job.id), 'artifact_job')
    jobs.add(job.id)
    return readArtifact(run, job, artifactName, (read, producer) => {
      requireEvidence(producer.repository === repository && producer.workflow === run.path && producer.job === jobName &&
        producer.runId === String(run.id) && producer.runAttempt === String(run.run_attempt) &&
        positiveId(Number(producer.artifactId)) && String(Number(producer.artifactId)) === producer.artifactId &&
        digest.test(producer.artifactSha256) && !artifacts.has(producer.artifactId), 'artifact_binding')
      artifacts.add(producer.artifactId)
      return { ...check(read), ...producer, jobId: String(job.id) }
    })
  }
  const ordinary = Object.fromEntries(['fg', 'z10m'].map(kind => {
    const run = selected[kind]
    const jobName = kind === 'fg' ? 'fg-composition-native' : 'z10m-supplier-native'
    const name = jobName === 'fg-composition-native' ? run.id : source.candidateSha
    return [kind, consume(run, jobName, 'ediel-' + jobName + '-' + name, read => verifyOrdinary(kind, read, junitCases, source, run))]
  }))
  const run = selected.protected
  const protectedSuites = suites.map(([suite, file, name, outcomes]) =>
    consume(run, 'Ediel completed reading / ' + suite, 'ediel-completed-reading-' + suite + '-' + run.id,
      read => verifyProtected(read, junitCases, source, run, suite, file, name, outcomes)))
  return { status: 'qualified', repository, pullNumber, checkoutSha: source.candidateSha, checkoutTree: source.candidateTree,
    ordinary, protectedSuites, scope: 'preproduction_completed_reading', wholeApproval: false }
}

module.exports = { branches, repository, repositoryId, verifyCompletedReadingAdmission }
