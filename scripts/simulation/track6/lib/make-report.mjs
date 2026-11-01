// Bygger report.json per scenario ur vitests JSON-rapport. Status per steg: passed | failed | skipped.
import { existsSync, lstatSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const fail = (message) => { throw new Error(message) }
const home = process.env.SIM_HOME
const within = (file) => { const r = relative(home, file); return r !== '' && r !== '..' && !r.startsWith('../') && !isAbsolute(r) }
const exists = (file) => { try { lstatSync(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
function privateHome() {
  if (!home || !isAbsolute(home) || realpathSync(home) !== home) fail('private canonical SIM_HOME required')
  const stat = lstatSync(home)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) fail('SIM_HOME must be private and owned')
}
function input(file, directory = false) {
  if (!file || !isAbsolute(file) || resolve(file) !== file || !within(file) || realpathSync(file) !== file) fail('input must remain under private home')
  const stat = lstatSync(file)
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('invalid input type')
  return file
}
function publish(file, value) {
  if (!file || !isAbsolute(file) || resolve(file) !== file || !within(file) || exists(file) || exists(file + '.tmp')) fail('output must be a fresh private path')
  let parent = dirname(file)
  while (!exists(parent)) parent = dirname(parent)
  if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) fail('output parent rebound')
  const git = spawnSync('git', ['-C', parent, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  if (git.status === 0) fail('report output inside Git checkout')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  if (realpathSync(dirname(file)) !== dirname(file)) fail('output parent changed')
  const scratch = mkdtempSync(join(dirname(file), '.t6-report-'))
  try {
    const temp = join(scratch, 'report.json')
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    linkSync(temp, file) // atomic no-overwrite publication; preserves a racing original
  } finally { rmSync(scratch, { recursive: true }) }
}

try {
  privateHome()
const args = process.argv.slice(2)
const get = (f, d = null) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d }
const exitCode = Number(get('--exit'))
if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255 || !/^[A-Za-z0-9._-]+$/.test(get('--run-id') ?? '')) fail('invalid run identity or exit status')
if (get('--merge')) {
  const root = input(get('--merge'), true), runId = get('--run-id')
  const reports = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const report = JSON.parse(readFileSync(input(join(root, entry.name, 'report.json')), 'utf8'))
    if (report.runId !== runId || !Number.isInteger(report.exit) || report.exit < 0 || report.exit > 255) fail('report runId or exit status mismatch')
    return report
  })
  if (!reports.length) fail('no scenario reports to merge')
  publish(get('--out'), { runId, exit: Math.max(exitCode, ...reports.map((r) => r.exit)), scenarios: reports })
  process.exit(0)
}
const vitestPath = get('--vitest')
if (vitestPath && exists(vitestPath)) input(vitestPath)
const identity = JSON.parse(readFileSync(input(get('--identity')), 'utf8'))
if (!identity.workerId || !identity.model) fail('observed worker/model identity required')
const evidence = get('--evidence')
if (evidence) {
  input(evidence, true)
  for (const name of ['observations.json', 'MANIFEST.sha256']) if (exists(join(evidence, name))) input(join(evidence, name))
}
let vitest = null
try { vitest = JSON.parse(readFileSync(vitestPath, 'utf8')) } catch { /* harnessfel nedan */ }
if (!Array.isArray(vitest?.testResults) || !Number.isInteger(vitest?.numTotalTests)) vitest = null

const statusOf = (s) => (s === 'passed' ? 'passed' : s === 'failed' ? 'failed' : 'skipped')
const steps = []
for (const file of vitest?.testResults ?? []) {
  for (const a of file.assertionResults ?? []) {
    steps.push({
      name: a.fullName ?? a.title,
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
  runIdentity: identity,
  file: get('--file'),
  runId: get('--run-id'),
  exit: vitest ? Math.max(exitCode, vitest.success === false || vitest.numFailedTests > 0 || vitest.numFailedTestSuites > 0 ? 1 : 0) : Math.max(exitCode, 2),
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
  observations: evidence ? readJson(join(evidence, 'observations.json')) : null,
}
publish(get('--out'), report)
if (!vitest || report.exit !== exitCode) process.exitCode = 1

} catch { console.error('T6 report refused: private path, input identity or no-overwrite publication failed'); process.exitCode = 1 }
