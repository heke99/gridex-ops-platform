// Bygger report.json per scenario ur vitests JSON-rapport. Status per steg: passed | failed | skipped.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const get = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d }
if (get('--summary')) {
  const summary = JSON.parse(readFileSync(get('--summary'), 'utf8'))
  const scenarios = summary.scenarios.map((entry) => {
    const report = JSON.parse(readFileSync(entry.report, 'utf8'))
    if (report.runId !== summary.runId || report.scenario !== entry.scenario || report.exit !== entry.exit) {
      throw new Error('scenariorapporten hör inte till denna körning')
    }
    return report
  })
  const out = get('--out')
  if (existsSync(out)) chmodSync(out, 0o600)
  writeFileSync(out, JSON.stringify({ runId: summary.runId, exit: summary.exit, scenarios }, null, 2), { mode: 0o600 })
  process.exit(0)
}
const vitestPath = get('--vitest')
const evidence = get('--evidence')
let vitest = null
try { vitest = JSON.parse(readFileSync(vitestPath, 'utf8')) } catch { /* harnessfel nedan */ }

const statusOf = (s) => (s === 'passed' ? 'passed' : s === 'failed' ? 'failed' : 'skipped')
const steps = []
for (const file of vitest?.testResults ?? []) {
  for (const a of file.assertionResults ?? []) {
    steps.push({
      name: a.fullName ?? a.title,
      scenarioId: String(a.fullName ?? a.title ?? '').match(/\bEDIEL\d{2}\.\d{2}\b/)?.[0] ?? null,
      status: statusOf(a.status),
      durationMs: a.duration ?? null,
      failureMessages: (a.failureMessages ?? []).map((m) => String(m).split('\n').slice(0, 12).join('\n')),
    })
  }
  if (file.status === 'failed' && !(file.assertionResults ?? []).length) {
    steps.push({ name: `(suite) ${file.name}`, status: 'failed', durationMs: null, failureMessages: [String(file.message ?? 'suite failed to run').split('\n').slice(0, 12).join('\n')] })
  }
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const report = {
  scenario: get('--scenario'),
  file: get('--file'),
  runId: get('--run-id'),
  exit: Number(get('--exit')),
  startedAt: get('--started'),
  endedAt: get('--ended'),
  harnessError: vitest ? null : 'vitest JSON saknas (körningen kraschade före rapportering, se log.txt)',
  vitest: vitest && {
    success: vitest.success,
    numTotalTestSuites: vitest.numTotalTestSuites, numPassedTestSuites: vitest.numPassedTestSuites, numFailedTestSuites: vitest.numFailedTestSuites,
    numTotalTests: vitest.numTotalTests, numPassedTests: vitest.numPassedTests, numFailedTests: vitest.numFailedTests,
    numPendingTests: vitest.numPendingTests, numTodoTests: vitest.numTodoTests, startTime: vitest.startTime,
  },
  steps,
  skipped: steps.filter((s) => s.status === 'skipped').map((s) => s.name),
  log: get('--log'),
  evidenceDir: evidence,
  evidenceManifest: evidence && existsSync(join(evidence, 'MANIFEST.sha256')) ? join(evidence, 'MANIFEST.sha256') : null,
  identity: get('--identity') ? readJson(get('--identity')) : null,
  observations: evidence ? readJson(join(evidence, 'observations.json')) : null,
}
writeFileSync(get('--out'), JSON.stringify(report, null, 2))
