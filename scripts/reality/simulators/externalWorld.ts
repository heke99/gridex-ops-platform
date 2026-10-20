// External-world simulator: the third-party HTTP services the platform calls,
// as one long-running local process the app is pointed at through its own
// configuration (ELPRISETJUSTNU_BASE_URL, RESEND_BASE_URL). Each service can be
// switched into a fault mode at runtime, like a real outage.
//
//   spot   GET  /api/v1/prices/YYYY/MM-DD_SEn.json  real prices from the public
//              provider, cached on disk (REALITY_SPOT_SOURCE=real, default), or a
//              deterministic synthetic curve (=synthetic) when offline
//   resend POST /emails, POST /emails/batch, GET /domains[/id]
//   papapi GET  /papapi/lite/?query=<postal code>  postal-code centroid from the registered
//              (real) coordinates; POST /__sim/geocode {postal_code, latitude, longitude}
//   lantmateriet GET /lantmateriet/autocomplete/adress, /referens/fritext, /<objektidentitet>
//              exact address points (SWEREF99 TM) from POST /__sim/address; Basic auth required
//   control GET /__sim/state, POST /__sim/fault {service, mode, ms?, count?}
//
// Run: npx tsx scripts/reality/simulators/externalWorld.ts   (REALITY_WORLD_PORT, default 3901)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

type Service = 'spot' | 'resend' | 'papapi' | 'lantmateriet'
type FaultMode = 'ok' | 'rate_limited' | 'server_error' | 'slow' | 'hang' | 'invalid_json'
type Fault = { mode: FaultMode; ms: number; remaining: number | null }

const port = Number(process.env.REALITY_WORLD_PORT ?? 3901)
const cacheDir = process.env.REALITY_SPOT_CACHE ?? join(process.cwd(), '.reality-cache', 'spot')
const spotSource = process.env.REALITY_SPOT_SOURCE ?? 'real'
const faults = new Map<Service, Fault>()
const log: Array<{ at: string; service: Service; path: string; status: number; ms: number }> = []
type ExactAddress = { id: string; street: string; number: string; postalCode: string; city: string; x: number; y: number }
const exactAddresses: ExactAddress[] = []
const label = (a: ExactAddress) => `${a.street} ${a.number}, ${a.postalCode.slice(0, 3)} ${a.postalCode.slice(3)} ${a.city}`
const fold = (value: string) => value.toLowerCase().replace(/[\s,.\-]+/g, '')
const postalCentroids = new Map<string, { latitude: number; longitude: number }>()
const emails: Array<{ id: string; at: string; to: unknown; subject: unknown; idempotencyKey: string | null }> = []

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c }); req.on('end', () => resolve(s)); req.on('error', reject) })
}
function send(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(payload))
}

/** Applies the active fault for a service. Returns true when the fault answered (or will never answer). */
async function applyFault(service: Service, res: ServerResponse): Promise<boolean> {
  const fault = faults.get(service)
  if (!fault || fault.mode === 'ok') return false
  if (fault.remaining !== null) { fault.remaining -= 1; if (fault.remaining < 0) { faults.delete(service); return false } }
  switch (fault.mode) {
    case 'rate_limited': send(res, 429, { message: 'rate limited (simulated)' }, { 'retry-after': String(Math.ceil(fault.ms / 1000) || 1) }); return true
    case 'server_error': send(res, 500, { message: 'internal error (simulated)' }); return true
    case 'invalid_json': res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"truncated":'); return true
    case 'hang': return true // never answers: only the caller's own timeout ends the request
    case 'slow': await new Promise(r => setTimeout(r, fault.ms)); return false
  }
  return false
}

/** Deterministic, plausible SE-area quarter-hour curve (SEK/kWh) for offline runs. */
function syntheticDay(date: string, area: string) {
  const start = new Date(`${date}T00:00:00+02:00`).getTime()
  const areaFactor = { SE1: 0.6, SE2: 0.65, SE3: 1, SE4: 1.25 }[area] ?? 1
  return Array.from({ length: 96 }, (_, q) => {
    const hour = q / 4
    const shape = 0.35 + 0.25 * Math.max(0, Math.sin(((hour - 5) * Math.PI) / 14)) + (hour >= 17 && hour < 20 ? 0.3 : 0)
    const sek = Math.round(shape * areaFactor * 100000) / 100000
    return { SEK_per_kWh: sek, EUR_per_kWh: Math.round((sek / 11.2) * 100000) / 100000, EXR: 11.2,
      time_start: new Date(start + q * 900_000).toISOString().replace('.000Z', '+00:00'),
      time_end: new Date(start + (q + 1) * 900_000).toISOString().replace('.000Z', '+00:00') }
  })
}

async function spot(res: ServerResponse, path: string) {
  const match = /^\/api\/v1\/prices\/(\d{4})\/(\d{2})-(\d{2})_(SE[1-4])\.json$/.exec(path)
  if (!match) return send(res, 404, { message: 'not found' })
  const [, y, m, d, area] = match
  const file = join(cacheDir, `${y}-${m}-${d}_${area}.json`)
  if (existsSync(file)) return send(res, 200, JSON.parse(readFileSync(file, 'utf8')))
  if (spotSource === 'synthetic') return send(res, 200, syntheticDay(`${y}-${m}-${d}`, area))
  const upstream = await fetch(`https://www.elprisetjustnu.se${path}`, { signal: AbortSignal.timeout(15_000) })
  if (!upstream.ok) return send(res, upstream.status, { message: `upstream ${upstream.status}` })
  const rows = await upstream.json()
  mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, JSON.stringify(rows))
  return send(res, 200, rows)
}

