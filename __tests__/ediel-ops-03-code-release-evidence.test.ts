import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Script } from 'node:vm'
import { expect, it } from 'vitest'

// Consumer behaviour only. GitHub/Git identity ports are finite; ZIP extraction,
// XML parsing, source hashing and the existing certificate code are real.
// These synthetic JUnit fixtures do not execute their native business cases.
// masterplan: OPS-03, AT-OPS-03
// Independent whole-code review approves these consumer assertions;
// actual new-head native/CI results and market activation remain separate.
const producer = path.resolve('scripts/gridex-full-production-e2e.cjs')
const localRequire = createRequire(import.meta.url)
const head = 'a'.repeat(40), tree = 'b'.repeat(40), repository = 'heke99/gridex-ops-platform'
const caseFile = 'scripts/ediel-sc-003-005-service-native.test.ts'
const caseName = 'SC003/SC005 legal provider DGI uses one permission and one E66 storage/disposition/physical ACK for two independently valid scoped missions'
const ddqFile = 'scripts/ediel-prodat-mixed-native.test.ts'
const ddqName = 'the partition owner commits only the full-guide own object and its one complete mixed BGM34 reply is routed and queued'
const transportFile = '__tests__/ediel-transport-byte-integrity.test.ts'
const mimeName = 'ENV-01 lossless bytes at every SMTP packaging boundary > MIME mode 1 preserves Swedish ISO8859-1 bytes'
const guardName = 'ENV-01 lossless bytes at every SMTP packaging boundary > the actual send path rejects before route, archive, attempt or provider effects'
const tgtFile = '__tests__/ediel-prodat-register-tgt-workflow.test.ts'
const tgtName = 'actual TGT workflow surrounding PRODAT register exchange > requires distinct messages for repeated acknowledgements and reports completion separately from portal approval'
const reviewedBase = 'b83b284467c8e0fcaa277706a708706e0a705068'
const ledgerFile = 'quality/audits/ediel-masterplan-v2/coverage.json'
const approvedEvidence = ['scripts/gridex-full-production-e2e.cjs', '__tests__/ediel-ops-03-code-release-evidence.test.ts',
  '__tests__/ediel-ops-03-release-evidence.test.ts', '.github/workflows/full-e2e.yml']
// Finite Git ports model a baseline/candidate comparison, not actual reviewedBase
// custody. Read available HEAD descriptors even in depth-one CI; only the two
// owned row spans are normalized in this modeled baseline. No ancestor fetch,
// historical-object fallback or change to the real production guard occurs.
// The combined repository's descriptor list exceeds spawnSync's 1 MiB default.
// Keep these real, bounded Git reads intact as the reviewed tree grows.
const fixtureGitReadOptions = { encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 }
const currentTree = spawnSync('git', ['--no-replace-objects', 'ls-tree', '-r', '-z', '--full-tree', 'HEAD'], fixtureGitReadOptions)
if (currentTree.status !== 0) throw Error('fixture_head_tree_unavailable')
const currentLedger = spawnSync('git', ['--no-replace-objects', 'show', 'HEAD:' + ledgerFile], fixtureGitReadOptions)
if (currentLedger.status !== 0) throw Error('fixture_head_ledger_unavailable')
const ledgerSnapshot = { ...currentLedger, stdout: (() => {
  const ledger = JSON.parse(currentLedger.stdout) as { rules: LedgerRow[]; acceptance_contracts: LedgerRow[] }
  let bytes = currentLedger.stdout
  const rowBytes = (row: LedgerRow) => JSON.stringify(row, null, 2).split('\n').map(line => '    ' + line).join('\n')
  for (const [rows, id, status, promoted] of [[ledger.rules, 'OPS-03', 'NOT_VERIFIED', 'VERIFIED'],
    [ledger.acceptance_contracts, 'AT-OPS-03', 'NOT_EXECUTED', 'PASSED']] as const) {
    const selected = rows.filter(row => row.id === id)
    if (selected.length !== 1) throw Error('fixture_owned_row_not_unique')
    const row = selected[0], oldBytes = rowBytes(row)
    if (!((row.status === status && row.evidence.length === 0) || (row.status === promoted && JSON.stringify(row.evidence) === JSON.stringify(approvedEvidence)))
      || bytes.split(oldBytes).length !== 2) throw Error('fixture_owned_row_shape_invalid')
    bytes = bytes.replace(oldBytes, rowBytes({ ...row, status, evidence: [] }))
  }
  return bytes
})() }
const modeledLedgerBlob = createHash('sha1').update('blob ' + Buffer.byteLength(ledgerSnapshot.stdout) + '\0').update(ledgerSnapshot.stdout).digest('hex')
const treeSnapshot = { ...currentTree, stdout: currentTree.stdout.split('\0').map(record => record.endsWith('\t' + ledgerFile)
  ? record.replace(/[0-9a-f]{40}\t/, modeledLedgerBlob + '\t') : record).join('\0') }
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
type Fault = 'api' | 'repository' | 'commit' | 'tree' | 'workflow' | 'run' | 'attempt' | 'job' | 'job_failed'
  | 'artifact' | 'artifact_head' | 'artifact_run' | 'expired' | 'digest' | 'artifact_attempt' | 'source' | 'native_config_source'
  | 'duplicate' | 'skip' | 'failure' | 'error' | 'missing' | 'wrong_case' | 'wrong_file' | 'xml_entity' | 'duplicate_zip' | 'latest_cancelled'
  | 'setup_input' | 'transitive_input' | 'missing_input' | 'extra_input' | 'mode_input' | 'symlink_input' | 'untracked_input' | 'ignored_input'
