// The simulated world around the platform: counterparties as separate
// processes and Vercel's cron schedule, driven against a locally running app.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { cron, LIVE } from '../live-chain-fixture'

export type GridOwnerSim = {
  url: string; edielId: string; email: string
  state: () => Promise<{ received: Array<Record<string, string>>; sent: Array<Record<string, string>>; failures: Array<{ error: string }>; pendingSends: number }>
  profile: (patch: Record<string, unknown>) => Promise<void>
  sendE66: (input: { meterId: string; day: string; receiver: string; dayIndex?: number }) => Promise<void>
  stop: () => void
}

/** A grid owner as its own OS process, talking to the platform only by e-mail. */
/** A free local TCP port, so worlds started one after another never collide. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().once('error', reject)
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolve(typeof address === 'object' && address ? address.port : 0)) })
  })
}

export async function startGridOwner(input: { edielId: string; email: string; port?: number; pollMs?: number }): Promise<GridOwnerSim> {
  const port = input.port ?? await freePort()
  const child: ChildProcess = spawn('npx', ['tsx', 'scripts/reality/simulators/gridOwner.ts'], {
    env: { ...process.env, REALITY_GRID_OWNER_EDIEL_ID: input.edielId, REALITY_GRID_OWNER_EMAIL: input.email,
      REALITY_GRID_OWNER_PORT: String(port), REALITY_GRID_OWNER_POLL_MS: String(input.pollMs ?? 15_000) },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  const output: string[] = []
  child.stdout?.on('data', chunk => output.push(String(chunk)))
  child.stderr?.on('data', chunk => output.push(String(chunk)))
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; ; i += 1) {
    if (output.join('').includes('control on')) break
    if (child.exitCode !== null || i > 120) throw Error(`grid_owner_start_failed:${output.join('').slice(-500)}`)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(url + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })
    return response.json()
  }
  return {
    url, edielId: input.edielId, email: input.email,
    state: () => call('/__sim/state'),
    profile: async patch => { await call('/__sim/profile', patch) },
    sendE66: async e66 => { await call('/__sim/send-e66', e66) },
    // npx starts tsx as a child: end the whole process group.
    stop: () => { if (child.pid) try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ } },
  }
}

/** vercel.json cron paths in their schedule order (minute offsets 0..4 of each 5-minute slot). */
export function vercelCronPaths(): Array<{ path: string; schedule: string }> {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string; schedule: string }> }
  return config.crons
}

/**
 * Runs the 5-minute operational crons the way Vercel does, one slot per call:
 * inbound mail, Ediel outbox, e-mail outbox, manual e-mail, manual inbound,
 * webhooks and customer operations, in their minute order. The test environment
 * is used where the production cron passes ?environment=production.
 */
export async function runOperationalCronSlot() {
  const fiveMinute = vercelCronPaths().filter(c => /^\d+-\d+\/5 /.test(c.schedule))
    .sort((a, b) => Number(a.schedule.split('-')[0]) - Number(b.schedule.split('-')[0]))
  const results: Array<{ path: string; status: number; ms: number; body: unknown }> = []
  for (const entry of fiveMinute) {
    const path = entry.path.replace('environment=production', 'environment=test')
    const started = Date.now()
    const result = await cron(path)
    results.push({ path, status: result.status, ms: Date.now() - started, body: result.body })
  }
  return results
}

export const world = { appUrl: LIVE.appUrl }
