import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const { branches, repository, repositoryId, verifyCompletedReadingAdmission } =
  createRequire(import.meta.url)('../scripts/lib/ediel-completed-reading-admission.cjs')

const source = { candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40), checkoutClean: true }
const repo = { id: repositoryId, full_name: repository }
const pullNumber = 1270
const branch = branches[pullNumber]
const pr = {
  number: pullNumber, state: 'open', draft: true, user: { login: 'heke99' },
  head: { sha: source.candidateSha, ref: branch, repo }, base: { ref: 'main', repo },
  labels: [{ name: 'e66-clock-' + source.candidateSha }],
}
const fgFile = 'scripts/ediel-at-z06f-supplier-acceptance-native.test.ts'
const z10mFile = 'scripts/ediel-at-z10m-supplier-acceptance-native.test.ts'
const compositionFile = 'scripts/ediel-at-z09fg-supplier-composition-native.test.ts'
const followupFile = 'scripts/ediel-z06f-reading-followup-native.test.ts'
const prepFile = 'scripts/helpers/ediel-z09fg-composition-inputs-native-producer.ts'
const names = (file: string) => Array.from(readFileSync(file, 'utf8').matchAll(/^(?:it|nativeIt)\('([^']+)'/gm), match => match[1])
const tests = (classname: string, cases: string[]) => cases.map(name => ({ classname, name }))
const z10mCases = tests(z10mFile, names(z10mFile))
const compositionCases = tests(compositionFile, [
  'native Z09F own desired receipt/dispatch/physical ACKs precede independent dated Z06 first application',
  'native Z09G own desired receipt/dispatch/physical ACKs precede independent dated Z06 first application',
  ...names(compositionFile),
])
const acceptance = ['F', 'G'].flatMap(kind => {
  const file = fgFile.replace('z06f', 'z06' + kind.toLowerCase())
  return tests(file, [...names(file), ...['false', 'true'].map(value =>
    kind + ' first case approval versions only its original structure; physical extra UD=' + value + ' never changes customer identity')])
})
const followups = ['register', 'meter', 'agency', 'date', 'quantity']
const suites = [
  ['fg', fgFile, acceptance[4].name, ['persisted']],
  ['z10m', z10mFile, z10mCases[4].name, ['persisted', 'persisted', 'structural_err']],
  ['z06f-followup-own', followupFile,
    'actual F apply creates own pending expectation; accepted physical AES/MG/QTY220/DTM597 persist fulfills only that source without extra market request', ['persisted']],
  ...followups.map(variant => ['z06f-followup-' + variant, followupFile,
    "actual misaligned or missing own reading ('" + variant + "') cannot fulfill F or borrow sibling evidence", ['unfulfilled']]),
] as [string, string, string, string[]][]
const protect = 'completed_reading-native-evidence/'
const preflight = 'completed_reading-clock-preflight-evidence/'
const uuid = (index: number) => '00000000-0000-4000-a000-' + String(index).padStart(12, '0')

type Row = Record<string, unknown>
type JunitRow = { classname: string; name: string; skipped?: string }

function fixture() {
  const ids = { protected: 20, fg: 21, z10m: 22 }
  const runFor = (id: number, path: string) => ({
    id, run_number: id, run_attempt: 1, path, status: 'completed', conclusion: 'success', event: 'pull_request',
    head_branch: branch, head_sha: source.candidateSha, repository: repo, head_repository: repo, pull_requests: [pr],
    actor: { login: 'heke99' }, triggering_actor: { login: 'heke99' },
  })
  const runs = [
    runFor(ids.protected, '.github/workflows/ediel-completed-reading-clock-native.yml'),
    runFor(ids.fg, '.github/workflows/ediel-fg-composition-native.yml'),
    runFor(ids.z10m, '.github/workflows/ediel-z10m-supplier-native.yml'),
  ]
  const matchingPr = structuredClone(pr)
  const commit = { sha: source.candidateSha, tree: { sha: source.candidateTree } }
  const base = (id: number) => ({
    checkout_sha: source.candidateSha, checkout_tree: source.candidateTree, workflow_run_id: String(id),
    workflow_run_attempt: '1', ordinary_required_gates: 'NOT_REPLACED',
  })
  const ordinary = (id: number) => ({
    ...base(id), purpose: 'supplemental_actual_native_feedback', native_exit_code: 0,
  })
  const levels = suites.map(([suite, classname, name, outcomes]) => {
    const job = 'Ediel completed reading / ' + suite
    const members: Row = {}
    const sync = { 'systemd-timesyncd': 'inactive', chrony: 'active', chronyd: 'active', ntp: 'inactive', ntpd: 'inactive' }
    for (const [mode, prefix] of [['native', protect], ['preflight', preflight]]) {
      const run = { checkout_sha: source.candidateSha, workflow_run_id: String(ids.protected),
        workflow_run_attempt: '1', job_id: 'completed-reading-native', repository, mode }
      members[prefix + 'receipt.json'] = {
        ...base(ids.protected), ...run, suite, repository_id: String(repositoryId),
        schema: 'completed_reading_boundary_workflow_receipt_v1', exit_code: 0, restoration_verified: true, whole_approval: false,
      }
      members[prefix + 'clock-restoration.json'] = {
        ...run, schema: 'completed_reading_clock_restoration_v1', restored: true,
        backend_and_workers_stopped_before_backward_restore: true, shared_advance_restore_lock: true,
        trusted_normal_reference_verified: true, prior_ntp: 'yes', restored_ntp: 'yes',
        prior_sync_services: { ...sync }, restored_sync_services: { ...sync },
        actual_normal_realtime_ms: 100, target_normal_realtime_ms: 100, trusted_normal_reference_s: 1,
      }
    }
    members[preflight + 'clock-capability.json'] = {
      product_execution: false, actual_forward_days: 21, actual_realtime_ms: 2000, target_realtime_ms: 2000, monotonic_elapsed_s: 0.1,
    }
    const database = { system_identifier: '123456789', postmaster_started_at: '2026-10-31T10:00:00Z' }
    members[protect + 'product-boundary-receipt.json'] = {
      schema: 'completed_reading_native_v1', suite, companyId: uuid(1), switchId: uuid(2),
      baselineSourceId: uuid(3), structuralSourceId: uuid(4),
      authority: { company_id: uuid(1), authenticated_current_context: true, phase_auth_readiness: { ready: true } },
      controllerReceipt: { shared_restore_lock: true, target_realtime_ms: 2000, actual_realtime_ms: 2001 },
      phase: { targetRealtimeMs: 2000, latestRegistrationMs: 1999, before: { postgres_new_transaction: { ...database, clock_ms: 100 } } },
      after: { postgres_new_transaction: { ...database, clock_ms: 2002 } },
      sources: outcomes.map((outcome, i) => ({
        id: uuid(100 + i), outcome, payloadHash: 'd'.repeat(64),
        receivedAt: '2026-12-01T01:00:02Z', registrationAt: '2026-12-01T01:00:00Z',
      })),
    }
    members[protect + 'native-junit.xml'] = [{ classname, name }, { classname, name: 'unselected registration', skipped: '' }]
    return { name: 'ediel-completed-reading-' + suite + '-' + ids.protected, job, members }
  })
  const ordinaryFg = {
    name: 'ediel-fg-composition-native-' + ids.fg, job: 'fg-composition-native',
    members: {
      'receipt.json': {
        ...ordinary(ids.fg), repository, repository_id: String(repositoryId), preparation_exit_code: 0,
        acceptance_exit_code: 0, input_identity: 'immutable_checkout_before_replay', preparation_scope: [prepFile],
        test_scope: [compositionFile], acceptance_scope: [...new Set(acceptance.map(row => row.classname))],
        actual_registered_case_names: compositionCases.map(test => test.name),
        actual_acceptance_case_names: acceptance.map(test => test.classname + ' :: ' + test.name),
      },
      'preparation-proof.json': { stage: 'READY_FOR_IMMUTABLE_CONSUMER' },
      'preparation-junit.xml': tests(prepFile, names(prepFile)),
      'native-junit.xml': compositionCases.map(row => ({ ...row })),
      'acceptance-junit.xml': acceptance.map(row => ({ ...row })),
    } as Row,
  }
  const ordinaryZ10 = {
    name: 'ediel-z10m-supplier-native-' + source.candidateSha, job: 'z10m-supplier-native',
    members: {
      'receipt.json': {
        ...ordinary(ids.z10m), purpose: 'supplemental_actual_native_feedback', canonical_replay: 'PASS',
        input_restoration: 'EXACT', backend_cleanup: 'QUALIFIED', test_scope: [z10mFile], test_case_names: z10mCases.map(row => row.name),
      },
      'native-junit.xml': z10mCases.map(row => ({ ...row })),
    } as Row,
  }
  const artifacts = [...levels, ordinaryFg, ordinaryZ10]
  const ports = {
    source: { ...source }, pullNumber,
    api(endpoint: string) {
      if (endpoint === 'pulls/1270') return matchingPr
      if (endpoint === 'git/commits/' + source.candidateSha) return commit
      throw Error('unexpected endpoint')
    },
    inventory(endpoint: string, key: string) {
      if (endpoint !== 'actions/runs?head_sha=' + source.candidateSha + '&per_page=100' || key !== 'workflow_runs') throw Error('unexpected inventory')
      return runs
    },
    identity(run: ReturnType<typeof runFor>, workflow: string) {
      return run.head_sha === source.candidateSha && run.path === workflow && run.repository?.id === repositoryId
    },
    successfulJob(run: ReturnType<typeof runFor>, name: string) {
      return { name, id: 1000 + artifacts.findIndex(row => row.job === name), run_id: run.id, run_attempt: run.run_attempt, status: 'completed', conclusion: 'success' }
    },
    readArtifact(run: ReturnType<typeof runFor>, job: { name: string }, artifactName: string, consume: (read: (member: string) => string, producer: Row) => unknown) {
      const index = artifacts.findIndex(row => row.name === artifactName && row.job === job.name)
      if (index < 0) throw Error('artifact missing')
      return consume(member => {
        if (!Object.hasOwn(artifacts[index].members, member)) throw Error('artifact member missing')
        return JSON.stringify(artifacts[index].members[member])
      }, { repository, workflow: run.path, job: job.name, runId: String(run.id), runAttempt: String(run.run_attempt),
        artifactId: String(2000 + index), artifactSha256: 'e'.repeat(64) })
    },
    sourceMatches(file: string, digest: string) {
      return createHash('sha256').update(readFileSync(file)).digest('hex') === digest
    },
    junitCases: JSON.parse,
  }
  return { ports, runs, matchingPr, commit, levels, ordinaryFg, ordinaryZ10 }
}

describe('exact-head completed-reading admission', () => {
  it('qualifies all ten authenticated artifacts on the approved checkout and preserves separate gate scope', () => {
    const evidence = verifyCompletedReadingAdmission(fixture().ports)
    expect(evidence).toMatchObject({
      status: 'qualified', checkoutSha: source.candidateSha, checkoutTree: source.candidateTree, pullNumber,
      wholeApproval: false, scope: 'preproduction_completed_reading',
    })
    expect(evidence.ordinary.fg.cases).toHaveLength(16)
    expect(evidence.ordinary.z10m.cases).toHaveLength(5)
    expect(evidence.protectedSuites).toHaveLength(8)
    expect(new Set(evidence.protectedSuites.map((row: Row) => row.runId))).toEqual(new Set(['20']))
    expect(new Set([...Object.values(evidence.ordinary), ...evidence.protectedSuites]
      .map((row: Row) => row.artifactId)).size).toBe(10)
  })

  it.each([
    ['a PR head mismatch', (f: ReturnType<typeof fixture>) => { f.matchingPr.head.sha = 'f'.repeat(40) }, /review_pr/],
    ['a revoked exact SHA label', (f: ReturnType<typeof fixture>) => { f.matchingPr.labels = [] }, /review_label_missing/],
    ['a repository tree mismatch', (f: ReturnType<typeof fixture>) => { f.commit.tree.sha = 'f'.repeat(40) }, /review_tree/],
    ['a changed producer pin', (f: ReturnType<typeof fixture>) => { f.ports.sourceMatches = () => false }, /review_producer_source/],
    ['an untrusted protected actor', (f: ReturnType<typeof fixture>) => { f.runs[0].actor.login = 'other' }, /protected_owner_or_attempt/],
    ['an older attempt', (f: ReturnType<typeof fixture>) => { f.runs[0].run_attempt = 2 }, /protected_owner_or_attempt/],
    ['a duplicate exact-head run', (f: ReturnType<typeof fixture>) => { f.runs.push({ ...f.runs[0], id: 3000 }) }, /run_ambiguous/],
    ['a protected job with only preflight', (f: ReturnType<typeof fixture>) => { delete f.levels[0].members[protect + 'receipt.json'] }, /member missing/],
    ['an unrestored protected clock', (f: ReturnType<typeof fixture>) => { (f.levels[0].members[protect + 'clock-restoration.json'] as Row).restored = false }, /clock_restoration/],
    ['a mismatched artifact checkout', (f: ReturnType<typeof fixture>) => { (f.levels[0].members[preflight + 'receipt.json'] as Row).checkout_tree = 'f'.repeat(40) }, /receipt_checkout_or_run/],
    ['an omitted protected suite', (f: ReturnType<typeof fixture>) => { f.levels[7].name = 'missing' }, /artifact missing/],
    ['a borrowed product outcome', (f: ReturnType<typeof fixture>) => { (f.levels[3].members[protect + 'product-boundary-receipt.json'] as Row).suite = 'z06f-followup-meter' }, /native_clock_or_authority/],
    ['a wrong outcome at the same count', (f: ReturnType<typeof fixture>) => { (f.levels[1].members[protect + 'product-boundary-receipt.json'] as { sources: { outcome: string }[] }).sources[2].outcome = 'persisted' }, /product_outcome/],
    ['a duplicate native JUnit registration', (f: ReturnType<typeof fixture>) => { const cases = f.levels[0].members[protect + 'native-junit.xml'] as JunitRow[]; cases.push(cases[0]) }, /junit_scope/],
    ['a skipped F/G acceptance', (f: ReturnType<typeof fixture>) => { (f.ordinaryFg.members['acceptance-junit.xml'] as JunitRow[])[4].skipped = '' }, /junit_scope/],
    ['a missing fifth Z10M test', (f: ReturnType<typeof fixture>) => { (f.ordinaryZ10.members['native-junit.xml'] as JunitRow[]).pop() }, /junit_scope/],
    ['a later red F/G run', (f: ReturnType<typeof fixture>) => { f.runs.push({ ...f.runs[1], id: 3001, run_number: 30, conclusion: 'failure' }) }, /fg_run_unsuccessful/],
    ['the absent ordinary Z10M run', (f: ReturnType<typeof fixture>) => { f.runs.pop() }, /z10m_run_missing/],
  ] as const)('rejects %s', (_label, alter, reason) => {
    const caseFixture = fixture()
    alter(caseFixture)
    expect(() => verifyCompletedReadingAdmission(caseFixture.ports)).toThrow(reason)
  })

  it('makes the real scoped certificate fail when GitHub event custody is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'gridex-reading-certificate-'))
    try {
      mkdirSync(join(root, 'scripts', 'lib'), { recursive: true })
      mkdirSync(join(root, 'bin'))
      for (const path of ['scripts/gridex-full-production-e2e.cjs', 'scripts/lib/ediel-completed-reading-admission.cjs']) {
        copyFileSync(path, join(root, path))
      }
      writeFileSync(join(root, 'bin', 'git'), '#!/bin/sh\ncase "$*" in\n*\'HEAD^{tree}\'*) printf %s ' +
        source.candidateTree + ';;\n*\'--porcelain\'*) exit 0;;\n*) printf %s ' + source.candidateSha + ';;\nesac\n', { mode: 0o755 })
      writeFileSync(join(root, 'bin', 'gh'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
      const child = spawnSync(process.execPath, ['scripts/gridex-full-production-e2e.cjs', '--certificate=pr'], {
        cwd: root, encoding: 'utf8', timeout: 10000,
        env: {
          NODE_ENV: 'test',
          PATH: join(root, 'bin') + ':' + process.env.PATH,
          GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: repository,
          GITHUB_REF: 'refs/pull/1270/merge', GITHUB_EVENT_PATH: join(root, 'missing-event.json'),
          SMOKE_RESULT: 'success', COVERAGE_RESULT: 'success',
        },
      })
      expect(child.status).toBe(1)
      const certificate = JSON.parse(readFileSync(join(root, 'e2e-artifacts', 'pr-release-certificate.json'), 'utf8'))
      expect(certificate).toMatchObject({
        verdict: 'RED', smoke: 'success', coverage: 'success',
        edielReleaseEvidence: { completedReadingAdmission: {
          status: 'unqualified', reason: 'completed_reading_admission:event_scope',
        }, formalEdielApproval: false },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
