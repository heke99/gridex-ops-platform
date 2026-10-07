#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

// OPS03 records runner execution custody separately from ordinary CI GREEN.
// Individual source-reviewed cases use authenticated existing artifacts below;
// neither channel implies an external counterparty or portal approval.
function checkoutSource(root) {
  function git(args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 })
    return result.status === 0 ? String(result.stdout || '').trim() : null
  }
  const commit = git(['rev-parse', 'HEAD']), tree = git(['rev-parse', 'HEAD^{tree}'])
  return {
    candidateSha: /^[0-9a-f]{40}$/.test(commit || '') ? commit : null,
    candidateTree: /^[0-9a-f]{40}$/.test(tree || '') ? tree : null,
    checkoutClean: git(['status', '--porcelain', '--untracked-files=normal']) === '',
    eventSha: process.env.GITHUB_SHA || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  }
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
function runnerArtifactPaths(report) {
  const logs = report.results.filter(row => row.log_file).map(row => {
    if (!/^e2e-artifacts\/logs\/[^/]+\.log$/.test(row.log_file)) throw Error('runner_log_reference_invalid')
    return row.log_file.slice('e2e-artifacts/'.length)
  })
  return ['gridex-e2e-report.json', 'gridex-e2e-junit.xml', ...logs]
}

// Reviewed individual assertions, not filenames or producer-supplied labels.
// The native owners retain their fixture/SQL/capture interfaces. Changing any
// pinned assertion/port source requires reviewing this narrow descriptor again.
const nativeCaseBindings = [
  { id: 'native_dgi_two_missions', sourceFile: 'scripts/ediel-sc-003-005-service-native.test.ts',
    sourceSha256: '2989d5d7b6d0ee85ae450dcbaed3204f72ed92fb277d9ec245798c5aa637c0db',
    name: 'SC003/SC005 legal provider DGI uses one permission and one E66 storage/disposition/physical ACK for two independently valid scoped missions',
    sources: [['scripts/fixtures/ediel-service-evidence-native.ts', '136758c6742f4f8896fb5bc81a14eebfaf8902458b0b46f0275af72f8de890b0']],
    classes: ['integration', 'tenant_e2e'],
    effects: { DDQ: false, DGI: true, multipleTenants: true, crossTenantAssignments: true, tenantCountLowerBound: 2 },
    ports: { postgres: 'real_local', postgrest: 'real_local', smtp: 'substituted', issuer: 'synthetic', tenantBootstrap: 'synthetic' } },
  { id: 'native_ddq_mixed_partition', sourceFile: 'scripts/ediel-prodat-mixed-native.test.ts',
    sourceSha256: '2fcdfcd2da03577614814c9d7b2d90886eb4e0a0bf8906defd6920ee2e2486a6',
    name: 'the partition owner commits only the full-guide own object and its one complete mixed BGM34 reply is routed and queued',
    sources: [['scripts/helpers/ediel-normal-switch-native-fixture.ts', 'b03ed608fe49648281b11bbd8a83e09673a7aa6a08f51a4e661d38a58e826cdc'],
      ['scripts/helpers/ediel-mixed-prodat-native-wire.ts', '205e06a7d4a94aeabd4ef9e64c8b0953a558a8fea0844a96213a322eb968126a']],
    classes: ['integration'],
    effects: { DDQ: true, DGI: false, multipleTenants: false, crossTenantAssignments: false, tenantCountLowerBound: 1 },
    ports: { postgres: 'real_local', postgrest: 'real_local', smtp: 'substituted', issuer: 'synthetic', tenantBootstrap: 'synthetic' } },
]
const reviewedNativeInputBase = 'b83b284467c8e0fcaa277706a708706e0a705068'
const ownedNativeInputExceptions = ['scripts/gridex-full-production-e2e.cjs', '__tests__/ediel-ops-03-code-release-evidence.test.ts',
  '.agent-memory/masterplan-ops03-checkpoint.md', '.github/workflows/full-e2e.yml']
const coverageLedgerPath = 'quality/audits/ediel-masterplan-v2/coverage.json'
const approvedOpsEvidence = ['scripts/gridex-full-production-e2e.cjs', '__tests__/ediel-ops-03-code-release-evidence.test.ts',
  '__tests__/ediel-ops-03-release-evidence.test.ts', '.github/workflows/full-e2e.yml']
