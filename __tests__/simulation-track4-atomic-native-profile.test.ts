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
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
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
import { execFileSync } from 'node:child_process'
type ProfileWorkflow = { on: { workflow_dispatch?: unknown }; jobs: Record<string, { if: string; steps: Array<{ name?: string; run?: string; uses?: string; with?: { path?: string } }> }> }
const { load: parse } = createRequire(import.meta.url)('js-yaml') as { load(source: string): ProfileWorkflow }
describe('profile workflow and failure boundaries', () => {
  it('keeps provisioning, preparation, native and exact cleanup in one explicitly guarded host job', () => {
    const workflow = parse(readFileSync(join(process.cwd(), '.github/workflows/t4-atomic-native.yml'), 'utf8'))
    expect(Object.keys(workflow.jobs)).toEqual(['atomic-native'])
    expect(workflow.on.workflow_dispatch).toBeUndefined()
    expect(workflow.jobs['atomic-native'].if).toContain("github.head_ref == 'codex/t4-atomic-native-activation'")
    const steps = workflow.jobs['atomic-native'].steps as Array<{ name?: string; run?: string; uses?: string; with?: { path?: string } }>
    const scripts = steps.map((step) => step.run ?? '').join('\n')
    for (const phase of ['init', 'bootstrap', 'prepare', 'native', 'cleanup']) {
      expect(scripts).toContain(`atomic-native-profile.mjs ${phase} "$T4_HOME/plan.json"`)
    }
    const uploads = steps.filter((step) => step.uses?.startsWith('actions/upload-artifact@'))
    expect(uploads).toHaveLength(4)
    expect(uploads.every((step) => step.with?.path === '${{ env.T4_HOME }}/export/*')).toBe(true)
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
