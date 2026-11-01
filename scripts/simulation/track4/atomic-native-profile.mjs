#!/usr/bin/env node
/**
 * T4 source profile, NOT an allocated backend or an execution grant.
 * ONE Actions job/host: init -> bootstrap -> prepare -> native -> cleanup.
 * Each mutating phase needs its own REAL neutral producer ref sealing the private
 * measured attempt. JSON scopes never become ACTIVE receipts. No ref is created.
 * Current ordinary issuer-authority writer and genuine retained cohort are absent:
 * missing either real input path fails BEFORE backend/business mutations.
 * c8c is immutable; strict1020 FINAL/provenance/raw-history checks surround it.
 *
 * Private input ABI (all paths canonical, inputs600/home700):
 * format/inputEpoch/owner/slot/expiresAt/home/projectId; sources each root+commit
 * +tree for app/preparer/profile/replayHelper/buildHelper; buildHelper additionally
 * fileSha256; dependencyLockSha256; tools.supabaseCli.path+sha256; sourceResources
 * exact file/slot refs+receipts; evidenceRecipientPath+Sha256; leases bootstrap,
 * preparation,native exact NEW resource names. A retained cohort supplies mode,
 * manifestPath+Sha256 and archivePath+Sha256. Its private manifest binds the
 * exact source/schema, original data-only archive, capture attempt/capsule,
 * source originals and two independently reviewed output originals, plus
 * cohortArtifact and preparationFacts paths+hashes. Facts contain companyIds,
 * actual Auth actor credentials and three unprepared targets expected by1020.
 * A recipe is not a retained cohort. Current ordinary-mode explicitly HOLDS.
 *
 * `receive ENCRYPTED_JSON NEW_PRIVATE_HOME` authenticates private input files
 * with an explicitly supplied transport key. All other commands take
 * `PHASE PRIVATE_PLAN_JSON`. Each phase exports ciphertext before the next
 * phase can poll an externally qualified measured lease. No producer is
 * acquired/published/released here. Actual grants, retained source authority,
 * integrated candidate, inputs and output qualification remain dependencies.
 * Cleanup refuses unknown births and reports failure rather than deleting them.
 * This targeted SQL profile does not start/claim the whole T4 mail/browser flow.
 */
