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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createSql } from './lib/sql.mjs'
import { createHttp, sha256Hex } from './lib/http.mjs'
import { countsFor, diffCounts } from '../fixtures/flows.mjs'

function parseArgs(argv) {
  const args = { only: [], scenario: null, out: null, report: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenario') args.scenario = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
    else if (argv[i] === '--report') args.report = argv[++i]
    else if (argv[i] === '--only') args.only.push(...argv[++i].split(','))
    else throw new Error(`unknown option ${argv[i]}`)
  }
  if (!args.scenario || !args.out || !args.report) throw new Error('usage: run-scenarios.mjs --scenario <file> --out <dir> --report <SIM_REPORT path> [--only ID[,ID]]')
  return args
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
const env = loadEnv(join(simHome, 'env'))
mkdirSync(args.out, { recursive: true })

const mod = await import(pathToFileURL(resolve(args.scenario)).href)
const scenarios = mod.scenarios ?? (mod.scenario ? [mod.scenario] : null)
if (!scenarios) throw new Error('scenario file must export `scenarios` (array) or `scenario`')

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

  const wanted = new Set(args.only)
  const byId = new Map(scenario.steps.map((s) => [s.id, s]))
  const selected = new Set()
  const select = (id) => { if (selected.has(id)) return; selected.add(id); for (const n of byId.get(id)?.needs ?? []) select(n) }
  for (const s of scenario.steps) if (wanted.size === 0 || wanted.has(s.id) || s.fixture) select(s.id)

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
    const bad = (step.needs ?? []).find((n) => status.get(n) !== 'passed')
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
  writeFileSync(join(args.out, `report-${scenario.id}.json`), JSON.stringify(report, null, 2))
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
    stack: { app: env.T4_APP_URL, api: env.NEXT_PUBLIC_SUPABASE_URL, appCommit: safeRead(join(simHome, 'built-commit')), replayCommit: safeRead(join(simHome, 'replay-commit')), fingerprint: safeRead(join(simHome, 'fingerprint')) },
    summary: { total: allSteps.length, passed: count('passed'), failed: count('failed'), skipped: count('skipped') },
    vitest: { numTotalTests: allSteps.length, numPassedTests: count('passed'), numFailedTests: count('failed'), numPendingTests: count('skipped') },
    scenarios: allScenarios, skipped: allSteps.filter((r) => r.status === 'skipped').map((r) => ({ scenarioId: r.scenarioId, id: r.id, reason: r.reason })),
    steps: allSteps,
  }
  writeFileSync(`${args.report}.tmp`, JSON.stringify(merged, null, 2))
  renameSync(`${args.report}.tmp`, args.report)
}
writeFileSync(join(args.out, 'summary.json'), JSON.stringify({ runId: process.env.T4_RUN_ID ?? null, scenarios: summaryRows }, null, 2))
console.log(JSON.stringify(summaryRows))
process.exit(anyFailed ? 1 : 0)

function safeRead(p) { try { return readFileSync(p, 'utf8').trim() } catch { return null } }
