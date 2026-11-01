import { describe, expect, it, vi } from 'vitest'
import { runProfilePhase } from '../scripts/simulation/track4/atomic-native-profile.mjs'

const sha = 'a'.repeat(64)
function fixture() {
  const plan = {
    format: 't4_atomic_native_profile_v1', inputEpoch: 'profile-test-epoch', owner: 'owned-producer',
    expiresAt: '2026-11-01T23:00:00Z', home: '/private/t4', projectId: 'gridex-ops-platform',
    evidenceRecipientSha256: '7048399e88324e148011152fd719d79a0bc9af82b890bc31699e982cbcf3c728',
    sources: { app: { root: '/private/app', commit: '1'.repeat(40), tree: '2'.repeat(40) },
      preparer: { root: '/private/preparer', commit: 'de035b35ee60c429ffc87495cc4f90a851579eec', tree: 'f13f2972926ad9a7b36ec5f6acd7cfc9bf506a18' },
      profile: { root: '/private/profile', commit: '3'.repeat(40), tree: '4'.repeat(40) } },
    cohort: { mode: 'retained', manifestSha256: sha, archiveSha256: sha, provenanceVerified: false },
    leases: { bootstrap: 'producer-t4-atomic-bootstrap-test', preparation: 'producer-t4-atomic-native-preparation-test',
      native: 'producer-t4-atomic-native-run-test' },
  }
  const host = { bootId: 'boot', daemonId: 'daemon', socketPath: '/run/docker.sock', socketDev: '1', socketIno: '2',
    driver: 'overlay2', dockerRootDir: '/owned/docker', effectiveRamBytes: 16 * 2 ** 30, freeDockerBytes: 30 * 2 ** 30 }
  const state: Record<string, unknown> = {}
  const io = {
    now: () => Date.parse('2026-11-01T20:00:00Z'),
    verifyStaticInputs: vi.fn(async () => undefined),
    inspectHost: vi.fn(async () => host),
    checkCohort: vi.fn(async () => ({ genuine: true })),
    verifyRecipient: vi.fn(async () => undefined),
    reserve: vi.fn(async () => undefined),
    event: vi.fn(async () => undefined),
    pendingLease: vi.fn(async (phase: string, scope: unknown) => ({ phase, scope, attemptSha256: sha })),
    awaitLease: vi.fn(async () => ({ verified: true, receipt: '5'.repeat(40) })),
    bootstrap: vi.fn(async () => ({ host, replay: { canonical: true, sourceRestored: true, databaseSystemIdentifier: '777' },
      build: { fresh: true }, app: { fresh: true }, actualResources: true })),
    prepare: vi.fn(async () => ({ nativeFixtureSha256: sha, actualGraphs: 3, actualAuthActors: 3 })),
    verifyLiveBackend: vi.fn(async () => undefined),
    strictSourceSnapshot: vi.fn(async () => ({ allFinal: true, provenanceSha256: sha, rawHistorySha256: sha })),
    native: vi.fn(async () => ({ exitCode: 0, passed: 6, failed: 0, skipped: 0, todo: 0 })),
    cleanup: vi.fn(async () => ({ verified: true, foreignDeleted: 0, unknown: [] })),
    exportEncrypted: vi.fn(async () => ({ encrypted: true, recipientSha256: plan.evidenceRecipientSha256 })),
  }
  return { plan, state, io, host }
}

describe('T4 same-host profile phase orchestration: controlled adapters only', () => {
  it('initializes only a pending data scope; no backend or native authorization is invented', async () => {
    const { plan, state, io } = fixture()
    const result = await runProfilePhase('init', plan, state, io)
    expect(result.nativeExecuted).toBe(false)
    expect(io.bootstrap).not.toHaveBeenCalled()
    expect(io.native).not.toHaveBeenCalled()
    expect(io.pendingLease).toHaveBeenCalledTimes(1)
  })

  it('holds before backend mutations when genuine cohort or actual authority is absent', async () => {
    const { plan, state, io } = fixture()
    io.checkCohort.mockResolvedValue({ genuine: false })
    await expect(runProfilePhase('init', plan, state, io)).rejects.toThrow('genuine_cohort_or_ordinary_authority_required')
    expect(io.reserve).not.toHaveBeenCalled()
    expect(io.bootstrap).not.toHaveBeenCalled()
  })

  it('rejects insufficient actual vfs space before a stack, build or business call', async () => {
    const { plan, state, io, host } = fixture()
    io.inspectHost.mockResolvedValue({ ...host, driver: 'vfs', freeDockerBytes: 39 * 2 ** 30 })
    await expect(runProfilePhase('init', plan, state, io)).rejects.toThrow('owned_host_capacity_hold')
    expect(io.bootstrap).not.toHaveBeenCalled()
  })

  it('requires a real fresh measured bootstrap lease before doing replay or build', async () => {
    const { plan, state, io } = fixture()
    await runProfilePhase('init', plan, state, io)
    io.awaitLease.mockResolvedValue({ verified: false, receipt: '' })
    await expect(runProfilePhase('bootstrap', plan, state, io)).rejects.toThrow('actual_phase_lease_required')
    expect(io.bootstrap).not.toHaveBeenCalled()
  })

  it('records canonical replay, fresh build/app and measured resources before preparing inputs', async () => {
    const { plan, state, io } = fixture()
    await runProfilePhase('init', plan, state, io)
    await runProfilePhase('bootstrap', plan, state, io)
    expect(io.bootstrap).toHaveBeenCalledTimes(1)
    expect(io.prepare).not.toHaveBeenCalled()
    expect(io.native).not.toHaveBeenCalled()
  })

  it('never mistakes an ended GEN backend or another Docker daemon for its own live host', async () => {
    const { plan, state, io, host } = fixture()
    await runProfilePhase('init', plan, state, io)
    io.inspectHost.mockResolvedValue({ ...host, daemonId: 'other-daemon' })
    await expect(runProfilePhase('bootstrap', plan, state, io)).rejects.toThrow('same_owned_host_required')
    expect(io.bootstrap).not.toHaveBeenCalled()
  })

  it('performs1020 once, then awaits another native lease rather than spending the preparation grant', async () => {
    const { plan, state, io } = fixture()
    for (const phase of ['init', 'bootstrap', 'prepare']) await runProfilePhase(phase, plan, state, io)
    expect(io.prepare).toHaveBeenCalledTimes(1)
    expect(io.native).not.toHaveBeenCalled()
    expect(io.pendingLease).toHaveBeenCalledTimes(3)
  })

  it('guards ALL FINAL and exact raw-source history independently before and after frozen c8c', async () => {
    const { plan, state, io } = fixture()
    for (const phase of ['init', 'bootstrap', 'prepare', 'native']) await runProfilePhase(phase, plan, state, io)
    expect(io.native).toHaveBeenCalledTimes(1)
    expect(io.strictSourceSnapshot).toHaveBeenCalledTimes(2)
  })

  it('refuses a second workload invocation, including after an unknown outcome', async () => {
    const { plan, state, io } = fixture()
    for (const phase of ['init', 'bootstrap', 'prepare']) await runProfilePhase(phase, plan, state, io)
    io.native.mockRejectedValue(new Error('unknown'))
    await expect(runProfilePhase('native', plan, state, io)).rejects.toThrow()
    await expect(runProfilePhase('native', plan, state, io)).rejects.toThrow('phase_already_attempted_no_retry')
    expect(io.native).toHaveBeenCalledTimes(1)
  })

  it('does not turn incomplete native reports or source-history drift into acceptance', async () => {
    const { plan, state, io } = fixture()
    for (const phase of ['init', 'bootstrap', 'prepare']) await runProfilePhase(phase, plan, state, io)
    io.strictSourceSnapshot.mockResolvedValueOnce({ allFinal: true, provenanceSha256: sha, rawHistorySha256: sha })
      .mockResolvedValueOnce({ allFinal: true, provenanceSha256: sha, rawHistorySha256: 'b'.repeat(64) })
    await expect(runProfilePhase('native', plan, state, io)).rejects.toThrow('source_history_changed')
  })

  it('cleanup runs after expiry without gaining authority over another daemon', async () => {
    const { plan, state, io } = fixture()
    for (const phase of ['init', 'bootstrap']) await runProfilePhase(phase, plan, state, io)
    io.now = () => Date.parse('2026-11-02T01:00:00Z')
    await runProfilePhase('cleanup', plan, state, io)
    expect(io.cleanup).toHaveBeenCalledTimes(1)
  })

  it('exports only encrypted evidence to the actual designated recipient', async () => {
    const { plan, state, io } = fixture()
    await runProfilePhase('init', plan, state, io)
    expect(io.exportEncrypted).toHaveBeenCalledTimes(1)
    expect(state).not.toHaveProperty('ACTIVE')
  })
})