import { spawn, execFileSync } from 'node:child_process'
import { constants, createCipheriv, createDecipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statfsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { availableParallelism } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export const EVIDENCE_RECIPIENT_SHA256 = '7048399e88324e148011152fd719d79a0bc9af82b890bc31699e982cbcf3c728'
export const FROZEN = Object.freeze({
  preparerCommit: 'de035b35ee60c429ffc87495cc4f90a851579eec',
  preparerTree: 'f13f2972926ad9a7b36ec5f6acd7cfc9bf506a18',
  preparerFiles: {
    'scripts/simulation/track4/lib/atomicNativePreparation.mjs': '5b375e523f0b24da71fdb9f527227c9c2fd4e82942eab75fa6e1cc8a54ff7327',
    'scripts/simulation/track4/prepare-atomic-native.mjs': '1556da942ad9fe7075e2ec7c5f6af7a4e2cd80c32e502d1bcb3693cb94f0657d',
    '__tests__/simulation-track4-atomic-native-preparation.test.ts': 'dcb8e5379b105cb458f57317b07fc6a7280fff811f00d50354d47ec3830a773d',
  },
  proofCommit: 'c8c4244d7224c46baf83695ca80fa2fe9f52f83e',
  proofSha256: 'a7b2b243265114fbb21d4c899ae8669fca31fda5cc2ca0671f5b6ad6bb766f0f',
  configSha256: '7c0e2362574a92a9f719a5fd3035659ad4121649ac5bdd298642b21e8c0c8a80',
  buildHelperCommit: 'da6ccacc5974f9e43804d87941cc2272a03ca3e0',
  buildHelperTree: '23cd25b8cbd89390d9085b6a440a47f028009e59',
  buildHelperSha256: 'b853f17dcf643a49ea4d97b4a871be5cd18c82927fc607de0ff216ce815d29f6',
  replayHelperCommit: '0c287bfd1b6e1bf0fb79a37ffd7367499b40d1d9',
  replayHelperPath: 'scripts/simulation/runtime/assigned_backend.py',
  replayHelperSha256: 'b5c365532590dd854b6a3971699a29cfa1afa2aed6b5f37cb364cad613327ff6',
})
const GIB = 2 ** 30
const PREFIX = 'refs/tags/agent-claims/masterplan/'
const HEX40 = /^[a-f0-9]{40}$/
const HEX64 = /^[a-f0-9]{64}$/
const MODES = ['init', 'bootstrap', 'prepare', 'native', 'cleanup']
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object'
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hash = (value) => sha(canonical(value))
class Hold extends Error { constructor(code) { super(code); this.code = code } }
const need = (value, code) => { if (!value) throw new Hold(code) }
const safeCode = (error) => error instanceof Hold && /^[a-z0-9_]+$/.test(error.code) ? error.code : 'unclassified_profile_failure'
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`

export function checkCapacity(host) {
  const floor = { vfs: 40, overlay2: 15, overlayfs: 15 }[host.driver]
  need(floor && host.effectiveRamBytes >= 8 * GIB && host.freeDockerBytes >= floor * GIB, 'owned_host_capacity_hold')
}
export function sameHost(before, after) {
  need(['bootId', 'daemonId', 'socketPath', 'socketDev', 'socketIno', 'driver', 'dockerRootDir']
    .every((key) => before[key] === after[key]), 'same_owned_host_required')
}
export function validatePlan(plan, now) {
  need(plan?.format === 't4_atomic_native_profile_v1' && /^[a-z0-9-]+$/.test(plan.inputEpoch)
    && typeof plan.owner === 'string' && plan.owner.length > 0, 'private_profile_input_required')
  need(isAbsolute(plan.home) && Date.parse(plan.expiresAt) > now, 'profile_input_expired_or_unbound')
  need(plan.evidenceRecipientSha256 === EVIDENCE_RECIPIENT_SHA256, 'actual_internal_evidence_recipient_required')
  need(plan.cohort && ['retained', 'ordinary'].includes(plan.cohort.mode), 'genuine_cohort_or_ordinary_authority_required')
  for (const key of ['app', 'preparer', 'profile']) {
    const source = plan.sources?.[key]
    need(source && isAbsolute(source.root) && HEX40.test(source.commit) && HEX40.test(source.tree), 'exact_profile_source_required')
  }
  need(plan.sources.preparer.commit === FROZEN.preparerCommit && plan.sources.preparer.tree === FROZEN.preparerTree,
    'reviewed1020_source_required')
  need(/^producer-t4-atomic-bootstrap-[a-z0-9-]+$/.test(plan.leases?.bootstrap)
    && /^producer-t4-atomic-native-preparation-[a-z0-9-]+$/.test(plan.leases?.preparation)
    && /^producer-t4-atomic-native-run-[a-z0-9-]+$/.test(plan.leases?.native), 'distinct_targeted_phase_resources_required')
}
export function encryptEvidence(bytes, publicPem, expectedSha256) {
  need(sha(publicPem) === expectedSha256, 'evidence_recipient_changed')
  const keyObject = createPublicKey(publicPem)
  need(keyObject.asymmetricKeyType === 'rsa' && keyObject.asymmetricKeyDetails.modulusLength >= 3072,
    'evidence_rsa3072_recipient_required')
  const key = randomBytes(32), nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()])
  const wrapped = publicEncrypt({ key: keyObject, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key)
  key.fill(0)
  return { format: 't4_private_evidence_envelope_v1', recipientSha256: expectedSha256,
    algorithm: 'AES-256-GCM/RSA-OAEP-SHA256', nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), wrappedKey: wrapped.toString('base64'), ciphertext: ciphertext.toString('base64') }
}
export function validateNativeReport(report, exitCode) {
  const cases = (report.testResults ?? []).flatMap((suite) => suite.assertionResults ?? [])
  need(exitCode === 0 && report.success === true && report.numTotalTests === 6 && report.numPassedTests === 6
    && report.numFailedTests === 0 && report.numPendingTests === 0 && (report.numTodoTests ?? 0) === 0
    && cases.length === 6 && cases.every((test) => test.status === 'passed'), 'exact_native_report_required')
  return { exitCode, passed: 6, failed: 0, skipped: 0, todo: 0 }
}

export async function runProfilePhase(mode, plan, state, io) {
  need(MODES.includes(mode), 'known_profile_phase_required')
  if (mode !== 'cleanup') validatePlan(plan, io.now())
  state.intents ??= {}
  state.results ??= {}
  if (mode === 'cleanup' && state.results.cleanup?.verified) return state.results.cleanup
  need(!state.intents[mode], 'phase_already_attempted_no_retry')
  if (mode === 'init') {
    await io.verifyStaticInputs(plan)
    await io.verifyRecipient(plan)
    const cohort = await io.checkCohort(plan)
    need(cohort.genuine === true, 'genuine_cohort_or_ordinary_authority_required')
    const host = await io.inspectHost(plan)
    checkCapacity(host)
    state.host = host
    await io.reserve(mode, plan)
    state.intents[mode] = true
    state.pendingBootstrap = await io.pendingLease('bootstrap', { planSha256: hash(plan), host, sources: plan.sources,
      cohortSha256: hash(plan.cohort), budget: { backend: 1, replay: 1, restore: 1, build: 1, app: 1, native: 0, cleanup: 1 } })
  } else {
    need(state.host, 'actual_initial_host_observation_required')
    const host = await io.inspectHost(plan, mode === 'cleanup')
    sameHost(state.host, host)
    if (mode !== 'cleanup') checkCapacity(host)
    if (mode === 'bootstrap') {
      need(state.pendingBootstrap, 'measured_bootstrap_scope_required')
      const lease = await io.awaitLease('bootstrap', state.pendingBootstrap, plan)
      need(lease.verified === true, 'actual_phase_lease_required')
      await io.reserve(mode, plan)
      state.intents[mode] = true
      state.bootstrapLease = lease
      const actual = await io.bootstrap(plan)
      need(actual.actualResources === true && actual.replay?.canonical === true
        && actual.replay.sourceRestored === true && actual.build?.fresh === true && actual.app?.fresh === true,
      'actual_bootstrap_replay_build_app_required')
      state.bootstrap = actual
      state.pendingPreparation = await io.pendingLease('preparation', actual)
    } else if (mode === 'prepare') {
      need(state.bootstrap && state.pendingPreparation, 'actual_prepared_backend_required')
      await io.verifyLiveBackend(plan, state.bootstrap)
      const lease = await io.awaitLease('preparation', state.pendingPreparation, plan)
      need(lease.verified === true, 'actual_phase_lease_required')
      await io.reserve(mode, plan)
      state.intents[mode] = true
      const prepared = await io.prepare(plan, lease)
      need(prepared.actualGraphs === 3 && prepared.actualAuthActors === 3 && HEX64.test(prepared.nativeFixtureSha256),
        'actual1020_graphs_auth_required')
      state.prepared = prepared
      state.pendingNative = await io.pendingLease('native', { prepared, backend: state.bootstrap,
        budget: { nativeFixtureRuns: 1, manualReruns: 0, cleanup: 1 } })
    } else if (mode === 'native') {
      need(state.prepared && state.pendingNative, 'actual1020_inputs_required')
      await io.verifyLiveBackend(plan, state.bootstrap)
      const lease = await io.awaitLease('native', state.pendingNative, plan)
      need(lease.verified === true, 'actual_phase_lease_required')
      const before = await io.strictSourceSnapshot(plan)
      need(before.allFinal === true, 'strict_final_source_required')
      await io.reserve(mode, plan)
      state.intents[mode] = true
      state.nativeAttempted = true
      let result
      let after
      try { result = await io.native(plan) } finally { after = await io.strictSourceSnapshot(plan) }
      need(after.allFinal === true && before.provenanceSha256 === after.provenanceSha256
        && before.rawHistorySha256 === after.rawHistorySha256, 'source_history_changed')
      need(result.exitCode === 0 && result.passed === 6 && result.failed === 0 && result.skipped === 0 && result.todo === 0,
        'exact_native_report_required')
      state.native = result
    } else if (mode === 'cleanup') {
      await io.reserve(mode, plan)
      state.intents[mode] = true
      const clean = await io.cleanup(plan, state)
      need(clean.verified === true && clean.foreignDeleted === 0 && clean.unknown?.length === 0,
        'exact_owned_cleanup_required')
      state.results.cleanup = clean
    }
  }
  await io.event({ phase: mode, observedAtUtc: new Date(io.now()).toISOString(), nativeExecuted: !!state.nativeAttempted })
  const exported = await io.exportEncrypted(plan, state)
  need(exported.encrypted === true && exported.recipientSha256 === plan.evidenceRecipientSha256,
    'private_encrypted_evidence_required')
  return { phase: mode, nativeExecuted: !!state.nativeAttempted, wholeScenarioPasses: 0,
    qualification: state.native ? 'SQL_NATIVE_ONLY_REQUIRES_INDEPENDENT_OUTPUT_REVIEW' : 'PENDING_NOT_NATIVE_ACCEPTANCE' }
}

function privateFile(path) {
  try {
    need(isAbsolute(path) && realpathSync(path) === path, 'canonical_private_file_required')
    const stat = lstatSync(path)
    need(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600, 'private_owned_file_required')
    return readFileSync(path)
  } catch (error) { throw error instanceof Hold ? error : new Hold('private_file_unavailable') }
}
function readJson(path) { try { return JSON.parse(privateFile(path)) } catch { throw new Hold('private_json_invalid') } }
function seal(path, value) {
  const fd = openSync(path, 'wx', 0o600)
  try { writeFileSync(fd, Buffer.isBuffer(value) ? value : `${canonical(value)}\n`) } finally { closeSync(fd) }
}
function replaceState(path, value) {
  // The only replaceable file is this invocation's private state cache; original
  // intent/phase/observation files remain exclusive originals.
  const stat = existsSync(path) ? lstatSync(path) : null
  need(!stat || (stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600), 'private_state_cache_required')
  writeFileSync(path, `${canonical(value)}\n`, { mode: 0o600 })
}
function capture(program, argv, options = {}) {
  try { return execFileSync(program, argv, { encoding: 'utf8', timeout: 20_000,
    maxBuffer: 32_000_000, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim() }
  catch { throw new Hold('observational_command_failed') }
}
function jcapture(program, argv, options) {
  try { return JSON.parse(capture(program, argv, options)) } catch { throw new Hold('observational_json_failed') }
}
export async function ownedChild(program, argv, options, timeoutMs, logPath) {
  const log = openSync(logPath, 'wx', 0o600)
  const child = spawn(program, argv, { ...options, detached: true, stdio: ['ignore', log, log] })
  let expired = false
  let escalation
  const close = new Promise((resolveClose, reject) => {
    child.once('error', () => reject(new Hold('owned_child_spawn_failed')))
    child.once('close', (code, signal) => resolveClose({ code, signal }))
  })
  const timer = setTimeout(() => {
    expired = true
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* close still determines outcome */ }
    escalation = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* already closed */ } }, 5_000)
  }, timeoutMs)
  try {
    const result = await close
    need(!expired && result.code === 0, expired ? 'owned_child_timeout_terminal' : 'owned_child_failed')
    return 0
  } finally { clearTimeout(timer); clearTimeout(escalation); closeSync(log) }
}
function source(root, commit, tree) {
  need(isAbsolute(root) && realpathSync(root) === root, 'canonical_source_root_required')
  need(capture('git', ['-C', root, 'rev-parse', 'HEAD']) === commit
    && capture('git', ['-C', root, 'rev-parse', 'HEAD^{tree}']) === tree
    && !capture('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal']), 'clean_exact_source_required')
}
function readBytesHash(path, expected) {
  need(realpathSync(path) === path && lstatSync(path).isFile() && sha(readFileSync(path)) === expected,
    'actual_bound_artifact_required')
  return readFileSync(path)
}
function sql(body, env) {
  const output = capture('psql', ['postgresql://postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'],
    { input: `SET statement_timeout='20s'; SET lock_timeout='5s';\n${body}`, env: { ...env, PGPASSWORD: 'postgres' } })
  try { return JSON.parse(output.split('\n').filter(Boolean).at(-1)) } catch { throw new Hold('database_observation_invalid') }
}

/** @param {string} endpoint @param {(path: string) => string} resolvePath */
export function normalizeDockerEndpoint(endpoint, resolvePath = realpathSync) {
  need(typeof endpoint === 'string' && endpoint.startsWith('unix:///') && !endpoint.includes('\0'), 'local_unix_docker_required')
  return resolvePath(endpoint.slice(7))
}
function ensureDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })
  const stat = lstatSync(path)
  need(realpathSync(path) === path && stat.isDirectory() && stat.uid === process.getuid()
    && (stat.mode & 0o777) === 0o700, 'owned_private_directory_required')
}
function dockerEnvironment(plan) {
  const directory = join(plan.home, 'docker-client')
  return { ...process.env, DOCKER_CONFIG: directory, DOCKER_CONTEXT: `t4-${plan.inputEpoch}`, DOCKER_HOST: undefined }
}
function docker(plan, ...argv) {
  const env = dockerEnvironment(plan)
  delete env.DOCKER_HOST
  return capture('docker', argv, { env })
}
function dockerJson(plan, ...argv) { return JSON.parse(docker(plan, ...argv)) }
function inventory(plan) {
  return { containers: docker(plan, 'ps', '-aq', '--no-trunc').split('\n').filter(Boolean).sort(),
    networks: docker(plan, 'network', 'ls', '--no-trunc', '--format', '{{.ID}}').split('\n').filter(Boolean).sort(),
    volumes: docker(plan, 'volume', 'ls', '--format', '{{.Name}}').split('\n').filter(Boolean).sort() }
}
async function inspectHost(plan, cleanup = false) {
  // Resolve the actual original endpoint without contacting a remote daemon.
  const endpoint = process.env.DOCKER_HOST || jcapture('docker', ['context', 'inspect', capture('docker', ['context', 'show'])])[0]?.Endpoints?.docker?.Host
  const socketPath = normalizeDockerEndpoint(endpoint)
  const socket = lstatSync(socketPath)
  need(socket.isSocket(), 'actual_docker_socket_required')
  const direct = jcapture('docker', ['--host', `unix://${socketPath}`, 'info', '--format', '{{json .}}'])
  const client = join(plan.home, 'docker-client')
  if (!existsSync(client)) {
    ensureDirectory(client)
    const env = { ...process.env, DOCKER_CONFIG: client }
    delete env.DOCKER_CONTEXT
    delete env.DOCKER_HOST
    capture('docker', ['--config', client, 'context', 'create', `t4-${plan.inputEpoch}`, '--docker', `host=unix://${socketPath}`], { env })
  }
  const actualContext = dockerJson(plan, 'context', 'inspect', `t4-${plan.inputEpoch}`)[0]
  need(actualContext?.Endpoints?.docker?.Host === `unix://${socketPath}`, 'private_docker_context_changed')
  const info = dockerJson(plan, 'info', '--format', '{{json .}}')
  need(info.ID === direct.ID, 'private_context_changed_daemon')
  const disk = statfsSync(info.DockerRootDir)
  let ram = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemTotal:\s+(\d+)/m)?.[1]) * 1024
  for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    if (existsSync(path)) { const value = Number(readFileSync(path, 'utf8').trim()); if (Number.isFinite(value)) ram = Math.min(ram, value) }
  }
  const host = { bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), daemonId: info.ID,
    socketPath, socketDev: String(socket.dev), socketIno: String(socket.ino), driver: info.Driver,
    dockerRootDir: realpathSync(info.DockerRootDir), effectiveRamBytes: ram,
    freeDockerBytes: Number(disk.bavail) * Number(disk.bsize), cpuCount: availableParallelism(),
    cpuQuota: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null,
    actionsRunId: process.env.GITHUB_RUN_ID, actionsJob: process.env.GITHUB_JOB }
  if (!cleanup) checkCapacity(host)
  return host
}
function processIdentity(pid) {
  need(Number.isSafeInteger(pid) && pid > 0, 'actual_process_pid_required')
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')
  return { pid, startTicks: stat[19], groupId: Number(stat[2]), cwd: realpathSync(`/proc/${pid}/cwd`),
    environmentSha256: sha(readFileSync(`/proc/${pid}/environ`)) }
}
function ownProcess(actual, expected) {
  need(actual.pid === expected.pid && actual.startTicks === expected.startTicks
    && actual.groupId === expected.groupId && actual.cwd === expected.cwd
    && actual.environmentSha256 === expected.environmentSha256, 'owned_process_identity_changed')
}
async function stopOwnedApp(record) {
  if (!record || !existsSync(`/proc/${record.pid}`)) return
  ownProcess(processIdentity(record.pid), record)
  process.kill(-record.pid, 'SIGTERM')
  const until = Date.now() + 5_000
  while (existsSync(`/proc/${record.pid}`) && Date.now() < until) await new Promise((done) => setTimeout(done, 50))
  if (existsSync(`/proc/${record.pid}`)) {
    ownProcess(processIdentity(record.pid), record)
    process.kill(-record.pid, 'SIGKILL')
    const killUntil = Date.now() + 2_000
    while (existsSync(`/proc/${record.pid}`) && Date.now() < killUntil) await new Promise((done) => setTimeout(done, 50))
  }
  need(!existsSync(`/proc/${record.pid}`), 'owned_app_not_terminal')
}
function inspectResources(plan, network) {
  const now = inventory(plan)
  const containers = now.containers.map((id) => dockerJson(plan, 'inspect', id)[0])
  const ours = containers.filter((item) => item.Config?.Labels?.['com.supabase.cli.project'] === plan.projectId
    && Object.values(item.NetworkSettings?.Networks ?? {}).some((entry) => entry.NetworkID === network.Id))
  need(ours.length === containers.length && ours.length > 0, 'foreign_or_unqualified_container_present')
  const volumes = now.volumes.map((name) => dockerJson(plan, 'volume', 'inspect', name)[0])
  need(volumes.every((item) => item.Labels?.['com.supabase.cli.project'] === plan.projectId), 'foreign_volume_present')
  const role = (prefix) => {
    const matches = ours.filter((item) => item.Name === `/${prefix}${plan.projectId}`)
    need(matches.length === 1, 'backend_role_ambiguous')
    return matches[0].Id
  }
  return { containers: ours, volumes, network, roles: {
    database: role('supabase_db_'), api: role('supabase_kong_'), storage: role('supabase_storage_') } }
}
function verifyResourceBirth(plan, item, networkId) {
  need(HEX64.test(item.Id) && item.Config?.Labels?.['com.supabase.cli.project'] === plan.projectId
    && Object.values(item.NetworkSettings?.Networks ?? {}).some((entry) => entry.NetworkID === networkId),
  'owned_container_birth_binding_required')
}
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/heke99/gridex-ops-platform/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''}`,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (response.status === 404) return null
  need(response.status === 200, 'authenticated_github_read_required')
  return response.json()
}
export function verifyLeaseCapsule(resource, attemptBytes, observed, commit, base) {
  const body = JSON.parse(commit.message)
  const expected = `Acquire bounded ${resource.slice(PREFIX.length)}; resources-sha256=${sha(resource)}; attempt-sha256=${sha(attemptBytes)}; state=PENDING_INPUT_QUALIFICATION`
  need(Object.keys(body).sort().join(',') === 'base,files,operation' && body.files?.length === 0
    && body.operation === expected && observed.object.sha === commit.sha && HEX40.test(commit.sha), 'neutral_phase_capsule_required')
  need(base.sha === body.base && commit.parents.length === 1 && commit.parents[0].sha === body.base
    && commit.tree.sha === base.tree.sha, 'neutral_phase_parent_tree_required')
}

function staticPreflight(plan) {
  need(process.versions.node === '22.23.4' && process.env.GITHUB_ACTIONS === 'true'
    && process.env.GITHUB_RUN_ATTEMPT === '1' && process.env.GITHUB_JOB === 'atomic-native', 'one_actual_source_bound_actions_job_required')
  for (const source_ of Object.values(plan.sources)) source(source_.root, source_.commit, source_.tree)
  need(fileURLToPath(import.meta.url) === join(plan.sources.profile.root, 'scripts/simulation/track4/atomic-native-profile.mjs'),
    'actual_profile_source_required')
  for (const [path, expected] of Object.entries(FROZEN.preparerFiles)) readBytesHash(join(plan.sources.preparer.root, path), expected)
  readBytesHash(join(plan.sources.app.root, 'scripts/invoice-approval-atomic-native.test.ts'), FROZEN.proofSha256)
  readBytesHash(join(plan.sources.app.root, 'scripts/invoice-approval-atomic-native.config.ts'), FROZEN.configSha256)
  readBytesHash(join(plan.sources.replayHelper.root, FROZEN.replayHelperPath), FROZEN.replayHelperSha256)
  need(plan.sources.replayHelper.commit === FROZEN.replayHelperCommit, 'qualified_replay_helper_source_required')
  need(plan.sources.buildHelper.commit === FROZEN.buildHelperCommit && plan.sources.buildHelper.tree === FROZEN.buildHelperTree
    && plan.sources.buildHelper.fileSha256 === FROZEN.buildHelperSha256, 'reviewed_build_helper_source_required')
  readBytesHash(join(plan.sources.buildHelper.root, 'scripts/simulation/track4/lib/common.sh'), FROZEN.buildHelperSha256)
  need(capture('supabase', ['--version']) === '2.101.0' && capture('supabase-go', ['--version']) === '2.101.0'
    && /^psql \(PostgreSQL\) 17\./.test(capture('psql', ['--version']))
    && /^pg_restore \(PostgreSQL\) 17\./.test(capture('pg_restore', ['--version'])), 'actual_pinned_toolchain_required')
  need(realpathSync(capture('which', ['supabase'])) === plan.tools.supabaseCli.path, 'actual_private_cli_path_required')
  readBytesHash(plan.tools.supabaseCli.path, plan.tools.supabaseCli.sha256)
  readBytesHash(join(plan.sources.app.root, 'package-lock.json'), plan.dependencyLockSha256)
  const configured = capture('python3', ['-c', 'import pathlib,sys,tomllib;print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())["project_id"])', join(plan.sources.app.root, 'supabase/config.toml')])
  need(configured === plan.projectId && /^[a-z0-9-]+$/.test(configured), 'fixed_source_project_binding_required')
  const tools = Object.fromEntries(['node', 'npm', 'supabase', 'supabase-go', 'psql', 'pg_restore', 'docker', 'python3', 'git']
    .map((name) => { const path = realpathSync(capture('which', [name]));
      return [name, { path, sha256: sha(readFileSync(path)), version: capture(name, ['--version']) }] }))
  seal(join(plan.home, 'receipts', 'actual-tools-source.json'), { tools, sources: plan.sources,
    dependencyLockSha256: plan.dependencyLockSha256, observedAtUtc: new Date().toISOString() })
}
async function checkGenuineCohort(plan) {
  if (plan.cohort.mode === 'ordinary') {
    // No generic recipe/boolean can bridge the currently absent issuer writer.
    // A future supported constructor requires its own reviewed tracked source
    // and actual ordinary authority API; this profile never seeds private flags.
    throw new Hold('ordinary_utilts_issuer_authority_bootstrap_unavailable')
  }
  const manifest = readJson(plan.cohort.manifestPath)
  readBytesHash(plan.cohort.manifestPath, plan.cohort.manifestSha256)
  readBytesHash(plan.cohort.archivePath, plan.cohort.archiveSha256)
  need(manifest.format === 'qualified_t4_unprepared_final_cohort_snapshot_v1'
    && manifest.scope === 'ISOLATED_SYNTHETIC_NEGATIVE_NOT_MAIN'
    && manifest.archiveSha256 === plan.cohort.archiveSha256
    && manifest.targetSchemaSha256 === sha(readFileSync(join(plan.sources.app.root, 'supabase/schema.sql')))
    && Array.isArray(manifest.sourceEvidence) && manifest.sourceEvidence.length > 0
    && Array.isArray(manifest.independentOutputReviews) && manifest.independentOutputReviews.length === 2,
  'qualified_retained_final_cohort_required')
  // These retained originals are data/provenance, not newly fabricated approval
  // flags. The actual restored graph still faces every live database guard.
  for (const evidence of [...manifest.sourceEvidence, ...manifest.independentOutputReviews]) readBytesHash(evidence.path, evidence.sha256)
  const captureReceipt = readJson(manifest.captureReceipt.path)
  readBytesHash(manifest.captureReceipt.path, manifest.captureReceipt.sha256)
  need(captureReceipt.nativeExecuted === false && captureReceipt.phase === 'FINAL_COHORT_CAPTURE'
    && captureReceipt.unpreparedApprovalCount === 0 && captureReceipt.normalFlowSources === true
    && captureReceipt.archiveSha256 === plan.cohort.archiveSha256
    && captureReceipt.inputEpoch === manifest.captureInputEpoch
    && captureReceipt.sourceCommit === plan.sources.app.commit && captureReceipt.sourceTree === plan.sources.app.tree
    && HEX40.test(captureReceipt.producerReceipt), 'retained_actual_capture_binding_required')
  const attemptBytes = privateFile(captureReceipt.attempt.path)
  need(sha(attemptBytes) === captureReceipt.attempt.sha256, 'retained_capture_attempt_changed')
  const attempt = JSON.parse(attemptBytes)
  const original = await github(`git/commits/${captureReceipt.producerReceipt}`)
  need(original && sha(original.message) === captureReceipt.producerBodySha256, 'retained_producer_original_required')
  const capsule = JSON.parse(original.message)
  const base = await github(`git/commits/${capsule.base}`)
  need(base && /^refs\/tags\/agent-claims\/masterplan\/producer-t4-final-cohort-[a-z0-9-]+$/.test(attempt.resource),
    'retained_source_producer_original_required')
  verifyLeaseCapsule(attempt.resource, attemptBytes, { object: { sha: original.sha } }, original, base)
  need(attempt.protocol === 'masterplan-reservation-v1' && attempt.repo === 'heke99/gridex-ops-platform'
    && attempt.inputEpoch === manifest.captureInputEpoch && attempt.scope?.kind === 't4-final-cohort-capture-v1'
    && attempt.scope.archiveSha256 === plan.cohort.archiveSha256
    && attempt.scope.targetSchemaSha256 === manifest.targetSchemaSha256
    && attempt.scope.cohortArtifactSha256 === manifest.cohortArtifact.sha256
    && attempt.scope.preparationFactsSha256 === manifest.preparationFacts.sha256
    && attempt.scope.sourceEvidenceSha256 === hash(manifest.sourceEvidence)
    && attempt.sourceHead === captureReceipt.sourceCommit && attempt.sourceTree === captureReceipt.sourceTree,
  'retained_capture_source_backend_scope_required')
  const toc = capture('pg_restore', ['--list', plan.cohort.archivePath]).split('\n').filter((line) => line && !line.startsWith(';'))
  need(toc.length > 0 && toc.every((line) => /^\d+; \d+ \d+ (TABLE DATA|SEQUENCE SET) /.test(line)), 'genuine_data_only_archive_required')
  if (manifest.storageArchive) readBytesHash(manifest.storageArchive.path, manifest.storageArchive.sha256)
  return { genuine: true, manifest }
}

function outputDirectories(plan) {
  ensureDirectory(plan.home)
  for (const directory of ['raw', 'attempts', 'receipts', 'private', 'export']) ensureDirectory(join(plan.home, directory))
}
async function waitLocalApp() {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3104/login', { redirect: 'manual', signal: AbortSignal.timeout(2_000) })
      if (response.status === 200) return
    } catch { /* finite readiness observation; no business request is retried */ }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Hold('new_owned_app_not_ready')
}
function boundApplicationEnvironment(plan, status) {
  const directory = join(plan.home, 'tool-home')
  ensureDirectory(directory)
  const ghConfig = join(plan.home, 'gh-client')
  ensureDirectory(ghConfig)
  const hostConfig = join(ghConfig, 'hosts.yml')
  if (!existsSync(hostConfig)) seal(hostConfig, Buffer.from(`github.com:\n    oauth_token: ${JSON.stringify(process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '')}\n    git_protocol: https\n`))
  return {
    PATH: process.env.PATH, HOME: directory, PWD: plan.sources.app.root, LANG: 'C.UTF-8',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    DOCKER_CONFIG: join(plan.home, 'docker-client'), DOCKER_CONTEXT: `t4-${plan.inputEpoch}`,
    GH_CONFIG_DIR: ghConfig, SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io',
    SIM_HOME: join(plan.home, 'build-home'), T4_APP_DIR: plan.sources.app.root,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    SITE_URL: 'http://127.0.0.1:3104', NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3104',
    CRON_SECRET: randomBytes(24).toString('hex'), PRICING_CRON_SECRET: randomBytes(24).toString('hex'),
    EMAIL_OUTBOX_CRON_SECRET: randomBytes(24).toString('hex'), SIGNATURE_EVIDENCE_SECRET: randomBytes(24).toString('hex'),
    T4_RUNTIME_PROCESS_NONCE: randomBytes(24).toString('hex'),
  }
}
async function bootstrapActual(plan) {
  const initial = inventory(plan)
  need(initial.containers.length === 0 && initial.volumes.length === 0, 'fresh_exclusive_daemon_required')
  seal(join(plan.home, 'receipts', 'initial-inventory.json'), initial)
  for (const port of [54321, 54322, 3104]) {
    const hex = port.toString(16).toUpperCase().padStart(4, '0')
    const listeners = ['/proc/net/tcp', '/proc/net/tcp6'].flatMap((path) => readFileSync(path, 'utf8').split('\n'))
    need(!listeners.some((line) => { const f = line.trim().split(/\s+/); return f[3] === '0A' && f[1]?.endsWith(`:${hex}`) }), 'exclusive_fixed_port_already_listening')
  }
  const app = plan.sources.app.root
  need(!existsSync(join(app, 'node_modules')) && !existsSync(join(app, '.next')), 'fresh_source_dependencies_build_required')
  await ownedChild('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: app, env: process.env }, 600_000, join(plan.home, 'raw', 'dependencies.log'))
  const lock = readJsonLoose(join(app, 'node_modules', '.package-lock.json'))
  const installedNext = readJsonLoose(join(app, 'node_modules', 'next', 'package.json'))
  const sourceLock = readJsonLoose(join(app, 'package-lock.json'))
  need(installedNext.version === sourceLock.packages['node_modules/next'].version
    && lock.packages['node_modules/next'].version === installedNext.version, 'locked_dependency_identity_required')
  seal(join(plan.home, 'receipts', 'dependencies.json'), { packageLockSha256: sha(readFileSync(join(app, 'package-lock.json'))),
    installedLockSha256: sha(readFileSync(join(app, 'node_modules', '.package-lock.json'))), nextVersion: installedNext.version })
  // Fresh replay tree: canonical script may alter only its own scratch inputs.
  const replay = join(plan.home, 'replay')
  ensureDirectory(replay)
  capture('git', ['-C', app, 'archive', '--format=tar', '--output', join(plan.home, 'private', 'app-source.tar'), 'HEAD'])
  capture('tar', ['-xf', join(plan.home, 'private', 'app-source.tar'), '-C', replay])
  const originalReplay = sha(readFileSync(join(app, 'scripts/gridex-aud-003-clean-replay.sh')))
  need(sha(readFileSync(join(replay, 'scripts/gridex-aud-003-clean-replay.sh'))) === originalReplay, 'canonical_replay_source_required')
  const networkName = `supabase_network_${plan.projectId}`
  const birth = { name: networkName, projectId: plan.projectId, owner: plan.owner, inputEpoch: plan.inputEpoch }
  seal(join(plan.home, 'receipts', 'network.intent.json'), birth)
  const networkId = docker(plan, 'network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
    '--label', `com.supabase.cli.project=${plan.projectId}`, '--label', `gridex.t4.epoch=${plan.inputEpoch}`,
    '--label', `t4.owner=${plan.owner}`, '--label', `t4.input-epoch=${plan.inputEpoch}`, networkName)
  need(HEX64.test(networkId), 'network_create_outcome_unknown')
  const network = dockerJson(plan, 'network', 'inspect', networkId)[0]
  need(network.Name === networkName && network.Labels?.['gridex.t4.epoch'] === plan.inputEpoch
    && network.Options?.['com.docker.network.bridge.host_binding_ipv4'] === '127.0.0.1', 'owned_network_birth_required')
  seal(join(plan.home, 'receipts', 'network.json'), network)
  // Exact independently reviewed T1 cleanup-delegation helper; this does not
  // substitute a stop executable, external DB, source SQL or accepted row.
  const driver = capture('python3', ['-c', `import importlib.util,sys\ns=importlib.util.spec_from_file_location('reviewed_t1_replay_helper',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.replay_driver(),end='')`,
    join(plan.sources.replayHelper.root, FROZEN.replayHelperPath)])
  need(driver.includes('source "$1/scripts/gridex-aud-003-clean-replay.sh"') && driver.includes('original_cleanup_called=0'),
    'qualified_replay_driver_contract_required')
  seal(join(plan.home, 'private', 'replay-driver.sh'), Buffer.from(driver))
  const replayEnv = { ...dockerEnvironment(plan), GRIDEX_CAPTURE_ERROR_BOUNDARY: '1', RUNNER_TEMP: plan.home }
  delete replayEnv.DOCKER_HOST
  delete replayEnv.GRIDEX_REPLAY_DB_URL
  await ownedChild('bash', [join(plan.home, 'private', 'replay-driver.sh'), replay], { cwd: replay, env: replayEnv },
    2_400_000, join(plan.home, 'raw', 'canonical-replay.log'))
  const log = readFileSync(join(plan.home, 'raw', 'canonical-replay.log'), 'utf8')
  need(log.includes('[GRIDEX-REM-002 replay] PASS: empty local Supabase ->'), 'actual_canonical_replay_completion_required')
  // Verify every archived tracked source after the original cleanup restored it.
  const paths = capture('git', ['-C', app, 'ls-files', '-z']).split('\0').filter(Boolean)
  for (const path of paths) {
    need(sha(readFileSync(join(app, path))) === sha(readFileSync(join(replay, path)))
      && (lstatSync(join(app, path)).mode & 0o777) === (lstatSync(join(replay, path)).mode & 0o777), 'replay_source_restoration_failed')
  }
  const resources = inspectResources(plan, network)
  seal(join(plan.home, 'receipts', 'resources.json'), resources)
  const status = JSON.parse(capture('supabase', ['status', '--output', 'json'], { cwd: app, env: dockerEnvironment(plan) }))
  need(status.API_URL === 'http://127.0.0.1:54321' && status.SERVICE_ROLE_KEY && status.ANON_KEY, 'actual_local_status_required')
  seal(join(plan.home, 'private', 'status.json'), status)
  const database = sql(`SELECT jsonb_build_object('databaseSystemIdentifier',system_identifier::text,
    'major',current_setting('server_version_num')::int/10000) FROM pg_control_system();`, dockerEnvironment(plan))
  need(database.major === 17, 'actual_postgres17_backend_required')
  const official = readJsonLoose(join(app, 'scripts/gridex-aud-003-main-ledger.json')).entries
  const ledger = capture('psql', ['postgresql://postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-F', '\t', '-c',
    'SELECT version,coalesce(name,\'\') FROM supabase_migrations.schema_migrations ORDER BY version'],
  { env: { ...dockerEnvironment(plan), PGPASSWORD: 'postgres' } })
  need(ledger === official.map((entry) => `${entry.version}\t${entry.name}`).join('\n'), 'actual_official_ledger_required')
  const replayReceipt = { canonical: true, sourceRestored: true, sourceCommit: plan.sources.app.commit,
    sourceTree: plan.sources.app.tree, sourceSha256: originalReplay, logSha256: sha(Buffer.from(log)),
    ledgerSha256: sha(Buffer.from(ledger)), databaseSystemIdentifier: database.databaseSystemIdentifier, postReplayMigrations: 0 }
  seal(join(plan.home, 'receipts', 'canonical-replay.json'), replayReceipt)
  await restoreCohortActual(plan, resources, status)
  const afterRestore = sql(`SELECT jsonb_build_object('databaseSystemIdentifier',system_identifier::text) FROM pg_control_system();`, dockerEnvironment(plan))
  need(afterRestore.databaseSystemIdentifier === database.databaseSystemIdentifier, 'same_replayed_database_required')
  const buildHome = join(plan.home, 'build-home')
  ensureDirectory(buildHome)
  const appEnv = boundApplicationEnvironment(plan, status)
  seal(join(plan.home, 'private', 'app-environment.json'), appEnv)
  seal(join(buildHome, 'env'), Buffer.from(canonical(appEnv)))
  const common = readBytesHash(join(plan.sources.buildHelper.root, 'scripts/simulation/track4/lib/common.sh'), plan.sources.buildHelper.fileSha256).toString('utf8')
  const evidenceFunction = common.match(/^t4_build_evidence\(\) \{[\s\S]*?\nPYBUILD\n\}/m)?.[0]
  need(evidenceFunction, 'qualified_build_evidence_function_required')
  const helper = `${evidenceFunction}\nAPP_DIR="$1"\nSIM_HOME="$2"\nt4_build_evidence "$3" "\${4:-}"\n`
  const beforeBuild = capture('bash', ['-c', helper, 't4-build', app, buildHome, 'inputs'], { cwd: app, env: appEnv })
  await ownedChild(process.execPath, ['--max-old-space-size=6144', 'node_modules/next/dist/bin/next', 'build', '--webpack'],
    { cwd: app, env: appEnv }, 900_000, join(plan.home, 'raw', 'next-build.log'))
  capture('bash', ['-c', helper, 't4-build', app, buildHome, 'capture', beforeBuild], { cwd: app, env: appEnv })
  source(app, plan.sources.app.commit, plan.sources.app.tree)
  const appLog = openSync(join(plan.home, 'raw', 'new-app.log'), 'wx', 0o600)
  seal(join(plan.home, 'receipts', 'app-start.intent.json'), { buildEvidenceSha256: sha(privateFile(join(buildHome, 'build-evidence.json'))),
    source: plan.sources.app, environmentSha256: hash(appEnv) })
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3104'],
    { cwd: app, env: appEnv, detached: true, stdio: ['ignore', appLog, appLog] })
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', () => reject(new Hold('new_owned_app_spawn_failed'))) })
  const identity = processIdentity(child.pid)
  seal(join(plan.home, 'receipts', 'app-process.json'), identity)
  child.unref()
  closeSync(appLog)
  await waitLocalApp()
  ownProcess(processIdentity(identity.pid), identity)
  const actual = { actualResources: true, host: await inspectHost(plan), replay: replayReceipt,
    build: { fresh: true, receiptSha256: sha(privateFile(join(buildHome, 'build-evidence.json'))) },
    app: { fresh: true, ...identity }, resources, databaseSystemIdentifier: database.databaseSystemIdentifier }
  seal(join(plan.home, 'receipts', 'actual-bootstrap.json'), actual)
  return actual
}
function readJsonLoose(path) { return JSON.parse(readFileSync(path, 'utf8')) }
async function restoreCohortActual(plan, resources, status) {
  if (plan.cohort.mode === 'ordinary') {
    throw new Hold('ordinary_utilts_issuer_authority_bootstrap_unavailable')
  }
  const manifest = readJson(plan.cohort.manifestPath)
  // Genuine data-only restoration, not a fabricated seed. Guards stay enabled;
  // unsupported insertion order/authority is a real HOLD, never patched around.
  await ownedChild('pg_restore', ['--data-only', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error',
    '--dbname', 'postgresql://postgres@127.0.0.1:54322/postgres', plan.cohort.archivePath],
  { env: { ...dockerEnvironment(plan), PGPASSWORD: 'postgres' } }, 300_000, join(plan.home, 'raw', 'genuine-cohort-restore.log'))
  if (manifest.storageArchive) {
    const entries = capture('tar', ['-tf', manifest.storageArchive.path]).split('\n').filter(Boolean)
    need(entries.every((name) => !name.startsWith('/') && !name.split('/').includes('..')), 'storage_archive_path_refused')
    const kinds = capture('tar', ['-tvf', manifest.storageArchive.path]).split('\n').filter(Boolean)
    need(kinds.every((line) => ['-', 'd'].includes(line[0])), 'storage_archive_links_refused')
    const storage = join(plan.home, 'restore-storage')
    ensureDirectory(storage)
    capture('tar', ['-xf', manifest.storageArchive.path, '-C', storage, '--no-same-owner', '--no-same-permissions'])
    const container = dockerJson(plan, 'inspect', resources.roles.storage)[0]
    verifyResourceBirth(plan, container, resources.network.Id)
    need(container.Mounts.some((mount) => mount.Destination === '/var/lib/storage'
      && resources.volumes.some((volume) => volume.Name === mount.Name)), 'owned_storage_mount_required')
    docker(plan, 'cp', `${storage}/.`, `${container.Id}:/var/lib/storage`)
  }
  // Actual source qualification and real Auth happen in1020, not from these
  // retained labels. No preliminary source/original or approved invoice is made.
  need(manifest.cohortArtifact && manifest.preparationFacts, 'actual_retained_target_facts_required')
  readBytesHash(manifest.cohortArtifact.path, manifest.cohortArtifact.sha256)
  seal(join(plan.home, 'receipts', 'cohort-restoration.json'), { archiveSha256: plan.cohort.archiveSha256,
    sourceOriginals: manifest.sourceEvidence, guardsDisabled: false, statusApiUrl: status.API_URL })
}

async function preparationInput(plan) {
  const actual = readJson(join(plan.home, 'receipts', 'actual-bootstrap.json'))
  const manifest = readJson(plan.cohort.manifestPath)
  const facts = readJson(manifest.preparationFacts.path)
  readBytesHash(manifest.preparationFacts.path, manifest.preparationFacts.sha256)
  need(facts.companyId && facts.otherCompanyId && facts.actors && facts.targets, 'retained_normal_flow_inputs_required')
  const artifacts = ['supabase/schema.sql', 'supabase/database.types.ts', 'supabase/schema.fingerprint.json',
    'scripts/migration-history-manifest.json', 'scripts/supabase-types-manifest.json']
  const producer = { nativeResource: plan.leases.preparation, ref: PREFIX + plan.leases.preparation,
    inputEpoch: plan.inputEpoch, agent: plan.owner, slot: plan.slot,
    outputHome: join(plan.home, 'prepared'), receipt: '0'.repeat(40), bodySha256: '0'.repeat(64),
    attempt: { path: join(plan.home, 'attempts', 'preparation.json'), sha256: '0'.repeat(64) } }
  return {
    format: 't4_atomic_native_preparation_input_v1', appRoot: plan.sources.app.root,
    source: { commit: plan.sources.app.commit, tree: plan.sources.app.tree,
      buildEvidenceSha256: actual.build.receiptSha256,
      genArtifacts: Object.fromEntries(artifacts.map((path) => [path, sha(readFileSync(join(plan.sources.app.root, path)))])) },
    harness: { ...plan.sources.preparer, files: FROZEN.preparerFiles }, buildHome: join(plan.home, 'build-home'),
    backend: { ...actual.host, databaseContainerId: actual.resources.roles.database,
      apiContainerId: actual.resources.roles.api, databaseSystemIdentifier: actual.databaseSystemIdentifier,
      appPid: actual.app.pid, appStartTicks: actual.app.startTicks, appPort: 3104,
      containerIds: actual.resources.containers.map((item) => item.Id).sort(),
      networkIds: [actual.resources.network.Id], volumeNames: actual.resources.volumes.map((item) => item.Name).sort() },
    tools: { supabaseCli: { path: plan.tools.supabaseCli.path, sha256: plan.tools.supabaseCli.sha256 } },
    appUrl: 'http://127.0.0.1:3104', expiresAt: plan.expiresAt,
    companyId: facts.companyId, otherCompanyId: facts.otherCompanyId, actors: facts.actors, targets: facts.targets,
    cohort: manifest.cohortArtifact, producer,
  }
}
async function pendingActual(plan, phase, observation) {
  const resource = PREFIX + plan.leases[phase]
  let scope = { kind: `t4-atomic-${phase}-same-host-v1`, inputEpoch: plan.inputEpoch,
    sourceHead: plan.sources.app.commit, sourceTree: plan.sources.app.tree,
    observationSha256: hash(observation), host: await inspectHost(plan), expiresAt: plan.expiresAt,
    outputHomeSha256: sha(plan.home), sources: plan.sources }
  let budget = phase === 'bootstrap'
    ? { backend: 1, replay: 1, restore: 1, build: 1, app: 1, native: 0, cleanup: 1 }
    : { nativeFixtureRuns: 1, manualReruns: 0, cleanup: 1 }
  if (phase === 'preparation') {
    const input = await preparationInput(plan)
    const preparationModule = await import(pathToFileURL(join(plan.sources.preparer.root, 'scripts/simulation/track4/lib/atomicNativePreparation.mjs')))
    scope = preparationModule.preparationProducerScope(input)
    budget = { prepareCalls: scope.prepareBudget, nativeFixtureRuns: 0, manualReruns: 0, provision: 0,
      builds: 0, migrations: 0, genCaptures: 0, merges: 0, deployments: 0 }
    seal(join(plan.home, 'private', 'preparation-input.pending.json'), input)
  }
  need(Array.isArray(plan.sourceResources) && plan.sourceResources.length > 0, 'actual_source_resource_originals_required')
  const attempt = { protocol: 'masterplan-reservation-v1', repo: 'heke99/gridex-ops-platform', owner: plan.owner,
    slot: plan.slot, epoch: 'gridex-five-agent-20261012', inputEpoch: plan.inputEpoch, resource,
    sourceHead: plan.sources.app.commit, sourceTree: plan.sources.app.tree, scope, budget,
    sourceResources: plan.sourceResources }
  const path = join(plan.home, 'attempts', `${phase}.json`)
  seal(path, attempt)
  return { resource, path, sha256: sha(privateFile(path)), expiresAt: plan.expiresAt }
}
async function awaitActualLease(plan, pending) {
  // These GETs only observe an independently qualified producer. This program
  // never creates, extends or releases authority refs, nor infers admission from
  // an allocation template. Finite wait leaves a readable encrypted checkpoint.
  const deadline = Math.min(Date.parse(pending.expiresAt), Date.now() + 20 * 60_000)
  const attemptBytes = privateFile(pending.path)
  need(sha(attemptBytes) === pending.sha256, 'pending_attempt_changed')
  const attempt = JSON.parse(attemptBytes)
  while (Date.now() < deadline) {
    const observed = await github(`git/ref/tags/agent-claims/masterplan/${pending.resource.slice(PREFIX.length)}`)
    if (observed) {
      const commit = await github(`git/commits/${observed.object.sha}`)
      need(commit, 'actual_phase_commit_required')
      let capsule
      try { capsule = JSON.parse(commit.message) } catch { throw new Hold('neutral_phase_capsule_required') }
      const base = await github(`git/commits/${capsule.base}`)
      need(base, 'actual_phase_base_required')
      verifyLeaseCapsule(pending.resource, attemptBytes, observed, commit, base)
      need(attempt.owner === plan.owner && attempt.slot === plan.slot && attempt.inputEpoch === plan.inputEpoch
        && attempt.sourceHead === plan.sources.app.commit && attempt.sourceTree === plan.sources.app.tree,
      'actual_phase_identity_changed')
      for (const binding of attempt.sourceResources) {
        need(/^refs\/tags\/agent-claims\/masterplan\/(file-[a-f0-9]{64}|slot-session-[a-f0-9-]{36})$/.test(binding.ref)
          && HEX40.test(binding.receipt), 'exact_source_resource_originals_required')
        const current = await github(`git/ref/${binding.ref.slice(5)}`)
        need(current?.object.sha === binding.receipt, 'actual_source_resource_changed')
      }
      const repeated = await github(`git/ref/${pending.resource.slice(5)}`)
      need(repeated?.object.sha === commit.sha, 'actual_phase_resource_changed')
      const lease = { verified: true, receipt: commit.sha, bodySha256: sha(commit.message), resource: pending.resource,
        attemptSha256: pending.sha256, observedAtUtc: new Date().toISOString() }
      seal(join(plan.home, 'receipts', `${pending.resource.slice(PREFIX.length)}.json`), lease)
      return lease
    }
    await new Promise((done) => setTimeout(done, 5_000))
  }
  throw new Hold('actual_phase_qualified_producer_absent')
}
async function prepareActual(plan, lease) {
  const input = readJson(join(plan.home, 'private', 'preparation-input.pending.json'))
  input.producer.receipt = lease.receipt
  input.producer.bodySha256 = lease.bodySha256
  input.producer.attempt.sha256 = lease.attemptSha256
  seal(join(plan.home, 'private', 'preparation-input.json'), input)
  const env = readJson(join(plan.home, 'private', 'app-environment.json'))
  await ownedChild(process.execPath, [join(plan.sources.preparer.root, 'scripts/simulation/track4/prepare-atomic-native.mjs'),
    join(plan.home, 'private', 'preparation-input.json'), join(plan.home, 'prepared')], { cwd: plan.sources.app.root, env }, 180_000,
  join(plan.home, 'raw', 'normal-flow-preparation.log'))
  const result = readJson(join(plan.home, 'prepared', 'preparation-result.json'))
  const fixture = readJson(join(plan.home, 'prepared', 'native-fixture.json'))
  need(result.state === 'PREPARED_INPUTS_NOT_NATIVE_ACCEPTANCE' && result.nativeExecuted === false
    && fixture, 'actual1020_prepared_receipts_required')
  return { actualGraphs: 3, actualAuthActors: 3,
    nativeFixtureSha256: sha(privateFile(join(plan.home, 'prepared', 'native-fixture.json'))),
    nativeStatusSha256: sha(privateFile(join(plan.home, 'prepared', 'native-status.json'))) }
}
async function strictSnapshotActual(plan) {
  // Run the frozen strict reader with EXACT build/app environment in an owned
  // subprocess. Calling observeTarget alone performs no prepare or approval.
  const script = `import {readFileSync,writeFileSync} from 'node:fs';
    import {realAdapters} from ${JSON.stringify(pathToFileURL(join(plan.sources.preparer.root, 'scripts/simulation/track4/prepare-atomic-native.mjs')).href)};
    const input=JSON.parse(readFileSync(process.argv[1],'utf8'));
    const io=await realAdapters(input,{});const result=[];
    for(const name of ['concurrent','contextDrift','rollback'])result.push(await io.observeTarget(name,input));
    writeFileSync(process.argv[2],JSON.stringify(result),{flag:'wx',mode:0o600});`
  const file = join(plan.home, 'receipts', `source-snapshot-${randomBytes(8).toString('hex')}.json`)
  await ownedChild(process.execPath, ['--input-type=module', '-e', script, join(plan.home, 'private', 'preparation-input.json'), file],
    { cwd: plan.sources.app.root, env: readJson(join(plan.home, 'private', 'app-environment.json')) }, 90_000, `${file}.log`)
  const observations = readJson(file)
  const input = readJson(join(plan.home, 'private', 'preparation-input.json'))
  const cohort = readJson(input.cohort.path)
  need(observations.length === 3, 'exact_source_targets_required')
  for (const [index, name] of ['concurrent', 'contextDrift', 'rollback'].entries()) {
    const row = observations[index]
    need(row.allSourcesFinal === true && row.finalSourceCount > 0
      && canonical(row.provenance) === canonical(cohort.targets[name].provenance), 'strict_retained_source_binding_required')
  }
  // Raw protected authority/history/source rows: approvals may legitimately
  // change item/invoice metadata, but cannot rewrite metering provenance.
  const protectedTables = ['public.normalized_metering_values', 'public.ediel_messages',
    'gridex_billing_source.underlay_bindings', 'gridex_billing_source.correction_journal',
    'gridex_utilts_issuer.namespaces', 'gridex_utilts_issuer.issuer_versions',
    'gridex_utilts_issuer.transport_mandate_versions', 'gridex_utilts_issuer.source_absence_grounds',
    'gridex_utilts_issuer.source_admissions', 'gridex_utilts_issuer.revocations',
    'gridex_utilts_issuer.observed_identifiers']
  const rows = protectedTables.map((table) => `SELECT ${literal(table)} AS name,
    coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') AS rows FROM ${table} r`).join(' UNION ALL ')
  const raw = sql(`SELECT jsonb_object_agg(t.name,t.rows) FROM (${rows}) t;`, dockerEnvironment(plan))
  return { allFinal: true, provenanceSha256: hash(observations.map((row) => row.provenance)), rawHistorySha256: hash(raw) }
}
async function verifyLiveActual(plan, actual) {
  sameHost(actual.host, await inspectHost(plan))
  ownProcess(processIdentity(actual.app.pid), actual.app)
  for (const original of actual.resources.containers) {
    const current = dockerJson(plan, 'inspect', original.Id)[0]
    verifyResourceBirth(plan, current, actual.resources.network.Id)
    need(current.Created === original.Created && current.State?.Running === true, 'owned_backend_no_longer_live')
  }
  const current = sql(`SELECT jsonb_build_object('systemIdentifier',system_identifier::text) FROM pg_control_system();`, dockerEnvironment(plan))
  need(current.systemIdentifier === actual.databaseSystemIdentifier, 'actual_database_identity_changed')
}
async function nativeActual(plan) {
  verifyInstalledRpc(plan, 'before-native')
  const app = plan.sources.app.root
  const env = readJson(join(plan.home, 'private', 'app-environment.json'))
  // Native inputs add only explicit driver inputs; they are not used as a build
  // or app receipt. The frozen preparer already bound the initial app environment.
  env.GRIDEX_NATIVE_STATUS = join(plan.home, 'prepared', 'native-status.json')
  env.T4_APPROVAL_NATIVE_FIXTURE = join(plan.home, 'prepared', 'native-fixture.json')
  const report = join(plan.home, 'receipts', 'native-report.json')
  let code = 0
  try {
    await ownedChild(process.execPath, [join(app, 'node_modules/vitest/vitest.mjs'), 'run', '--config',
      join(app, 'scripts/invoice-approval-atomic-native.config.ts'), '--reporter=json', `--outputFile=${report}`],
    { cwd: app, env }, 360_000, join(plan.home, 'raw', 'native-driver.log'))
  } catch { code = 1 }
  need(existsSync(report), 'actual_native_report_absent')
  // Vitest creates its output with umask077 set by CLI entry.
  verifyInstalledRpc(plan, 'after-native')
  return validateNativeReport(readJson(report), code)
}
async function cleanupActual(plan, state) {
  // Cleanup uses only actual originals/finite intents from this same host. A
  // missing parsed bootstrap result is not permission to forget partial births.
  const appPath = join(plan.home, 'receipts', 'app-process.json')
  if (existsSync(appPath)) await stopOwnedApp(readJson(appPath))
  const intentPath = join(plan.home, 'receipts', 'network.intent.json')
  if (!existsSync(intentPath)) return { verified: true, foreignDeleted: 0, unknown: [] }
  const intent = readJson(intentPath)
  need(intent.owner === plan.owner && intent.inputEpoch === plan.inputEpoch && intent.projectId === plan.projectId,
    'owned_cleanup_intent_changed')
  const before = inventory(plan)
  const networks = before.networks.map((id) => dockerJson(plan, 'network', 'inspect', id)[0])
  const ours = networks.filter((network) => network.Name === intent.name
    && network.Labels?.['t4.owner'] === plan.owner && network.Labels?.['t4.input-epoch'] === plan.inputEpoch)
  need(ours.length <= 1, 'owned_cleanup_network_ambiguous')
  if (!ours.length) {
    need(before.containers.length === 0 && before.volumes.length === 0, 'partial_cleanup_unqualified_resources')
    return { verified: true, foreignDeleted: 0, unknown: [] }
  }
  const network = ours[0]
  const actual = state.bootstrap ?? (existsSync(join(plan.home, 'receipts', 'actual-bootstrap.json'))
    ? readJson(join(plan.home, 'receipts', 'actual-bootstrap.json')) : null)
  const containers = before.containers.map((id) => dockerJson(plan, 'inspect', id)[0])
  const owned = containers.filter((item) => item.Config?.Labels?.['com.supabase.cli.project'] === plan.projectId
    && Object.values(item.NetworkSettings?.Networks ?? {}).some((entry) => entry.NetworkID === network.Id))
  const unknown = containers.filter((item) => !owned.some((ours_) => ours_.Id === item.Id)).map((item) => item.Id)
  // Actual births and labels are re-read immediately before each exact deletion.
  for (const item of owned) {
    const current = dockerJson(plan, 'inspect', item.Id)[0]
    verifyResourceBirth(plan, current, network.Id)
    need(current.Created === item.Created, 'owned_cleanup_container_changed')
    docker(plan, 'rm', '--force', item.Id)
  }
  const volumeNames = new Set(owned.flatMap((item) => item.Mounts.filter((mount) => mount.Type === 'volume').map((mount) => mount.Name)))
  for (const volume of actual?.resources.volumes ?? []) volumeNames.add(volume.Name)
  for (const name of before.volumes) {
    const volume = dockerJson(plan, 'volume', 'inspect', name)[0]
    if (!volumeNames.has(name) || volume.Labels?.['com.supabase.cli.project'] !== plan.projectId) { unknown.push(name); continue }
    docker(plan, 'volume', 'rm', name)
  }
  const currentNetwork = dockerJson(plan, 'network', 'inspect', network.Id)[0]
  need(currentNetwork.Name === intent.name && currentNetwork.Labels?.['t4.owner'] === plan.owner
    && currentNetwork.Labels?.['t4.input-epoch'] === plan.inputEpoch
    && Object.keys(currentNetwork.Containers ?? {}).length === 0, 'owned_cleanup_network_changed')
  docker(plan, 'network', 'rm', network.Id)
  const after = inventory(plan)
  need(!after.containers.some((id) => owned.some((item) => item.Id === id))
    && !after.networks.includes(network.Id) && !after.volumes.some((name) => volumeNames.has(name)), 'owned_cleanup_not_terminal')
  seal(join(plan.home, 'receipts', 'cleanup-observation.json'), { before, after, deletedContainerIds: owned.map((item) => item.Id),
    deletedNetworkIds: [network.Id], deletedVolumeNames: [...volumeNames], unknown, foreignDeleted: 0 })
  return { verified: unknown.length === 0, foreignDeleted: 0, unknown }
}
function exportActual(plan, state) {
  const files = {}
  const collect = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name)
      if (['export', 'replay', 'restore-storage'].some((name_) => path === join(plan.home, name_))) continue
      const stat = lstatSync(path)
      need(!stat.isSymbolicLink(), 'private_export_symlink_refused')
      if (stat.isDirectory()) collect(path)
      else if (stat.isFile()) {
        need(stat.uid === process.getuid() && (stat.mode & 0o022) === 0, 'private_export_permissions_required')
        files[path.slice(plan.home.length + 1)] = readFileSync(path).toString('base64')
      } else throw new Hold('private_export_file_type_refused')
    }
  }
  collect(plan.home)
  const envelope = encryptEvidence(gzipSync(Buffer.from(canonical({ format: 't4_profile_private_evidence_v1', files, state }))),
    privateFile(plan.evidenceRecipientPath), plan.evidenceRecipientSha256)
  const path = join(plan.home, 'export', `evidence-${Object.keys(state.intents).length}-${randomBytes(6).toString('hex')}.enc.json`)
  seal(path, envelope)
  return { encrypted: true, recipientSha256: plan.evidenceRecipientSha256 }
}
export function realProfileAdapters(plan, state) {
  return {
    now: Date.now, verifyStaticInputs: async () => staticPreflight(plan),
    verifyRecipient: async () => { need(sha(privateFile(plan.evidenceRecipientPath)) === plan.evidenceRecipientSha256,
      'actual_internal_evidence_recipient_required') },
    checkCohort: checkGenuineCohort, inspectHost,
    reserve: async (phase) => {
      seal(join(plan.home, 'receipts', `${phase}.intent.json`), { phase, inputEpoch: plan.inputEpoch, at: new Date().toISOString() })
      state.intents[phase] = true
      replaceState(join(plan.home, 'state.json'), state)
    },
    pendingLease: (phase, observed) => pendingActual(plan, phase, observed),
    awaitLease: (_phase, pending) => awaitActualLease(plan, pending),
    bootstrap: bootstrapActual, verifyLiveBackend: verifyLiveActual, prepare: prepareActual,
    strictSourceSnapshot: strictSnapshotActual, native: nativeActual, cleanup: cleanupActual,
    event: async (event) => seal(join(plan.home, 'receipts', `event-${randomBytes(8).toString('hex')}.json`), event),
    exportEncrypted: async () => exportActual(plan, state),
  }
}
export async function main(argv = process.argv.slice(2)) {
  process.umask(0o077)
  if (argv[0] === 'receive') return receivePrivateInput(argv.slice(1))
  need(argv.length === 2 && MODES.includes(argv[0]), 'usage_phase_private_plan_required')
  const [phase, input] = argv
  const plan = readJson(input)
  outputDirectories(plan)
  const path = join(plan.home, 'state.json')
  const state = existsSync(path) ? readJson(path) : { planSha256: hash(plan) }
  need(state.planSha256 === hash(plan), 'private_profile_plan_changed')
  const io = realProfileAdapters(plan, state)
  try {
    const result = await runProfilePhase(phase, plan, state, io)
    replaceState(path, state)
    seal(join(plan.home, 'export', `safe-${phase}.json`), result)
    return result
  } catch (error) {
    await io.event({ phase, code: safeCode(error), observedAtUtc: new Date().toISOString() })
    replaceState(path, state)
    await io.exportEncrypted(plan, state)
    throw error
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`T4 profile HOLD: ${safeCode(error)}\n`)
    process.exitCode = 1
  })
}

