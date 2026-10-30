// Anrop mot appens riktiga HTTP-ingångar. Härkomst: 01d97c27:scripts/simulation/track3/lib/app.ts (T3_ -> T6_), utökad med hälso-pollning.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appUrl, custodyDir, env, mode } from './base'

export type HttpResult = { status: number; ok: boolean; body: unknown; text: string; ms: number }

async function call(path: string, secret: string, init: RequestInit = {}): Promise<HttpResult> {
  const t0 = Date.now()
  const r = await fetch(`${appUrl()}${path}`, { ...init, headers: { authorization: `Bearer ${secret}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(170_000) })
  const text = await r.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* ej JSON */ }
  return { status: r.status, ok: r.ok, body, text, ms: Date.now() - t0 }
}

/** app/api/internal/inbound-mail/cron/route.ts (Bearer EDIEL_INBOUND_CRON_SECRET). */
export const triggerInbound = (environment: 'test' | 'production' = mode()) =>
  call(`/api/internal/inbound-mail/cron?environment=${environment}`, env('EDIEL_INBOUND_CRON_SECRET'), { method: 'POST' })

/** app/api/ediel/outbox/process/route.ts (Bearer EDIEL_CRON_SECRET). */
export const triggerOutbox = (environment: 'test' | 'production' = mode(), limit = 25) =>
  call(`/api/ediel/outbox/process?environment=${environment}&limit=${limit}`, env('EDIEL_CRON_SECRET'), { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })

export type HealthSample = { t: number; status: number | null; ms: number; error?: string }
const POLL_SCRIPT = `
const fs = require('node:fs')
const [url, file, intervalMs] = process.argv.slice(1)
let stop = false
process.on('SIGTERM', () => { stop = true })
;(async () => {
  while (!stop) {
    const t = Date.now()
    let rec
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
      await r.arrayBuffer()
      rec = { t, status: r.status, ms: Date.now() - t }
    } catch (e) { rec = { t, status: null, ms: Date.now() - t, error: String(e && e.message || e) } }
    fs.appendFileSync(file, JSON.stringify(rec) + '\\n')
    await new Promise((res) => setTimeout(res, Number(intervalMs)))
  }
})()
`

/**
 * Hälso-pollning parallellt med en annan åtgärd, i en EGEN process (testprocessens händelseloop blockeras av spawnSync under dump/restore).
 * Route: /api/internal/system/health (oautentiserad => 401/503, aldrig 200 utan hemlighet; jfr scenarios/smoke.test.ts SMOKE.02).
 * Enbart INFORMATION om processens responsivitet: routen svarar 503 före all DB-åtkomst (app/api/internal/system/health/route.ts:41-43), så 503 är avsiktligt
 * och bevisar INTE att databasen är uppe. "Fel" = nätverksfel/timeout/HTTP >= 500 utom 503. Beviset för "utan att stoppa främmande körningar" är lib/custody/foreign.ts.
 * Provsvar skrivs till fil i SIM_HOME.
 */
export function startHealthPoll(intervalMs = 500, file = join(custodyDir('health'), `poll-${Date.now()}.jsonl`)): { file: string; stop: () => Promise<{ samples: HealthSample[]; failures: HealthSample[]; maxMs: number; p95Ms: number }> } {
  writeFileSync(file, '', { mode: 0o600 })
  const child = spawn(process.execPath, ['-e', POLL_SCRIPT, `${appUrl()}/api/internal/system/health`, file, String(intervalMs)], { stdio: 'ignore' })
  return {
    file,
    stop: async () => {
      await new Promise((res) => setTimeout(res, intervalMs + 300))
      const exited = new Promise((res) => child.once('exit', res))
      child.kill('SIGTERM')
      await Promise.race([exited, new Promise((res) => setTimeout(res, 12_000))])
      if (child.exitCode === null) child.kill('SIGKILL')
      const samples = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as HealthSample)
      const failures = samples.filter((s) => s.status === null || (s.status >= 500 && s.status !== 503))
      const ms = samples.map((x) => x.ms).sort((a, b) => a - b)
      return { samples, failures, maxMs: ms.at(-1) ?? 0, p95Ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] ?? 0 }
    },
  }
}