function papapi(res: ServerResponse, url: URL) {
  const postal = (url.searchParams.get('query') ?? '').replace(/\s+/g, '')
  const point = postalCentroids.get(postal)
  if (!point) return send(res, 200, { results: [] })
  return send(res, 200, { results: [{ postal_code: `${postal.slice(0, 3)} ${postal.slice(3)}`, latitude: point.latitude, longitude: point.longitude, country: 'SE' }] })
}

function lantmateriet(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!String(req.headers.authorization ?? '').startsWith('Basic ')) return send(res, 401, { message: 'unauthorized' })
  const path = url.pathname.replace(/^\/lantmateriet/, '')
  const wanted = fold(url.searchParams.get('adress') ?? '')
  const matches = exactAddresses.filter(a => fold(label(a)) === wanted)
  if (path === '/autocomplete/adress') return send(res, 200, matches.map(label))
  if (path === '/referens/fritext') {
    if (matches.length === 0) return send(res, 404, { message: 'no match' })
    return send(res, 200, matches.map(a => ({ objektidentitet: a.id, adress: { adressomrade: a.street, adressplatsnummer: a.number, postnummer: a.postalCode, postort: a.city } })))
  }
  const found = exactAddresses.find(a => path === `/${a.id}`)
  if (!found) return send(res, 404, { message: 'not found' })
  return send(res, 200, { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [found.x, found.y] }, properties: { objektidentitet: found.id } }] })
}

async function resend(req: IncomingMessage, res: ServerResponse, path: string) {
  if (req.method === 'POST' && (path === '/emails' || path === '/emails/batch')) {
    const parsed = JSON.parse((await body(req)) || '{}')
    const items = Array.isArray(parsed) ? parsed : [parsed]
    const ids = items.map(item => {
      const id = randomUUID()
      emails.push({ id, at: new Date().toISOString(), to: item.to, subject: item.subject, idempotencyKey: String(req.headers['idempotency-key'] ?? '') || null })
      return { id }
    })
    return send(res, 200, path === '/emails' ? ids[0] : { data: ids })
  }
  if (req.method === 'GET' && path.startsWith('/domains')) return send(res, 200, path === '/domains' ? { data: [] } : { id: path.split('/')[2], status: 'verified', records: [] })
  return send(res, 404, { message: 'not simulated' })
}

const server = createServer(async (req, res) => {
  const started = Date.now()
  const path = new URL(req.url ?? '/', 'http://local').pathname
  try {
    if (path === '/__sim/state') return send(res, 200, { faults: Object.fromEntries(faults), log: log.slice(-200), emails })
    if (path === '/__sim/fault' && req.method === 'POST') {
      const input = JSON.parse(await body(req)) as { service: Service; mode: FaultMode; ms?: number; count?: number }
      if (input.mode === 'ok') faults.delete(input.service)
      else faults.set(input.service, { mode: input.mode, ms: input.ms ?? 0, remaining: input.count ?? null })
      return send(res, 200, { faults: Object.fromEntries(faults) })
    }
    if (path === '/__sim/geocode' && req.method === 'POST') {
      const input = JSON.parse(await body(req)) as { postal_code: string; latitude: number; longitude: number }
      postalCentroids.set(input.postal_code.replace(/\s+/g, ''), { latitude: input.latitude, longitude: input.longitude })
      return send(res, 200, { registered: postalCentroids.size })
    }
    if (path === '/__sim/address' && req.method === 'POST') {
      const input = JSON.parse(await body(req)) as Omit<ExactAddress, 'id'>
      exactAddresses.push({ ...input, postalCode: input.postalCode.replace(/\s+/g, ''), id: randomUUID() })
      return send(res, 200, { registered: exactAddresses.length })
    }
    const service: Service = path.startsWith('/api/v1/prices') ? 'spot' : path.startsWith('/papapi') ? 'papapi' : path.startsWith('/lantmateriet') ? 'lantmateriet' : 'resend'
    if (await applyFault(service, res)) { log.push({ at: new Date().toISOString(), service, path, status: res.statusCode, ms: Date.now() - started }); return }
    if (service === 'spot') await spot(res, path)
    else if (service === 'papapi') papapi(res, new URL(req.url ?? '/', 'http://local'))
    else if (service === 'lantmateriet') lantmateriet(req, res, new URL(req.url ?? '/', 'http://local'))
    else await resend(req, res, path)
    log.push({ at: new Date().toISOString(), service, path, status: res.statusCode, ms: Date.now() - started })
  } catch (error) {
    if (!res.headersSent) send(res, 502, { message: error instanceof Error ? error.message : String(error) })
  }
})
server.listen(port, '127.0.0.1', () => console.log(`[external-world] listening on http://127.0.0.1:${port} (spot=${spotSource})`))