export function decryptInputEnvelope(envelope, keyHex) {
  need(/^[a-f0-9]{64}$/.test(keyHex ?? '') && envelope.format === 't4_private_profile_input_aes256gcm_v1',
    'actual_encrypted_private_input_required')
  try {
    const nonce = Buffer.from(envelope.nonce, 'base64'), tag = Buffer.from(envelope.tag, 'base64')
    need(nonce.length === 12 && tag.length === 16, 'private_input_envelope_invalid')
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), nonce)
    decipher.setAuthTag(tag)
    const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
    return JSON.parse(bytes)
  } catch { throw new Hold('private_input_authentication_failed') }
}

function receivePrivateInput(argv) {
  need(argv.length === 2, 'encrypted_input_and_owned_home_required')
  const [envelopePath, home] = argv
  need(isAbsolute(home) && resolve(home) === home && !existsSync(home), 'fresh_private_input_home_required')
  const incoming = decryptInputEnvelope(readJsonLoose(envelopePath), process.env.T4_RUNTIME_INPUT_KEY)
  need(incoming.format === 't4_private_profile_input_files_v1' && incoming.files && incoming.files['plan.json'],
    'private_input_files_required')
  ensureDirectory(home)
  for (const [name, base64] of Object.entries(incoming.files)) {
    need(typeof base64 === 'string' && !isAbsolute(name) && !name.split('/').some((part) => ['', '.', '..'].includes(part))
      && !['state.json', 'docker-client', 'receipts', 'export', 'raw', 'attempts'].includes(name.split('/')[0]),
    'private_input_path_refused')
    let directory = home
    for (const part of name.split('/').slice(0, -1)) { directory = join(directory, part); ensureDirectory(directory) }
    seal(join(home, name), Buffer.from(base64, 'base64'))
  }
  const plan = readJson(join(home, 'plan.json'))
  need(plan.home === home, 'private_input_home_binding_required')
  return { phase: 'receive', nativeExecuted: false, wholeScenarioPasses: 0 }
}

