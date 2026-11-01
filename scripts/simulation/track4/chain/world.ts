// The simulated world around the T4 platform for the source chain: the grid owner as its own OS process (talking to the
// platform only by e-mail through GreenMail) and the cron calls the platform's scheduler would make.
// Pattern origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426 scripts/helpers/reality/world.ts
// (startGridOwner, freePort); rewritten: the simulator runs under jiti (tsx is not installed here), no production lane.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cron } from './vendor/scripts/helpers/live-chain-fixture'

export const ROOT = resolve(__dirname, '../../../..')
export const SIM_HOME = process.env.SIM_HOME ?? `${process.env.HOME}/sim-home/track4`

export const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer().once('error', rej)
  s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => res(typeof a === 'object' && a ? a.port : 0)) })
})

export type GridOwnerSim = {
  url: string; edielId: string; email: string
  state: () => Promise<{ received: Array<Record<string, string>>; sent: Array<Record<string, string>>; failures: Array<{ error: string }>; pendingSends: number }>
  profile: (patch: Record<string, unknown>) => Promise<void>
  stop: () => void
}

/** The vendored grid-owner simulator under jiti; stays up until stop() or down.sh (pid file gridowner-<port>.pid). */
export async function startGridOwner(input: { edielId: string; email: string; pollMs?: number }): Promise<GridOwnerSim> {
  const port = await freePort()
  mkdirSync(`${SIM_HOME}/logs`, { recursive: true }); mkdirSync(`${SIM_HOME}/pids`, { recursive: true })
  const logPath = `${SIM_HOME}/logs/grid-owner-${port}.log`
  const log = openSync(logPath, 'a')
  const alias = JSON.stringify({ '@': ROOT, 'server-only': resolve(ROOT, 'node_modules/next/dist/compiled/server-only/empty.js') })
  const child = spawn(process.execPath, [resolve(ROOT, 'node_modules/jiti/lib/jiti-cli.mjs'), resolve(__dirname, 'vendor/scripts/reality/simulators/gridOwner.ts')], {
    cwd: ROOT, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, JITI_ALIAS: alias, JITI_FS_CACHE: 'false', REALITY_GRID_OWNER_EDIEL_ID: input.edielId, REALITY_GRID_OWNER_EMAIL: input.email,
      REALITY_GRID_OWNER_PORT: String(port), REALITY_GRID_OWNER_POLL_MS: String(input.pollMs ?? 5000), REALITY_MAIL_HOST: 'localhost',
      REALITY_SMTPS_PORT: process.env.T4_SMTPS_PORT ?? '55425', REALITY_IMAPS_PORT: process.env.T4_IMAPS_PORT ?? '55426', REALITY_GRID_OWNER_GRID_AREA: 'ALS' },
  })
  child.unref()
  if (child.pid) writeFileSync(`${SIM_HOME}/pids/gridowner-${port}.pid`, String(child.pid))
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; ; i += 1) {
    if (readFileSync(logPath, 'utf8').includes('control on')) break
    if (child.exitCode !== null || i > 90) throw new Error(`grid_owner_start_failed: ${readFileSync(logPath, 'utf8').slice(-800)}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
  const call = async (path: string, body?: unknown) => (await fetch(url + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })).json()
  return {
    url, edielId: input.edielId, email: input.email,
    state: () => call('/__sim/state'), profile: async (patch) => { await call('/__sim/profile', patch) },
    stop: () => { if (child.pid) try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ } },
  }
}

export const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
export const TICK_MS = Number(process.env.T4_CHAIN_TICK_MS ?? 10_000)

/** One pass of what the scheduler does for the Ediel test lane: inbound mail, then the Ediel outbox, then customer operations. */
export async function slot(options: { operations?: boolean } = {}) {
  const inbound = await cron('/api/internal/inbound-mail/cron?environment=test')
  const outbox = await cron('/api/ediel/outbox/process?environment=test')
  const operations = options.operations === false ? null : await cron('/api/internal/customer-operations/cron')
  return { inbound: { status: inbound.status, body: inbound.body }, outbox: { status: outbox.status, body: outbox.body }, operations: operations && { status: operations.status } }
}
