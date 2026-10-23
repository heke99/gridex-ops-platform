// The simulated world around the platform: counterparties as separate
// processes and Vercel's cron schedule, driven against a locally running app.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { cron, LIVE, sql } from '../live-chain-fixture'

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
 * Runs the frequent operational crons the way Vercel does, one 5-minute slot per
 * call (inbound mail, Ediel outbox, e-mail outboxes, manual inbound, webhooks,
 * customer operations; the 10- and 15-minute crons every 2nd/3rd slot), in
 * their minute order. A cron Vercel runs for ?environment=production runs exactly so (tenants live in production
 * answer there; FINDINGS T9), and again for ?environment=test for the scenarios that run in the test lane.
 */
let slotIndex = 0
export async function runOperationalCronSlot() {
  // Every-minute crons ("* * * * *") run in every slot, first; the others at their minute offset.
  const frequent = vercelCronPaths()
    .map(c => c.schedule === '* * * * *' ? { ...c, every: 5, minute: -1 }
      : { ...c, every: Number(/^\d+-\d+\/(\d+) \* \* \* \*$/.exec(c.schedule)?.[1] ?? 0), minute: Number(c.schedule.split('-')[0]) })
    .filter(c => [5, 10, 15].includes(c.every))
    .sort((a, b) => (a.minute % 5) - (b.minute % 5) || a.minute - b.minute)
  const results: Array<{ path: string; status: number; ms: number; body: unknown }> = []
  // Before the outbox runs: the deploy pipeline's verified release receipt for the running build (FINDINGS F89/F91).
  // The per-scope proofs themselves are recorded by the product's own job inside the Ediel outbox cron.
  const receiptStarted = Date.now()
  const { recordSimulatedReleaseReceipt } = await import('./scopedCertification')
  const receipt = await recordSimulatedReleaseReceipt().then(body => ({ status: 200, body }), (error: unknown) => ({ status: 500, body: { error: error instanceof Error ? error.message : String(error) } }))
  results.push({ path: 'reality:simulated-deploy-release-receipt', status: receipt.status, ms: Date.now() - receiptStarted, body: receipt.body })
  for (const entry of frequent) {
    if (slotIndex % (entry.every / 5) !== 0) continue
    const paths = entry.path.includes('environment=production') ? [entry.path, entry.path.replace('environment=production', 'environment=test')] : [entry.path]
    for (const path of paths) {
      const started = Date.now()
      const result = await cron(path)
      results.push({ path, status: result.status, ms: Date.now() - started, body: result.body })
    }
  }
  slotIndex += 1
  return results
}

export const world = { appUrl: LIVE.appUrl }

/**
 * Market reference data a fresh environment must have before customers can be served, fetched by the
 * platform's own crons: SVK's grid-area polygons (paged import, real public ArcGIS service) and the
 * spot prices (the external-world simulator). Returns what was imported.
 */
export async function prepareMarketData(maxImportCalls = 60) {
  const verified = () => sql<boolean>(`SELECT EXISTS(SELECT FROM public.energy_geodata_versions WHERE provider='svk_arcgis' AND status='verified')`)
  const calls: Array<{ status: number; ms: number }> = []
  for (let i = 0; i < maxImportCalls && !verified(); i++) {
    const started = Date.now()
    const result = await cron('/api/internal/platform/grid-areas/import/cron')
    calls.push({ status: result.status, ms: Date.now() - started })
    if (result.status >= 500) break
  }
  const spot = await cron('/api/cron/pricing/spot-prices')
  return {
    geodataVerified: verified(), importCalls: calls.length, importMs: calls.reduce((sum, c) => sum + c.ms, 0), failedCall: calls.find(c => c.status >= 400) ?? null,
    gridAreas: sql<number>(`SELECT to_jsonb(count(*)) FROM public.platform_grid_area_geometries WHERE is_active`), spotStatus: spot.status,
  }
}