function verifyInstalledRpc(plan, phase) {
  const migration = readBytesHash(join(plan.sources.app.root,
    'supabase/migrations/20261101115115_invoice_approval_atomic.sql'),
  '1052f7157b250ac8a004c7da36c24c1cd1a44a4feebe303fb4a31b17732a433f').toString('utf8')
  const body = migration.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1]
  need(body, 'exact997_sql_body_required')
  const actual = sql(`SELECT jsonb_build_object('body',p.prosrc,'config',p.proconfig,
    'securityDefiner',p.prosecdef,'argumentTypes',oidvectortypes(p.proargtypes),
    'resultType',pg_get_function_result(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='gridex_approve_invoice_export_item_v1'
      AND p.proargtypes='2950 2950 2950 3802 25'::oidvector;`, dockerEnvironment(plan))
  need(actual.body === body && actual.securityDefiner === true && actual.resultType === 'jsonb'
    && canonical([...actual.config].sort()) === canonical(['lock_timeout=5s', 'search_path=pg_catalog']),
  'actual_installed997_rpc_binding_required')
  seal(join(plan.home, 'receipts', `${phase}-installed-rpc.json`), { migrationSha256: sha(migration),
    prosrcSha256: sha(actual.body), config: actual.config, securityDefiner: true,
    argumentTypes: actual.argumentTypes, resultType: actual.resultType })
}
