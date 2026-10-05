import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import * as nodePath from 'node:path'
import { Script } from 'node:vm'
import { expect, it } from 'vitest'

// Execute the existing producer in requested modes with finite filesystem/git/child ports.
// Every child command is substituted; no domain, staging, native or external command runs. This
// proves artifact production/consumption, never the substituted child tests.
const producer = resolve('scripts/gridex-full-production-e2e.cjs')
const head = 'a'.repeat(40), tree = 'b'.repeat(40), event = 'd'.repeat(40)
const runIdentity = { GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2' }
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
type Evidence = {
  candidateSha: string | null; candidateTree: string | null; eventSha: string | null
  codeEvidence: string; fullCardVerification: string; formalEdielApproval: boolean; liveCounterpartyVerified: boolean
  levels: Record<string, { status: string }>
  scopeMatrix: { tenantIds: string[]; DDQ: boolean; DGI: boolean; crossTenantAssignments: boolean }
  executions: { mode: string; status: string; qualification?: string; sourceReference?: string; payloadSha256?: string; files?: { path: string; sha256: string }[] }[]
  blockers: string[]
}
type Artifact = { writes: Map<string, string>; report: { mode: string; status: string; summary: { total: number; passed: number; failed: number }; results: { id: string; log_file: string; status: string; failure_class: string | null }[] }; exitCode: number; calls: string[][] }
function runProducer(options: { mode?: 'smoke' | 'full' | 'runtime' | 'real'; fail?: boolean; dirty?: boolean; unavailableGit?: boolean; changedHead?: boolean; forgedReceipts?: boolean } = {}): Artifact {
  const writes = new Map<string, string>(), calls: string[][] = []
  let headReads = 0
  const processPort = { argv: ['node', producer, '--mode=' + (options.mode ?? 'smoke')], execPath: '/synthetic/node',
    env: { GITHUB_SHA: event, ...runIdentity, ...(options.forgedReceipts ? { GRIDEX_EDIEL_RELEASE_EVIDENCE_PATH: '/synthetic/receipts.json' } : {}) },
    exitCode: 0, exit(code: number) { throw Error(`unexpected_exit:${code}`) } }
  const fsPort = {
    mkdirSync() {}, existsSync() { return true },
    readFileSync(name: string) {
      if (writes.has(name)) return writes.get(name)!
      if (name.endsWith('package.json')) return readFileSync(resolve('package.json'), 'utf8')
      // Adversarial declarations are not executed receipts, even with hashes.
      if (name === '/synthetic/receipts.json') return JSON.stringify({ schemaVersion: 1, receipts: [] })
      throw Error(`undeclared_read:${name}`)
    },
    writeFileSync(name: string, bytes: string) { writes.set(name, bytes) },
  }
  const spawnPort = (command: string, args: string[]) => {
    calls.push([command, ...args])
    if (command === 'git') {
      if (options.unavailableGit) return { status: 128, stdout: '', stderr: 'synthetic no git' }
      const output = args.includes('HEAD^{tree}') ? tree : args.includes('--porcelain') ? (options.dirty ? ' M changed.ts' : '')
        : options.changedHead && ++headReads > 1 ? 'e'.repeat(40) : head
      return { status: 0, stdout: output, stderr: '' }
    }
    return { status: options.fail ? 1 : 0, stdout: options.fail ? 'synthetic schema drift' : 'synthetic finite child success', stderr: '' }
  }
  new Script(readFileSync(producer, 'utf8'), { filename: producer }).runInNewContext({
    __dirname: resolve('scripts'), process: processPort, console: { log() {}, error() {} },
    require(name: string) {
      if (name === 'node:fs') return fsPort
      if (name === 'node:path') return nodePath
      if (name === 'node:child_process') return { spawnSync: spawnPort }
      if (name === 'node:crypto') return { createHash }
      throw Error(`undeclared_module:${name}`)
    },
  })
  return { writes, calls, exitCode: processPort.exitCode, report: JSON.parse(writes.get(resolve('e2e-artifacts/gridex-e2e-report.json'))!) }
}
const indexPath = resolve('e2e-artifacts/gridex-executed-evidence.json')
function index(artifact: Artifact) { return JSON.parse(artifact.writes.get(indexPath) ?? '{}') }

it('binds actual emitted report, orchestration JUnit and redacted logs to checkout head/tree and workflow attempt', () => {
  const artifact = runProducer(), receipt = index(artifact)
  expect(artifact.exitCode).toBe(0)
  expect(receipt).toMatchObject({ format: 'gridex_runner_execution_artifact_v1', mode: 'smoke', sourceUnchanged: true,
    source: { candidateSha: head, candidateTree: tree, eventSha: event, checkoutClean: true, runId: '12345', runAttempt: '2' } })
  const expected = ['gridex-e2e-report.json', 'gridex-e2e-junit.xml', ...artifact.report.results.map(row => row.log_file.replace(/^e2e-artifacts\//, ''))]
  expect(receipt.files.map((file: { path: string }) => file.path)).toEqual(expected)
  for (const file of receipt.files) expect(file.sha256).toBe(hash(artifact.writes.get(resolve('e2e-artifacts', file.path))!))
  expect(artifact.calls.filter(row => row[0] !== 'git').length).toBe(artifact.report.summary.total)
})
it.each(['dirty', 'unavailableGit', 'changedHead'] as const)('does not qualify %s source while preserving the ordinary runner result', fault => {
  const artifact = runProducer({ [fault]: true })
  expect(artifact.exitCode).toBe(0)
  expect(artifact.report.status).toBe('passed')
  expect(index(artifact).sourceUnchanged).toBe(false)
})
it('retains genuine child failures and the existing failure classifier', () => {
  const artifact = runProducer({ fail: true })
  expect(artifact.exitCode).toBe(1)
  expect(artifact.report.status).toBe('failed')
  expect(artifact.report.results.every(row => row.failure_class === 'database_or_migration_drift')).toBe(true)
})

const yaml = createRequire(import.meta.url)('js-yaml') as { load(value: string): { jobs: Record<string, { steps: { name?: string; run?: string; uses?: string; 'continue-on-error'?: boolean; with?: { name?: string; path?: string; ref?: string; 'run-id'?: string } }[] }> } }
function workflow() { return yaml.load(readFileSync(resolve('.github/workflows/full-e2e.yml'), 'utf8')) }
// The actual certificate shell is copied byte-for-byte to a private temp root.
// The provider download boundary is finite: copy actual VM-producer artifact
// bytes only when the checked-in workflow requests this run's named artifact.
function certificate(mode: 'pr' | 'nightly', artifact?: Artifact, options: { additionalArtifacts?: Artifact[]; state?: string | Record<string, string>; oldHead?: boolean; oldTree?: boolean; wrongMode?: boolean; differentRun?: boolean; differentAttempt?: boolean; corrupt?: string; missing?: string; forgedReceipts?: boolean } = {}) {
  const job = workflow().jobs[mode === 'pr' ? 'pr-certificate' : 'nightly-release-certificate']
  const step = job.steps.find(row => row.name?.startsWith('Require '))!
  const root = mkdtempSync(resolve(tmpdir(), 'ediel-ops03-workflow-'))
  try {
    mkdirSync(resolve(root, 'scripts')); mkdirSync(resolve(root, 'bin'))
    writeFileSync(resolve(root, 'scripts/gridex-full-production-e2e.cjs'), readFileSync(producer))
    for (const supplied of [...(artifact ? [artifact] : []), ...(options.additionalArtifacts ?? [])]) {
      const artifactMode = supplied.report.mode === 'real' ? 'real-customer' : supplied.report.mode
      const download = job.steps.find(row => row.uses === 'actions/download-artifact@v4' && row.with?.name === 'gridex-e2e-' + artifactMode + '-${{ github.run_id }}')
      if (!download) continue
      const target = resolve(root, download.with!.path!)
      for (const [name, original] of supplied.writes) {
        const relative = nodePath.relative(resolve('e2e-artifacts'), name)
        if (relative === options.missing) continue
        let bytes = relative === options.corrupt ? original + 'corrupted' : original
        if (relative === 'gridex-executed-evidence.json' && (options.oldHead || options.oldTree || options.wrongMode || options.differentRun || options.differentAttempt)) {
          const source = JSON.parse(bytes)
          if (options.oldHead) source.source.candidateSha = 'e'.repeat(40)
          if (options.oldTree) source.source.candidateTree = 'e'.repeat(40)
          if (options.wrongMode) source.mode = 'full'
          if (options.differentRun) source.source.runId = '99999'
          if (options.differentAttempt) source.source.runAttempt = '1'
          bytes = JSON.stringify(source)
        }
        mkdirSync(dirname(resolve(target, relative)), { recursive: true })
        writeFileSync(resolve(target, relative), bytes)
      }
    }
    if (options.forgedReceipts) {
      const fake = ['document', 'unit', 'integration', 'tenant_e2e', 'transport', 'TGT'].map(level => ({ id: level, level, status: 'passed', candidateSha: head, candidateTree: tree, qualification: 'disposable_native',
        cases: [{ kind: 'DDQ', tenantIds: ['tenant-a', 'tenant-b'], assertions: ['positive', 'negative', 'tenant_isolation'] }], modeledPorts: [] }))
      writeFileSync(resolve(root, 'fake.json'), JSON.stringify({ schemaVersion: 1, receipts: fake }))
    }
    writeFileSync(resolve(root, 'bin/git'), `#!/bin/sh\ncase "$*" in\n*'HEAD^{tree}'*) printf '%s' '${tree}';;\n*'--porcelain'*) exit 0;;\n*) printf '%s' '${head}';;\nesac\n`, { mode: 0o755 })
    const states = Object.fromEntries(['SMOKE_RESULT', 'COVERAGE_RESULT', 'FULL_RESULT', 'RUNTIME_RESULT', 'REAL_RESULT'].map(key => [key, typeof options.state === 'string' ? options.state : options.state?.[key] ?? 'success']))
    const child = spawnSync('bash', ['-c', step.run!], { cwd: root, encoding: 'utf8', timeout: 10000,
      env: { NODE_ENV: 'test', PATH: `${resolve(root, 'bin')}:${process.env.PATH}`, GITHUB_SHA: event, ...runIdentity,
        ...(options.forgedReceipts ? { GRIDEX_EDIEL_RELEASE_EVIDENCE_PATH: resolve(root, 'fake.json') } : {}), ...states } })
    return { exit: child.status, stderr: child.stderr, value: JSON.parse(readFileSync(resolve(root, `e2e-artifacts/${mode}-release-certificate.json`), 'utf8')) as { verdict: string; edielReleaseEvidence: Evidence } }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
it('the actual PR workflow carries same-run emitted bytes to the certificate without promoting static checks to Ediel proof', () => {
  const artifact = runProducer(), result = certificate('pr', artifact)
  expect(result.stderr).toBe('')
  expect(result.exit).toBe(0); expect(result.value.verdict).toBe('GREEN')
  expect(result.value.edielReleaseEvidence).toMatchObject({ candidateSha: head, candidateTree: tree, eventSha: event, codeEvidence: 'incomplete', fullCardVerification: 'NOT_VERIFIED', formalEdielApproval: false, liveCounterpartyVerified: false,
    scopeMatrix: { tenantIds: [], DDQ: false, DGI: false, crossTenantAssignments: false } })
  expect(result.value.edielReleaseEvidence.executions).toContainEqual(expect.objectContaining({ mode: 'smoke', status: 'qualified', qualification: 'runner_step_exit_status', payloadSha256: hash(artifact.writes.get(indexPath)!) }))
  expect(Object.keys(result.value.edielReleaseEvidence.levels)).toEqual(['document', 'unit', 'integration', 'tenant_e2e', 'transport', 'TGT'])
  for (const level of Object.values(result.value.edielReleaseEvidence.levels)) expect(level.status).toBe('missing')
})
it.each(['oldHead', 'oldTree', 'wrongMode', 'differentRun', 'differentAttempt'] as const)('rejects %s artifacts despite GREEN job labels', fault => {
  const result = certificate('pr', runProducer(), { [fault]: true })
  expect(result.exit).toBe(0); expect(result.value.verdict).toBe('GREEN')
  expect(result.value.edielReleaseEvidence.executions).toContainEqual(expect.objectContaining({ mode: 'smoke', status: 'unqualified' }))
})
it.each(['gridex-e2e-report.json', 'gridex-e2e-junit.xml', 'logs/01-whole-project-coverage.log'])('rejects tampered %s emitted bytes', corrupt => {
  expect(certificate('pr', runProducer(), { corrupt }).value.edielReleaseEvidence.executions).toContainEqual(expect.objectContaining({ mode: 'smoke', status: 'unqualified' }))
})
it.each(['gridex-executed-evidence.json', 'gridex-e2e-junit.xml', 'logs/01-whole-project-coverage.log'])('holds missing %s evidence independently of ordinary job success', missing => {
  expect(certificate('pr', runProducer(), { missing }).value.edielReleaseEvidence.executions).toContainEqual(expect.objectContaining({ mode: 'smoke', status: 'unqualified' }))
})
it.each(['dirty', 'unavailableGit', 'changedHead', 'fail'] as const)('refuses %s runner artifacts without falsifying the original CI verdict', fault => {
  const result = certificate('pr', runProducer({ [fault]: true }))
  expect(result.exit).toBe(0); expect(result.value.verdict).toBe('GREEN')
  expect(result.value.edielReleaseEvidence.executions).toContainEqual(expect.objectContaining({ status: 'unqualified' }))
})
it('does not use declarative six-class/tenant receipts as executed source evidence', () => {
  const result = certificate('pr', runProducer({ forgedReceipts: true }), { forgedReceipts: true })
  expect(result.value.edielReleaseEvidence.codeEvidence).toBe('incomplete')
  expect(result.value.edielReleaseEvidence.scopeMatrix).toEqual({ tenantIds: [], DDQ: false, DGI: false, crossTenantAssignments: false })
  for (const level of Object.values(result.value.edielReleaseEvidence.levels)) expect(level.status).toBe('missing')
})
it('cannot promote genuine specification JSON alone into executed evidence', () => {
  const documentOnly = { ...runProducer(), writes: new Map([[resolve('e2e-artifacts/rules.json'), readFileSync(resolve('docs/ediel/masterplan-v2/registers/rules.json'), 'utf8')]]) }
  const result = certificate('pr', documentOnly)
  expect(result.value.edielReleaseEvidence).toMatchObject({ codeEvidence: 'incomplete', fullCardVerification: 'NOT_VERIFIED', formalEdielApproval: false, liveCounterpartyVerified: false })
  expect(result.value.edielReleaseEvidence.executions).toContainEqual(expect.objectContaining({ mode: 'smoke', status: 'unqualified' }))
})
it.each(['pr', 'nightly'] as const)('keeps absent %s evidence incomplete while preserving ordinary GREEN', mode => {
  const result = certificate(mode)
  expect(result.exit).toBe(0); expect(result.value.verdict).toBe('GREEN')
  expect(result.value.edielReleaseEvidence).toMatchObject({ codeEvidence: 'incomplete', fullCardVerification: 'NOT_VERIFIED', formalEdielApproval: false, liveCounterpartyVerified: false })
  expect(result.value.edielReleaseEvidence.executions.every(row => row.status === 'unqualified')).toBe(true)
})
it.each(['failed', 'skipped', 'cancelled', ''])('retains the existing RED certificate for %s job results', state => {
  for (const mode of ['pr', 'nightly'] as const) {
    const result = certificate(mode, undefined, { state })
    expect(result.exit).toBe(1); expect(result.value.verdict).toBe('RED')
  }
})
it.each([['pr', 'SMOKE_RESULT'], ['pr', 'COVERAGE_RESULT'], ['nightly', 'FULL_RESULT'], ['nightly', 'RUNTIME_RESULT'], ['nightly', 'REAL_RESULT']] as const)('retains RED when only %s/%s fails', (mode, key) => {
  const result = certificate(mode, runProducer(), { state: { [key]: 'failed' } })
  expect(result.exit).toBe(1); expect(result.value.verdict).toBe('RED')
})
it('downloads every expected producer artifact through the current workflow-run channel at exact checkout head', () => {
  for (const [name, modes] of [['pr-certificate', ['smoke']], ['nightly-release-certificate', ['full', 'runtime', 'real']]] as const) {
    const job = workflow().jobs[name]
    expect(job.steps.find(row => row.uses === 'actions/checkout@v4')?.with?.ref).toBe('${{ github.event.pull_request.head.sha || github.sha }}')
    const downloads = job.steps.filter(row => row.uses === 'actions/download-artifact@v4')
    expect(downloads).toHaveLength(modes.length)
    for (const mode of modes) {
      const artifactName = mode === 'real' ? 'real-customer' : mode
      expect(downloads).toContainEqual(expect.objectContaining({ uses: 'actions/download-artifact@v4', 'continue-on-error': true, with: { name: 'gridex-e2e-' + artifactName + '-${{ github.run_id }}', path: `e2e-artifacts/inputs/${mode}` } }))
    }
  }
})

it('the actual nightly shell consumes all three actual VM-produced mode artifacts without qualifying Ediel cases', () => {
  const full = runProducer({ mode: 'full' }), runtime = runProducer({ mode: 'runtime' }), real = runProducer({ mode: 'real' })
  const artifacts = [full, runtime, real]
  for (const artifact of artifacts) {
    expect(artifact.exitCode).toBe(0)
    expect(artifact.report.status).toBe('passed')
    // Every runner command is observed at the finite child port, including the
    // would-be Vitest and staging scripts; none is invoked by the host process.
    expect(artifact.calls.filter(call => call[0] !== 'git')).toHaveLength(artifact.report.summary.total)
  }
  expect(full.calls).toContainEqual(['npm', 'run', 'test'])
  expect(runtime.calls).toContainEqual(['/synthetic/node', 'scripts/gridex-tenant-runtime-e2e.mjs'])
  expect(real.calls).toContainEqual(['/synthetic/node', 'scripts/gridex-real-customer-e2e.mjs'])
  const result = certificate('nightly', full, { additionalArtifacts: [runtime, real] })
  expect(result.stderr).toBe('')
  expect(result.exit).toBe(0); expect(result.value.verdict).toBe('GREEN')
  expect(result.value.edielReleaseEvidence.executions.map(row => [row.mode, row.status])).toEqual([['full', 'qualified'], ['runtime', 'qualified'], ['real', 'qualified']])
  for (const artifact of artifacts) expect(result.value.edielReleaseEvidence.executions).toContainEqual(expect.objectContaining({ mode: artifact.report.mode, qualification: 'runner_step_exit_status', payloadSha256: hash(artifact.writes.get(indexPath)!) }))
  expect(result.value.edielReleaseEvidence).toMatchObject({ candidateSha: head, candidateTree: tree, codeEvidence: 'incomplete', fullCardVerification: 'NOT_VERIFIED', formalEdielApproval: false, liveCounterpartyVerified: false,
    scopeMatrix: { tenantIds: [], DDQ: false, DGI: false, crossTenantAssignments: false } })
  for (const level of Object.values(result.value.edielReleaseEvidence.levels)) expect(level.status).toBe('missing')
})
it('the nightly certificate holds a missing runtime artifact while retaining both qualified sibling modes', () => {
  const full = runProducer({ mode: 'full' }), real = runProducer({ mode: 'real' })
  const result = certificate('nightly', full, { additionalArtifacts: [real] })
  expect(result.exit).toBe(0); expect(result.value.verdict).toBe('GREEN')
  expect(result.value.edielReleaseEvidence.executions.map(row => [row.mode, row.status])).toEqual([['full', 'qualified'], ['runtime', 'unqualified'], ['real', 'qualified']])
  expect(result.value.edielReleaseEvidence.blockers).toContain('runner_artifact_missing_or_unqualified:runtime')
  expect(result.value.edielReleaseEvidence).toMatchObject({ codeEvidence: 'incomplete', fullCardVerification: 'NOT_VERIFIED', formalEdielApproval: false, liveCounterpartyVerified: false,
    scopeMatrix: { tenantIds: [], DDQ: false, DGI: false, crossTenantAssignments: false } })
})
