// Anrop av Next server actions över HTTP med en inloggad admin-session (cookie), utan att röra appkoden.
//
// Mekanism (Next 16 / React Flight): klienten skickar `POST <sidans route>` med headern `Next-Action: <id>` och en
// multipart-kropp där fält "0" är JSON-listan med action-argumenten. Ett FormData-argument serialiseras som
// strängen "$K<n>" och dess poster ligger som fälten "_<n>_<namn>" (React encodeReply; prefixet har ledande
// understreck) och MÅSTE komma FÖRE fält "0" i kroppen (busboy-avkodaren löser $K när "0" anländer).
// Belagt offline mot RUN_DIR:s react-server-dom-webpack (client encodeReply + server decodeReplyFromBusboy):
// "1_<namn>" eller "0" först ger tom FormData; "_1_<namn>" före "0" ger rätt poster. Action-id slås upp i
// RUN_DIR/.next/server/server-reference-manifest.json via (filnamn, exportnamn); manifestets `workers` visar vilka
// sidor som får köra actionen och därmed vilken route som ska POST:as.
// Svaret är en Flight-ström: rad "1:<json>" är returvärdet, "1:E{...}" ett kastat fel (meddelandet maskas i
// produktionsbygget; se appens logg), och header `x-action-redirect` finns när actionen anropat redirect().
import fs from 'node:fs'
import path from 'node:path'
import { sim } from './env'
import type { AppSession } from './session'

const RUN_DIR = process.env.RUN_DIR ?? '/root/sim/track5'

type ManifestEntry = { workers: Record<string, unknown>; filename: string; exportedName: string }
let manifest: Record<string, ManifestEntry> | null = null

function loadManifest(): Record<string, ManifestEntry> {
  if (manifest) return manifest
  const file = path.join(RUN_DIR, '.next/server/server-reference-manifest.json')
  if (!fs.existsSync(file)) throw new Error(`server-reference-manifest.json saknas (${file}); är appen byggd?`)
  manifest = (JSON.parse(fs.readFileSync(file, 'utf8')) as { node: Record<string, ManifestEntry> }).node
  return manifest
}

/** Slår upp action-id utifrån källfil (relativt RUN_DIR) och exportnamn. Valfritt: kräver att `worker` (sidan) får köra den. */
export function findActionId(filename: string, exportedName: string, worker?: string): string {
  const hits = Object.entries(loadManifest()).filter(([, v]) => v.filename === filename && v.exportedName === exportedName)
  if (hits.length === 0) throw new Error(`server action saknas i manifestet: ${filename}#${exportedName}`)
  const hit = worker ? hits.find(([, v]) => worker in v.workers) : hits[0]
  if (!hit) throw new Error(`${filename}#${exportedName} är inte registrerad för sidan ${worker}; sidor: ${Object.keys(hits[0][1].workers).join(', ')}`)
  return hit[0]
}

export type ServerActionResult = {
  requestId?: string
  httpStatus: number
  /** Header x-action-redirect (actionen anropade redirect()). */
  redirect: string | null
  /** Tolkat returvärde (Flight-rad 1) när det är JSON, annars null. */
  value: unknown
  /** True när Flight-strömmen innehåller ett kastat fel (rad 'E{...}'). */
  threw: boolean
  /** Felrad(er) (digest, ev. meddelande i dev). Själva texten finns i appens serverlogg. */
  errorRows: string[]
  /** Första 400 tecknen av svaret för felsökning. */
  excerpt: string
}

export type ActionArg = unknown | FormData

/**
 * Anropar en server action. `route` är sidan som POST:as (t.ex. `/admin/customers/<id>`), `args` är actionens
 * argument i ordning (FormData-argument ersätts med $K-referenser).
 */
let callSeq = 0
export async function callServerAction(
  session: AppSession,
  opts: { route: string; filename: string; exportedName: string; args: ActionArg[]; worker?: string },
): Promise<ServerActionResult> {
  const id = findActionId(opts.filename, opts.exportedName, opts.worker)
  const body = new FormData()
  let part = 1
  const encoded = opts.args.map((arg) => {
    if (arg instanceof FormData) {
      const ref = part
      part += 1
      for (const [key, value] of arg.entries()) body.append(`_${ref}_${key}`, value as string | Blob)
      return `$K${ref.toString(16)}`
    }
    return arg === undefined ? '$undefined' : arg
  })
  body.append('0', JSON.stringify(encoded))
  // Exakt ett försök per anrop: ingen retry och aldrig redirect-följning (session.fetch använder redirect:'manual').
  callSeq += 1
  const requestId = `sim-${process.pid}-${callSeq}-${Date.now().toString(36)}`
  console.info(`[server-action] #${callSeq} request-id=${requestId} ${opts.exportedName} POST ${opts.route}`)
  const res = await session.fetch(opts.route, {
    method: 'POST',
    headers: { 'Next-Action': id, Accept: 'text/x-component', Origin: sim.appUrl, 'X-Sim-Request-Id': requestId },
    body,
  })
  const text = await res.text()
  const rows = new Map<string, string>()
  const errorRows: string[] = []
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]+):(.*)$/.exec(line)
    if (!m) continue
    rows.set(m[1], m[2])
    if (m[2].startsWith('E{') || m[2].startsWith('E"')) errorRows.push(`${m[1]}:${m[2].slice(0, 300)}`)
  }
  let value: unknown = null
  const row1 = rows.get('1')
  if (row1 && !row1.startsWith('E')) { try { value = JSON.parse(row1) } catch { value = null } }
  return {
    requestId,
    httpStatus: res.status,
    redirect: res.headers.get('x-action-redirect'),
    value,
    threw: errorRows.length > 0,
    errorRows,
    excerpt: text.slice(0, 400),
  }
}