function ownedCoverageUpdate(command, candidateSha, before, after) {
  if (!before || !after || before.type !== 'blob' || after.type !== 'blob' || before.mode !== '100644' || after.mode !== before.mode) return false
  if (before.record === after.record) return true
  const original = String(command('git', ['--no-replace-objects', 'show', reviewedNativeInputBase + ':' + coverageLedgerPath], 2 * 1024 * 1024))
  const candidate = String(command('git', ['--no-replace-objects', 'show', candidateSha + ':' + coverageLedgerPath], 2 * 1024 * 1024))
  const ledger = JSON.parse(original)
  if (!Array.isArray(ledger.rules) || ledger.rules.length !== 121 || !Array.isArray(ledger.acceptance_contracts) || ledger.acceptance_contracts.length !== 231) return false
  const rules = ledger.rules.filter(row => row.id === 'OPS-03'), acceptances = ledger.acceptance_contracts.filter(row => row.id === 'AT-OPS-03')
  if (rules.length !== 1 || acceptances.length !== 1) return false
  const rule = rules[0], acceptance = acceptances[0]
  if (JSON.stringify(rule) !== JSON.stringify({ id: 'OPS-03', acceptance_id: 'AT-OPS-03', status: 'NOT_VERIFIED', evidence: [] })
    || JSON.stringify(acceptance) !== JSON.stringify({ id: 'AT-OPS-03', status: 'NOT_EXECUTED', evidence: [] })) return false
  // Two exact immutable row spans, not a fifth arbitrary content exception.
  // Every foreign byte/order/key/metadata, including whitespace, stays intact.
  // Equality to this expected text also rejects duplicate-key JSON ambiguity.
  const rowBytes = row => JSON.stringify(row, null, 2).split('\n').map(line => '    ' + line).join('\n')
  let expected = original
  for (const [row, status] of [[rule, 'VERIFIED'], [acceptance, 'PASSED']]) {
    const oldBytes = rowBytes(row), nextBytes = rowBytes({ ...row, status, evidence: approvedOpsEvidence })
    if (expected.split(oldBytes).length !== 2) return false
    expected = expected.replace(oldBytes, nextBytes)
  }
  return candidate === expected
}
function unchangedNativeExecutionInputs(command, candidateSha) {
  function tree(commit) {
    const text = String(command('git', ['--no-replace-objects', 'ls-tree', '-r', '-z', '--full-tree', commit], 5 * 1024 * 1024))
    if (!text.endsWith('\0')) throw Error('input_tree_incomplete')
    const entries = new Map()
    for (const entry of text.slice(0, -1).split('\0')) {
      const match = /^([0-7]{6}) (blob|commit) ([0-9a-f]{40})\t([^\0]+)$/.exec(entry)
      if (!match || entries.has(match[4])) throw Error('input_tree_invalid')
      entries.set(match[4], { mode: match[1], type: match[2], record: entry })
    }
    return entries
  }
  const baseline = tree(reviewedNativeInputBase), candidate = tree(candidateSha)
  for (const name of new Set([...baseline.keys(), ...candidate.keys()])) {
    const before = baseline.get(name), after = candidate.get(name)
    if (name === coverageLedgerPath) {
      if (!ownedCoverageUpdate(command, candidateSha, before, after)) return false
    } else if (ownedNativeInputExceptions.includes(name)) {
      // Only reviewed content edits in these four regular files are exempt.
      // Deletions, symlinks or executable-bit changes are never exemptions.
      if (!after || after.type !== 'blob' || after.mode !== (before?.mode || '100644') || !['100644', '100755'].includes(after.mode)) return false
    } else if (!before || !after || before.record !== after.record) return false
  }
  if (String(command('git', ['--no-replace-objects', 'ls-files', '--others', '--exclude-standard', '-z']))) return false
  // These existing managed channels are not new source exceptions: npm ci
  // installs lock-bound dependencies; workflow coverage and certificates put
  // generated reports/downloads in the two gitignored output directories.
  // Ignore rules alone cannot authorize another helper/config/SQL/runtime file.
  const ignored = command('git', ['--no-replace-objects', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', '.',
    ':(exclude)node_modules', ':(exclude)coverage', ':(exclude)e2e-artifacts'])
  return String(ignored) === ''
}
// Source-reviewed code cases: synthetic ports are explicit and never become
// live delivery, SQL integration or formal portal-approval assertions.
const coverageCaseBindings = [
  { id: 'coverage_mime_code', sourceFile: '__tests__/ediel-transport-byte-integrity.test.ts',
    sourceSha256: '8552b2921e1b76aa77f9a6181db117ca9e04366f57233e76e151cd605b70d530',
    name: 'ENV-01 lossless bytes at every SMTP packaging boundary > MIME mode 1 preserves Swedish ISO8859-1 bytes',
    classes: ['unit', 'transport'], qualification: 'code_modelling',
    ports: { mimeBuilder: 'real_pure_function', encoding: 'real_node_buffer', database: 'not_entered', provider: 'not_entered' } },
  { id: 'coverage_send_guard_code', sourceFile: '__tests__/ediel-transport-byte-integrity.test.ts',
    sourceSha256: '8552b2921e1b76aa77f9a6181db117ca9e04366f57233e76e151cd605b70d530',
    name: 'ENV-01 lossless bytes at every SMTP packaging boundary > the actual send path rejects before route, archive, attempt or provider effects',
    classes: ['unit', 'transport'], qualification: 'code_modelling',
    ports: { sendGuard: 'real_product_function', acceptedProjection: 'modeled_rpc', databaseEffects: 'fail_traps', providerEffects: 'fail_traps' } },
  { id: 'coverage_tgt_code', sourceFile: '__tests__/ediel-prodat-register-tgt-workflow.test.ts',
    sourceSha256: 'bfb52aa18f28f62794546d881a798bc2d979dc532bced44c0564741aa95d81ed',
    name: 'actual TGT workflow surrounding PRODAT register exchange > requires distinct messages for repeated acknowledgements and reports completion separately from portal approval',
    classes: ['TGT'], qualification: 'code_modelling', ports: { stateMachine: 'real_product_function', messages: 'synthetic', portal: 'not_entered' } },
]
const coverageWorkflowSha256 = '4b596a8e9b72835a89a6fff9bb77fdcad7eabb52bd1de5b03fa208344fa4bd31'
const documentBinding = { id: 'coverage_document_integrity', sourceFile: 'scripts/check-ediel-masterplan-v2.cjs',
  sourceSha256: '4ed209736d9aa05ca07e56943bb043b62e36f26069a96771c34d03f90a96591c',
  classes: ['document'], qualification: 'specification_integrity_and_evidence_references_only', ports: { filesystem: 'real_local' } }
const documentOutput = { scope: 'specification integrity and evidence references only', originalFiles: 33, rules: 121,
  acceptanceContracts: 231, applicationConformanceAsserted: false, productionReadinessAsserted: false }
