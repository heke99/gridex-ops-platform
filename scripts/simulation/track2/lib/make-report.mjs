// Omvandlar vitests JSON-reporter (jest-format) till spårets rapport. Argument: raw.json out.json scenario meta.json
import fs from 'node:fs'
const [rawPath, outPath, scenario, metaPath] = process.argv.slice(2)
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
let raw = null
try { raw = JSON.parse(fs.readFileSync(rawPath, 'utf8')) } catch { /* vitest skrev ingen rapport */ }
const map = { passed: 'passed', failed: 'failed', pending: 'skipped', skipped: 'skipped', todo: 'skipped', disabled: 'skipped' }
const steps = []
for (const file of raw?.testResults ?? []) {
  for (const t of file.assertionResults ?? []) {
    steps.push({
      name: t.fullName ?? t.title,
      status: map[t.status] ?? 'failed',
      durationMs: t.duration ?? null,
      failureMessages: (t.failureMessages ?? []).map((m) => String(m).slice(0, 4000)),
    })
  }
  if (file.status === 'failed' && !(file.assertionResults ?? []).some((t) => t.status === 'failed')) {
    steps.push({ name: `${file.name} (suite)`, status: 'failed', durationMs: null, failureMessages: [String(file.message || 'suite/hook failed, se loggen').slice(0, 4000)] })
  }
}
const count = (s) => steps.filter((x) => x.status === s).length
const report = {
  scenario,
  ...meta,
  vitest: raw ? {
    success: raw.success, numTotalTestSuites: raw.numTotalTestSuites, numFailedTestSuites: raw.numFailedTestSuites,
    numTotalTests: raw.numTotalTests, numPassedTests: raw.numPassedTests, numFailedTests: raw.numFailedTests,
    numPendingTests: raw.numPendingTests, numTodoTests: raw.numTodoTests ?? 0, startTime: raw.startTime,
  } : null,
  summary: { passed: count('passed'), failed: count('failed'), skipped: count('skipped'), total: steps.length },
  steps,
}
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
