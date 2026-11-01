#!/usr/bin/env node
// T4 scenario runner. Loads a scenario file (ES module exporting `scenarios`: [{ id, title, steps: [...] }]),
// runs the steps in order against the live T4 stack and writes per-scenario report JSON.
//
// Step shape:
//   { id: 'MAIN04.02', title, scope: 'api'|'sql'|'api+sql'|'playwright'|..., needs: ['FX06', ...], todo: 'reason',
//     note: 'what this step does / does not verify', run: async (ctx) => {} }
// A step with `todo` is reported as skipped with reason "TODO: ..." (explicit, never silently green).
// A step whose `needs` did not pass is skipped ("dependency ... not passed"); never executed on stale state.
//
// ctx: { env, sql, sqlAdmin, http, assert, fixture, dbErrorsSince, value(k,v), finding(text), file(name, bytes), step }
// Evidence recorded per step: http[] (status, bytes, sha256, location), db.before/after counts of the billing
// tables for tenant A, db.delta, values{}, findings[], files[] (bytes + sha256).
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createSql } from './lib/sql.mjs'
import { createHttp, sha256Hex } from './lib/http.mjs'
import { countsFor, diffCounts } from '../fixtures/flows.mjs'

function parseArgs(argv) {
  const args = { only: [], scenario: null, out: null, report: null }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], value = argv[++i]
    if (!['--scenario', '--out', '--report', '--only'].includes(flag)) throw new Error(`unknown option ${flag}`)
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`)
    if (flag === '--only') args.only.push(...value.split(','))
    else {
      const key = flag.slice(2)
      if (args[key] !== null) throw new Error(`duplicate option ${flag}`)
      args[key] = value
    }
  }
  if (!args.scenario || !args.out || !args.report) throw new Error('usage: run-scenarios.mjs --scenario <file> --out <dir> --report <SIM_REPORT path> [--only ID[,ID]]')
  if (args.only.some(id => !id) || new Set(args.only).size !== args.only.length) throw new Error('empty or duplicate requested scenario ID')
  return args
}

// Exact T4 role IDs and the already declared substeps. No prefix inference or
// invented credit case: an absent requested ID is an admission failure.
const CANONICAL_IDS = new Set(['MAIN04.02', 'MAIN04.05', 'BILLNEG01.01', 'BILLNEG01.02', 'BILLNEG01.03', 'BILLNEG01.04', 'BILLNEG01.05', 'MAIN05.01', 'MAIN05.02', 'MAIN05.03', 'MAIN05.04', 'MAIN05.05', 'MAIN05.06'])
const SUBSTEPS = new Map([['BILLNEG01.04a', 'BILLNEG01.04'], ['BILLNEG01.04b', 'BILLNEG01.04'], ['MAIN05.05b', 'MAIN05.05']])

function planScenarios(scenarios, only) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('scenario list must be nonempty')
  const groups = new Map(), byId = new Map(), owners = new Map(), plans = new Map(), fileIds = new Set()
  for (const scenario of scenarios) {
    if (!/^[A-Z][A-Z0-9_-]{0,99}$/.test(scenario.id) || fileIds.has(scenario.id)) throw new Error('invalid or duplicate scenario file ID')
    fileIds.add(scenario.id)
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) throw new Error('scenario steps must be nonempty')
    plans.set(scenario, { selected: new Set(), dependencies: new Map() })
    for (const step of scenario.steps) {
      if (!step || typeof step.id !== 'string' || byId.has(step.id)) throw new Error('missing or duplicate step ID')
      if (!Array.isArray(step.needs ?? []) || (step.needs ?? []).some(n => typeof n !== 'string') || new Set(step.needs ?? []).size !== (step.needs ?? []).length) throw new Error('invalid dependency list')
      if (!step.todo && typeof step.run !== 'function') throw new Error('executable step has no run function')
      if (step.fixture) {
        if (!/^FX[A-Z0-9_]*$/.test(step.id) || step.scenarioId !== undefined) throw new Error('invalid fixture ID')
      } else {
        const parent = step.scenarioId ?? step.id
        if (!CANONICAL_IDS.has(parent) || (step.id !== parent && SUBSTEPS.get(step.id) !== parent)) throw new Error('unknown canonical scenario or substep')
        if (!groups.has(parent)) groups.set(parent, [])
        groups.get(parent).push(step.id)
      }
      byId.set(step.id, step); owners.set(step.id, scenario)
    }
  }
  if (groups.size === 0) throw new Error('scenario file has no declared business scenario')
  for (const id of only) if (!CANONICAL_IDS.has(id) || !groups.has(id)) throw new Error(`requested scenario has no declared canonical implementation: ${id}`)
  const expand = id => groups.get(id) ?? (byId.has(id) ? [id] : null)
  for (const scenario of scenarios) {
    const plan = plans.get(scenario), indices = new Map(scenario.steps.map((s, i) => [s.id, i]))
    for (const step of scenario.steps) {
      const deps = new Set()
      for (const id of step.needs ?? []) {
        const resolved = expand(id)
        if (!resolved) throw new Error(`unknown dependency: ${id}`)
        for (const dep of resolved) {
          // The runner executes declared order with a separate fixture per file.
          // Reject forward/self/cyclic/cross-file edges before any fixture effect.
          if (owners.get(dep) !== scenario || indices.get(dep) >= indices.get(step.id)) throw new Error('dependency must precede its step in the same scenario file')
          deps.add(dep)
        }
      }
      plan.dependencies.set(step.id, [...deps])
    }
    const select = id => {
      if (plan.selected.has(id)) return
      plan.selected.add(id)
      for (const dep of plan.dependencies.get(id)) select(dep)
    }
    // Retain the fixture sequence: the inherited fixture also has implicit
    // establishment dependencies. Invalid selections never reach this point.
    for (const step of scenario.steps) if (step.fixture || only.length === 0 || only.includes(step.scenarioId ?? step.id)) select(step.id)
  }
  return { plans, missingScenarioIds: [...CANONICAL_IDS].filter(id => !groups.has(id)) }
}

function canonicalPath(path) {
  if (typeof path !== 'string' || resolve(path) !== path) throw new Error('output paths and T4_SIM_HOME must be canonical absolute paths')
  return path
}

// Linux is already required by the harness. Walk each component without
// following symlinks, then keep directory descriptors for output operations.
function openDirectory(path) {
  canonicalPath(path)
  let fd = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    for (const part of path.split('/').filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      closeSync(fd); fd = next
    }
    return fd
  } catch (error) { closeSync(fd); throw error }
}

const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino
function absent(path) {
  try { lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  throw new Error('output or reservation already exists')
}

function reserveOutputs(home, out, report, scenarios) {
  const uid = process.getuid(), dirs = new Map(), owned = []
  const below = path => {
    canonicalPath(path)
    if (!path.startsWith(home + '/')) throw new Error('output must be below private T4_SIM_HOME')
  }
  const directory = path => {
    if (!dirs.has(path)) {
      const fd = openDirectory(path), stat = fstatSync(fd)
      if (stat.uid !== uid) { closeSync(fd); throw new Error('output directory owner mismatch') }
      dirs.set(path, { fd, stat, path })
    }
    return dirs.get(path)
  }
  const stable = dir => {
    const fd = openDirectory(dir.path)
    try { if (!sameInode(fstatSync(fd), dir.stat)) throw new Error('output directory changed') }
    finally { closeSync(fd) }
  }
  const relative = (dir, name) => `/proc/self/fd/${dir.fd}/${name}`
  const removeOwn = entry => {
    try { if (sameInode(lstatSync(entry.path), entry.stat)) unlinkSync(entry.path) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const close = () => {
    try {
      for (const entry of owned) {
        try { removeOwn(entry) } finally { closeSync(entry.fd) }
      }
    } finally { for (const dir of dirs.values()) closeSync(dir.fd) }
  }
  try {
    below(out); below(report)
    const homeDir = directory(home)
    if (homeDir.stat.mode & 0o077) throw new Error('T4_SIM_HOME must be private mode0700')
    const parent = directory(dirname(out))
    stable(parent)
    try { mkdirSync(relative(parent, basename(out)), { mode: 0o700 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    const outDir = directory(out)
    if (readdirSync(`/proc/self/fd/${outDir.fd}`).length !== 0) throw new Error('run output directory must be empty')
    const paths = [report, join(out, 'summary.json'), ...scenarios.map(s => join(out, `report-${s.id}.json`))]
    if (new Set(paths).size !== paths.length) throw new Error('aliased output destinations')
    // Complete admission before creating any reservations or executing fixtures.
    for (const path of paths) {
      below(path)
      const dir = directory(dirname(path))
      for (const name of [basename(path), basename(path) + '.tmp', basename(path) + '.t4-reserved']) absent(relative(dir, name))
    }
    const outputs = new Map()
    const exclusive = (dir, name) => {
      stable(dir)
      const path = relative(dir, name)
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      const entry = { fd, path, stat: fstatSync(fd) }
      owned.push(entry)
      return entry
    }
    for (const path of [...paths].sort()) {
      const dir = directory(dirname(path)), name = basename(path)
      exclusive(dir, name + '.t4-reserved')
      const temp = exclusive(dir, `.${name}.t4-${randomUUID()}.tmp`)
      outputs.set(path, { dir, name, temp, published: false })
    }
    return {
      close,
      write(path, value) {
        const entry = outputs.get(path)
        if (!entry || entry.published) throw new Error('unreserved or already published output')
        stable(entry.dir)
        writeFileSync(entry.temp.fd, JSON.stringify(value, null, 2))
        fsyncSync(entry.temp.fd)
        if (!sameInode(lstatSync(entry.temp.path), entry.temp.stat)) throw new Error('temporary output changed')
        const target = relative(entry.dir, entry.name)
        // Hard-link publication is atomic and refuses any competing destination.
        // All writes use the held exclusive FD, never a discovered pathname.
        linkSync(entry.temp.path, target)
        const published = lstatSync(target)
        if (!published.isFile() || !sameInode(published, entry.temp.stat)) throw new Error('published output identity mismatch')
        fsyncSync(entry.dir.fd)
        entry.published = true
        removeOwn(entry.temp)
      },
    }
  } catch (error) { close(); throw error }
}

function loadEnv(path) {
  const env = { ...process.env }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1)
  }
  return env
}

const args = parseArgs(process.argv.slice(2))
const simHome = process.env.T4_SIM_HOME
if (!simHome) throw new Error('T4_SIM_HOME is required (run through run.sh)')
canonicalPath(simHome)
const env = loadEnv(join(simHome, 'env'))

const mod = await import(pathToFileURL(resolve(args.scenario)).href)
const scenarios = mod.scenarios ?? (mod.scenario ? [mod.scenario] : null)
if (!scenarios) throw new Error('scenario file must export `scenarios` (array) or `scenario`')
const { plans, missingScenarioIds } = planScenarios(scenarios, args.only)
const output = reserveOutputs(simHome, args.out, args.report, scenarios)

try {
const sql = createSql(env.T4_DB_URL)
// The product masks RPC errors (e.g. lib/billing/invoiceReviewPrepare.ts:454 -> "Draftfakturan kunde inte skapas.").
// The real SQLSTATE/message is in the Postgres log, so every step records the ERROR/FATAL lines logged while it ran.
const DB_CONTAINER = env.T4_DB_CONTAINER ?? `supabase_db_${env.T4_PROJECT_ID}`
const dbErrorsSince = (sinceIso) => new Promise((resolve) => {
  execFile('docker', ['logs', '--since', sinceIso, DB_CONTAINER], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) return resolve([`(db log unavailable: ${String(error.message).slice(0, 120)})`])
    const lines = `${stdout}\n${stderr}`.split('\n').filter((l) => /\b(ERROR|FATAL|PANIC):/.test(l))
    const dedup = [...new Set(lines.map((l) => l.replace(/^\S+ \S+ \S+ \[\d+\] /, '').slice(0, 400)))]
    resolve(dedup.slice(0, 30))
  })
})
// Superuser connection (local supabase_admin) for fixture writes that must bypass product triggers
// (session_replication_role=replica needs superuser). Fixture-only; scenario steps use `sql`.
const sqlAdmin = createSql(env.T4_DB_URL.replace('//postgres:', '//supabase_admin:'))
let anyFailed = false
const summaryRows = []
const allSteps = []
const allScenarios = []

for (const scenario of scenarios) {
  const startedAt = new Date().toISOString()
  const fixture = {}
  let current = null // step record whose evidence http calls are attributed to
  const http = createHttp({ baseUrl: env.T4_APP_URL, onRecord: (r) => current?.evidence.http.push(r) })
  const ctx = {
    env, sql, sqlAdmin, http, assert, fixture, dbErrorsSince,
    runDir: args.out,
    value: (k, v) => { current.evidence.values[k] = v },
    finding: (text) => { current.evidence.findings.push(text) },
    file: (name, bytes) => { current.evidence.files.push({ name, bytes: bytes.length, sha256: sha256Hex(bytes) }) },
    get step() { return current },
  }

  const { selected, dependencies } = plans.get(scenario)

  const records = []
  const status = new Map()
  for (const step of scenario.steps) {
    const rec = {
      id: step.id, scenarioId: step.scenarioId ?? (step.fixture ? 'FIXTURE' : step.id), name: `${step.id} ${step.title}`, scope: step.scope ?? null, mechanism: step.mechanism ?? null, note: step.note ?? null,
      status: 'skipped', reason: null, startedAt: null, finishedAt: null, durationMs: 0, error: null,
      evidence: { http: [], dbErrors: [], db: { before: null, after: null, delta: null }, values: {}, findings: [], files: [] },
    }
    records.push(rec)
    if (!selected.has(step.id)) { rec.reason = 'not selected (--only)'; status.set(step.id, 'skipped'); continue }
    if (step.todo) { rec.reason = `TODO: ${step.todo}`; status.set(step.id, 'skipped'); continue }
    const bad = dependencies.get(step.id).find((n) => status.get(n) !== 'passed')
    if (bad) { rec.reason = `dependency ${bad} did not pass (${status.get(bad) ?? 'not run'})`; status.set(step.id, 'skipped'); continue }

    current = rec
    rec.startedAt = new Date().toISOString()
    const t0 = Date.now()
    try {
      if (fixture.companyA) rec.evidence.db.before = await countsFor(sql, fixture.companyA)
      await step.run(ctx)
      rec.status = 'passed'
    } catch (error) {
      rec.status = 'failed'
      rec.error = { name: error?.name ?? 'Error', message: String(error?.message ?? error), sqlstate: error?.code && /^[0-9A-Z]{5}$/.test(String(error.code)) ? error.code : undefined,
        actual: error?.actual, expected: error?.expected, stack: String(error?.stack ?? '').split('\n').slice(0, 6) }
    }
    try {
      if (fixture.companyA) {
        rec.evidence.db.after = await countsFor(sql, fixture.companyA)
        if (rec.evidence.db.before) rec.evidence.db.delta = diffCounts(rec.evidence.db.before, rec.evidence.db.after)
      }
    } catch (error) { rec.evidence.db.error = String(error?.message ?? error) }
    rec.evidence.dbErrors = await dbErrorsSince(rec.startedAt)
    rec.durationMs = Date.now() - t0
    rec.finishedAt = new Date().toISOString()
    status.set(step.id, rec.status)
    current = null
    console.log(`${rec.status.toUpperCase().padEnd(7)} ${rec.name}${rec.error ? `\n        ${rec.error.message}` : ''}${rec.status === 'failed' && rec.evidence.dbErrors.length ? `\n        db log: ${rec.evidence.dbErrors.slice(0, 4).join('\n                ')}` : ''}${rec.reason ? `  (${rec.reason})` : ''}`)
  }

  const count = (s) => records.filter((r) => r.status === s).length
  const report = {
    runId: process.env.T4_RUN_ID ?? null,
    scenario: { id: scenario.id, title: scenario.title, file: resolve(args.scenario) },
    startedAt, finishedAt: new Date().toISOString(),
    stack: { app: env.T4_APP_URL, api: env.NEXT_PUBLIC_SUPABASE_URL, appCommit: safeRead(join(simHome, 'built-commit')), replayCommit: safeRead(join(simHome, 'replay-commit')) },
    fixture: { companyA: fixture.companyA ?? null, companyB: fixture.companyB ?? null, provider: fixture.provider ?? null, gsrn: fixture.gsrn ?? null },
    summary: { total: records.length, passed: count('passed'), failed: count('failed'), skipped: count('skipped') },
    // vitest-style counters so tooling that expects a vitest summary can read it
    vitest: { numTotalTests: records.length, numPassedTests: count('passed'), numFailedTests: count('failed'), numPendingTests: count('skipped') },
    skipped: records.filter((r) => r.status === 'skipped').map((r) => ({ id: r.id, reason: r.reason })),
    steps: records,
  }
  output.write(join(args.out, `report-${scenario.id}.json`), report)
  summaryRows.push({ scenario: scenario.id, ...report.summary })
  allSteps.push(...records.map((r) => ({ scenarioFileId: scenario.id, ...r })))
  allScenarios.push({ id: scenario.id, title: scenario.title, summary: report.summary, skipped: report.skipped, startedAt, finishedAt: report.finishedAt })
  if (report.summary.failed > 0) anyFailed = true
}

// SIM_REPORT: one merged report; every step carries the scenario ID it belongs to (a scenario file may hold several IDs; PASS is
// judged per ID from its own steps by the caller). Written atomically.
{
  const count = (st) => allSteps.filter((r) => r.status === st).length
  const merged = {
    runId: process.env.T4_RUN_ID ?? null, scenarioFile: resolve(args.scenario),
    scope: 'DECLARED_STEPS_ONLY_NOT_CAMPAIGN_ACCEPTANCE', missingScenarioIds,
    stack: { app: env.T4_APP_URL, api: env.NEXT_PUBLIC_SUPABASE_URL, appCommit: safeRead(join(simHome, 'built-commit')), replayCommit: safeRead(join(simHome, 'replay-commit')), fingerprint: safeRead(join(simHome, 'fingerprint')) },
    summary: { total: allSteps.length, passed: count('passed'), failed: count('failed'), skipped: count('skipped') },
    vitest: { numTotalTests: allSteps.length, numPassedTests: count('passed'), numFailedTests: count('failed'), numPendingTests: count('skipped') },
    scenarios: allScenarios, skipped: allSteps.filter((r) => r.status === 'skipped').map((r) => ({ scenarioId: r.scenarioId, id: r.id, reason: r.reason })),
    steps: allSteps,
  }
  output.write(args.report, merged)
}
output.write(join(args.out, 'summary.json'), { runId: process.env.T4_RUN_ID ?? null, scenarios: summaryRows })
console.log(JSON.stringify(summaryRows))
process.exitCode = anyFailed ? 1 : 0
} finally { output.close() }

function safeRead(p) { try { return readFileSync(p, 'utf8').trim() } catch { return null } }