function consumeReviewedCodeEvidence(root, source, blockers, modes) {
  const repository = process.env.GITHUB_REPOSITORY
  const caseEvidence = []
  let ciQualified = false
  if (!repository || !source.candidateSha || !source.candidateTree || !source.checkoutClean) return { caseEvidence, ciQualified }
  function command(executable, args, maxBuffer = 2 * 1024 * 1024) {
    const result = spawnSync(executable, args, { cwd: root, timeout: 15000, maxBuffer })
    if (result.status !== 0 || result.stdout == null) throw Error('case_source_command_failed')
    return result.stdout
  }
  const apiCache = new Map(), sourceCache = new Map()
  function api(endpoint) {
    if (!apiCache.has(endpoint)) apiCache.set(endpoint, JSON.parse(String(command('gh', ['api', '--hostname', 'github.com', '--method', 'GET', 'repos/' + repository + '/' + endpoint]))))
    return apiCache.get(endpoint)
  }
  function sourceMatches(file, digest) {
    if (!sourceCache.has(file)) sourceCache.set(file, sha256(command('git', ['--no-replace-objects', 'show', source.candidateSha + ':' + file], 5 * 1024 * 1024)))
    return sourceCache.get(file) === digest
  }
  function inventory(endpoint, key) {
    const value = api(endpoint)
    if (!Array.isArray(value[key]) || !Number.isSafeInteger(value.total_count) || value.total_count < 0 || value.total_count > value[key].length) throw Error('case_inventory_incomplete')
    return value[key]
  }
  function identity(run, workflow) {
    return run.head_sha === source.candidateSha && run.path === workflow && run.repository?.full_name === repository && run.head_repository?.full_name === repository
      && Number.isSafeInteger(run.repository.id) && run.repository.id > 0 && run.head_repository.id === run.repository.id
      && Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0
      && Number.isSafeInteger(run.run_number) && run.run_number > 0
  }
  function latestRun(runs, workflow) {
    const matches = runs.filter(run => run.path === workflow && ['pull_request', 'push'].includes(run.event))
    if (!matches.length || !matches.every(run => Number.isSafeInteger(run.run_number) && run.run_number > 0)) throw Error('case_run_identity_invalid')
    const latestNumber = Math.max(...matches.map(run => run.run_number)), latest = matches.filter(run => run.run_number === latestNumber)
    if (latest.length !== 1 || !identity(latest[0], workflow)) throw Error('case_latest_run_ambiguous_or_unqualified')
    return latest[0]
  }
  function jobs(run) { return inventory('actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs?per_page=100', 'jobs') }
  function successfulJob(run, name) {
    const selected = jobs(run).filter(job => job.name === name && job.run_id === run.id && job.run_attempt === run.run_attempt)
    if (selected.length !== 1 || selected[0].status !== 'completed' || selected[0].conclusion !== 'success'
      || !Number.isSafeInteger(selected[0].id) || selected[0].id <= 0) throw Error('case_job_not_qualified')
    return selected[0]
  }
  function readArtifact(run, job, artifactName, consume) {
    let directory
    try {
      const selected = inventory('actions/runs/' + run.id + '/artifacts?per_page=100', 'artifacts').filter(artifact => artifact.name === artifactName && artifact.expired === false
        && artifact.workflow_run?.id === run.id && artifact.workflow_run.head_sha === source.candidateSha
        && artifact.workflow_run.repository_id === run.repository.id && artifact.workflow_run.head_repository_id === run.head_repository.id)
      if (selected.length !== 1) throw Error('case_artifact_not_unique')
      const artifact = selected[0], created = Date.parse(artifact.created_at), started = Date.parse(job.started_at), ended = Date.parse(job.completed_at)
      // Artifact metadata lacks an attempt number. Its upload must lie inside
      // this exact successful producer job's execution window, never an old run.
      if (![created, started, ended].every(Number.isFinite) || started > ended || created < started || created > ended
        || !Number.isSafeInteger(artifact.id) || artifact.id <= 0 || !Number.isSafeInteger(artifact.size_in_bytes)
        || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > 64 * 1024 * 1024 || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest || '')) throw Error('case_artifact_binding_invalid')
      const archive = command('gh', ['api', '--hostname', 'github.com', '--method', 'GET', 'repos/' + repository + '/actions/artifacts/' + artifact.id + '/zip'], 64 * 1024 * 1024)
      const archiveHash = sha256(archive)
      if (artifact.digest !== 'sha256:' + archiveHash || archive.length !== artifact.size_in_bytes) throw Error('case_artifact_digest_mismatch')
      directory = fs.mkdtempSync(path.join(root, 'e2e-artifacts', 'ops03-download-'))
      const archivePath = path.join(directory, 'source.zip')
      fs.writeFileSync(archivePath, archive)
      const entries = String(command('unzip', ['-Z1', archivePath])).trim().split(/\r?\n/)
      function read(name) {
        if (entries.filter(entry => entry === name).length !== 1) throw Error('case_artifact_member_not_unique')
        return String(command('unzip', ['-p', archivePath, name], 8 * 1024 * 1024))
      }
      const producer = { repository, workflow: run.path, job: job.name, runId: String(run.id), runAttempt: String(run.run_attempt),
        artifactId: String(artifact.id), artifactSha256: archiveHash }
      return consume(read, producer)
    } finally { if (directory) fs.rmSync(directory, { recursive: true, force: true }) }
  }
  function junitCases(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('case_junit_entity_forbidden')
    const { XMLParser, XMLValidator } = require('fast-xml-parser')
    if (XMLValidator.validate(xml) !== true) throw Error('case_junit_invalid')
    // The locked decoder accepts numeric prefixes and drops prohibited scalar
    // values. Check complete attribute references before it can rename a case.
    function attributeReferences(value) {
      for (let at = value.indexOf('&'); at !== -1;) {
        const end = value.indexOf(';', at + 1)
        if (end === -1) throw Error('case_junit_reference_invalid')
        const token = value.slice(at + 1, end)
        if (!/^(?:amp|lt|gt|quot|apos)$/.test(token)) {
          const numeric = /^#(?:([0-9]+)|x([0-9a-fA-F]+))$/.exec(token)
          if (!numeric) throw Error('case_junit_reference_invalid')
          const cp = numeric[1] === undefined ? Number.parseInt(numeric[2], 16) : Number(numeric[1])
          if (!Number.isSafeInteger(cp) || !(cp === 9 || cp === 10 || cp === 13 ||
            (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) ||
            (cp >= 0x10000 && cp <= 0x10FFFF))) throw Error('case_junit_reference_invalid')
        }
        at = value.indexOf('&', end + 1)
      }
    }
    // Comments, CDATA and processing instructions contain literal text rather
    // than attributes; quoted > and < within a value must not split its tag.
    for (let at = 0; (at = xml.indexOf('<', at)) !== -1;) {
      const terminator = xml.startsWith('<!--', at) ? '-->' : xml.startsWith('<![CDATA[', at) ? ']]>' : xml.startsWith('<?', at) ? '?>' : null
      if (terminator) {
        const end = xml.indexOf(terminator, at + 2)
        if (end === -1) throw Error('case_junit_invalid')
        at = end + terminator.length
        continue
      }
      for (at++; at < xml.length && xml[at] !== '>'; at++) {
        if (xml[at] !== '"' && xml[at] !== "'") continue
        const end = xml.indexOf(xml[at], at + 1)
        if (end === -1) throw Error('case_junit_invalid')
        attributeReferences(xml.slice(at + 1, end))
        at = end
      }
      at++
    }
    // Decode standard attribute references (Vitest emits &gt; in suite names)
    // after rejecting all DOCTYPE/ENTITY declarations above.
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', processEntities: true,
      // This locked parser couples numeric references to htmlEntities. Supply
      // only XML's five predefined names, never the larger HTML entity set.
      htmlEntities: { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }, parseAttributeValue: false }).parse(xml)
    const testcases = []
    function collect(node) {
      if (!node || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) {
        const values = Array.isArray(value) ? value : [value]
        if (key === 'testcase') testcases.push(...values)
        else values.forEach(collect)
      }
    }
    collect(parsed)
    return testcases
  }
  function qualified(binding, producer) {
    return { id: binding.id, status: 'qualified', sourceFile: binding.sourceFile, sourceSha256: binding.sourceSha256,
      classes: binding.classes, qualification: binding.qualification || 'reviewed_native_case',
      effects: binding.effects || { DDQ: false, DGI: false, multipleTenants: false, crossTenantAssignments: false, tenantCountLowerBound: 0 }, ports: binding.ports,
      inputSource: { reviewedBaseSha: reviewedNativeInputBase, comparison: 'immutable_tree_mode_type_blob_path', ownedExceptions: ownedNativeInputExceptions,
        allowedCoverageDelta: { path: coverageLedgerPath, rule: 'OPS-03:VERIFIED', acceptance: 'AT-OPS-03:PASSED', evidencePaths: approvedOpsEvidence,
          comparison: 'atomic_two_row_spans_all_other_bytes_unchanged' } }, producer }
  }
  function cases(bindings, xml, producer) {
    const testcases = junitCases(xml)
    return bindings.flatMap(binding => {
      try {
        if (!sourceMatches(binding.sourceFile, binding.sourceSha256) || !(binding.sources || []).every(([file, digest]) => sourceMatches(file, digest))) throw Error('case_assertions_changed')
        const selected = testcases.filter(testcase => testcase.classname === binding.sourceFile && testcase.name === binding.name)
        if (selected.length !== 1 || ['failure', 'error', 'skipped'].some(key => Object.prototype.hasOwnProperty.call(selected[0], key))) throw Error('case_result_missing_or_failed')
        return [qualified(binding, { ...producer, junitSha256: sha256(xml) })]
      } catch { blockers.push('case_result_missing_or_unqualified:' + binding.id); return [] }
    })
  }
  try {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw Error('case_repository_invalid')
    const remote = String(command('git', ['config', '--get', 'remote.origin.url'])).trim().replace(/\.git$/, '')
    if (remote !== 'https://github.com/' + repository && remote !== 'git@github.com:' + repository) throw Error('case_repository_mismatch')
    if (!unchangedNativeExecutionInputs(command, source.candidateSha)) throw Error('case_execution_inputs_changed')
    const commit = api('git/commits/' + source.candidateSha)
    if (commit.sha !== source.candidateSha || commit.tree?.sha !== source.candidateTree) throw Error('case_commit_mismatch')
    const runs = inventory('actions/runs?head_sha=' + source.candidateSha + '&per_page=100', 'workflow_runs')
    try {
      const workflow = '.github/workflows/ops-hardening.yml'
      if (!sourceMatches(workflow, 'eceef159107cc788bb0188e43874ed20fbcf9acdbd9a0f259ef68e20b5c6a261')
        || !sourceMatches('scripts/ediel-source-owner-native.config.ts', '722e7d4f59e4fcb851e258d9f1b1f58136a24aeb04af4a4167371db93874fe56')) throw Error('case_producer_source_changed')
      const run = latestRun(runs, workflow)
      if (run.status !== 'completed' || run.conclusion !== 'success') throw Error('case_latest_run_not_qualified')
      caseEvidence.push(...readArtifact(run, successfulJob(run, 'clean-migration-replay'), 'gridex-rem-002-clean-replay', (read, producer) => cases(nativeCaseBindings, read('rem002-native-junit.xml'), producer)))
    } catch { blockers.push('case_artifact_missing_or_unqualified:native') }
    try {
      const workflow = '.github/workflows/full-e2e.yml'
      if (!sourceMatches(workflow, coverageWorkflowSha256)) throw Error('case_producer_source_changed')
      const run = latestRun(runs, workflow)
      const ownRun = String(run.id) === source.runId && String(run.run_attempt) === source.runAttempt
      // A PR certificate runs inside its own in-progress workflow, after the
      // coverage job. Nightly reuses latest PR/push coverage on this same head;
      // it never runs a second coverage producer or substitutes an older head.
      if (!(run.status === 'completed' && ['success', 'failure'].includes(run.conclusion))
        && !(ownRun && run.status === 'in_progress' && run.conclusion === null)) throw Error('case_latest_run_not_qualified')
      caseEvidence.push(...readArtifact(run, successfulJob(run, 'coverage'), 'gridex-coverage-' + run.id, (read, producer) => {
        const results = cases(coverageCaseBindings, read('ediel-unit-junit.xml'), producer)
        try {
          if (!sourceMatches(documentBinding.sourceFile, documentBinding.sourceSha256)) throw Error('document_checker_changed')
          const bytes = read('ediel-document-integrity.json'), output = JSON.parse(bytes)
          if (!output || Object.keys(output).length !== Object.keys(documentOutput).length || !Object.entries(documentOutput).every(([key, value]) => output[key] === value)) throw Error('document_result_not_qualified')
          results.push(qualified(documentBinding, { ...producer, command: 'node scripts/check-ediel-masterplan-v2.cjs', outputSha256: sha256(bytes) }))
        } catch { blockers.push('case_result_missing_or_unqualified:' + documentBinding.id) }
        return results
      }))
      const current = runs.filter(row => identity(row, workflow) && String(row.id) === source.runId && String(row.run_attempt) === source.runAttempt)
      if (current.length !== 1) throw Error('current_ci_run_not_authenticated')
      const ciRun = current[0], pr = modes.length === 1 && modes[0] === 'smoke'
      if (pr && (!ownRun || ciRun.event !== 'pull_request') || !pr && !['schedule', 'workflow_dispatch'].includes(ciRun.event)) throw Error('current_ci_mode_not_authenticated')
      if (!(ciRun.status === 'in_progress' && ciRun.conclusion === null) && !(ciRun.status === 'completed' && ciRun.conclusion === 'success')) throw Error('current_ci_run_not_passed')
      if (!ownRun && !(run.status === 'completed' && run.conclusion === 'success')) throw Error('coverage_ci_run_not_passed')
      for (const name of pr ? ['smoke', 'coverage'] : ['full', 'runtime-staging', 'real-customer-staging']) successfulJob(ciRun, name)
      ciQualified = true
    } catch { blockers.push('case_artifact_missing_or_unqualified:coverage') }
  } catch { blockers.push('case_source_missing_or_unqualified') }
  if (!ciQualified) blockers.push('authenticated_ci_not_passed')
  return { caseEvidence, ciQualified }
}
function assembleEdielReleaseEvidence(root, ciPassed, modes) {
  const source = checkoutSource(root), blockers = []
  if (!source.candidateSha || !source.candidateTree || !source.checkoutClean) blockers.push('checkout_provenance_unqualified')
  if (!ciPassed) blockers.push('ci_not_passed')
  const executions = modes.map(mode => {
    const directory = path.join(root, 'e2e-artifacts', 'inputs', mode)
    const sourceReference = path.relative(root, path.join(directory, 'gridex-executed-evidence.json'))
    try {
      const indexBytes = fs.readFileSync(path.join(directory, 'gridex-executed-evidence.json'))
      const index = JSON.parse(String(indexBytes))
      if (index.format !== 'gridex_runner_execution_artifact_v1' || index.mode !== mode || index.sourceUnchanged !== true
        || !source.candidateSha || !source.candidateTree || !source.checkoutClean || !source.runId || !source.runAttempt
        || index.source?.checkoutClean !== true || index.source.candidateSha !== source.candidateSha || index.source.candidateTree !== source.candidateTree
        || index.source.runId !== source.runId || index.source.runAttempt !== source.runAttempt || !Array.isArray(index.files)) throw Error('runner_source_unqualified')
      const report = JSON.parse(String(fs.readFileSync(path.join(directory, 'gridex-e2e-report.json'))))
      if (report.schema_version !== 2 || report.suite !== 'gridex-full-production-e2e' || report.mode !== mode || report.status !== 'passed'
        || !Array.isArray(report.results) || !report.results.length || report.summary?.total !== report.results.length
        || report.summary.passed !== report.results.length || report.summary.failed !== 0
        || !report.results.every(row => row.status === 'passed' && row.exit_code === 0 && row.log_file)) throw Error('runner_result_unqualified')
      const requiredPaths = runnerArtifactPaths(report)
      if (index.files.length !== requiredPaths.length || new Set(index.files.map(file => file.path)).size !== requiredPaths.length) throw Error('runner_artifact_set_unqualified')
      for (const reference of requiredPaths) {
        const file = index.files.find(entry => entry.path === reference)
        if (!file || !/^[0-9a-f]{64}$/.test(file.sha256 || '') || sha256(fs.readFileSync(path.join(directory, reference))) !== file.sha256) throw Error('runner_artifact_bytes_unqualified')
      }
      return { mode, status: 'qualified', qualification: 'runner_step_exit_status', sourceReference, payloadSha256: sha256(indexBytes),
        files: index.files, stepCount: report.results.length,
        steps: report.results.map(row => ({ id: row.id, kind: row.kind, command: row.script || row.file, status: row.status })),
        limits: ['JUnit records orchestrator steps, not individual test cases.',
          'Successful commands do not qualify test ports, tenant roles, DDQ/DGI assignments, transport or TGT.'] }
    } catch {
      blockers.push('runner_artifact_missing_or_unqualified:' + mode)
      return { mode, status: 'unqualified', sourceReference }
    }
  })
  // Individual results through the authenticated existing producer channel may
  // establish only the source-reviewed classes/effects of those exact cases.
  const { caseEvidence, ciQualified } = consumeReviewedCodeEvidence(root, source, blockers, modes)
  const levels = Object.fromEntries(['document', 'unit', 'integration', 'tenant_e2e', 'transport', 'TGT']
    .map(level => [level, { status: 'missing', qualification: 'not_established_by_runner_step_results' }]))
  for (const level of Object.keys(levels)) {
    const cases = caseEvidence.filter(row => row.classes.includes(level))
    const transportComplete = level !== 'transport' || ['coverage_mime_code', 'coverage_send_guard_code'].every(id => cases.some(row => row.id === id))
    if (cases.length && transportComplete) levels[level] = { status: 'qualified', qualification: level === 'document' ? documentBinding.qualification
      : ['transport', 'TGT'].includes(level) ? 'code_modelling' : 'reviewed_individual_code_case',
      ...(level === 'transport' ? { effectClass: 'transport_code' } : level === 'TGT' ? { effectClass: 'TGT_code' } : {}), caseReferences: cases.map(row => row.id) }
    else blockers.push('evidence_level_missing_or_unqualified:' + level)
  }
  const scopeMatrix = { tenantIds: [], DDQ: caseEvidence.some(row => row.effects.DDQ), DGI: caseEvidence.some(row => row.effects.DGI),
    crossTenantAssignments: caseEvidence.some(row => row.effects.crossTenantAssignments) }
  const tenantCountLowerBound = Math.max(0, ...caseEvidence.map(row => row.effects.tenantCountLowerBound))
  if (tenantCountLowerBound) scopeMatrix.tenantCountLowerBound = tenantCountLowerBound
  if (!(scopeMatrix.DDQ && scopeMatrix.DGI && scopeMatrix.crossTenantAssignments && tenantCountLowerBound >= 2)) blockers.push('scope_matrix_incomplete')
  // All six authenticated code classes, aggregate native matrix, immutable
  // source, current CI jobs and runner custody are necessary together. Neither
  // specification JSON nor modeled external ports authenticate market approval.
  const complete = ciPassed && ciQualified && Object.values(levels).every(level => level.status === 'qualified')
    && scopeMatrix.DDQ && scopeMatrix.DGI && scopeMatrix.crossTenantAssignments && tenantCountLowerBound >= 2
    && executions.length === modes.length && executions.every(execution => execution.status === 'qualified')
  return { ...source, sourceAuthentication: 'github_run_job_artifact_and_immutable_tree', codeEvidence: complete ? 'qualified' : 'incomplete', fullCardVerification: complete ? 'CODE_VERIFIED' : 'NOT_VERIFIED',
    formalEdielApproval: false, liveCounterpartyVerified: false, levels,
    activationGates: { liveTransport: 'NOT_OBSERVED', formalTGT: 'NOT_OBSERVED' }, scopeMatrix, executions, caseEvidence, blockers }
}