type CoverageFault = 'document_missing' | 'document_conformance' | 'mime_missing' | 'guard_missing' | 'tgt_missing' | 'tgt_skipped'
  | 'tgt_duplicate' | 'suite_name' | 'source' | 'workflow_source' | 'head' | 'attempt' | 'job' | 'job_failed'
  | 'artifact' | 'artifact_head' | 'artifact_run' | 'artifact_attempt' | 'digest' | 'expired' | 'latest_cancelled'
  | 'run_failed' | 'current_run' | 'current_job_failed' | 'runner_missing' | 'runner_corrupt'
  | 'name_double_encoded' | 'name_unknown_entity' | 'name_html_entity' | 'xml_entity'
type NumericReferenceFault = 'decimal_suffix' | 'hex_suffix' | 'uppercase_hex' | 'null' | 'control' | 'surrogate' | 'noncharacter' | 'above_range'
type LedgerChange = 'approved' | 'foreign_rule_status' | 'foreign_at_status' | 'foreign_evidence' | 'spec' | 'metadata' | 'row_order' | 'missing' | 'extra'
  | 'invalid_evidence' | 'duplicate_evidence' | 'evidence_order' | 'own_extra_field' | 'own_wrong_status' | 'one_row' | 'foreign_whitespace' | 'duplicate_key'
  | 'invalid_json' | 'mode' | 'symlink' | 'deleted' | 'type'
