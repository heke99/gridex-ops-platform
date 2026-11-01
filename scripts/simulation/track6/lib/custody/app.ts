// Anrop mot appens riktiga HTTP-ingångar. Härkomst: 01d97c27:scripts/simulation/track3/lib/app.ts (T3_ -> T6_), utökad med hälso-pollning.
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appUrl, custodyDir, env, mode } from './base'

/**
 * Retain the original child handle and observe it from creation. A successful
 * kill() means only that a signal was sent, never that the writer has stopped.
 */
export function ownedChildStopper(child: ChildProcess, graceMs: number): () => Promise<void> {
  if (!Number.isInteger(graceMs) || graceMs < 0 || graceMs > 20_000) throw new Error('T6 child cleanup grace is not finite')
  let exited = child.exitCode !== null || child.signalCode !== null
  let childError = false
  const waiters = new Set<() => void>()
  child.once('exit', () => { exited = true; for (const done of [...waiters]) done() })
  // Spawn/signal errors can precede stop(). Keep them tied to this handle and
  // prevent an unhandled event from escaping without a cleanup failure receipt.
  child.on('error', () => { childError = true })
  const terminal = () => exited || child.exitCode !== null || child.signalCode !== null
  const wait = (ms: number): Promise<boolean> => new Promise(resolve => {
    if (terminal()) { resolve(true); return }
    const done = () => { clearTimeout(timer); waiters.delete(done); resolve(true) }
    const timer = setTimeout(() => { waiters.delete(done); resolve(terminal()) }, ms)
    waiters.add(done)
  })
  let stopping: Promise<void> | undefined
  return () => stopping ??= (async () => {
    let signalFailed = false
    const signal = (name: NodeJS.Signals): boolean => {
      if (terminal()) return true
      try { if (child.kill(name)) return true } catch { /* exact handle only; surface failure below */ }
      signalFailed = true
      return false
    }
    if (!terminal()) {
      if (signal('SIGTERM')) await wait(graceMs)
      if (!terminal()) { signal('SIGKILL'); await wait(2000) }
    }
    if (!terminal()) throw new Error('T6 child cleanup refused: child exit is unknown after bounded signals')
    if (signalFailed || childError) throw new Error('T6 child cleanup refused: child signal or process error')
  })()
}

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
  const stopChild = ownedChildStopper(child, 12_000)
  return {
    file,
    stop: async () => {
      await stopChild()
      const samples = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as HealthSample)
      const failures = samples.filter((s) => s.status === null || (s.status >= 500 && s.status !== 503))
      const ms = samples.map((x) => x.ms).sort((a, b) => a - b)
      return { samples, failures, maxMs: ms.at(-1) ?? 0, p95Ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] ?? 0 }
    },
  }
}