const certificateMode = process.argv.find(arg => arg.startsWith('--certificate='))?.split('=')[1]
if (certificateMode) {
  const root = path.resolve(__dirname, '..')
  const states = certificateMode === 'pr'
    ? { smoke: process.env.SMOKE_RESULT, coverage: process.env.COVERAGE_RESULT }
    : certificateMode === 'nightly'
      ? { full: process.env.FULL_RESULT, runtime_staging: process.env.RUNTIME_RESULT, protected_customer_staging: process.env.REAL_RESULT }
      : null
  if (!states) { console.error('Unknown release certificate mode'); process.exitCode = 2 }
  else {
    const passed = Object.values(states).every(status => status === 'success')
    const artifactDir = path.join(root, 'e2e-artifacts')
    fs.mkdirSync(artifactDir, { recursive: true })
    const certificate = { schema_version: 1, ...Object.fromEntries(Object.entries(states).map(([key, value]) => [key, value ?? 'missing'])),
      verdict: passed ? 'GREEN' : 'RED', edielReleaseEvidence: assembleEdielReleaseEvidence(root, passed, certificateMode === 'pr' ? ['smoke'] : ['full', 'runtime', 'real']) }
    fs.writeFileSync(path.join(artifactDir, certificateMode + '-release-certificate.json'), JSON.stringify(certificate, null, 2) + '\n')
    if (!passed) process.exitCode = 1
  }
} else {

const root = path.resolve(__dirname, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
const logsDir = path.join(artifactDir, 'logs')
fs.mkdirSync(logsDir, { recursive: true })

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageScripts = pkg.scripts || {}
const validModes = new Set(['smoke', 'full', 'runtime', 'real', 'all'])
const requested = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1]
  || process.env.GRIDEX_E2E_MODE
  || 'smoke'
if (!validModes.has(requested)) {
  console.error(`Unknown E2E mode ${JSON.stringify(requested)}. Use smoke, full, runtime, real or all.`)
  process.exit(2)
}

const npmStep = (id, category, script, description) => ({
  id,
  category,
  kind: 'npm',
  script,
  description,
})
const nodeStep = (id, category, file, args, description) => ({
  id,
  category,
  kind: 'node',
  file,
  args: args || [],
  description,
})

// The smoke suite is intentionally fast enough for every push while still
// touching every production boundary through existing Gridex regression gates.
const smoke = [
  nodeStep('whole-project-coverage', 'coverage', 'scripts/gridex-whole-project-e2e-coverage.cjs', [], 'Inventories the whole repository and rejects unclassified API surfaces, migration drift and stale E2E references.'),
  nodeStep('tenant-platform-contract', 'tenant', 'scripts/gridex-tenant-platform-e2e-contract-regression.cjs', [], 'Locks canonical tenant, invitation, lifecycle and website intake invariants.'),
  npmStep('migrations', 'database', 'db:migrations:check', 'Migration integrity, public contracts and generated schema types.'),
  npmStep('tenant-model', 'tenant', 'tenant:multitenant:static', 'Canonical multi-tenant model and isolation contract.'),
  npmStep('tenant-source-of-truth', 'tenant', 'gridex:tenant-source-of-truth-regression', 'Tenant source-of-truth and scoping invariants.'),
  npmStep('test-production-separation', 'safety', 'gridex:test-production-separation-regression', 'Test/prod separation and outbound safety.'),
  npmStep('website-intake', 'customer_intake', 'gridex:multitenant-website-application-flow-regression', 'Multi-tenant website customer application flow.'),
  npmStep('route-readiness', 'ediel', 'gridex:production-route-readiness-regression', 'Production route materialization, send guard and tenant route isolation.'),
  npmStep('edifact-customer-flow', 'ediel', 'gridex:tenant-customer-edifact-completion-regression', 'Tenant customer EDIFACT completion flow.'),
  npmStep('metering', 'metering', 'gridex:multi-metering-values-regression', 'Multi-metering-value persistence and tenant mapping.'),
  npmStep('billing', 'billing', 'gridex:multi-site-billing-underlay-regression', 'Multi-site billing underlay flow.'),
  npmStep('portal-api', 'customer_portal', 'gridex:customer-portal-multi-site-api-regression', 'Customer portal multi-site API behavior.'),
  npmStep('rbac', 'security', 'security:rbac', 'RBAC and tenant access safety.'),
  npmStep('api-boundaries', 'api', 'api:error-boundaries', 'Canonical external API error boundaries.'),
  npmStep('typecheck', 'quality', 'typecheck', 'Application TypeScript correctness.'),
]

// Full is the release/nightly certificate. It composes the authoritative
// domain regressions already maintained in the repository instead of creating
// a second implementation of the business logic.
const fullOnly = [
  npmStep('runtime-readiness', 'database', 'db:runtime-readiness:check', 'Runtime database/schema readiness.'),
  npmStep('production-migration-readiness', 'database', 'db:migrations:production-readiness', 'Production migration readiness and drift checks.'),
  npmStep('canonical-onboarding', 'tenant', 'verify:canonical-onboarding', 'Canonical onboarding, authorization scopes, customer numbers and EDIEL onboarding readiness.'),
  npmStep('canonical-production-hardening', 'platform', 'ops:canonical-production-hardening', 'Canonical production hardening invariants.'),
  npmStep('emergency-access', 'security', 'ops:emergency-access-regression', 'Emergency/break-glass access safety.'),
  npmStep('runtime-consistency', 'platform', 'ops:canonical-runtime-consistency', 'Runtime consistency across production boundaries.'),

  npmStep('contract-lifecycle', 'contract', 'gridex:contract-lifecycle-repair-regression', 'Contract lifecycle and repair behavior.'),
  npmStep('contract-tenant-lifecycle', 'contract', 'gridex:contract-tenant-lifecycle-completion-regression', 'Contract behavior follows tenant lifecycle.'),
  npmStep('contract-delete-graph', 'contract', 'gridex:contract-delete-graph-completion-regression', 'Safe contract deletion graph and historical blockers.'),
  npmStep('contract-go-live', 'contract', 'verify:contract-go-live:static', 'Complete contract go-live static certificate.'),
  npmStep('contract-channel-publication', 'contract', 'verify:contract-channel-publication:static', 'Channel publication and API documentation sync.'),
  npmStep('contract-commercial-selection', 'pricing', 'verify:contract-commercial-selection:static', 'Commercial selection, pricing and build consistency.'),
  npmStep('customer-legal-package', 'legal', 'verify:customer-legal-package', 'Customer legal package, POA and acceptance contract.'),

  npmStep('website-full', 'customer_intake', 'verify:multitenant-website-application-flow:static', 'Website application API, review, continuation and tenant isolation.'),
  npmStep('website-quote-integrity', 'pricing', 'gridex:website-quote-integrity-regression', 'Quote/pricing integrity at the website boundary.'),
  npmStep('website-poa', 'legal', 'gridex:website-api-power-of-attorney-regression', 'Website/API power-of-attorney flow.'),
  npmStep('website-ops-chain', 'customer_intake', 'gridex:website-application-ops-chain-regression', 'Website application through OPS operational chain.'),
  npmStep('automatic-customer-intake', 'customer_intake', 'gridex:automatic-customer-intake-foundation-regression', 'Automatic customer intake foundation.'),
  npmStep('customer-intake-hardening', 'customer_intake', 'gridex:customer-intake-completion-hardening-regression', 'Customer intake completion and failure recovery.'),
  npmStep('price-area-assurance', 'pricing', 'gridex:price-area-assurance-regression', 'Price-area assurance and location trust boundary.'),
  npmStep('customer-info-chain', 'facility', 'gridex:customer-info-z01-chain-regression', 'Customer information and facility Z01 chain.'),
  npmStep('facility-preflight', 'facility', 'gridex:z01-facility-preflight-regression', 'Facility preflight before outbound operations.'),
  npmStep('missing-facility-blocker', 'facility', 'gridex:z01-missing-facility-controlled-blocker-regression', 'Missing facility fails closed rather than guessing.'),
  npmStep('manual-facility-workflow', 'facility', 'gridex:facility-lookup-manual-workflow-regression', 'Manual facility lookup workflow.'),
  npmStep('automatic-facility-edifact', 'facility', 'gridex:automatic-facility-lookup-edifact-dispatch-regression', 'Automatic facility lookup through EDIFACT dispatch.'),
  npmStep('inbound-facility-recognition', 'facility', 'gridex:inbound-facility-recognition-regression', 'Inbound facility information is recognized and linked canonically.'),

  npmStep('route-runtime-selection', 'ediel', 'gridex:route-runtime-selection-regression', 'Runtime route selection.'),
  npmStep('route-matrix', 'ediel', 'gridex:ediel-route-matrix-regression', 'EDIEL route matrix completeness.'),
  npmStep('ack-chain', 'ediel', 'gridex:ack-chain-regression', 'CONTRL/APERAK acknowledgment lifecycle.'),
  npmStep('inbound-tenant-resolution', 'ediel', 'gridex:edifact-inbound-tenant-resolution-regression', 'Inbound EDIFACT resolves to the correct tenant.'),
  npmStep('shared-mailbox-resolution', 'ediel', 'gridex:shared-mailbox-tenant-resolution-regression', 'Shared mailbox messages retain tenant isolation.'),
  npmStep('ediel-full-business-pipeline', 'ediel', 'gridex:ediel-intent-pipeline-full-regression', 'EDIEL intents, PRODAT support, supplier switch, ACK, UTILTS, reconciliation and eSett XML.'),
  npmStep('supplier-business', 'operations', 'gridex:supplier-business-full-regression', 'Supplier/ombud business operations and automation.'),

  npmStep('invoice-customer-number', 'billing', 'gridex:invoice-partner-customer-number-regression', 'Invoice/customer-number canonical linkage.'),
  npmStep('ediel-metering-billing-automation', 'billing', 'gridex:ediel-automation-metering-billing-regression', 'EDIEL automation through metering and billing.'),
  npmStep('settlement-export', 'billing', 'gridex:production-settlement-export-regression', 'Production settlement/export flow.'),
  npmStep('metering-billing-rls', 'billing', 'gridex:rls-multisite-metering-billing-regression', 'RLS isolation for metering and billing.'),
  npmStep('automation-idempotency', 'automation', 'gridex:automation-idempotency-multisite-regression', 'Automation is idempotent across multi-site customers.'),
  npmStep('messages-visibility', 'operations', 'gridex:messages-operations-visibility-regression', 'Operations/messages visibility and tenant scoping.'),
  npmStep('communication-source-of-truth', 'communications', 'gridex:communication-source-of-truth-regression', 'Communication status/source-of-truth.'),
  npmStep('mail-recipient-resolution', 'communications', 'gridex:manual-email-recipient-resolution-regression', 'Tenant-aware mail recipient resolution.'),
  npmStep('platform-contract-api-mail', 'communications', 'gridex:platform-tenant-contracts-api-mail-regression', 'Platform, tenant, contracts, API and mail integration boundary.'),
  npmStep('website-webhooks', 'webhooks', 'gridex:website-api-webhook-regression', 'Website API webhook contract.'),

  npmStep('api-docs', 'api', 'api:docs', 'OpenAPI documentation generation/validation.'),
  npmStep('api-compatibility', 'api', 'api:compatibility', 'Backwards compatibility of public API.'),
  npmStep('api-release', 'api', 'api:release:verify', 'External API release contract.'),
  npmStep('api-runtime-parity', 'api', 'api:runtime:parity', 'Runtime routes match the canonical API contract.'),
  npmStep('api-error-registry', 'api', 'api:error-registry', 'Public API errors remain canonical and documented.'),
  npmStep('api-performance-tenant-gates', 'api', 'api:performance-tenant-gates', 'API performance and tenant gates.'),
  npmStep('rate-limits', 'security', 'gridex:rate-limit-regression', 'API rate limit contract.'),
  npmStep('system-health', 'release', 'gridex:system-health-regression', 'System health regression.'),
  npmStep('supabase-advisors', 'security', 'gridex:supabase-advisors-hardening-regression', 'Supabase advisor/security hardening.'),

  npmStep('lint', 'quality', 'lint', 'Lint and code-quality gate.'),
  npmStep('typecheck-scripts', 'quality', 'typecheck:scripts', 'E2E/operations script TypeScript correctness.'),
  npmStep('typecheck-tests', 'quality', 'typecheck:tests', 'Test TypeScript correctness.'),
  npmStep('unit-integration-tests', 'quality', 'test', 'Repository Vitest suite.'),
  npmStep('production-dependency-audit', 'security', 'security:audit-production', 'High-severity production dependency audit.'),
  npmStep('build', 'release', 'build', 'Production Next.js build.'),
]

const runtime = [
  nodeStep('fresh-tenant-runtime', 'runtime_tenant', 'scripts/gridex-tenant-runtime-e2e.mjs', [], 'Staging-only new-tenant canonical lifecycle and contract roundtrip.'),
]

const realCustomer = [
  nodeStep('real-customer-runtime', 'real_customer', 'scripts/gridex-real-customer-e2e.mjs', [], 'Read-only persistent staging customer graph validation using protected fixture IDs.'),
]

function mergeUnique(...groups) {
  const seen = new Set()
  return groups.flat().filter((step) => {
    if (seen.has(step.id)) return false
    seen.add(step.id)
    return true
  })
}

const steps = requested === 'smoke'
  ? smoke
  : requested === 'full'
    ? mergeUnique(smoke, fullOnly)
    : requested === 'runtime'
      ? runtime
      : requested === 'real'
        ? realCustomer
        : mergeUnique(smoke, fullOnly, runtime, realCustomer)

function secretValues() {
  const explicitNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY',
    'GRIDEX_E2E_ACTOR_USER_ID',
    'DATABASE_URL',
    'RESEND_API_KEY',
    'CRON_SECRET',
    'OPENAI_API_KEY',
  ]
  const dynamicRealFixtureNames = Object.keys(process.env).filter((name) => name.startsWith('GRIDEX_E2E_REAL_'))
  return [...new Set([...explicitNames, ...dynamicRealFixtureNames])]
    .map((name) => process.env[name])
    .filter((value) => typeof value === 'string' && value.length >= 6)
}