// These exercise actual local crypto/process/source controls, not a database,
// producer lease or native SQL acceptance. Test keys have no customer identity.
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decryptInputEnvelope, encryptEvidence, normalizeDockerEndpoint, ownedChild,
  validateNativeReport, verifyLeaseCapsule } from '../scripts/simulation/track4/atomic-native-profile.mjs'

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
describe('actual profile controls without backend execution', () => {
  it('canonicalizes the common GHA /var/run socket alias before private context binding', () => {
    expect(normalizeDockerEndpoint('unix:///var/run/docker.sock', () => '/run/docker.sock')).toBe('/run/docker.sock')
    expect(() => normalizeDockerEndpoint('tcp://localhost:2375')).toThrow('local_unix_docker_required')
  })
  it('encrypts private bytes for only the pinned RSA3072 recipient', () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 3072 })
    const pem = keys.publicKey.export({ type: 'spki', format: 'pem' })
    const envelope = encryptEvidence(Buffer.from('private Auth and allocation'), pem, digest(pem))
    expect(JSON.stringify(envelope)).not.toContain('private Auth')
    const key = privateDecrypt({ key: keys.privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(envelope.wrappedKey, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    expect(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString())
      .toBe('private Auth and allocation')
    expect(() => encryptEvidence(Buffer.from('private'), pem, '0'.repeat(64))).toThrow('evidence_recipient_changed')
  })
  it('rejects tampered incoming private evidence without exposing plaintext', () => {
    const key = Buffer.alloc(32, 7), nonce = Buffer.alloc(12, 8)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const ciphertext = Buffer.concat([cipher.update('{"actual":"input"}'), cipher.final()])
    const envelope = { format: 't4_private_profile_input_aes256gcm_v1', nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
    expect(decryptInputEnvelope(envelope, key.toString('hex'))).toEqual({ actual: 'input' })
    ciphertext[0] ^= 1
    expect(() => decryptInputEnvelope({ ...envelope, ciphertext: ciphertext.toString('base64') }, key.toString('hex')))
      .toThrow('private_input_authentication_failed')
  })
  it('binds the neutral public capsule to the exact private attempt bytes and same-tree sole parent', () => {
    const resource = 'refs/tags/agent-claims/masterplan/producer-t4-atomic-bootstrap-control'
    const attempt = Buffer.from('{"private":"actual"}\n')
    const message = JSON.stringify({ base: '1'.repeat(40), files: [], operation:
      `Acquire bounded producer-t4-atomic-bootstrap-control; resources-sha256=${digest(resource)}; attempt-sha256=${digest(attempt)}; state=PENDING_INPUT_QUALIFICATION` })
    const commit = { sha: '2'.repeat(40), message, parents: [{ sha: '1'.repeat(40) }], tree: { sha: '3'.repeat(40) } }
    const observed = { object: { sha: commit.sha } }, base = { sha: '1'.repeat(40), tree: { sha: '3'.repeat(40) } }
    expect(() => verifyLeaseCapsule(resource, attempt, observed, commit, base)).not.toThrow()
    expect(() => verifyLeaseCapsule(resource, Buffer.from('changed'), observed, commit, base)).toThrow()
    expect(() => verifyLeaseCapsule(resource, attempt, observed, { ...commit, parents: [] }, base)).toThrow()
    expect(() => verifyLeaseCapsule(resource, attempt, observed, commit, { ...base, tree: { sha: '4'.repeat(40) } })).toThrow()
  })
  it('requires all six real report cases and rejects pass summaries containing skip or failure', () => {
    const report = { success: true, numTotalTests: 6, numPassedTests: 6, numFailedTests: 0, numPendingTests: 0,
      testResults: [{ assertionResults: Array.from({ length: 6 }, () => ({ status: 'passed' })) }] }
    expect(validateNativeReport(report, 0).passed).toBe(6)
    expect(() => validateNativeReport(report, 1)).toThrow()
    expect(() => validateNativeReport({ ...report, numPendingTests: 1 }, 0)).toThrow()
    expect(() => validateNativeReport({ ...report, testResults: [] }, 0)).toThrow()
  })
  it('captures child output privately and terminates an owned timed-out child finitely', async () => {
    const directory = mkdtempSync(join(tmpdir(), 't4-profile-child-'))
    try {
      const good = join(directory, 'good.log')
      await expect(ownedChild(process.execPath, ['-e', 'process.stdout.write("secret")'], {}, 2000, good)).resolves.toBe(0)
      expect(readFileSync(good, 'utf8')).toBe('secret')
      expect(statSync(good).mode & 0o777).toBe(0o600)
      await expect(ownedChild(process.execPath, ['-e', 'setInterval(()=>{},100)'], {}, 50,
        join(directory, 'timeout.log'))).rejects.toThrow('owned_child_timeout_terminal')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})

import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
type ProfileWorkflow = { on: { workflow_dispatch?: unknown }; jobs: Record<string, { if: string; env: Record<string, string>; steps: Array<{ name?: string; run?: string; uses?: string; with?: { path?: string } }> }> }
const { load: parse } = createRequire(import.meta.url)('js-yaml') as { load(source: string): ProfileWorkflow }
describe('profile workflow and failure boundaries', () => {
  it('keeps provisioning, preparation, native and exact cleanup in one explicitly guarded host job', () => {
    const workflow = parse(readFileSync(join(process.cwd(), '.github/workflows/t4-atomic-native.yml'), 'utf8'))
    expect(Object.keys(workflow.jobs)).toEqual(['host-probe', 'atomic-native'])
    expect(workflow.on.workflow_dispatch).toMatchObject({ inputs: { mode: { options: ['bootstrap-only'] } } })
    expect(workflow.jobs['atomic-native'].if).toContain("github.event.label.name == 't4-atomic-native-activation'")
    const steps = workflow.jobs['atomic-native'].steps as Array<{ name?: string; run?: string; uses?: string; with?: { path?: string } }>
    const scripts = steps.map((step) => step.run ?? '').join('\n')
    for (const phase of ['init', 'bootstrap', 'prepare', 'native', 'cleanup']) {
      expect(scripts).toContain(`atomic-native-profile.mjs ${phase} "$T4_HOME/plan.json"`)
    }
    const uploads = steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'))
    expect(uploads).toHaveLength(5)
    expect(uploads.filter((step) => step.with?.path === '${{ env.T4_HOME }}/export/*')).toHaveLength(4)
    expect(uploads.filter((step) => step.with?.path === '${{ env.T4_HOST_PROOF_HOME }}/export/*')).toHaveLength(1)
    expect(scripts).not.toMatch(/docker (?:system prune|rm -f \$\()/)
  })
  it('parses every shell/Python bootstrap block without running provisioning commands', () => {
    const workflow = parse(readFileSync(join(process.cwd(), '.github/workflows/t4-atomic-native.yml'), 'utf8'))
    for (const step of workflow.jobs['atomic-native'].steps) {
      const script = step.run
      if (!script) continue
      expect(() => execFileSync('bash', ['-n', '-c', script], { timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] })).not.toThrow()
      for (const match of script.matchAll(/python3 - <<'([A-Z]+)'\n([\s\S]*?)\n\1/g)) {
        expect(() => execFileSync('python3', ['-c', 'import ast,sys;ast.parse(sys.argv[1])', match[2]],
          { timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] })).not.toThrow()
      }
    }
  })
  it('takes the strict post-snapshot even after an unknown native outcome', async () => {
    const { plan, state, io } = fixture()
    for (const phase of ['init', 'bootstrap', 'prepare']) await runProfilePhase(phase, plan, state, io)
    io.native.mockRejectedValueOnce(new Error('unknown'))
    await expect(runProfilePhase('native', plan, state, io)).rejects.toThrow('unknown')
    expect(io.strictSourceSnapshot).toHaveBeenCalledTimes(2)
    expect(io.exportEncrypted).toHaveBeenCalledTimes(3)
  })
  it('cannot start the native driver after a strict FINAL denial or unsuccessful lease', async () => {
    const { plan, state, io } = fixture()
    for (const phase of ['init', 'bootstrap', 'prepare']) await runProfilePhase(phase, plan, state, io)
    io.strictSourceSnapshot.mockResolvedValueOnce({ allFinal: false, provenanceSha256: sha, rawHistorySha256: sha })
    await expect(runProfilePhase('native', plan, state, io)).rejects.toThrow('strict_final_source_required')
    expect(io.native).not.toHaveBeenCalled()
  })
})

import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import * as actualProfile from '../scripts/simulation/track4/atomic-native-profile.mjs'
function privateJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data), { mode: 0o600 })
}
describe('review regressions: real source and filesystem boundaries', () => {
  it('never delivers the transport key to PR-head code; trusted immutable main source is gated first', () => {
    const workflow = parse(readFileSync(join(process.cwd(), '.github/workflows/t4-atomic-native.yml'), 'utf8'))
    expect(workflow.on).toHaveProperty('pull_request_target')
    const steps = workflow.jobs['atomic-native'].steps
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with).toHaveProperty('ref', '${{ github.workflow_sha }}')
    const gateIndex = steps.findIndex((step) => step.name === 'Verify trusted immutable code and public bootstrap lease before private inputs')
    const keyIndex = steps.findIndex((step) => step.name === 'Decrypt private input and obtain exact public source snapshots')
    expect(gateIndex).toBeGreaterThan(0)
    expect(gateIndex).toBeLessThan(keyIndex)
    expect(workflow.jobs['atomic-native'].env.TRUSTED_WORKFLOW_SHA).toBe('${{ github.workflow_sha }}')
    expect(steps[gateIndex].run).toContain('verify-code')
  })
  it('binds preparer imports to the actual locked app dependency environment', async () => {
    const root = mkdtempSync(join(tmpdir(), 't4-preparer-deps-'))
    try {
      const app = join(root, 'app'), preparer = join(root, 'preparer')
      for (const path of [app, preparer]) {
        mkdirSync(path)
        writeFileSync(join(path, 'package.json'), '{"type":"module"}')
        writeFileSync(join(path, 'package-lock.json'), '{"lockfileVersion":3}')
      }
      symlinkSync(join(process.cwd(), 'node_modules'), join(app, 'node_modules'))
      const bind = (actualProfile as unknown as { bindPreparerDependencies(app: string, preparer: string): unknown }).bindPreparerDependencies
      await bind(app, preparer)
      const resolved = createRequire(join(preparer, 'prepare.mjs')).resolve('@supabase/ssr')
      expect(resolved).toBe(createRequire(join(app, 'prepare.mjs')).resolve('@supabase/ssr'))
      expect(readFileSync(join(preparer, 'package-lock.json'), 'utf8')).toBe('{"lockfileVersion":3}')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('passes the complete observed daemon network set to1020 and retains separate owned cleanup network', async () => {
    const root = mkdtempSync(join(tmpdir(), 't4-network-binding-'))
    try {
      const home = join(root, 'home'), app = join(root, 'app')
      mkdirSync(home); mkdirSync(app); mkdirSync(join(home, 'receipts'))
      for (const path of ['supabase', 'scripts']) mkdirSync(join(app, path))
      for (const path of ['supabase/schema.sql', 'supabase/database.types.ts', 'supabase/schema.fingerprint.json',
        'scripts/migration-history-manifest.json', 'scripts/supabase-types-manifest.json']) writeFileSync(join(app, path), 'source')
      const networkIds = ['1', '2', '3', '4'].map((value) => value.repeat(64))
      const ownNetwork = networkIds[3]
      privateJson(join(home, 'receipts/actual-bootstrap.json'), { host: {}, build: { receiptSha256: sha }, app: { pid: 12, startTicks: '3' },
        databaseSystemIdentifier: 'db', resources: { roles: { database: 'db', api: 'api' },
          containers: [], volumes: [], network: { Id: ownNetwork }, allNetworkIds: networkIds } })
      const facts = { companyId: 'coA', otherCompanyId: 'coB', actors: {}, targets: {} }
      privateJson(join(home, 'facts.json'), facts)
      privateJson(join(home, 'manifest.json'), { preparationFacts: { path: join(home, 'facts.json'),
        sha256: digest(JSON.stringify(facts)) }, cohortArtifact: { path: '/actual/cohort', sha256: sha } })
      const { plan } = fixture()
      const input = await actualProfile.preparationInput({ ...plan, home,
        cohort: { manifestPath: join(home, 'manifest.json') }, sources: { ...plan.sources, app: { ...plan.sources.app, root: app } },
        tools: { supabaseCli: { path: '/private/supabase', sha256: sha } } })
      expect(input.backend.networkIds).toEqual(networkIds)
      expect(input.backend.networkIds).toContain(ownNetwork)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('pins both real ELF members from the inspected official2.101 archive, without fake companion provisioning', () => {
    // Actual archive SHA285877ef... was read-only inspected independently. It
    // contains BOTH these members; companion absence was a review hypothesis.
    expect(actualProfile.FROZEN).toHaveProperty('supabaseBinarySha256', 'b67f22c508bb7434e4e36151b722e289130ed9e07a7ad4f9faadf4c83237286f')
    expect(actualProfile.FROZEN).toHaveProperty('supabaseGoBinarySha256', '9dd9e81a21074081328b77a27a8aef7be45a2828f81d99c4e1fb65efbec73947')
  })
})

describe('immutable default-main public gate: actual capsule control', () => {
  it('accepts only a neutral sole-parent capsule rooted in the immutable trusted workflow commit', () => {
    const workflowSha = 'a'.repeat(40), tree = 'b'.repeat(40), receipt = 'c'.repeat(40)
    const resource = `refs/tags/agent-claims/masterplan/producer-t4-atomic-runtime-code-123-${workflowSha}`
    const message = JSON.stringify({ base: workflowSha, files: [], operation:
      `Acquire bounded ${resource.slice('refs/tags/agent-claims/masterplan/'.length)}; resources-sha256=${digest(resource)}; attempt-sha256=${'d'.repeat(64)}; state=PENDING_INPUT_QUALIFICATION` })
    const observed = { object: { sha: receipt } }
    const commit = { sha: receipt, message, parents: [{ sha: workflowSha }], tree: { sha: tree } }
    const base = { sha: workflowSha, tree: { sha: tree } }
    expect(() => actualProfile.verifyTrustedCodeCapsule(workflowSha, resource, observed, commit, base)).not.toThrow()
    expect(() => actualProfile.verifyTrustedCodeCapsule('e'.repeat(40), resource, observed, commit, base)).toThrow()
    expect(() => actualProfile.verifyTrustedCodeCapsule(workflowSha, resource, observed,
      { ...commit, tree: { sha: 'f'.repeat(40) } }, base)).toThrow()
    expect(() => actualProfile.verifyTrustedCodeCapsule(workflowSha, resource, observed,
      { ...commit, parents: [{ sha: workflowSha }, { sha: 'e'.repeat(40) }] }, base)).toThrow()
  })
  it('refuses a different preparer lock and preserves any unknown dependency directory', () => {
    const root = mkdtempSync(join(tmpdir(), 't4-preparer-deps-denial-'))
    try {
      const app = join(root, 'app'), preparer = join(root, 'preparer')
      for (const path of [app, preparer]) { mkdirSync(path); writeFileSync(join(path, 'package.json'), '{}') }
      writeFileSync(join(app, 'package-lock.json'), 'app-lock')
      writeFileSync(join(preparer, 'package-lock.json'), 'different-lock')
      expect(() => actualProfile.bindPreparerDependencies(app, preparer)).toThrow('preparer_dependency_inputs_differ')
      writeFileSync(join(preparer, 'package-lock.json'), 'app-lock')
      symlinkSync(join(process.cwd(), 'node_modules'), join(app, 'node_modules'))
      mkdirSync(join(preparer, 'node_modules'))
      writeFileSync(join(preparer, 'node_modules/foreign'), 'preserve')
      expect(() => actualProfile.bindPreparerDependencies(app, preparer)).toThrow('fresh_preparer_dependency_environment_required')
      expect(readFileSync(join(preparer, 'node_modules/foreign'), 'utf8')).toBe('preserve')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

type FixtureNetwork = { Id: string; Name: string; Created?: string; Labels: Record<string, string>; Containers: Record<string, unknown> }
function processRecord(pid: number) {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)!.split(' ')
    return { pid, state: fields[0], startTicks: fields[19], groupId: Number(fields[2]) }
  } catch { return null }
}
async function descendantControl(normalExit: boolean) {
  const root = mkdtempSync(join(tmpdir(), 't4-owned-descendant-'))
  const recordPath = join(root, 'descendant.json')
  let record: ReturnType<typeof processRecord> = null
  try {
    const grandchild = `const fs=require('node:fs');process.on('SIGTERM',()=>{});
      fs.writeFileSync(${JSON.stringify(recordPath)},JSON.stringify({pid:process.pid}));setInterval(()=>{},100);`
    const parent = `const {spawn}=require('node:child_process');const fs=require('node:fs');
      spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});
      const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(recordPath)})){
        clearInterval(timer);${normalExit ? 'process.exit(0)' : 'setInterval(()=>{},100)'} }},10);`
    let outcome = ''
    try { await ownedChild(process.execPath, ['-e', parent], {}, 600, join(root, 'child.log')) }
    catch (error) { outcome = (error as Error).message }
    const pid = JSON.parse(readFileSync(recordPath, 'utf8')).pid as number
    record = processRecord(pid)
    expect(record === null || ['Z', 'X'].includes(record.state)).toBe(true)
    expect(outcome).toBe(normalExit ? 'owned_child_background_descendants_terminal' : 'owned_child_timeout_terminal')
    const terminal = JSON.parse(readFileSync(join(root, 'child.log.process-terminal.json'), 'utf8'))
    expect(terminal.liveMembers).toEqual([])
    expect(terminal.allProcessesReaped).toBe(terminal.zombieMembers.length === 0)
    if (record?.state === 'Z') expect(terminal.zombieMembers.some((row: { pid: number }) => row.pid === record?.pid)).toBe(true)
  } finally {
    // Baseline RED intentionally exposes a live descendant. Clean ONLY the
    // actual fixture identity, never a recycled PID or any foreign process.
    if (record && !['Z', 'X'].includes(record.state)) {
      const current = processRecord(record.pid)
      if (current?.startTicks === record.startTicks && current.groupId === record.groupId) process.kill(record.pid, 'SIGKILL')
    }
    rmSync(root, { recursive: true, force: true })
  }
}
describe('review cleanup regressions: actual process groups and cleanup adapter', () => {
  it('keeps escalation after TERM exits the leader while its grandchild ignores TERM', async () => {
    await descendantControl(false)
  }, 15_000)
  it('does not accept normal leader exit with a background grandchild still running', async () => {
    await descendantControl(true)
  }, 15_000)
  it('preserves and reports a new unknown Docker network instead of verified cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 't4-network-cleanup-'))
    try {
      mkdirSync(join(root, 'receipts'))
      const baseline = '1'.repeat(64), owned = '2'.repeat(64), foreign = '3'.repeat(64)
      const { plan } = fixture()
      const actualPlan = { ...plan, home: root }
      const ownNetwork = { Id: owned, Name: 'supabase_network_gridex-ops-platform', Labels: {
        't4.owner': plan.owner, 't4.input-epoch': plan.inputEpoch }, Containers: {} }
      privateJson(join(root, 'receipts/initial-inventory.json'), { containers: [], volumes: [], networks: [baseline] })
      privateJson(join(root, 'receipts/network.intent.json'), { owner: plan.owner, inputEpoch: plan.inputEpoch,
        projectId: plan.projectId, name: ownNetwork.Name })
      privateJson(join(root, 'receipts/network.json'), ownNetwork)
      const networks = new Map<string, FixtureNetwork>([[baseline, { Id: baseline, Name: 'bridge', Labels: {}, Containers: {} }],
        [owned, ownNetwork], [foreign, { Id: foreign, Name: 'new-foreign-network', Labels: {}, Containers: {} }]])
      const deleted: string[] = []
      const backend = {
        inventory: () => ({ containers: [], volumes: [], networks: [...networks.keys()] }),
        dockerJson: (_plan: unknown, _kind: string, _action: string, id: string) => [networks.get(id)],
        docker: (_plan: unknown, kind: string, action: string, id: string) => {
          expect([kind, action]).toEqual(['network', 'rm']); deleted.push(id); networks.delete(id); return ''
        },
      }
      const result = await actualProfile.cleanupActual(actualPlan, {}, backend)
      expect(result.verified).toBe(false)
      expect(result.unknown).toContain(foreign)
      expect(deleted).toEqual([owned])
      expect(networks.has(baseline)).toBe(true)
      expect(networks.has(foreign)).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

async function cleanupNetworkControl(mode: 'copied' | 'late' | 'none') {
  const root = mkdtempSync(join(tmpdir(), 't4-network-custody-'))
  try {
    mkdirSync(join(root, 'receipts'))
    const baseline = 'a'.repeat(64), owned = 'b'.repeat(64), unknown = 'c'.repeat(64)
    const { plan } = fixture()
    const network = { Id: owned, Name: 'owned-network', Created: '2026-11-01T00:00:00Z',
      Labels: { 't4.owner': plan.owner, 't4.input-epoch': plan.inputEpoch }, Containers: {} }
    privateJson(join(root, 'receipts/initial-inventory.json'), { containers: [], volumes: [], networks: [baseline] })
    privateJson(join(root, 'receipts/network.intent.json'), { owner: plan.owner, inputEpoch: plan.inputEpoch,
      projectId: plan.projectId, name: network.Name })
    privateJson(join(root, 'receipts/network.json'), network)
    const networks = new Map<string, FixtureNetwork>([[baseline, { ...network, Id: baseline, Name: 'bridge' }]])
    if (mode === 'copied') networks.set(unknown, { ...network, Id: unknown })
    else networks.set(owned, network)
    const deleted: string[] = []
    const backend = {
      inventory: () => ({ containers: [], volumes: [], networks: [...networks.keys()] }),
      dockerJson: (_plan: unknown, _kind: string, _action: string, id: string) => [networks.get(id)],
      docker: (_plan: unknown, kind: string, action: string, id: string) => {
        expect([kind, action]).toEqual(['network', 'rm'])
        deleted.push(id); networks.delete(id)
        if (mode === 'late') networks.set(unknown, { ...network, Id: unknown, Name: 'late-foreign' })
        return ''
      },
    }
    const result = await actualProfile.cleanupActual({ ...plan, home: root }, {}, backend)
    return { result, deleted, baselinePresent: networks.has(baseline), unknownPresent: networks.has(unknown), unknown }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
describe('exact network ID custody and complete cleanup observations', () => {
  it('preserves an unknown replacement that copied the original labels and name', async () => {
    const observed = await cleanupNetworkControl('copied')
    expect(observed.result.verified).toBe(false)
    expect(observed.result.unknown).toContain(observed.unknown)
    expect(observed.deleted).toEqual([])
    expect(observed.unknownPresent).toBe(true)
    expect(observed.baselinePresent).toBe(true)
  })
  it('reports an unknown birth first observed after owned network deletion', async () => {
    const observed = await cleanupNetworkControl('late')
    expect(observed.result.verified).toBe(false)
    expect(observed.result.unknown).toContain(observed.unknown)
    expect(observed.deleted).toEqual(['b'.repeat(64)])
    expect(observed.unknownPresent).toBe(true)
    expect(observed.baselinePresent).toBe(true)
  })
  it('can verify exact owned cleanup while preserving unchanged baseline networks', async () => {
    const observed = await cleanupNetworkControl('none')
    expect(observed.result).toEqual({ verified: true, foreignDeleted: 0, unknown: [] })
    expect(observed.deleted).toEqual(['b'.repeat(64)])
    expect(observed.baselinePresent).toBe(true)
  })
})

describe('owned process signaling boundary', () => {
  it('leaves a distinct fixture session alive while terminating its owned command group', async () => {
    const root = mkdtempSync(join(tmpdir(), 't4-distinct-session-'))
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], { detached: true, stdio: 'ignore' })
    const closed = new Promise<void>((done) => sentinel.once('close', () => done()))
    let record: ReturnType<typeof processRecord> = null
    try {
      await new Promise<void>((done, reject) => { sentinel.once('spawn', done); sentinel.once('error', reject) })
      record = processRecord(sentinel.pid!)
      expect(record).not.toBeNull()
      await expect(ownedChild(process.execPath, ['-e', 'setInterval(()=>{},100)'], {}, 80,
        join(root, 'owned.log'))).rejects.toThrow('owned_child_timeout_terminal')
      const current = processRecord(sentinel.pid!)
      expect(current?.startTicks).toBe(record?.startTicks)
      expect(current && !['Z', 'X'].includes(current.state)).toBe(true)
    } finally {
      if (record) {
        const current = processRecord(record.pid)
        if (current?.startTicks === record.startTicks && current.groupId === record.groupId) process.kill(record.pid, 'SIGKILL')
      }
      await closed
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('app teardown uses the same complete owned group boundary', () => {
  it('does not verify cleanup while a Next-like owned descendant survives app leader TERM', async () => {
    const root = mkdtempSync(join(tmpdir(), 't4-app-group-'))
    const pidPath = join(root, 'grandchild.json')
    const script = `const fs=require('node:fs');process.on('SIGTERM',()=>{});
      fs.writeFileSync(${JSON.stringify(pidPath)},JSON.stringify({pid:process.pid}));setInterval(()=>{},100)`
    const parent = spawn(process.execPath, ['-e', `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(script)}],{stdio:'ignore'});setInterval(()=>{},100)`],
      { detached: true, stdio: 'ignore' })
    const closed = new Promise<void>((done) => parent.once('close', () => done()))
    let descendant: ReturnType<typeof processRecord> = null
    let leader: ReturnType<typeof processRecord> = null
    try {
      await new Promise<void>((done, reject) => { parent.once('spawn', done); parent.once('error', reject) })
      leader = processRecord(parent.pid!)
      expect(leader).not.toBeNull()
      const deadline = Date.now() + 2000
      while (!existsSync(pidPath) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10))
      descendant = processRecord(JSON.parse(readFileSync(pidPath, 'utf8')).pid)
      mkdirSync(join(root, 'receipts'))
      privateJson(join(root, 'receipts/initial-inventory.json'), { containers: [], networks: [], volumes: [] })
      privateJson(join(root, 'receipts/app-process.json'), { ...leader, cwd: realpathSync(`/proc/${parent.pid}/cwd`),
        environmentSha256: digest(readFileSync(`/proc/${parent.pid}/environ`)) })
      const { plan } = fixture()
      const backend = { inventory: () => ({ containers: [], networks: [], volumes: [] }),
        dockerJson: () => { throw new Error('no Docker inspection expected') }, docker: () => { throw new Error('no Docker mutation expected') } }
      const result = await actualProfile.cleanupActual({ ...plan, home: root }, {}, backend)
      expect(result.verified).toBe(true)
      const current = processRecord(descendant!.pid)
      expect(!current || ['Z', 'X'].includes(current.state)).toBe(true)
    } finally {
      for (const original of [leader, descendant]) {
        if (!original) continue
        const current = processRecord(original.pid)
        if (current?.startTicks === original.startTicks && current.groupId === original.groupId && !['Z', 'X'].includes(current.state)) {
          process.kill(original.pid, 'SIGKILL')
        }
      }
      await closed
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})

describe('host-first read-only hosted probe and explicit bootstrap-only successor', () => {
  it('has a same-repo PR probe with no secrets, installs, images or backend commands', () => {
    const workflow = parse(readFileSync(join(process.cwd(), '.github/workflows/t4-atomic-native.yml'), 'utf8'))
    expect(workflow.on).toHaveProperty('pull_request')
    const probe = workflow.jobs['host-probe']
    expect(probe).toBeDefined()
    expect(probe.if).toContain('github.event.pull_request.head.repo.full_name == github.repository')
    const serialized = JSON.stringify(probe)
    expect(serialized).not.toContain('secrets.')
    expect(serialized).not.toMatch(/npm ci|docker pull|supabase start|apt-get/)
    expect(serialized).toContain('host-probe')
  })
  it('measures the real selected local endpoint and cgroup limit without mutating Docker', async () => {
    const calls: string[] = []
    const fs = new Map([
      ['/proc/sys/kernel/random/boot_id', 'actual-test-boot'], ['/proc/meminfo', 'MemTotal: 16777216 kB'],
      ['/proc/self/cgroup', '0::/owned/test'], ['/sys/fs/cgroup/memory.max', String(12 * 2 ** 30)],
      ['/sys/fs/cgroup/cpu.max', '400000 100000'],
      ['/sys/fs/cgroup/owned/test/memory.max', String(4 * 2 ** 30)], ['/sys/fs/cgroup/owned/memory.max', 'max'],
    ])
    const reader = (actualProfile as unknown as { observeHostReadOnly(io: unknown): unknown }).observeHostReadOnly
    const result = await reader({ env: { DOCKER_CONTEXT: 'actual-local', DOCKER_HOST: 'tcp://unselected-remote:2375' },
      command: (program: string, argv: string[]) => {
        const command = `${program} ${argv.join(' ')}`; calls.push(command)
        if (command.includes('context show')) return 'actual-local'
        if (command.includes('context inspect')) return JSON.stringify([{ Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }])
        if (command.includes(' info ')) return JSON.stringify({ ID: 'daemon', Driver: 'overlay2', DockerRootDir: '/docker' })
        if (command.includes('network ls')) return 'baseline-network'
        return ''
      }, read: (path: string) => { if (!fs.has(path)) throw Object.assign(new Error(), { code: 'ENOENT' }); return fs.get(path) },
      realpath: (path: string) => path === '/var/run/docker.sock' ? '/run/docker.sock' : path,
      socket: () => ({ dev: 1, ino: 2, isSocket: () => true }),
      disk: () => ({ bavail: 30, bsize: 2 ** 30 }), cpus: () => 4 }) as { effectiveRamBytes: number; socketPath: string }
    expect(result.effectiveRamBytes).toBe(4 * 2 ** 30)
    expect(result.socketPath).toBe('/run/docker.sock')
    expect(calls.every((command) => !/docker (?:create|pull|start|stop|rm|run|prune)\b|docker context create|docker image (?:pull|rm|tag)/.test(command))).toBe(true)
  })
  it('supports manual bootstrap-only without requiring a business cohort or enabling native', async () => {
    const runner = (actualProfile as unknown as { runBootstrapOnly(plan: unknown, state: unknown, io: unknown): Promise<unknown> }).runBootstrapOnly
    const order: string[] = []
    const io = {
      qualify: async () => { order.push('qualify-host-source-assignment') },
      tools: async () => { order.push('bounded-tools') },
      replay: async () => { order.push('canonical-replay'); return { actualResources: true, replay: { canonical: true, sourceRestored: true } } },
      cleanup: async () => { order.push('exact-cleanup'); return { verified: true, foreignDeleted: 0, unknown: [] } },
      exportEncrypted: async () => { order.push('encrypted-evidence') },
    }
    const result = await runner({ format: 't4_atomic_bootstrap_only_v1', mode: 'bootstrap-only' }, {}, io)
    expect(order).toEqual(['qualify-host-source-assignment', 'bounded-tools', 'canonical-replay', 'exact-cleanup', 'encrypted-evidence'])
    expect(result).toMatchObject({ nativeExecuted: false, businessExecuted: false, qualification: 'BOOTSTRAP_ONLY_REQUIRES_OUTPUT_REVIEW' })
  })
  it('qualifies the term host before private secrets and every existing install step', () => {
    const workflow = parse(readFileSync(join(process.cwd(), '.github/workflows/t4-atomic-native.yml'), 'utf8'))
    expect(workflow.on.workflow_dispatch).toBeDefined()
    const steps = workflow.jobs['atomic-native'].steps
    const probe = steps.findIndex((step) => step.name === 'Observe actual term host before private inputs or setup')
    const privateInput = steps.findIndex((step) => step.name === 'Require privately authenticated input before backend mutations')
    const setup = steps.findIndex((step) => step.name === 'Install exact public tool archives on this disposable host')
    expect(probe).toBeGreaterThan(0)
    expect(probe).toBeLessThan(privateInput)
    expect(probe).toBeLessThan(setup)
    expect(steps.findIndex((step) => step.name === 'Qualify actual bootstrap assignment before installation')).toBeLessThan(setup)
  })
})

import { sign } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
const canonicalSigned = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonicalSigned).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalSigned(item)}`).join(',')}}`
    : JSON.stringify(value)
describe('real cryptographic two-way bootstrap assignment transport; no ROOT private key', () => {
  const root = generateKeyPairSync('rsa', { modulusLength: 3072 })
  const runner = generateKeyPairSync('rsa', { modulusLength: 3072 })
  const rootPem = root.publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const runnerPem = runner.publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const privatePem = runner.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const proof = { purpose: 'bootstrap-term-host', inputPublicKey: runnerPem, proofSha256: 'a'.repeat(64), nonce: 'b'.repeat(64),
    runId: '123', runAttempt: '1', job: 'atomic-native', head: 'c'.repeat(40), tree: 'd'.repeat(40),
    host: { bootId: 'actual-fixture-boot' }, observedAtUtc: '2026-11-01T18:00:00Z' }
  const now = Date.parse('2026-11-01T18:10:00Z')
  function envelope(overrides: Record<string, unknown> = {}, padding = '') {
    const expiresAt = '2026-11-01T19:00:00Z'
    const payload = { format: 't4_signed_bootstrap_assignment_v1', proofSha256: proof.proofSha256, nonce: proof.nonce,
      runId: proof.runId, runAttempt: proof.runAttempt, job: proof.job, sourceHead: proof.head, sourceTree: proof.tree,
      bootId: proof.host.bootId, recipientSha256: digest(runnerPem), expiresAt, budget: { business: 0, native: 0 },
      plan: { format: 't4_atomic_bootstrap_only_v1', mode: 'bootstrap-only', expiresAt, padding },
      files: { 'code-attempt.json': 'e30=', 'bootstrap-attempt.json': 'e30=' }, ...overrides }
    const signature = sign('sha256', Buffer.from(canonicalSigned(payload)),
      { key: root.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64')
    return encryptEvidence(Buffer.from(JSON.stringify({ payload, signature })), runnerPem, digest(runnerPem))
  }
  function open(value: ReturnType<typeof envelope>, scope = proof) {
    return actualProfile.decryptBootstrapAssignment(value, privatePem, scope, now, rootPem, digest(rootPem))
  }
  it('authenticates an actual ROOT-like PSS signature and the one live runner encryption key', () => {
    expect(open(envelope()).plan).toMatchObject({ mode: 'bootstrap-only' })
  })
  it('rejects wrong decryption/signing keys and ciphertext tampering', () => {
    const value = envelope()
    expect(() => actualProfile.decryptBootstrapAssignment(value,
      root.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), proof, now, rootPem, digest(rootPem))).toThrow()
    expect(() => actualProfile.decryptBootstrapAssignment(value, privatePem, proof, now, runnerPem, digest(runnerPem))).toThrow('actual_root_assignment_signature_required')
    const corrupted = Buffer.from(value.ciphertext, 'base64'); corrupted[0] ^= 1
    expect(() => open({ ...value, ciphertext: corrupted.toString('base64') })).toThrow()
  })
  it.each(['nonce', 'proofSha256', 'runId', 'runAttempt', 'job', 'head', 'tree'] as const)('rejects %s replay or source drift', (field) => {
    expect(() => open(envelope(), { ...proof, [field]: 'foreign' })).toThrow('fresh_host_assignment_binding_required')
  })
  it('rejects boot drift, expiry, business/native budget, ended preview and malformed input', () => {
    expect(() => open(envelope(), { ...proof, host: { bootId: 'foreign' } })).toThrow()
    expect(() => open(envelope({ expiresAt: '2026-11-01T18:01:00Z' }))).toThrow('bootstrap_assignment_expired_or_unbounded')
    expect(() => open(envelope({ budget: { business: 1, native: 0 } }))).toThrow()
    expect(() => open(envelope(), { ...proof, purpose: 'pull-request-preview' })).toThrow()
    expect(() => open({ ...envelope(), wrappedKey: 'malformed' })).toThrow()
  })
  it('keeps carrier under the comment bound and rejects4KiB truncation, duplicates and foreign frames', () => {
    const value = envelope({}, 'sized-private-plan'.repeat(500))
    const body = JSON.stringify({ kind: 't4-bootstrap-assignment-envelope-v1', runId: proof.runId,
      proofSha256: proof.proofSha256, recipientSha256: digest(runnerPem), envelope: value })
    expect(Buffer.byteLength(body)).toBeLessThan(60_000)
    expect(body.length).toBeGreaterThan(4096)
    expect(actualProfile.selectBootstrapCarrier([{ body }], proof)).toEqual(value)
    expect(() => actualProfile.selectBootstrapCarrier([{ body: body.slice(0, 4096) }], proof)).toThrow('bootstrap_assignment_carrier_malformed')
    expect(() => actualProfile.selectBootstrapCarrier([{ body }, { body }], proof)).toThrow('bootstrap_assignment_carrier_ambiguous')
    expect(actualProfile.selectBootstrapCarrier([{ body: body.replace('"runId":"123"', '"runId":"456"') }], proof)).toBeNull()
    expect(() => actualProfile.selectBootstrapCarrier([{ body: body + ' '.repeat(60_000) }], proof)).toThrow()
  })
  it('fails on actual carrier-read/auth errors without inventing an assignment', async () => {
    const get = vi.fn(async () => { throw new Error('authenticated_github_read_required') })
    await expect(actualProfile.readBootstrapCarrier(proof, get)).rejects.toThrow('authenticated_github_read_required')
    expect(get).toHaveBeenCalledTimes(1)
  })
  it('never exports the ephemeral input private key, even inside encrypted checkpoints', () => {
    const home = mkdtempSync(join(tmpdir(), 't4-key-export-boundary-'))
    try {
      mkdirSync(join(home, 'export'), { mode: 0o700 })
      writeFileSync(join(home, 'recipient.pem'), rootPem, { mode: 0o600 })
      writeFileSync(join(home, 'ephemeral-input-key.private.pem'), 'NEVER_EXPORT_EPHEMERAL_PRIVATE_KEY', { mode: 0o600 })
      actualProfile.exportActual({ home, evidenceRecipientPath: join(home, 'recipient.pem'), evidenceRecipientSha256: digest(rootPem) }, {})
      const exported = JSON.parse(readFileSync(join(home, 'export', readdirSync(join(home, 'export'))[0]), 'utf8'))
      const key = privateDecrypt({ key: root.privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(exported.wrappedKey, 'base64'))
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(exported.nonce, 'base64'))
      decipher.setAuthTag(Buffer.from(exported.tag, 'base64'))
      const plaintext = gunzipSync(Buffer.concat([decipher.update(Buffer.from(exported.ciphertext, 'base64')), decipher.final()])).toString()
      expect(plaintext).not.toContain('ephemeral-input-key.private.pem')
      expect(plaintext).not.toContain('NEVER_EXPORT_EPHEMERAL_PRIVATE_KEY')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})

describe('complete authenticated bootstrap carrier snapshot', () => {
  const scope = { runId: 'run', proofSha256: 'p', inputPublicKey: 'public' }
  const match = JSON.stringify({ kind: 't4-bootstrap-assignment-envelope-v1', runId: scope.runId,
    proofSha256: scope.proofSha256, recipientSha256: digest(scope.inputPublicKey), envelope: { actual: 'ciphertext' } })
  function api(rows: Array<{ id: number; body: string }>, alter?: (route: string, result: unknown) => unknown) {
    return vi.fn(async (route: string) => {
      const page = Number(new URL(`https://test/${route}`).searchParams.get('page'))
      const result = route === 'issues/930' ? { comments: rows.length } : rows.slice((page - 1) * 100, page * 100)
      return alter ? alter(route, result) : result
    })
  }
  const budget = async () => ({ remaining: 1000, limit: 1000, reset: Math.floor(Date.now() / 1000) + 3600 })
  it('rejects the actual301-comment duplicate on pages1and4', async () => {
    const rows = Array.from({ length: 301 }, (_, index) => ({ id: index + 1, body: index === 0 || index === 300 ? match : '{}' }))
    await expect(actualProfile.readBootstrapCarrier(scope, api(rows), budget)).rejects.toThrow('bootstrap_assignment_carrier_ambiguous')
  })
  it('does not accept a short page hidden behind the advertised total', async () => {
    const rows = Array.from({ length: 301 }, (_, index) => ({ id: index + 1, body: index === 300 ? match : '{}' }))
    const get = api(rows, (route, result) => route.endsWith('page=2') ? (result as unknown[]).slice(0, 50) : result)
    await expect(actualProfile.readBootstrapCarrier(scope, get, budget)).rejects.toThrow()
  })
  it('rejects count drift, duplicate IDs and missing available API budget', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ id: index + 1, body: index === 100 ? match : '{}' }))
    let counts = 0
    await expect(actualProfile.readBootstrapCarrier(scope, api(rows, (route, result) => route === 'issues/930' && ++counts > 1
      ? { comments: 102 } : result), budget)).rejects.toThrow()
    await expect(actualProfile.readBootstrapCarrier(scope, api([{ id: 1, body: '{}' }, { id: 1, body: match }]), budget)).rejects.toThrow()
    await expect(actualProfile.readBootstrapCarrier(scope, api(rows), async () => ({ remaining: 0, limit: 1000, reset: 1 }))).rejects.toThrow()
  })
  it('accepts one carrier only after two complete stable scans and rejects capped input', async () => {
    const rows = Array.from({ length: 301 }, (_, index) => ({ id: index + 1, body: index === 300 ? match : '{}' }))
    const get = api(rows)
    await expect(actualProfile.readBootstrapCarrier(scope, get, budget)).resolves.toEqual({ actual: 'ciphertext' })
    expect(get.mock.calls.filter(([route]) => route.includes('comments?'))).toHaveLength(8)
    const tooMany = vi.fn(async () => ({ comments: 1001 }))
    await expect(actualProfile.readBootstrapCarrier(scope, tooMany, budget)).rejects.toThrow()
    expect(tooMany).toHaveBeenCalledTimes(1)
  })
})

type ImageRow = { Id: string; RepoTags: string[]; RepoDigests: string[] }
function imageCleanupFixture(initial: ImageRow[] = []) {
  const home = mkdtempSync(join(tmpdir(), 't4-complete-image-cleanup-'))
  mkdirSync(join(home, 'receipts'))
  const pins = actualProfile.BOOTSTRAP_IMAGES
  const reference = (pin: typeof pins[number]) => `${pin.tag.slice(0, pin.tag.lastIndexOf(':'))}@${pin.manifest}`
  const current = new Map<string, ImageRow>(initial.map((row) => [row.Id, structuredClone(row)]))
  for (const pin of pins) {
    const row = current.get(pin.config) ?? { Id: pin.config, RepoTags: [], RepoDigests: [] }
    row.RepoTags = [...new Set([...row.RepoTags, pin.tag])]
    row.RepoDigests = [...new Set([...row.RepoDigests, reference(pin)])]
    current.set(row.Id, row)
  }
  privateJson(join(home, 'receipts/images.intent.json'), { initial, expected: pins })
  privateJson(join(home, 'receipts/images-pinned.json'), { inventory: pins, initialImageIds: initial.map((row) => row.Id) })
  const deleted: string[] = []
  let listReads = 0
  let beforeList: (() => void) | undefined
  let afterDelete: (() => void) | undefined
  let prunableParent: string | undefined
  const backend = {
    docker: (_plan: unknown, ...args: string[]) => {
      if (args[1] === 'ls') { listReads++; beforeList?.(); return [...current.keys()].join('\n') }
      expect(args.slice(0, 2)).toEqual(['image', 'rm'])
      const ref = args.at(-1)!, row = [...current.values()].find((item) => item.RepoTags.includes(ref) || item.RepoDigests.includes(ref))
      if (!row) throw new Error('missing-image-ref')
      deleted.push(ref)
      if (prunableParent && !args.includes('--no-prune')) current.delete(prunableParent)
      row.RepoTags = row.RepoTags.filter((tag) => tag !== ref); row.RepoDigests = row.RepoDigests.filter((digest) => digest !== ref)
      if (!row.RepoTags.length && !row.RepoDigests.length) current.delete(row.Id)
      afterDelete?.()
      return ''
    },
    dockerJson: (_plan: unknown, ...args: string[]) => args.slice(2).map((ref) => {
      const row = current.get(ref) ?? [...current.values()].find((item) => item.RepoTags.includes(ref) || item.RepoDigests.includes(ref))
      if (!row) throw new Error('missing-image-inspect')
      return structuredClone(row)
    }),
  }
  return { home, pins, current, deleted, backend, reference,
    get listReads() { return listReads }, setBeforeList: (fn: () => void) => { beforeList = fn },
    setAfterDelete: (fn: () => void) => { afterDelete = fn }, setPrunableParent: (id: string) => { prunableParent = id }, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}
describe('complete immutable image inventory cleanup', () => {
  it('does not return verified cleanup with an unknown eighth config', () => {
    const f = imageCleanupFixture()
    try {
      f.current.set(`sha256:${'f'.repeat(64)}`, { Id: `sha256:${'f'.repeat(64)}`, RepoTags: ['foreign:latest'], RepoDigests: [] })
      expect(() => actualProfile.cleanupBootstrapImages({ home: f.home }, f.backend)).toThrow()
      expect(f.current.has(`sha256:${'f'.repeat(64)}`)).toBe(true)
      expect(f.deleted).not.toContain('foreign:latest')
    } finally { f.cleanup() }
  })
  it('preserves a baseline expected config that was originally dangling', () => {
    const pin = actualProfile.BOOTSTRAP_IMAGES[0]
    const f = imageCleanupFixture([{ Id: pin.config, RepoTags: [], RepoDigests: [] }])
    try {
      expect(() => actualProfile.cleanupBootstrapImages({ home: f.home }, f.backend)).toThrow()
      expect(f.current.has(pin.config)).toBe(true)
      expect(f.deleted).toEqual([])
    } finally { f.cleanup() }
  })
  it('detects late births and a final read error instead of returning verified', () => {
    for (const mode of ['late', 'read-error']) {
      const f = imageCleanupFixture()
      try {
        f.setAfterDelete(() => {
          if (mode === 'late') f.current.set(`sha256:${'e'.repeat(64)}`, { Id: `sha256:${'e'.repeat(64)}`, RepoTags: ['late:foreign'], RepoDigests: [] })
          else if (f.current.size === 0) f.setBeforeList(() => { throw new Error('actual-final-read-failed') })
        })
        expect(() => actualProfile.cleanupBootstrapImages({ home: f.home }, f.backend)).toThrow()
        expect(f.deleted).not.toContain('late:foreign')
      } finally { f.cleanup() }
    }
  })
  it('returns only after exact seven-pin cleanup and unchanged baseline preservation', () => {
    const baseline = { Id: `sha256:${'d'.repeat(64)}`, RepoTags: ['baseline:keep'], RepoDigests: [] }
    const f = imageCleanupFixture([baseline])
    try {
      actualProfile.cleanupBootstrapImages({ home: f.home }, f.backend)
      expect([...f.current.values()]).toEqual([baseline])
      expect(f.listReads).toBeGreaterThan(2)
      expect(JSON.parse(readFileSync(join(f.home, 'receipts/image-cleanup.json'), 'utf8')).verified).toBe(true)
    } finally { f.cleanup() }
  })
})

describe('quota URL and bounded polling use the actual Actions allowance', () => {
  it('reads authenticated GLOBAL rate_limit, never the repository-prefixed endpoint', async () => {
    vi.stubEnv('GH_TOKEN', 'synthetic-budget-test-token')
    const urls: string[] = []
    try {
      const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
        urls.push(String(url))
        expect(Object.hasOwn(options?.headers ?? {}, 'Authorization')).toBe(true)
        return new Response(JSON.stringify({ resources: { core: { remaining: 91, limit: 1000,
          reset: Math.floor(Date.now() / 1000) + 3600 } } }), { status: 200 })
      })
      expect((await actualProfile.readGithubCoreBudget(fetcher)).remaining).toBe(91)
      expect(urls).toEqual(['https://api.github.com/rate_limit'])
      await expect(actualProfile.readGithubCoreBudget(async () => new Response('', { status: 403 }))).rejects.toThrow('assignment_api_budget_read_failed')
    } finally { vi.unstubAllEnvs() }
  })
  it('limits full-board polling and slows it further for an actual small remaining allowance', () => {
    const full = actualProfile.bootstrapCarrierPollDelay(20 * 60_000, { remainingAfter: 988, requestCost: 12 })
    const tight = actualProfile.bootstrapCarrierPollDelay(20 * 60_000, { remainingAfter: 88, requestCost: 12 })
    expect(full).toBeGreaterThanOrEqual(45_000)
    expect(Math.ceil(20 * 60_000 / full) * 12).toBeLessThan(400)
    expect(tight).toBeGreaterThan(full)
    expect(() => actualProfile.bootstrapCarrierPollDelay(1000, { remainingAfter: 64, requestCost: 12 })).toThrow()
  })
})

describe('stable snapshot and exact image reference negative controls', () => {
  it('rejects same-count body edits between the two complete scans', async () => {
    const scope = { runId: 'run', proofSha256: 'proof', inputPublicKey: 'key' }
    let pages = 0
    const get = async (route: string) => route === 'issues/930' ? { comments: 1 }
      : [{ id: 1, body: ++pages === 1 ? '{}' : '{"changed":true}' }]
    await expect(actualProfile.readBootstrapCarrier(scope, get, async () => ({ remaining: 1000, limit: 1000,
      reset: Math.floor(Date.now() / 1000) + 3600 }))).rejects.toThrow('assignment_snapshot_content_drift')
  })
  it('holds before deletion on partial pins and preserves late foreign reference drift', () => {
    for (const mode of ['partial', 'ref-drift']) {
      const f = imageCleanupFixture()
      try {
        if (mode === 'partial') f.current.delete(f.pins[0].config)
        else f.setAfterDelete(() => {
          const row = f.current.get(f.pins[1].config)
          if (row && !row.RepoTags.includes('foreign:alias')) row.RepoTags.push('foreign:alias')
        })
        expect(() => actualProfile.cleanupBootstrapImages({ home: f.home }, f.backend)).toThrow()
        if (mode === 'partial') expect(f.deleted).toEqual([])
        else expect(f.current.get(f.pins[1].config)?.RepoTags).toContain('foreign:alias')
        expect(f.deleted).not.toContain('foreign:alias')
        expect(JSON.parse(readFileSync(join(f.home, 'receipts/image-cleanup-incomplete.json'), 'utf8')).verified).toBe(false)
      } finally { f.cleanup() }
    }
  })
  it('retains a preexisting tagged expected config and removes only introduced references', () => {
    const baseline = { Id: actualProfile.BOOTSTRAP_IMAGES[0].config, RepoTags: ['baseline:keep-same-config'], RepoDigests: [] }
    const f = imageCleanupFixture([baseline])
    try {
      actualProfile.cleanupBootstrapImages({ home: f.home }, f.backend)
      expect([...f.current.values()]).toEqual([baseline])
      expect(f.deleted).not.toContain('baseline:keep-same-config')
    } finally { f.cleanup() }
  })
})

describe('Docker default parent-pruning preservation', () => {
  it('retains an immutable dangling baseline parent BEFORE destructive image deletion', () => {
    const baseline = { Id: `sha256:${'9'.repeat(64)}`, RepoTags: [], RepoDigests: [] }
    const f = imageCleanupFixture([baseline])
    try {
      // Official DockerCLI source: PruneChildren: !opts.noPrune. This adapter
      // models that actual deletion option; a late HOLD cannot restore parentID.
      f.setPrunableParent(baseline.Id)
      expect(() => actualProfile.cleanupBootstrapImages({ home: f.home }, f.backend)).not.toThrow()
      expect(f.current.get(baseline.Id)).toEqual(baseline)
    } finally { f.cleanup() }
  })
})