type Options = { fault?: Fault; selfAttested?: boolean; ddq?: boolean; dgi?: boolean; coverage?: boolean; coverageFault?: CoverageFault; coverageNameEncoding?: 'decimal' | 'hex'; numericReferenceFault?: NumericReferenceFault; coverageReferenceText?: boolean; nightly?: boolean; ciFailed?: boolean; ledgerChange?: LedgerChange }
type LedgerRow = { id: string; status: string; evidence: string[]; [key: string]: unknown }
function candidateLedger(change: LedgerChange) {
  const ledger = JSON.parse(ledgerSnapshot.stdout) as { rules: LedgerRow[]; acceptance_contracts: LedgerRow[]; [key: string]: unknown }
  const rule = ledger.rules.find(row => row.id === 'OPS-03')!, acceptance = ledger.acceptance_contracts.find(row => row.id === 'AT-OPS-03')!
  rule.status = 'VERIFIED'; acceptance.status = 'PASSED'; rule.evidence = [...approvedEvidence]; acceptance.evidence = [...approvedEvidence]
  if (change === 'foreign_rule_status') ledger.rules[0].status = ledger.rules[0].status === 'VERIFIED' ? 'NOT_VERIFIED' : 'VERIFIED'
  if (change === 'foreign_at_status') ledger.acceptance_contracts[0].status = ledger.acceptance_contracts[0].status === 'PASSED' ? 'NOT_EXECUTED' : 'PASSED'
  if (change === 'foreign_evidence') ledger.rules[0].evidence = [...ledger.rules[0].evidence, producer]
  if (change === 'spec') ledger.spec_sha256 = 'e'.repeat(64)
  if (change === 'metadata') ledger.scope = 'self-attested production conformance'
  if (change === 'row_order') [ledger.rules[0], ledger.rules[1]] = [ledger.rules[1], ledger.rules[0]]
  if (change === 'missing') ledger.acceptance_contracts.shift()
  if (change === 'extra') ledger.rules.push({ id: 'self-attested-extra', status: 'VERIFIED', evidence: [...approvedEvidence] })
  if (change === 'invalid_evidence') rule.evidence[0] = 'docs/forged-release.json'
  if (change === 'duplicate_evidence') acceptance.evidence.push(approvedEvidence[0])
  if (change === 'evidence_order') rule.evidence.reverse()
  if (change === 'own_extra_field') rule.fullMatrixVerified = true
  if (change === 'own_wrong_status') rule.status = 'PASSED'
  if (change === 'one_row') { acceptance.status = 'NOT_EXECUTED'; acceptance.evidence = [] }
  let bytes = JSON.stringify(ledger, null, 2) + '\n'
  if (change === 'foreign_whitespace') bytes = bytes.replace('  "spec_version"', '    "spec_version"')
  if (change === 'duplicate_key') bytes = bytes.replace('  "scope":', '  "scope": "forged ignored duplicate",\n  "scope":')
  if (change === 'invalid_json') bytes += '{'
  return bytes
}
type Evidence = {
  codeEvidence: string; fullCardVerification: string; formalEdielApproval: boolean; liveCounterpartyVerified: boolean
  levels: Record<string, { status: string }>; blockers: string[]
  caseEvidence?: { id: string; status: string; sourceFile: string; sourceSha256: string; classes: string[]; effects: Record<string, boolean | number>; ports: Record<string, string>; producer: { runId: string; runAttempt: string; artifactId: string; artifactSha256: string } }[]
  scopeMatrix: { tenantIds: string[]; DDQ: boolean; DGI: boolean; crossTenantAssignments: boolean; tenantCountLowerBound?: number }
  activationGates?: { liveTransport: string; formalTGT: string }
}
function fixture(options: Options = {}) {
  const f = options.fault
  const one = `<testcase classname="${f === 'wrong_file' ? 'unreviewed.test.ts' : caseFile}" name="${f === 'wrong_case' ? 'claims DDQ DGI all tenants' : caseName}" time="0.1">${f === 'skip' ? '<skipped/>' : f === 'failure' ? '<failure/>' : f === 'error' ? '<error/>' : ''}</testcase>`
  const two = `<testcase classname="${ddqFile}" name="${ddqName}" time="0.2"/>`
  const xml = `${f === 'xml_entity' ? '<!DOCTYPE testsuites [<!ENTITY scope SYSTEM "file:///etc/passwd">]>' : ''}<testsuites><testsuite name="native">${options.dgi === false || f === 'missing' ? '' : one}${f === 'duplicate' ? one : ''}${options.ddq === false ? '' : two}</testsuite></testsuites>`
  // Python's standard ZIP writer supplies real archive bytes; production unzip
  // remains real. Neither this fixture writer nor XML names confer case proof.
  const zip = spawnSync('python3', ['-c', 'import io,sys,zipfile,json; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("rem002-native-junit.xml",sys.stdin.buffer.read()); z.writestr("self-attested.json",json.dumps({"classes":["document","unit","integration","tenant_e2e","transport","TGT"],"DDQ":True,"DGI":True,"tenantIds":["fake-a","fake-b"],"crossTenantAssignments":True,"modeledPorts":[],"sourceFile":"evil.ts"})); z.close(); sys.stdout.buffer.write(b.getvalue())'], { input: xml })
  if (zip.status !== 0) throw Error('fixture_zip_failed')
  const archive = zip.stdout
  const run = { id: 100, run_number: 12, run_attempt: 2, head_sha: f === 'run' ? 'e'.repeat(40) : head,
    path: f === 'workflow' ? '.github/workflows/unreviewed.yml' : '.github/workflows/ops-hardening.yml',
    status: 'completed', conclusion: f === 'latest_cancelled' ? 'cancelled' : 'success', event: 'pull_request', run_started_at: '2026-10-05T12:00:00Z',
    repository: { id: 10, full_name: f === 'repository' ? 'foreign/repository' : repository }, head_repository: { id: 10, full_name: repository } }
  const job = { id: 200, run_id: 100, run_attempt: f === 'attempt' ? 1 : 2,
    name: f === 'job' ? 'unrelated-pass' : 'clean-migration-replay', status: 'completed', conclusion: f === 'job_failed' ? 'failure' : 'success',
    started_at: '2026-10-05T12:00:05Z', completed_at: '2026-10-05T12:03:00Z' }
  const artifact = { id: 300, name: f === 'artifact' ? 'unrelated-artifact' : 'gridex-rem-002-clean-replay', expired: f === 'expired',
    size_in_bytes: archive.length, digest: 'sha256:' + (f === 'digest' ? '0'.repeat(64) : sha256(archive)),
    created_at: f === 'artifact_attempt' ? '2026-10-05T11:00:00Z' : '2026-10-05T12:02:30Z',
    workflow_run: { id: f === 'artifact_run' ? 999 : 100, repository_id: 10, head_repository_id: 10, head_sha: f === 'artifact_head' ? 'e'.repeat(40) : head } }
  return { run, job, artifact, archive }
}
const xmlAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function coverageFixture(options: Options) {
  const f = options.coverageFault
  // The authentic Vitest reporter encodes the suite separator as &gt;. Keeping
  // raw > here hid the actual producer/consumer mismatch despite green tests.
  const nameAttribute = (name: string) => {
    const encoded = xmlAttribute(name)
    if (f === 'name_double_encoded') return encoded.replace(/&gt;/g, '&amp;gt;')
    if (f === 'name_unknown_entity') return encoded.replace(/&gt;/g, '&unknown;')
    if (f === 'name_html_entity') return encoded.replace(/&gt;/g, '&GT;')
    if (options.coverageNameEncoding === 'decimal') return encoded.replace(/&gt;/g, '&#62;')
    if (options.coverageNameEncoding === 'hex') return encoded.replace(/&gt;/g, '&#x3e;')
    if (options.numericReferenceFault === 'decimal_suffix') return encoded.replace(/&gt;/g, '&#62junk;')
    if (options.numericReferenceFault === 'hex_suffix') return encoded.replace(/&gt;/g, '&#x3eJUNK;')
    if (options.numericReferenceFault === 'uppercase_hex') return encoded.replace(/&gt;/g, '&#X3E;')
    const inserted = { null: '&#0;', control: '&#1;', surrogate: '&#xD800;', noncharacter: '&#xFFFE;', above_range: '&#x110000;' }
    if (options.numericReferenceFault && options.numericReferenceFault in inserted) return inserted[options.numericReferenceFault as keyof typeof inserted] + encoded
    return encoded
  }
  const junit = (file: string, name: string, content = '') => `<testcase classname="${xmlAttribute(file)}" name="${nameAttribute(name)}" time="0.1">${content}</testcase>`
  const tgt = junit(tgtFile, f === 'suite_name' ? tgtName.split(' > ')[1] : tgtName, f === 'tgt_skipped' ? '<skipped/>' : '')
  const literalText = options.coverageReferenceText ? '<!-- <testcase name="&#0; &#62junk;"> --><?note value="&#0;"?><system-out context="&#x9;&#xA;&#xD;&#32;&#xD7FF;&#xE000;&#xFFFD;&#x10000;&#x10FFFF;"><![CDATA[<testcase name="&#0; &#xD800; &#62junk;">]]></system-out>' : ''
  const xml = `${f === 'xml_entity' ? '<!DOCTYPE testsuites [<!ENTITY scope SYSTEM "file:///etc/passwd">]>' : ''}<testsuites>${literalText}<testsuite name="${xmlAttribute(transportFile)}">${f === 'mime_missing' ? '' : junit(transportFile, mimeName)}${f === 'guard_missing' ? '' : junit(transportFile, guardName)}</testsuite><testsuite name="${xmlAttribute(tgtFile)}">${f === 'tgt_missing' ? '' : tgt}${f === 'tgt_duplicate' ? tgt : ''}</testsuite></testsuites>`
  const document = { scope: 'specification integrity and evidence references only', originalFiles: 33, rules: 121, acceptanceContracts: 231,
    applicationConformanceAsserted: f === 'document_conformance', productionReadinessAsserted: false }
  const entries: Record<string, string> = { 'ediel-unit-junit.xml': xml, 'self-attested.json': JSON.stringify({ classes: ['document', 'unit', 'transport', 'TGT'], sourceFile: 'trusted-by-name.test.ts' }) }
  if (f !== 'document_missing') entries['ediel-document-integrity.json'] = JSON.stringify(document)
  const zip = spawnSync('python3', ['-c', 'import io,sys,zipfile,json; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); [z.writestr(k,v) for k,v in json.load(sys.stdin).items()]; z.close(); sys.stdout.buffer.write(b.getvalue())'], { input: JSON.stringify(entries) })
  if (zip.status !== 0) throw Error('coverage_fixture_zip_failed')
  const run = { id: 12345, run_number: 13, run_attempt: 2, head_sha: f === 'head' ? 'e'.repeat(40) : head,
    path: '.github/workflows/full-e2e.yml', status: options.nightly || ['run_failed', 'latest_cancelled'].includes(f ?? '') ? 'completed' : 'in_progress',
    conclusion: f === 'latest_cancelled' ? 'cancelled' : f === 'run_failed' ? 'failure' : options.nightly ? 'success' : null,
    event: 'pull_request', repository: { id: 10, full_name: repository }, head_repository: { id: 10, full_name: repository } }
  const job = { id: 400, run_id: 12345, run_attempt: f === 'attempt' ? 1 : 2, name: f === 'job' ? 'not-coverage' : 'coverage',
    status: 'completed', conclusion: f === 'job_failed' ? 'failure' : 'success', started_at: '2026-10-05T12:00:00Z', completed_at: '2026-10-05T12:05:00Z' }
  const artifact = { id: 500, name: f === 'artifact' ? 'self-labelled-proof' : 'gridex-coverage-12345', expired: f === 'expired', size_in_bytes: zip.stdout.length,
    digest: 'sha256:' + (f === 'digest' ? '0'.repeat(64) : sha256(zip.stdout)), created_at: f === 'artifact_attempt' ? '2026-10-05T11:30:00Z' : '2026-10-05T12:04:30Z',
    workflow_run: { id: f === 'artifact_run' ? 999 : 12345, repository_id: 10, head_repository_id: 10, head_sha: f === 'artifact_head' ? 'e'.repeat(40) : head } }
  const current = options.nightly ? { ...run, id: 99999, run_number: 14, status: 'in_progress', conclusion: null, event: 'schedule' } : run
  const currentJobs = (options.nightly ? ['full', 'runtime-staging', 'real-customer-staging'] : ['smoke']).map((name, n) => ({ ...job, id: 600 + n,
    run_id: current.id, run_attempt: 2, name, conclusion: f === 'current_job_failed' ? 'failure' : 'success' }))
  return { run, current, jobs: [job, ...(!options.nightly ? currentJobs : [])], currentJobs, artifact, archive: zip.stdout }
}
// Exercise the existing runner artifact producer with finite child ports; no
// business command executes and no alternative manifest/case emitter exists.
function stageRunner(root: string, mode: string, runId: string, corrupt = false) {
  const writes = new Map<string, string>()
  const outputRoot = path.join(root, 'e2e-artifacts')
  new Script(readFileSync(producer, 'utf8'), { filename: producer }).runInNewContext({
    __dirname: path.join(root, 'scripts'), console: { log() {}, error() {} },
    process: { argv: ['node', producer, '--mode=' + mode], execPath: '/synthetic/node', env: { GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: '2' }, exitCode: 0 },
    require(name: string) {
      if (name === 'node:fs') return { mkdirSync() {}, existsSync() { return true }, readFileSync(file: string) {
        if (file.endsWith('package.json')) return readFileSync(path.resolve('package.json'), 'utf8')
        if (!writes.has(file)) throw Error('undeclared_runner_read:' + file)
        return writes.get(file)!
      }, writeFileSync(file: string, bytes: string) { writes.set(file, bytes) } }
      if (name === 'node:child_process') return { spawnSync(command: string, args: string[]) {
        return { status: 0, stdout: command === 'git' ? args.includes('HEAD^{tree}') ? tree : args.includes('--porcelain') ? '' : head : 'substituted child execution', stderr: '' }
      } }
      return localRequire(name)
    },
  })
  for (const [file, bytes] of writes) {
    const target = path.join(outputRoot, 'inputs', mode, path.relative(outputRoot, file))
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, corrupt && file.endsWith('gridex-e2e-junit.xml') ? bytes + 'corrupt' : bytes)
  }
}
function consume(options: Options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ops03-code-consumer-'))
  const provided = fixture(options), calls: string[][] = []
  const coverage = options.coverage ? coverageFixture(options) : undefined
  const processPort = { argv: ['node', producer, '--certificate=' + (options.nightly ? 'nightly' : 'pr')], env: {
    SMOKE_RESULT: options.ciFailed ? 'failure' : 'success', COVERAGE_RESULT: 'success', FULL_RESULT: 'success', RUNTIME_RESULT: 'success', REAL_RESULT: 'success', GITHUB_SHA: 'd'.repeat(40),
    GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: options.nightly ? '99999' : '12345', GITHUB_RUN_ATTEMPT: '2',
    ...(options.selfAttested ? { GRIDEX_EDIEL_RELEASE_EVIDENCE_PATH: '/self-attested.json', GRIDEX_EDIEL_CASE_DESCRIPTORS: '{"all":"trusted"}' } : {}),
  }, exitCode: 0 }
  const spawnPort: typeof spawnSync = ((command: string, args: string[], settings: Record<string, unknown>) => {
    calls.push([command, ...args])
    const good = (stdout: string | Buffer) => ({ status: 0, stdout, stderr: settings.encoding ? '' : Buffer.alloc(0) })
    if (command === 'git') {
      if (args[0] === '--no-replace-objects') args = args.slice(1)
      if (args[0] === 'ls-tree') {
        if (args[args.length - 1] === reviewedBase) return good(treeSnapshot.stdout)
        const target = options.fault === 'setup_input' ? 'scripts/gridex-aud-003-clean-replay.sh'
          : options.fault === 'transitive_input' ? 'scripts/helpers/native-fixture-company-identity.ts' : 'lib/ediel/services/projection.ts'
        const records = treeSnapshot.stdout.split('\0').filter(Boolean).flatMap(record => {
          if (options.ledgerChange && record.endsWith('\t' + ledgerFile)) {
            if (options.ledgerChange === 'deleted') return []
            const mode = options.ledgerChange === 'mode' ? '100755' : options.ledgerChange === 'symlink' ? '120000' : options.ledgerChange === 'type' ? '160000' : '100644'
            return [mode + (options.ledgerChange === 'type' ? ' commit ' : ' blob ') + 'e'.repeat(40) + '\t' + ledgerFile]
          }
          if (!record.endsWith('\t' + target)) return [record]
          if (options.fault === 'missing_input') return []
          if (options.fault === 'setup_input' || options.fault === 'transitive_input') return [record.replace(/[0-9a-f]{40}\t/, 'e'.repeat(40) + '\t')]
          if (options.fault === 'mode_input') return [record.replace(/^100644/, '100755')]
          if (options.fault === 'symlink_input') return ['120000 blob ' + 'e'.repeat(40) + '\t' + target]
          return [record]
        })
        if (options.fault === 'extra_input') records.push('100644 blob ' + 'e'.repeat(40) + '\tscripts/native-unreviewed-input.ts')
        return good(records.join('\0') + '\0')
      }
      if (args[0] === 'ls-files') {
        const ignored = args.includes('--ignored')
        return good(options.fault === (ignored ? 'ignored_input' : 'untracked_input') ? 'scripts/untracked-runtime-input.ts\0' : '')
      }
      if (args[0] === 'show') {
        const file = args[1].slice(args[1].indexOf(':') + 1)
        if (file === ledgerFile) return good(args[1].startsWith(reviewedBase + ':') || !options.ledgerChange ? ledgerSnapshot.stdout : candidateLedger(options.ledgerChange))
        const bytes = readFileSync(path.resolve(file))
        const changed = options.fault === 'source' && file === caseFile || options.coverageFault === 'source' && file === tgtFile
          || options.coverageFault === 'workflow_source' && file === '.github/workflows/full-e2e.yml'
          || options.fault === 'native_config_source' && file === 'scripts/ediel-source-owner-native.config.ts'
        return good(changed ? Buffer.concat([bytes, Buffer.from('\n// changed reviewed source')]) : bytes)
      }
      if (args[0] === 'config') return good(`https://github.com/${repository}.git`)
      return good(args.includes('HEAD^{tree}') ? tree : args.includes('--porcelain') ? '' : head)
    }
    if (command === 'gh') {
      if (options.fault === 'api') return { status: 1, stdout: '', stderr: 'finite unavailable API' }
      const endpoint = args[args.length - 1]
      if (endpoint === `repos/${repository}/git/commits/${head}`) return good(JSON.stringify({ sha: options.fault === 'commit' ? 'e'.repeat(40) : head, tree: { sha: options.fault === 'tree' ? 'e'.repeat(40) : tree } }))
      if (endpoint === `repos/${repository}/actions/runs?head_sha=${head}&per_page=100`) {
        const runs: Record<string, unknown>[] = options.fault === 'latest_cancelled' ? [{ ...provided.run, id: 99, run_number: 11, conclusion: 'success' }, provided.run] : [provided.run]
        if (coverage) {
          runs.push(coverage.run)
          if (options.nightly && options.coverageFault !== 'current_run') runs.push(coverage.current)
          if (options.coverageFault === 'latest_cancelled') runs.push({ ...coverage.run, id: 12344, run_number: 12, conclusion: 'success' })
          if (!options.nightly && options.coverageFault === 'current_run') coverage.run.id = 54321
        }
        return good(JSON.stringify({ total_count: runs.length, workflow_runs: runs }))
      }
      if (endpoint === 'repos/' + repository + '/actions/runs/100/attempts/2/jobs?per_page=100') return good(JSON.stringify({ total_count: 1, jobs: [provided.job] }))
      if (endpoint === 'repos/' + repository + '/actions/runs/100/artifacts?per_page=100') return good(JSON.stringify({ total_count: 1, artifacts: [provided.artifact] }))
      if (endpoint === 'repos/' + repository + '/actions/artifacts/300/zip') return good(provided.archive)
      if (coverage) {
        if (endpoint === 'repos/' + repository + '/actions/runs/12345/attempts/2/jobs?per_page=100') return good(JSON.stringify({ total_count: coverage.jobs.length, jobs: coverage.jobs }))
        if (endpoint === 'repos/' + repository + '/actions/runs/99999/attempts/2/jobs?per_page=100') return good(JSON.stringify({ total_count: coverage.currentJobs.length, jobs: coverage.currentJobs }))
        if (endpoint === 'repos/' + repository + '/actions/runs/12345/artifacts?per_page=100') return good(JSON.stringify({ total_count: 1, artifacts: [coverage.artifact] }))
        if (endpoint === 'repos/' + repository + '/actions/artifacts/500/zip') return good(coverage.archive)
        if (options.coverageFault === 'latest_cancelled') {
          if (endpoint === 'repos/' + repository + '/actions/runs/12344/attempts/2/jobs?per_page=100') return good(JSON.stringify({ total_count: coverage.jobs.length, jobs: coverage.jobs.map(job => ({ ...job, run_id: 12344 })) }))
          if (endpoint === 'repos/' + repository + '/actions/runs/12344/artifacts?per_page=100') return good(JSON.stringify({ total_count: 1, artifacts: [{ ...coverage.artifact, id: 499, name: 'gridex-coverage-12344', workflow_run: { ...coverage.artifact.workflow_run, id: 12344 } }] }))
          if (endpoint === 'repos/' + repository + '/actions/artifacts/499/zip') return good(coverage.archive)
        }
      }
      if (options.fault === 'latest_cancelled') {
        if (endpoint === 'repos/' + repository + '/actions/runs/99/attempts/2/jobs?per_page=100') return good(JSON.stringify({ total_count: 1, jobs: [{ ...provided.job, id: 199, run_id: 99 }] }))
        if (endpoint === 'repos/' + repository + '/actions/runs/99/artifacts?per_page=100') return good(JSON.stringify({ total_count: 1, artifacts: [{ ...provided.artifact, id: 299, workflow_run: { ...provided.artifact.workflow_run, id: 99 } }] }))
        if (endpoint === 'repos/' + repository + '/actions/artifacts/299/zip') return good(provided.archive)
      }
      throw Error('undeclared_github_endpoint:' + endpoint)
    }
    if (command === 'unzip') {
      const result = spawnSync(command, args, settings)
      if (options.fault === 'duplicate_zip' && args[0] === '-Z1') return good('rem002-native-junit.xml\nrem002-native-junit.xml\n')
      return result
    }
    throw Error('undeclared_child:' + command)
  }) as typeof spawnSync
  try {
    if (coverage && options.coverageFault !== 'runner_missing') for (const mode of options.nightly ? ['full', 'runtime', 'real'] : ['smoke']) stageRunner(root, mode, processPort.env.GITHUB_RUN_ID, options.coverageFault === 'runner_corrupt')
    new Script(readFileSync(producer, 'utf8'), { filename: producer }).runInNewContext({
      __dirname: path.join(root, 'scripts'), process: processPort, console: { log() {}, error() {} },
      require(name: string) {
        if (name === 'node:child_process') return { spawnSync: spawnPort }
        return localRequire(name)
      },
    })
    const certificate = JSON.parse(readFileSync(path.join(root, 'e2e-artifacts/' + (options.nightly ? 'nightly' : 'pr') + '-release-certificate.json'), 'utf8'))
    return { evidence: certificate.edielReleaseEvidence as Evidence, exit: processPort.exitCode, verdict: certificate.verdict as string, calls }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const dgi = (evidence: Evidence) => evidence.caseEvidence?.find(row => row.id === 'native_dgi_two_missions')
const ddq = (evidence: Evidence) => evidence.caseEvidence?.find(row => row.id === 'native_ddq_mixed_partition')

it('uses authenticated run/job/archive bytes and reviewed actual assertions for only the known native case effects', () => {
  const result = consume()
  expect(result.exit).toBe(0); expect(result.verdict).toBe('GREEN')
  expect(dgi(result.evidence)).toMatchObject({ status: 'qualified', sourceFile: caseFile,
    sourceSha256: '2989d5d7b6d0ee85ae450dcbaed3204f72ed92fb277d9ec245798c5aa637c0db',
    classes: ['integration', 'tenant_e2e'], effects: { DDQ: false, DGI: true, multipleTenants: true, crossTenantAssignments: true },
    ports: { postgres: 'real_local', postgrest: 'real_local', smtp: 'substituted', issuer: 'synthetic', tenantBootstrap: 'synthetic' },
    producer: { runId: '100', runAttempt: '2', artifactId: '300' } })
  expect(ddq(result.evidence)).toMatchObject({ status: 'qualified', sourceFile: ddqFile, effects: { DDQ: true, DGI: false } })
  expect(result.evidence.scopeMatrix).toMatchObject({ DDQ: true, DGI: true, crossTenantAssignments: true, tenantCountLowerBound: 2 })
  expect(result.evidence.levels.integration.status).toBe('qualified')
  expect(result.evidence.levels.tenant_e2e.status).toBe('qualified')
  for (const level of ['document', 'unit', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('missing')
  expect(result.evidence.codeEvidence).toBe('incomplete')
  expect(result.evidence.fullCardVerification).toBe('NOT_VERIFIED')
})
it('keeps live transport and authenticated TGT activation separate from modeled code-case evidence', () => {
  const result = consume()
  expect(result.evidence.activationGates).toEqual({ liveTransport: 'NOT_OBSERVED', formalTGT: 'NOT_OBSERVED' })
  expect(result.evidence.formalEdielApproval).toBe(false); expect(result.evidence.liveCounterpartyVerified).toBe(false)
})
it('refuses the latest cancelled producer despite its uploaded artifact and an older fully valid successful run on the same head', () => {
  const result = consume({ fault: 'latest_cancelled' })
  expect(result.evidence.caseEvidence ?? []).toEqual([])
  expect(result.evidence.scopeMatrix).toMatchObject({ DDQ: false, DGI: false, crossTenantAssignments: false })
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it.each(['api', 'repository', 'commit', 'tree', 'workflow', 'run', 'attempt', 'job', 'job_failed', 'artifact', 'artifact_head', 'artifact_run', 'expired', 'digest', 'artifact_attempt', 'duplicate_zip'] as const)('holds %s provenance without turning ordinary GREEN into class proof', fault => {
  const result = consume({ fault })
  expect(result.verdict).toBe('GREEN')
  expect(result.evidence.caseEvidence ?? []).toEqual([])
  expect(result.evidence.scopeMatrix).toMatchObject({ DDQ: false, DGI: false, crossTenantAssignments: false })
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it.each(['source', 'duplicate', 'skip', 'failure', 'error', 'missing', 'wrong_case', 'wrong_file'] as const)('never qualifies %s DGI assertion/result while retaining a distinct valid DDQ case', fault => {
  const result = consume({ fault })
  expect(dgi(result.evidence)).toBeUndefined()
  expect(ddq(result.evidence)?.status).toBe('qualified')
  expect(result.evidence.scopeMatrix).toMatchObject({ DDQ: true, DGI: false, crossTenantAssignments: false })
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it('refuses entity-bearing XML before any scope is qualified', () => {
  expect(consume({ fault: 'xml_entity' }).evidence.caseEvidence ?? []).toEqual([])
})
it.each(['DDQ', 'DGI'] as const)('keeps the matrix incomplete when the actual %s result is absent', role => {
  const result = consume({ ddq: role !== 'DDQ', dgi: role !== 'DGI' })
  expect(result.evidence.scopeMatrix[role]).toBe(false)
  expect(result.evidence.codeEvidence).toBe('incomplete')
  expect(result.evidence.blockers).toContain('scope_matrix_incomplete')
})
it('ignores malicious self-attested classes, ports and mixed tenant identities in environment or archive JSON', () => {
  const result = consume({ selfAttested: true, ddq: false })
  expect(dgi(result.evidence)?.status).toBe('qualified')
  expect(result.evidence.scopeMatrix.tenantIds).toEqual([])
  expect(result.evidence.scopeMatrix).toMatchObject({ DDQ: false, DGI: true, crossTenantAssignments: true })
  for (const level of ['document', 'unit', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('missing')
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it.each(['setup_input', 'transitive_input', 'missing_input', 'extra_input', 'mode_input', 'symlink_input', 'untracked_input', 'ignored_input'] as const)('holds %s execution input even when the unchanged assertion file and successful JUnit remain genuine', fault => {
  const result = consume({ fault })
  expect(result.evidence.caseEvidence ?? []).toEqual([])
  expect(result.evidence.levels.integration.status).toBe('missing')
  expect(result.evidence.levels.tenant_e2e.status).toBe('missing')
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it('coverage authenticates six separate code evidence classes and aggregate native matrix without external activation', () => {
  const result = consume({ coverage: true, selfAttested: true })
  for (const level of ['document', 'unit', 'integration', 'tenant_e2e', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('qualified')
  expect(result.evidence.codeEvidence).toBe('qualified')
  expect(result.evidence.fullCardVerification).toBe('CODE_VERIFIED')
  expect(result.evidence.activationGates).toEqual({ liveTransport: 'NOT_OBSERVED', formalTGT: 'NOT_OBSERVED' })
  expect(result.evidence.formalEdielApproval).toBe(false); expect(result.evidence.liveCounterpartyVerified).toBe(false)
  expect(result.evidence.caseEvidence?.find(row => row.id === 'coverage_tgt_code')).toMatchObject({ classes: ['TGT'], ports: { messages: 'synthetic', portal: 'not_entered' } })
  expect(result.calls.filter(row => row.at(-1) === `repos/${repository}/git/commits/${head}`)).toHaveLength(1)
  expect(result.calls.filter(row => row.at(-1) === `repos/${repository}/actions/runs?head_sha=${head}&per_page=100`)).toHaveLength(1)
  expect(result.calls.filter(row => row.at(-1) === `repos/${repository}/actions/runs/12345/attempts/2/jobs?per_page=100`)).toHaveLength(1)
})
it('refuses changed native-config bytes while retaining distinct coverage classes and authenticated CI', () => {
  // Change only git-show bytes; modeled tree, source cases, API and JUnit stay valid.
  const result = consume({ coverage: true, fault: 'native_config_source' })
  expect(result.exit).toBe(0); expect(result.verdict).toBe('GREEN')
  expect(dgi(result.evidence)).toBeUndefined(); expect(ddq(result.evidence)).toBeUndefined()
  for (const level of ['integration', 'tenant_e2e']) expect(result.evidence.levels[level].status).toBe('missing')
  for (const level of ['document', 'unit', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('qualified')
  expect(result.evidence.caseEvidence?.filter(row => row.id.startsWith('coverage_')).map(row => row.id)).toEqual([
    'coverage_mime_code', 'coverage_send_guard_code', 'coverage_tgt_code', 'coverage_document_integrity',
  ])
  expect(result.evidence.scopeMatrix).toMatchObject({ DDQ: false, DGI: false, crossTenantAssignments: false })
  expect(result.evidence.scopeMatrix.tenantCountLowerBound ?? 0).toBe(0)
  expect(result.evidence.blockers).toContain('case_artifact_missing_or_unqualified:native')
  expect(result.evidence.blockers).not.toContain('case_execution_inputs_changed')
  expect(result.evidence.blockers).not.toContain('case_source_missing_or_unqualified')
  expect(result.evidence.blockers).not.toContain('authenticated_ci_not_passed')
  expect(result.evidence.codeEvidence).toBe('incomplete')
  expect(result.evidence.fullCardVerification).toBe('NOT_VERIFIED')
})
it('coverage nightly reuses the latest successful PR/push producer on the same immutable head instead of a second coverage invocation', () => {
  const result = consume({ coverage: true, nightly: true })
  expect(result.evidence.codeEvidence).toBe('qualified')
  expect(result.evidence.caseEvidence?.find(row => row.id === 'coverage_tgt_code')?.producer).toMatchObject({ runId: '12345', runAttempt: '2', artifactId: '500' })
})
it.each(['decimal', 'hex'] as const)('coverage decodes numeric %s attribute references before exact reviewed-case selection', coverageNameEncoding => {
  const result = consume({ coverage: true, coverageNameEncoding })
  expect(result.evidence.fullCardVerification).toBe('CODE_VERIFIED')
  for (const level of ['unit', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('qualified')
})
it.each(['name_double_encoded', 'name_unknown_entity', 'name_html_entity', 'xml_entity'] as const)('coverage refuses %s without qualifying a differently named or declared-entity case', coverageFault => {
  const result = consume({ coverage: true, coverageFault })
  for (const level of ['unit', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('missing')
  expect(result.evidence.caseEvidence?.filter(row => ['coverage_mime_code', 'coverage_send_guard_code', 'coverage_tgt_code'].includes(row.id))).toEqual([])
  expect(result.evidence.levels.integration.status).toBe('qualified')
  expect(result.evidence.fullCardVerification).toBe('NOT_VERIFIED')
})
it.each(['decimal_suffix', 'hex_suffix', 'uppercase_hex', 'null', 'control', 'surrogate', 'noncharacter', 'above_range'] as const)('coverage refuses invalid numeric %s attributes before a permissive decoder can rename a case', numericReferenceFault => {
  const result = consume({ coverage: true, numericReferenceFault })
  for (const level of ['unit', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('missing')
  expect(result.evidence.caseEvidence?.filter(row => ['coverage_mime_code', 'coverage_send_guard_code', 'coverage_tgt_code'].includes(row.id))).toEqual([])
  expect(result.evidence.levels.integration.status).toBe('qualified')
  expect(result.evidence.fullCardVerification).toBe('NOT_VERIFIED')
})
it('coverage accepts reference-like literal text in comments, processing instructions and CDATA without inventing an attribute or testcase', () => {
  const result = consume({ coverage: true, coverageReferenceText: true })
  expect(result.evidence.fullCardVerification).toBe('CODE_VERIFIED')
  for (const level of ['unit', 'transport', 'TGT']) expect(result.evidence.levels[level].status).toBe('qualified')
  expect(result.evidence.caseEvidence?.filter(row => row.id.startsWith('coverage_'))).toHaveLength(4)
})
it.each([['document_missing', 'document'], ['document_conformance', 'document'], ['mime_missing', 'transport'], ['guard_missing', 'transport'], ['tgt_missing', 'TGT'], ['tgt_skipped', 'TGT'], ['tgt_duplicate', 'TGT'], ['suite_name', 'TGT'], ['source', 'TGT']] as const)('coverage keeps %s out of its %s class while preserving other authentic result classes', (coverageFault, level) => {
  const result = consume({ coverage: true, coverageFault })
  expect(result.evidence.levels[level].status).toBe('missing')
  expect(result.evidence.levels.integration.status).toBe('qualified')
  expect(result.evidence.levels.tenant_e2e.status).toBe('qualified')
  expect(result.evidence.levels[level === 'TGT' ? 'unit' : 'TGT'].status).toBe('qualified')
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it.each(['workflow_source', 'head', 'attempt', 'job', 'job_failed', 'artifact', 'artifact_head', 'artifact_run', 'artifact_attempt', 'digest', 'expired', 'latest_cancelled'] as const)('coverage rejects %s provenance and never uses an older uploaded success instead', coverageFault => {
  const result = consume({ coverage: true, coverageFault })
  expect(result.evidence.caseEvidence?.filter(row => row.id.startsWith('coverage_')) ?? []).toEqual([])
  expect(result.evidence.levels.integration.status).toBe('qualified')
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it.each(['run_failed', 'current_run', 'current_job_failed', 'runner_missing', 'runner_corrupt'] as const)('coverage refuses complete release qualification for %s even with six successful result classes', coverageFault => {
  const result = consume({ coverage: true, coverageFault })
  expect(result.evidence.codeEvidence).toBe('incomplete')
  expect(result.evidence.fullCardVerification).toBe('NOT_VERIFIED')
})
it('coverage retains bounded code cases from a failed overall producer but never passes its CI release', () => {
  const result = consume({ coverage: true, coverageFault: 'run_failed' })
  expect(result.evidence.levels.TGT.status).toBe('qualified')
  expect(result.evidence.codeEvidence).toBe('incomplete')
  expect(result.evidence.blockers).toContain('authenticated_ci_not_passed')
})
it.each(['DDQ', 'DGI'] as const)('coverage does not promote whole OPS03 when %s native scope is missing', role => {
  const result = consume({ coverage: true, ddq: role !== 'DDQ', dgi: role !== 'DGI' })
  expect(result.evidence.levels.TGT.status).toBe('qualified')
  expect(result.evidence.scopeMatrix[role]).toBe(false)
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it('coverage denies supplied CI failure despite authentic class and matrix results', () => {
  const result = consume({ coverage: true, ciFailed: true })
  expect(result.verdict).toBe('RED'); expect(result.exit).toBe(1)
  expect(result.evidence.codeEvidence).toBe('incomplete')
})
it('ledger permits only the exact atomic OPS03 and AT promotion while preserving all 350 foreign rows and metadata bytes', () => {
  const result = consume({ coverage: true, ledgerChange: 'approved' })
  expect(result.evidence.codeEvidence).toBe('qualified')
  expect(result.evidence.fullCardVerification).toBe('CODE_VERIFIED')
  expect(result.evidence.caseEvidence).toHaveLength(6)
})
it.each(['foreign_rule_status', 'foreign_at_status', 'foreign_evidence', 'spec', 'metadata', 'row_order', 'missing', 'extra', 'invalid_evidence', 'duplicate_evidence', 'evidence_order', 'own_extra_field', 'own_wrong_status', 'one_row', 'foreign_whitespace', 'duplicate_key', 'invalid_json', 'mode', 'symlink', 'deleted', 'type'] as const)('ledger holds %s despite authentic six-class results and exact-head CI', ledgerChange => {
  const result = consume({ coverage: true, ledgerChange })
  expect(result.evidence.caseEvidence ?? []).toEqual([])
  expect(result.evidence.codeEvidence).toBe('incomplete')
  expect(result.evidence.blockers).toContain('case_source_missing_or_unqualified')
})
