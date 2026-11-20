import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Finite source-contract fixtures, never a runtime allocation or native proof.
const script = path.resolve(__dirname, '../scripts/simulation/track5/bootstrap.py')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const portKeys = ['API', 'DB', 'SHADOW', 'POOLER', 'STUDIO', 'MAIL_HTTP', 'SMTP', 'APP', 'COUNTERPART', 'RECEIVER_TLS', 'RECEIVER_CTRL']
function fixture() {
  const assignment = { schema: 'gridex-simulation-runtime-assignment-v1', worker: 'T5', state: 'ACTIVE', environmentId: 'finite-source-fixture',
    expiresAt: '2026-11-01T19:00:00Z', allowedOperations: ['up', 'run', 'down'], sourceCommit: 'a'.repeat(40), runDir: '/finite/app', simHome: '/finite/home', projectId: 'finite-t5',
    ports: Object.fromEntries(portKeys.map((key, i) => [`SIM_${key}_PORT`, 20000 + i])), receiver: { ip: '93.184.216.34', hosts: ['receiver.t5.sim.invalid'], networkTag: 'gridex-sim-t5-finite' } }
  const evidence = { schema: 'gridex-t5-bootstrap-observations-v1', environmentId: assignment.environmentId, assignmentSha256: digest(JSON.stringify(assignment)),
    observedAt: '2026-11-01T17:00:00Z', expiresAt: assignment.expiresAt, source: { appCommit: assignment.sourceCommit, appTree: '9'.repeat(40), harnessSha256: 'b'.repeat(64), workflowSha256: 'c'.repeat(64), clean: true },
    tools: { node: '22.23.4', npm: '10.9.2', supabase: '2.101.0', postgres: '17.11', python: '3.12.14' },
    host: { effectiveRamBytes: 8 * 2 ** 30, cpuCount: 4, cpuQuota: 400000 as number | string, cpuPeriod: 100000 as number | null, dockerDriver: 'overlay2', dockerRootDir: '/finite/docker', dockerFreeBytes: 15 * 2 ** 30,
      dockerDaemonId: 'finite-daemon', dockerSocketDevice: 1, dockerSocketInode: 2, networkNamespace: 'net:[1234]' },
    network: { mode: 'PREPARED_EXTERNALLY', preparer: 'finite-independent-producer', networkNamespace: 'net:[1234]', receiver: { ...assignment.receiver, tlsPort: 20009, controlPort: 20010 },
      dnsAnswers: { 'receiver.t5.sim.invalid': ['93.184.216.34'] }, tlsVerifiedHosts: ['receiver.t5.sim.invalid'], tlsVerificationEnabled: true,
      isolatedRouteSha256: 'd'.repeat(64), dnsObservationSha256: 'e'.repeat(64), tlsObservationSha256: 'f'.repeat(64), externalDeliveryBlocked: true },
    lifecycle: { producer: 'finite-runtime-producer', inputEpoch: 'finite-epoch', remainingRuns: 1, cleanupOwner: 'finite-runtime-producer',
      cleanupScopes: ['processes', 'descendants', 'containers', 'volumes', 'networks', 'receiver-routing', 'private-files'],
      backendIdentitySha256: '1'.repeat(64), replayReceiptSha256: '2'.repeat(64), buildReceiptSha256: '3'.repeat(64), genReceiptSha256: '4'.repeat(64), ownershipReceiptSha256: '5'.repeat(64) } }
  return { assignment, evidence }
}
function check(input: ReturnType<typeof fixture>) {
  const result = spawnSync('python3', ['-B', '-I', '-c', `import importlib.util,json,sys,datetime
s=importlib.util.spec_from_file_location('bootstrap',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
x=json.loads(sys.argv[2])
try:
 print(json.dumps(m.validate(json.dumps(x['assignment'],separators=(',',':')).encode(),x['evidence'],datetime.datetime(2026,11,1,18,tzinfo=datetime.timezone.utc))))
except (ValueError,KeyError,TypeError) as e:
 print(str(e));sys.exit(1)`, script, JSON.stringify(input)], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
  return { code: result.status, output: result.stdout, stderr: result.stderr }
}
describe('T5 bootstrap source contract, supplied observations only', () => {
  it('checks a complete finite contract without admitting a runtime', () => {
    const result = check(fixture()); expect(result.stderr).toBe(''); expect(result.code).toBe(0)
    expect(JSON.parse(result.output)).toEqual({ state: 'CONTRACT_CHECKED_NOT_RUNTIME_ADMITTED', nativeQualified: false, wholeScenarioPASS: 0 })
  })
  const rejects: Array<[string, (x: ReturnType<typeof fixture>) => void]> = [
    ['assignment_hash', x => { x.evidence.assignmentSha256 = '0'.repeat(64) }],
    ['ports', x => { x.assignment.ports.SIM_DB_PORT = x.assignment.ports.SIM_API_PORT }],
    ['ports', x => { delete x.assignment.ports.SIM_SMTP_PORT }],
    ['source', x => { x.evidence.source.appCommit = '0'.repeat(40) }],
    ['source', x => { x.evidence.source.clean = false }],
    ['toolchain', x => { x.evidence.tools.node = '24.19.0' }],
    ['toolchain', x => { x.evidence.tools.supabase = '2.100.0' }],
    ['toolchain', x => { x.evidence.tools.postgres = '16.1' }],
    ['toolchain', x => { x.evidence.tools.python = '3.10.14' }],
    ['toolchain', x => { x.evidence.tools.npm = '11.0.0' }],
    ['ram', x => { x.evidence.host.effectiveRamBytes-- }],
    ['docker_driver', x => { x.evidence.host.dockerDriver = 'unknown' }],
    ['docker_capacity', x => { x.evidence.host.dockerFreeBytes-- }],
    ['docker_identity', x => { x.evidence.host.dockerDaemonId = '' }],
    ['namespace', x => { x.evidence.network.networkNamespace = 'net:[999]' }],
    ['receiver_binding', x => { x.evidence.network.receiver.tlsPort++ }],
    ['dns', x => { x.evidence.network.dnsAnswers['receiver.t5.sim.invalid'].push('127.0.0.1') }],
    ['tls', x => { x.evidence.network.tlsVerificationEnabled = false }],
    ['route', x => { x.evidence.network.externalDeliveryBlocked = false }],
    ['network_evidence', x => { x.evidence.network.isolatedRouteSha256 = '' }],
    ['cleanup', x => { x.evidence.lifecycle.cleanupScopes.pop() }],
    ['budget', x => { x.evidence.lifecycle.remainingRuns = 0 }],
    ['lifecycle_evidence', x => { x.evidence.lifecycle.buildReceiptSha256 = '' }],
    ['expired', x => { x.evidence.expiresAt = '2026-11-01T17:00:00Z' }],
    ['observation_time', x => { x.evidence.observedAt = '2026-11-01T18:01:00Z' }],
  ]
  for (const [reason, mutate] of rejects) it(`rejects missing/mismatched ${reason}`, () => {
    const x = fixture(); mutate(x)
    // Rebind after intentional assignment edits so the intended field is tested.
    if (reason !== 'assignment_hash') x.evidence.assignmentSha256 = digest(JSON.stringify(x.assignment))
    const result = check(x); expect(result.code).toBe(1); expect(result.output).toContain(`bootstrap_${reason}`)
  })
  it('allows the assigned runtime producer to prepare its own network', () => {
    const x = fixture(); x.evidence.network.preparer = x.evidence.lifecycle.producer
    expect(check(x).code).toBe(0)
  })
  it('records an unlimited cgroup quota without inventing a CPU admission gate', () => {
    const x = fixture(); x.evidence.host.cpuQuota = 'max'; expect(check(x).code).toBe(0)
  })
  it('records absent cgroup data with an observed CPU count', () => {
    const x = fixture(); x.evidence.host.cpuQuota = 'unavailable'; x.evidence.host.cpuPeriod = null
    expect(check(x).code).toBe(0)
    x.evidence.host.cpuCount = 0; expect(check(x).output).toContain('bootstrap_cpu')
  })
  it('applies the larger vfs capacity threshold', () => {
    const x = fixture(); x.evidence.host.dockerDriver = 'vfs'
    expect(check(x).output).toContain('bootstrap_docker_capacity')
    x.evidence.host.dockerFreeBytes = 40 * 2 ** 30; expect(check(x).code).toBe(0)
  })
  for (const mode of ['valid', 'world-readable', 'symlink', 'inside-git', 'duplicate-json']) it(`private CLI boundary: ${mode}`, () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 't5-bootstrap-contract-')))
    try {
      const x = fixture(), now = Date.now(), sentinel = 'FINITE_PRIVATE_SENTINEL_NEVER_PRINT'
      x.evidence.observedAt = new Date(now - 60000).toISOString()
      x.assignment.expiresAt = x.evidence.expiresAt = new Date(now + 3600000).toISOString()
      let raw = JSON.stringify({ ...x.assignment, privateSentinel: sentinel })
      if (mode === 'duplicate-json') raw = raw.slice(0, -1) + ',"worker":"T5"}'
      x.evidence.assignmentSha256 = digest(raw)
      const assignment = path.join(dir, 'assignment.json'), observations = path.join(dir, 'observations.json')
      fs.writeFileSync(assignment, raw, { mode: 0o600 })
      fs.writeFileSync(observations, JSON.stringify(x.evidence), { mode: 0o600 })
      if (mode === 'world-readable') fs.chmodSync(assignment, 0o644)
      if (mode === 'inside-git') expect(spawnSync('git', ['init', '--quiet', dir]).status).toBe(0)
      let input = assignment
      if (mode === 'symlink') { input = path.join(dir, 'linked.json'); fs.symlinkSync(assignment, input) }
      const result = spawnSync('python3', ['-B', '-I', script, '--assignment', input, '--observations', observations], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      expect(result.error).toBeUndefined(); expect(result.status).toBe(mode === 'valid' ? 0 : 1)
      expect(JSON.parse(result.stdout).state).toBe(mode === 'valid' ? 'CONTRACT_CHECKED_NOT_RUNTIME_ADMITTED' : 'HOLD')
      expect(result.stdout + result.stderr).not.toContain(sentinel)
      expect(result.stderr).toBe('')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