const secrets = secretValues()
function redact(input) {
  let output = String(input || '')
  for (const secret of secrets) output = output.split(secret).join('[REDACTED]')
  output = output
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b(sk[-_][A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1[REDACTED]@')
  return output
}

function slug(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function classifyFailure(step, combined, explicitError) {
  const text = `${explicitError || ''}\n${combined || ''}`.toLowerCase()
  if (/missing required package\.json script|node step file does not exist|stale e2e reference|cannot find module|module not found|unclassified api namespace/.test(text)) {
    return 'stale_regression_or_uncovered_surface'
  }
  if (step.category === 'database' || /migration|schema drift|database drift|generated types|supabase.*schema/.test(text)) {
    return 'database_or_migration_drift'
  }
  if (/missing required secret|staging configuration|enotfound|econnrefused|network|timeout|timed out|rate limit|http 429|http 5\d\d|external dependency/.test(text)) {
    return 'environment_or_external_dependency'
  }
  return 'code_or_workflow_defect'
}

function runStep(step) {
  if (step.kind === 'npm' && !Object.prototype.hasOwnProperty.call(packageScripts, step.script)) {
    const error = `Required package.json script is missing: ${step.script}`
    return {
      ...step,
      status: 'failed',
      exit_code: 127,
      duration_ms: 0,
      log_file: null,
      error,
      failure_class: classifyFailure(step, '', error),
    }
  }
  if (step.kind === 'node' && !fs.existsSync(path.join(root, step.file))) {
    const error = `Required E2E script is missing: ${step.file}`
    return {
      ...step,
      status: 'failed',
      exit_code: 127,
      duration_ms: 0,
      log_file: null,
      error,
      failure_class: classifyFailure(step, '', error),
    }
  }

  const started = Date.now()
  const command = step.kind === 'npm' ? 'npm' : process.execPath
  const args = step.kind === 'npm' ? ['run', step.script] : [step.file, ...(step.args || [])]
  console.log(`\n=== [${step.category}] ${step.id}: ${step.description} ===`)
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, GRIDEX_E2E_PARENT_MODE: requested },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const duration = Date.now() - started
  const combined = redact(`${result.stdout || ''}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`)
  const logName = `${String(results.length + 1).padStart(2, '0')}-${slug(step.id)}.log`
  const logPath = path.join(logsDir, logName)
  fs.writeFileSync(logPath, combined)

  const exitCode = typeof result.status === 'number' ? result.status : 1
  const status = exitCode === 0 ? 'passed' : 'failed'
  const explicitError = result.error ? redact(result.error.message) : null
  const failureClass = status === 'failed' ? classifyFailure(step, combined, explicitError) : null
  console.log(`${status.toUpperCase()} ${step.id} (${Math.round(duration / 100) / 10}s)${failureClass ? ` [${failureClass}]` : ''}`)
  if (status === 'failed') {
    const tail = combined.split('\n').slice(-30).join('\n')
    console.error(tail)
  }
  return {
    ...step,
    status,
    exit_code: exitCode,
    signal: result.signal || null,
    duration_ms: duration,
    log_file: path.relative(root, logPath),
    error: explicitError,
    failure_class: failureClass,
  }
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const executionSource = checkoutSource(root)
const results = []
const startedAt = new Date().toISOString()
for (const step of steps) results.push(runStep(step))
const finishedAt = new Date().toISOString()
const passed = results.filter((row) => row.status === 'passed').length
const failed = results.filter((row) => row.status === 'failed').length
const totalDuration = results.reduce((sum, row) => sum + row.duration_ms, 0)
const categories = {}
const failureClasses = {}
for (const row of results) {
  categories[row.category] ||= { passed: 0, failed: 0 }
  categories[row.category][row.status] += 1
  if (row.failure_class) failureClasses[row.failure_class] = (failureClasses[row.failure_class] || 0) + 1
}

const report = {
  schema_version: 2,
  suite: 'gridex-full-production-e2e',
  mode: requested,
  started_at: startedAt,
  finished_at: finishedAt,
  duration_ms: totalDuration,
  status: failed === 0 ? 'passed' : 'failed',
  summary: { total: results.length, passed, failed },
  categories,
  failure_classes: failureClasses,
  safety: {
    ci_self_modifies_repository: false,
    production_mutation_allowed: false,
    runtime_mutation_requires_explicit_staging_opt_in: true,
    real_customer_fixture_is_read_only: true,
    real_customer_outbound_allowed: false,
    logs_redact_known_secrets_and_fixture_values: true,
  },
  results,
}
fs.writeFileSync(path.join(artifactDir, 'gridex-e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`)

const md = [
  '# Gridex full production E2E report',
  '',
  `- Mode: \`${requested}\``,
  `- Status: **${report.status.toUpperCase()}**`,
  `- Passed: ${passed}/${results.length}`,
  `- Failed: ${failed}/${results.length}`,
  `- Started: ${startedAt}`,
  `- Finished: ${finishedAt}`,
  '',
  '| Domain | Step | Status | Failure class | Duration | Evidence |',
  '|---|---|---:|---|---:|---|',
  ...results.map((row) => `| ${row.category} | ${row.id} | ${row.status} | ${row.failure_class || '-'} | ${(row.duration_ms / 1000).toFixed(1)}s | ${row.log_file || row.error || '-'} |`),
  '',
  '## Safety contract',
  '',
  '- CI never edits production data or commits fixes by itself.',
  '- Fresh-tenant runtime mutation is staging-only and requires explicit opt-ins.',
  '- Persistent real-customer validation is read-only and refuses outbound traffic.',
  '- Real fixture values and known credentials are redacted from runner logs.',
  '- Test tenant retirement uses lifecycle tombstones; no business history is hard-deleted.',
  '- Failures are classified so stale tests, database drift, external blockers and production defects are not conflated.',
  '',
]
fs.writeFileSync(path.join(artifactDir, 'gridex-e2e-report.md'), `${md.join('\n')}\n`)

const junitCases = results.map((row) => {
  const failure = row.status === 'failed'
    ? `<failure message="${xmlEscape(row.failure_class || row.error || `exit ${row.exit_code}`)}">See ${xmlEscape(row.log_file || 'E2E report')}</failure>`
    : ''
  return `<testcase classname="gridex.e2e.${xmlEscape(row.category)}" name="${xmlEscape(row.id)}" time="${(row.duration_ms / 1000).toFixed(3)}">${failure}</testcase>`
}).join('')
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="gridex-full-production-e2e" tests="${results.length}" failures="${failed}" time="${(totalDuration / 1000).toFixed(3)}">${junitCases}</testsuite>\n`
fs.writeFileSync(path.join(artifactDir, 'gridex-e2e-junit.xml'), junit)
const finishedSource = checkoutSource(root)
const sourceUnchanged = Boolean(executionSource.candidateSha && executionSource.candidateTree && executionSource.checkoutClean
  && finishedSource.checkoutClean && executionSource.candidateSha === finishedSource.candidateSha && executionSource.candidateTree === finishedSource.candidateTree)
const executionArtifact = { format: 'gridex_runner_execution_artifact_v1', mode: requested, source: executionSource, sourceUnchanged,
  files: runnerArtifactPaths(report).map(reference => ({ path: reference, sha256: sha256(fs.readFileSync(path.join(artifactDir, reference))) })) }
fs.writeFileSync(path.join(artifactDir, 'gridex-executed-evidence.json'), JSON.stringify(executionArtifact, null, 2) + '\n')

console.log(`\nGridex E2E ${report.status}: ${passed}/${results.length} passed, ${failed} failed.`)
console.log('Evidence: e2e-artifacts/gridex-e2e-report.md, .json, JUnit XML and per-step redacted logs.')
if (failed > 0) process.exitCode = 1
}
