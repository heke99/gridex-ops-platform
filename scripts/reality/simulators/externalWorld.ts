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
import { createHash, randomUUID } from 'node:crypto'
import { syntheticSpotDay } from '../../helpers/reality/dst'

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
type SimAttachment = { filename: string | null; contentType: string | null; sizeBytes: number; sha256: string; pdf: boolean }
const emails: Array<{ id: string; at: string; to: unknown; subject: unknown; idempotencyKey: string | null; attachments: SimAttachment[] }> = []

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

/**
 * Deterministic, plausible SE-area quarter-hour curve (SEK/kWh) for offline runs: one row per actual
 * quarter-hour of the Stockholm calendar day (92/96/100 around the DST changes, DST-H2), as elprisetjustnu
 * publishes it. Formerly 96 rows from local midnight at a fixed +02:00, which left 25 October with a one-hour
 * gap and put every winter day one hour into the previous day.
 */
function syntheticDay(date: string, area: string) {
  return syntheticSpotDay(date, area)
}

function stockholm(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}
function syntheticPublished(date: string, now = new Date()) {
  const today = stockholm(now)
  const tomorrow = stockholm(new Date(now.getTime() + 24 * 3_600_000)).date
  return date <= today.date || (date === tomorrow && today.hour >= 13)
}

async function spot(res: ServerResponse, path: string) {
  const match = /^\/api\/v1\/prices\/(\d{4})\/(\d{2})-(\d{2})_(SE[1-4])\.json$/.exec(path)
  if (!match) return send(res, 404, { message: 'not found' })
  const [, y, m, d, area] = match
  const file = join(cacheDir, `${y}-${m}-${d}_${area}.json`)
  if (existsSync(file)) return send(res, 200, JSON.parse(readFileSync(file, 'utf8')))
  // Like the real provider: a day exists once Nord Pool has published it (the day ahead, after 13:00 Stockholm time);
  // later days are 404. Otherwise a whole future month would look complete and lockable (FINDINGS T28).
  if (spotSource === 'synthetic') return syntheticPublished(`${y}-${m}-${d}`) ? send(res, 200, syntheticDay(`${y}-${m}-${d}`, area)) : send(res, 404, { message: 'not published yet' })
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
      // Resend receives base64 content; the simulator keeps its fingerprint, never the bytes.
      const attachments = (Array.isArray(item.attachments) ? item.attachments : []).map((a: { filename?: string; content?: string; content_type?: string; contentType?: string }) => {
        const bytes = Buffer.from(String(a.content ?? ''), 'base64')
        return { filename: a.filename ?? null, contentType: a.content_type ?? a.contentType ?? null, sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'), pdf: bytes.subarray(0, 5).toString('latin1') === '%PDF-' }
      })
      emails.push({ id, at: new Date().toISOString(), to: item.to, subject: item.subject, idempotencyKey: String(req.headers['idempotency-key'] ?? '') || null, attachments })
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
