// executionScope: ISOLATED_NATIVE
// simulation: TERM01.01, TERM01.02, TERM01.03, TERM01.04, TERM01.05
// Bindningstid och slutdatum för kundavtal. Oraklet räknas här med en egen ren datumfunktion
// (inte appens lifecycle.ts/commitment.ts). Läsvägar: adminsidan /admin/customers/[id]?tab=contracts via HTTP
// med riktig admin-cookie-session, och DB-raden i customer_contracts.
// Ingen webbläsare (Playwright) används: ren HTTP + psql. Auth/JWT = real tid; affärsdatum = explicita parametrar.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { loginSession, psql, psqlRows, removeAdminFixtureUser, type AppSession } from '../lib'
import { assertContractEditFeedback, callServerAction, type ServerActionResult } from '../lib/server-action'
import {
  createSignedContract, createTermTenant, probeCreateCustomerAction, probeCreateContractTsPath, psqlExpectError, rowHash, stockholmToday,
  type SignedContractFixture, type TermTenant, type CreateSignedContractInput,
} from '../lib/term-fixture'

// ---------- Oberoende orakel: ren kalenderaritmetik på YYYY-MM-DD (ingen Date, ingen app-kod) ----------
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysIn = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : DAYS_IN_MONTH[m - 1])
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
function parseIso(iso: string) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d } }
/** Start + n kalendermånader, dag klampas till målmånadens sista dag. Resultatet är det EXKLUSIVA bindningsslutet. */
export function oracleAddMonths(iso: string, months: number): string {
  const { y, m, d } = parseIso(iso)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12); const nm = (total % 12) + 1
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, daysIn(ny, nm)))}`
}
/** Dagen före (sista bundna dag när slutet är exklusivt). */
export function oracleDayBefore(iso: string): string {
  const { y, m, d } = parseIso(iso)
  if (d > 1) return `${pad(y, 4)}-${pad(m)}-${pad(d - 1)}`
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y
  return `${pad(py, 4)}-${pad(pm)}-${pad(daysIn(py, pm))}`
}
/** Dagar sedan 0000-03-01 (proleptisk gregoriansk, Hinnants civil-algoritm); för dagsdifferenser. */
function ordinal(iso: string): number {
  const { y: initialYear, m, d } = parseIso(iso)
  let y = initialYear
  y -= m <= 2 ? 1 : 0
  const era = Math.floor(y / 400); const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
}
const dayDiff = (a: string, b: string) => ordinal(a) - ordinal(b)

// ---------- Läsning av adminsidan ----------
const MONTHS = (() => {
  const map = new Map<string, number>()
  for (let i = 0; i < 12; i += 1) {
    for (const style of ['short', 'long'] as const) {
      const name = new Intl.DateTimeFormat('sv-SE', { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2020, i, 15)))
      map.set(name.replace(/\.$/, '').toLowerCase(), i + 1)
    }
  }
  return map
})()
const DATE_TOKEN = String.raw`(?:—|\d{1,2}\s+[^\s\d]+\s+\d{4}(?:\s+\d{2}:\d{2})?)`

function pageText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[   ]/g, ' ')
}

/** Privacy checks include serialized response data, not just visible date text.
 * This bounded profile reads Next's literal inline queue (0/1/2/3) as data.
 * Unknown scripts/encodings mean HOLD, never a successful privacy assertion. */
async function tenantPrivacyText(html: string): Promise<string> {
  function hold(): never { throw new Error('TERM01.TEN response encoding is unqualified') }
  const limit = 16 * 1024 * 1024
  if (Buffer.byteLength(html, 'utf8') > limit) hold()
  const views: string[] = [], chunks: Buffer[] = []
  let bootstrap = false, formState = false, dataStarted = false, instructions = 0, bytes = 0, strings = 0
  const add = (value: string) => {
    bytes += Buffer.byteLength(value, 'utf8')
    if (bytes > limit * 4) hold()
    views.push(value)
  }
  // Keep attributes/comments as well as text; markup is not a privacy boundary.
  add(html); add(html.replace(/<[^>]+>/g, ''))
  type HtmlNode = { nodeType: number; rawTagName?: string | null; rawAttrs?: string; rawAttributes?: Record<string, string | null>; rawText: string; text: string; childNodes?: HtmlNode[] }
  type HtmlAPI = { parse: (input: string, options: { comment: boolean }) => HtmlNode; TextNode: new (input: string) => { text: string } }
  // Next bundles this full decoder without declarations. Import only this
  // fixed installed path and qualify its public API, with no module extraction.
  const moduleName: string = 'next/dist/compiled/node-html-parser/index.js'
  let imported: unknown
  try { imported = await import(moduleName) } catch { hold() }
  if (!imported || typeof imported !== 'object') hold()
  const namespace = imported as Record<string, unknown>
  const publicModule = typeof namespace.parse === 'function' ? namespace : namespace.default
  if (!publicModule || typeof publicModule !== 'object') hold()
  const api = publicModule as Record<string, unknown>
  if (typeof api.parse !== 'function' || typeof api.TextNode !== 'function') hold()
  const parseHTML = api.parse as HtmlAPI['parse'], TextNode = api.TextNode as HtmlAPI['TextNode']
  const decodeText = (value: string): string => {
    try {
      const decoded = new TextNode(value).text
      if (typeof decoded !== 'string') hold()
      return decoded
    } catch { return hold() }
  }
  const numericProfile = (value: string) => {
    for (const reference of value.matchAll(/&#(?:x([0-9a-f]+)|(\d+));?/gi)) {
      const code = reference[1] ? parseInt(reference[1], 16) : Number(reference[2])
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) hold()
    }
  }
  const attributeText = (value: string) => {
    numericProfile(value)
    // The public API uses text-default decoding. Attribute qualification is
    // narrower: full semicolon-terminated named references producing 1–2 code
    // points. Legacy-prefix ambiguity (&notit;) / unknown names mean HOLD.
    for (const [reference] of value.matchAll(/&[a-z][a-z0-9]*;?/gi)) {
      if (!reference.endsWith(';') || [...decodeText(reference)].length > 2) hold()
    }
    add(decodeText(value))
  }
  let document: HtmlNode
  try { document = parseHTML(html, { comment: true }) } catch { hold() }
  if (!document || !Array.isArray(document.childNodes)) hold()
  const stack: Array<{ node: HtmlNode; raw: boolean }> = [{ node: document, raw: false }], textParts: string[] = []
  const rawTags = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext'])
  let nodes = 0
  while (stack.length) {
    const { node, raw } = stack.pop()!
    if (++nodes > 100000) hold()
    if (node.nodeType === 1) {
      // Audit the raw attribute representation as well as parsed values, so
      // duplicate attributes cannot disappear behind the parser's value map.
      if (node.rawAttrs) attributeText(node.rawAttrs)
      for (const value of Object.values(node.rawAttributes ?? {})) attributeText(value ?? '')
    } else if (node.nodeType === 3 && !raw) {
      numericProfile(node.rawText)
      const text = decodeText(node.rawText)
      add(text); textParts.push(text)
    }
    const childRaw = raw || rawTags.has(node.rawTagName?.toLowerCase() ?? '')
    for (const child of [...(node.childNodes ?? [])].reverse()) stack.push({ node: child, raw: childRaw })
  }
  add(textParts.join(''))
  const jsonStrings = (value: string) => {
    const tokens = value.matchAll(/"(?:\\["\\/bfnrt]|\\u[0-9a-f]{4}|[^"\\\u0000-\u001f])*"/gi)
    for (const token of tokens) {
      if (++strings > 100000) hold()
      const decoded: unknown = JSON.parse(token[0])
      if (typeof decoded !== 'string') hold()
      add(decoded)
    }
  }
  // Decode quoted JSON strings after byte reassembly, including Flight model
  // strings escaped inside the outer Next queue JSON. Never evaluate JS.
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
  let matched = 0
  for (const match of html.matchAll(scripts)) {
    matched++
    if (matched > 10000) hold()
    let body = match[1].trim()
    if (!body) {
      if (!/\bsrc\s*=\s*(?:"[^"]+"|'[^']+')/i.test(match[0].slice(0, match[0].indexOf('>')))) hold()
      continue
    }
    while (body) {
      const initial = '(self.__next_f=self.__next_f||[]).push('
      const next = 'self.__next_f.push('
      const prefix = body.startsWith(initial) ? initial : body.startsWith(next) ? next : hold()
      if (++instructions > 10000 || (prefix === initial && bootstrap) || (prefix === next && !bootstrap)) hold()
      const input = body.slice(prefix.length)
      if (input[0] !== '[') hold()
      let depth = 0, quoted = false, escaped = false, end = -1
      for (let i = 0; i < input.length; i++) {
        const character = input[i]
        if (quoted) {
          if (escaped) escaped = false
          else if (character === '\\') escaped = true
          else if (character === '"') quoted = false
        } else if (character === '"') quoted = true
        else if (character === '[' || character === '{') depth++
        else if (character === ']' || character === '}') {
          if (--depth === 0) { end = i + 1; break }
        }
      }
      if (end < 0 || input[end] !== ')') hold()
      let payload: unknown
      try { payload = JSON.parse(input.slice(0, end)) } catch { hold() }
      if (!Array.isArray(payload)) hold()
      const [tag, value] = payload
      if (prefix === initial) {
        if (tag !== 0 || payload.length !== 1) hold()
        bootstrap = true
      } else if (tag === 1 || tag === 3) {
        if (payload.length !== 2 || typeof value !== 'string') hold()
        if (tag === 3 && (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
          || Buffer.from(value, 'base64').toString('base64') !== value)) hold()
        const chunk = Buffer.from(value, tag === 1 ? 'utf8' : 'base64')
        bytes += chunk.length
        if (bytes > limit * 4) hold()
        chunks.push(chunk); dataStarted = true
      } else if (tag === 2) {
        if (payload.length !== 2 || formState || dataStarted) hold()
        formState = true
        const encoded = JSON.stringify(value)
        add(encoded); jsonStrings(encoded)
      } else hold()
      body = input.slice(end + 1).trim()
      if (body) {
        if (!body.startsWith(';')) hold()
        body = body.slice(1).trim()
      }
    }
  }
  if ((html.match(/<script\b/gi) ?? []).length !== matched) hold()
  const flight = Buffer.concat(chunks).toString('utf8')
  add(flight); jsonStrings(flight)
  return views.join('\n')
}
function svDateToIso(token: string | undefined): string | null {
  if (!token || token.trim() === '—') return null
  const m = /(\d{1,2})\s+([^\s\d]+?)\.?\s+(\d{4})/.exec(token)
  if (!m) throw new Error(`oläsbart datum på sidan: ${token}`)
  const month = MONTHS.get(m[2].replace(/\.$/, '').toLowerCase())
  if (!month) throw new Error(`okänd månad på sidan: ${m[2]}`)
  return `${m[3]}-${pad(month)}-${pad(Number(m[1]))}`
}
function grab(text: string, re: RegExp, what: string): string {
  const m = re.exec(text)
  if (!m) throw new Error(`fält saknas på adminsidan: ${what}`)
  return m[1]
}

type ShownContract = {
  summaryStart: string | null; summarySlut: string | null
  detailStart: string | null; explicitSlut: string | null; aktuelltSlutdatum: string | null; nextRenewal: string | null
  currentTermEnd: string | null; bindingMonthsText: string; bindingActive: 'Ja' | 'Nej'; autoRenewText: string
}

async function readShown(session: AppSession, customerId: string): Promise<ShownContract> {
  const start = `/admin/customers/${customerId}?tab=contracts`
  const res = await session.fetch(start)
  const html = await res.text()
  if (res.status !== 200) {
    // Följ redirectkedjan manuellt (session.fetch följer inte) och logga varje steg så att felet förklarar sig självt.
    const chain: string[] = [`${res.status} ${start} -> ${res.headers.get('location') ?? '(ingen Location)'}`]
    let current = res
    for (let hop = 0; hop < 5 && current.status >= 300 && current.status < 400 && current.headers.get('location'); hop += 1) {
      const next = new URL(current.headers.get('location')!, 'http://x').pathname + new URL(current.headers.get('location')!, 'http://x').search
      current = await session.fetch(next)
      await current.text()
      chain.push(`${current.status} ${next} -> ${current.headers.get('location') ?? '(slut)'}`)
    }
    const digest = /NEXT_REDIRECT[^<"]{0,200}/.exec(html)?.[0] ?? ''
    console.error(`[readShown] icke-200: ${chain.join(' | ')} ${digest}`)
    throw new Error(`admin-sidan svarade ${res.status}; Location=${res.headers.get('location')}; kedja=${chain.join(' | ')}; ${html.slice(0, 200)}`)
  }
  const t = pageText(html)
  const summary = new RegExp(String.raw`Start\s+(${DATE_TOKEN})\s*·\s*Slut\s+(${DATE_TOKEN})`).exec(t)
  if (!summary) throw new Error('fält saknas på adminsidan: "Start … · Slut …" (är kundens avtalsflik renderad?)')
  const term = new RegExp(String.raw`Nuvarande avtalsperiod\s+(${DATE_TOKEN})\s*→\s*(${DATE_TOKEN})`).exec(t)
  return {
    summaryStart: svDateToIso(summary[1]), summarySlut: svDateToIso(summary[2]),
    detailStart: svDateToIso(grab(t, new RegExp(String.raw`Start:\s*(${DATE_TOKEN})`), 'Start:')),
    explicitSlut: svDateToIso(grab(t, new RegExp(String.raw`Explicit slut:\s*(${DATE_TOKEN})`), 'Explicit slut')),
    aktuelltSlutdatum: svDateToIso(grab(t, new RegExp(String.raw`Aktuellt slutdatum:\s*(${DATE_TOKEN})`), 'Aktuellt slutdatum')),
    nextRenewal: svDateToIso(grab(t, new RegExp(String.raw`Nästa förlängning:\s*(${DATE_TOKEN})`), 'Nästa förlängning')),
    currentTermEnd: term ? svDateToIso(term[2]) : null,
    bindingMonthsText: grab(t, /Bindningstid:\s*(\S+)\s*mån/, 'Bindningstid').trim(),
    bindingActive: grab(t, /Bindning aktiv nu\s+(Ja|Nej)/, 'Bindning aktiv nu') as 'Ja' | 'Nej',
    autoRenewText: grab(t, /Auto renew:\s*(Ja|Nej)/, 'Auto renew'),
  }
}

type DbContract = {
  id: string; status: string; binding_months: number | null; notice_months: number | null
  starts_at: string | null; ends_at: string | null; signed_at: string | null; monthly_fee_sek: number | null
  contract_price_snapshot_id: string | null; auto_renew_enabled: boolean
}
function readDb(contractId: string): DbContract {
  const rows = psqlRows<DbContract>(`select id,status,binding_months,notice_months,starts_at,ends_at,signed_at,monthly_fee_sek,contract_price_snapshot_id,auto_renew_enabled from public.customer_contracts where id='${contractId}'`)
  expect(rows).toHaveLength(1)
  return rows[0]
}

// ---------- Gemensam uppsättning ----------
let tenant: TermTenant
let session: AppSession
const tenantSessionFor = async () => session
const observations: Record<string, unknown>[] = []

type ContractInput = Partial<CreateSignedContractInput> & Pick<CreateSignedContractInput, 'bindingMonths' | 'startsAt'>
const withDefaults = (input: ContractInput): CreateSignedContractInput => ({ contractType: 'variable_hourly', noticeMonths: 1, priceArea: 'SE3', ...input })

/** Skapar signerat avtal och kör bindningskontrollen (kund, anläggning, mätpunkt, prissnapshot, bevis, versioner). */
async function signed(input: ContractInput): Promise<SignedContractFixture> {
  const f = await createSignedContract(tenant, withDefaults(input))
  assertBindingChain(f)
  return f
}

// Selected native columns and the signed v6 fixture's JSON members. These
// annotations preserve, and do not replace, the runtime binding assertions.
type ContractRow = {
  company_id: string; customer_id: string | null; site_id: string | null; customer_site_id: string | null; metering_point_id: string | null
  contract_publication_version_id: string | null; contract_offer_id: string | null; legal_bundle_version_id: string | null
  contract_product_version_id: string | null; price_plan_version_id: string | null; contract_price_snapshot_id: string | null
  status: string; contract_name: string; contract_type: string
  binding_months: number | null; notice_months: number | null; monthly_fee_sek: number | null; invoice_fee_sek: number | null
  fixed_price_ore_per_kwh: number | null; spot_markup_ore_per_kwh: number | null; variable_fee_ore_per_kwh: number | null
  starts_at: string | null; ends_at: string | null; signed_at: string | null
  terms_version: string | null; price_version: string | null; campaign_name: string | null; campaign_code: string | null; campaign_version: string | null
  green_fee_mode: string | null; auto_renew_enabled: boolean; auto_renew_term_months: number | null; document_sha256: string | null
  snapshot_hash: string | null; signature_snapshot_sha256: string | null
  signature_snapshot: { pricing_snapshot_sha256?: string }; metadata: { sim_declared_signed_at?: string }
}
type SnapshotPriceOption = { price_option_reference: string; binding_months: number; notice_months: number }
type SnapshotPriceComponent = { component_code?: string; componentCode?: string; amount: number | string | null }
type PriceSnapshotRow = {
  company_id: string; contract_id: string; customer_id: string | null; snapshot_hash: string; recomputed_hash: string
  snapshot_json: { price_options: SnapshotPriceOption[]; price_option_reference: string }
  price_components_snapshot: SnapshotPriceComponent[]
}

const sha256 = /^[a-f0-9]{64}$/
/**
 * Bindningskontroll: rätt company/kund/anläggning/mätpunkt, prissnapshot med samma company/contract/customer och
 * bindning/uppsägning/månadsavgift som erbjöds, signeringsbevis som refererar avtalet, samt exakta publicerade versioner.
 */
function assertBindingChain(f: SignedContractFixture) {
  const q = <T,>(sql: string) => psqlRows<T>(sql)
  const [c] = q<ContractRow>(`select * from public.customer_contracts where id='${f.contractId}'`)
  expect(c, 'avtalsraden finns').toBeTruthy()
  expect(c.company_id).toBe(f.companyId)
  expect(c.customer_id).toBe(f.customerId)
  expect(c.site_id).toBe(f.siteId)
  if (c.customer_site_id !== null) expect(c.customer_site_id).toBe(f.siteId)
  expect(c.metering_point_id).toBe(f.meteringPointId)
  const [site] = q<{ company_id: string | null; customer_id: string | null }>(`select company_id,customer_id from public.customer_sites where id='${f.siteId}'`)
  expect(site).toMatchObject({ company_id: f.companyId, customer_id: f.customerId })
  const [mp] = q<{ company_id: string | null; customer_id: string | null; site_id: string | null }>(`select company_id,customer_id,site_id from public.metering_points where id='${f.meteringPointId}'`)
  expect(mp).toMatchObject({ company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId })

  // Publicerade versioner
  expect(c.contract_publication_version_id).toBe(f.publicationVersionId)
  expect(c.contract_offer_id).toBe(f.offerId)
  const [pv] = q<{ status: string; legal_bundle_version_id: string; contract_product_version_id: string; price_plan_version_id: string | null; offer_id: string | null }>(`select status,legal_bundle_version_id,contract_product_version_id,price_plan_version_id,publication_snapshot->>'legacy_contract_offer_id' as offer_id from public.contract_publication_versions where id='${f.publicationVersionId}'`)
  expect(pv.status).toBe('published')
  expect(pv.offer_id, 'publication-versionen hör till fixturens erbjudande').toBe(f.offerId)
  expect(c.legal_bundle_version_id, 'legal_bundle_version_id = publicerad versions').toBe(pv.legal_bundle_version_id)
  expect(c.contract_product_version_id).toBe(pv.contract_product_version_id)
  expect(c.price_plan_version_id).toBe(pv.price_plan_version_id)

  // Prissnapshot
  const [snap] = q<PriceSnapshotRow>(`select s.*, encode(extensions.digest(convert_to(s.snapshot_json::text,'UTF8'),'sha256'),'hex') as recomputed_hash from public.contract_price_snapshots s where s.id='${c.contract_price_snapshot_id}'`)
  expect(snap, 'prissnapshot finns').toBeTruthy()
  expect(snap).toMatchObject({ company_id: f.companyId, contract_id: f.contractId, customer_id: f.customerId })
  const offeredBinding = f.input.bindingMonths
  const offeredNotice = f.input.noticeMonths
  const offeredFee = f.input.monthlyFeeSek ?? 49
  // v6-selection-snapshoten (gridex_create_internal_customer_contract_v1) har inga toppnivånycklar binding_months/notice_months/
  // monthly_fee_sek: villkoren ligger i det valda prisalternativet (price_options[price_option_reference]) och i
  // price_components_snapshot (komponent monthly_fee); radens värden kopieras från option resp. komponent.
  const chosen = (snap.snapshot_json.price_options as SnapshotPriceOption[]).find((o) => o.price_option_reference === snap.snapshot_json.price_option_reference)
  expect(chosen, `valt prisalternativ ${snap.snapshot_json.price_option_reference} finns i snapshoten`).toBeTruthy()
  expect(chosen!.binding_months, 'snapshot: valt alternativ binding_months').toBe(offeredBinding ?? 0)
  expect(chosen!.notice_months, 'snapshot: valt alternativ notice_months').toBe(offeredNotice)
  const feeComponent = (snap.price_components_snapshot as SnapshotPriceComponent[]).find((x) => (x.component_code ?? x.componentCode) === 'monthly_fee')
  expect(feeComponent, 'snapshot: monthly_fee-komponent').toBeTruthy()
  expect(Number(feeComponent!.amount), 'snapshot: månadsavgiftskomponent').toBe(offeredFee)
  // Erbjudandet (price option) och avtalsraden
  const [opt] = q<{ binding_months: number; notice_months: number }>(`select binding_months,notice_months from public.contract_price_options where id='${f.priceOptionId}'`)
  expect(opt).toMatchObject({ binding_months: offeredBinding ?? 0, notice_months: offeredNotice })
  // Avtalsraden har värdena från appens skapande (erbjudandets default/option), inte från fixturen.
  if (offeredBinding === null) expect([null, 0], 'avtalsrad binding_months (null erbjuden)').toContain(c.binding_months)
  else expect(c.binding_months, 'avtalsrad binding_months från appens skapande').toBe(offeredBinding)
  expect(c.notice_months, 'avtalsrad notice_months från appens skapande').toBe(offeredNotice)
  expect(Number(c.monthly_fee_sek)).toBe(offeredFee)

  // Hash: signaturens pricing_snapshot_sha256 = snapshotens hash = avtalets snapshot_hash (hård); omräkning är informativ.
  expect(snap.snapshot_hash).toMatch(sha256)
  expect(c.snapshot_hash).toBe(snap.snapshot_hash)
  expect(c.signature_snapshot.pricing_snapshot_sha256).toBe(snap.snapshot_hash)
  expect(c.signature_snapshot_sha256).toMatch(sha256)

  // Signeringsbevis skapat av finalize
  const ev = q<{ evidence_type: string; evidence_sha256: string }>(`select evidence_type,evidence_sha256 from public.customer_contract_evidence where customer_contract_id='${f.contractId}' and company_id='${f.companyId}'`)
  expect(ev.find((e) => e.evidence_type === 'online_acceptance')?.evidence_sha256, 'online_acceptance-evidens = signaturhash').toBe(c.signature_snapshot_sha256)
  const acc = q<{ contract_publication_version_id: string | null; acceptance_sha256: string; signing_method: string | null }>(`select contract_publication_version_id,acceptance_sha256,signing_method from public.customer_contract_acceptances where customer_contract_id='${f.contractId}' and company_id='${f.companyId}'`)
  expect(acc).toHaveLength(1)
  expect(acc[0].contract_publication_version_id).toBe(f.publicationVersionId)
  expect(acc[0].acceptance_sha256).toMatch(sha256)
  const req = q<{ used_at: string | null }>(`select used_at from public.customer_contract_signature_requests where customer_contract_id='${f.contractId}' and company_id='${f.companyId}' and customer_id='${f.customerId}'`)
  expect(req.length).toBeGreaterThanOrEqual(1)
  expect(req.some((r) => r.used_at)).toBe(true)
  const legal = q<{ legal_document_sha256: string | null }>(`select legal_document_sha256 from public.customer_legal_acceptances where contract_id='${f.contractId}' and company_id='${f.companyId}' and customer_id='${f.customerId}'`)
  expect(legal.length, 'juridiska accepter per bundle-dokument').toBeGreaterThanOrEqual(1)
  for (const l of legal) expect(l.legal_document_sha256).toMatch(sha256)
  expect(c.signed_at, 'signed_at (real tid)').toBeTruthy()
  expect(c.metadata.sim_declared_signed_at).toBe(f.declaredSignedAt)
  console.info(`[BIND] skapandeväg=${f.creation.contractPath} source_type=${f.creation.sourceType} customerAction=${f.creation.customerAction.httpStatus} contractAction=${f.creation.contractAction.httpStatus} auto_renew_enabled=${c.auto_renew_enabled} auto_renew_term_months=${c.auto_renew_term_months} ends_at=${c.ends_at}; contract ${f.contractId.slice(0, 8)} signed_at(real)=${c.signed_at} sim_declared_signed_at=${c.metadata.sim_declared_signed_at} document_sha256=${c.document_sha256 ?? 'null (sätts först vid PDF-arkivering)'} snapshot_hash_recomputed_match=${snap.recomputed_hash === snap.snapshot_hash}`)
}

/**
 * Binding > 0. STRIKT: konventionen måste vara exklusiv (start + N kalendermånader, klampat) och tzShift 0.
 * Ett inklusivt datum (sista bundna dag) är fail med eget meddelande; ägaren avgör konventionen separat.
 * Sparat ends_at: RPC-vägen sparar formulärets ends_at (tomt => null); ett sparat datum måste vara exklusivt.
 */
async function assertBindingEnd(scenario: string, f: SignedContractFixture, bindingMonths: number, startsAt: string, expectedExclusive: string) {
  const db = readDb(f.contractId)
  expect(db).toMatchObject({ status: 'signed', binding_months: bindingMonths, notice_months: 1, starts_at: startsAt })
  expect(db.signed_at, 'signed_at ska vara satt').toBeTruthy()
  const lastBoundDay = oracleDayBefore(expectedExclusive)
  // RPC-vägen (gridex_create_internal_customer_contract_v1) sätter ends_at = nullif(p_contract->>'ends_at','')::date, dvs formulärets
  // värde (tomt => null); ingen DB-härledning sker (guard-triggern är inte kopplad, add_months-funktionen saknas). Null är därför tillåtet
  // och slutet härleds vid visning; ett sparat datum måste vara exakt exklusivt start+N.
  if (db.ends_at !== null) expect(db.ends_at, `sparat ends_at ${db.ends_at} är inte exklusivt start+${bindingMonths} (${expectedExclusive})`).toBe(expectedExclusive)
  else console.info(`[${scenario}] ends_at sparas som null av RPC-vägen; härleds vid visning`)
  const shown = await readShown(session, f.customerId)
  const tzShift = dayDiff(shown.detailStart!, startsAt)
  expect(tzShift, `tzShift: visad start ${shown.detailStart} vs DB-start ${startsAt} (appens tidszon förskjuter visningen; ingen tyst korrigering)`).toBe(0)
  const slut = shown.summarySlut
  const current = shown.aktuelltSlutdatum
  expect(slut, 'Slut (sammanfattning) och Aktuellt slutdatum ska visa samma dag').toBe(current)
  expect(shown.currentTermEnd, 'Nuvarande avtalsperiod slut ska stämma med Aktuellt slutdatum').toBe(current)
  const convention = current === expectedExclusive ? 'exclusive' : current === lastBoundDay ? 'inclusive' : 'other'
  const now = new Date().toISOString()
  observations.push({ scenario, startsAt, bindingMonths, expectedExclusive, lastBoundDay, shownSlut: shown.summarySlut, shownAktuellt: shown.aktuelltSlutdatum, tzShift, convention, dbEndsAt: db.ends_at, path: f.creation.contractPath })
  console.info(`[${scenario}] app visar ${current} (${convention}); exklusivt orakel ${expectedExclusive}, sista bundna dag ${lastBoundDay}, tzShift ${tzShift}, DB ends_at ${db.ends_at}, skapandeväg ${f.creation.contractPath}`)
  console.info(`[${scenario}] tre tider: deklarerat signeringsdatum=${f.declaredSignedAt}; verkligt signed_at=${db.signed_at}; nu=${now}. App-lifecycle: slutdatum härleds ur starts_at+binding_months (ej signed_at); bindning aktiv nu använder referenceDate = nu (Stockholm-dag).`)
  expect(convention, convention === 'inclusive'
    ? `appen visar SISTA BUNDNA DAG ${current}, inte exklusivt slut ${expectedExclusive}: konventionen inklusiv avviker från kravet (exklusiv); ägarbeslut krävs`
    : `appen visar ${current}: varken ${expectedExclusive} (exklusivt) eller ${lastBoundDay} (sista bundna dag)`).toBe('exclusive')
  expect(shown.bindingMonthsText).toBe(String(bindingMonths))
  const today = stockholmToday()
  expect(shown.bindingActive, `bindning aktiv nu mot exklusivt slut ${expectedExclusive} och idag ${today}`).toBe(today < expectedExclusive ? 'Ja' : 'Nej')
  return { convention, shown }
}

describe('TERM01 bindningstid och slutdatum', () => {
  beforeAll(async () => {
    tenant = await createTermTenant()
    session = await loginSession(tenant.admin.email, tenant.admin.password, { companyId: tenant.companyId })
  }, 120_000)
  afterAll(async () => {
    console.info(`TERM01 observationer: ${JSON.stringify(observations)}`)
    if (tenant) await removeAdminFixtureUser(tenant.admin)
  })

  it('TERM01.PRE createCustomerAction: utfall för en färsk unik inskickning (fynd claude-track2/004; räknas inte in i TERM-utfall)', async () => {
    const r = await probeCreateCustomerAction(tenant)
    const verdict = r.customersCreated === 1 ? 'ACCEPTERAT (kund skapad)' : r.error ? `NEKAT: ${r.error}` : 'OKLART'
    console.info(`[TERM01.PRE] request-id=${r.requestId} HTTP ${r.httpStatus} => ${verdict}; kunder skapade=${r.customersCreated}; intake=${JSON.stringify(r.intake)}`)
    expect(r.httpStatus).toBeLessThan(500)
  })

  it('TERM01.PRE createContract TS-path: erbjudande utan price_options skapar avtalet (fynd 005; räknas inte in i TERM-utfall)', async () => {
    const r = await probeCreateContractTsPath(tenant)
    console.info(`[TERM01.PRE createContract TS-path] request-id=${r.requestId} HTTP ${r.httpStatus} kastade=${r.threw} avtal skapade=${r.contractsCreated} ${r.errorRows.join(' | ').slice(0, 200)} (PGRST204 i appens logg = fynd 005)`)
    // Fynd 005: TS-vägen ska skapa avtalet utan schemafel (PGRST204 på current_supplier_*-kolumner före rättningen).
    expect(r.threw, `createContractFromOfferAction kastade: ${r.errorRows.join(' | ').slice(0, 200)}`).toBe(false)
    expect(r.httpStatus).toBe(200)
    expect(r.errorRows).toEqual([])
    expect(r.contractsCreated, 'exakt ett nytt kundavtal i DB').toBe(1)
  })

  it('TERM01.01 tillsvidare utan bindningsslut (binding_months 0; null i erbjudandet normaliseras till 0 av fixturen), notice från erbjudandet, ingen förnyelse', async () => {
    // Ett nekande av en giltig bindning är ett fel: skapandet får inte fångas. null kan inte skickas hela vägen: price option
    // (priceOptionSchema/contract_price_options.binding_months) kräver heltal, och ensureOffer sätter binding ?? 0.
    for (const bindingMonths of [0, null] as const) {
      const f = await createSignedContract(tenant, withDefaults({ bindingMonths, noticeMonths: 2, startsAt: '2026-11-01' }))
      assertBindingChain(f)
      const db = readDb(f.contractId)
      expect(db.binding_months, 'binding_months från appens skapande (null i erbjudandet blev 0 i fixturen)').toBe(0)
      expect(db).toMatchObject({ status: 'signed', notice_months: 2, starts_at: '2026-11-01', ends_at: null, auto_renew_enabled: false })
      expect(db.signed_at).toBeTruthy()
      const shown = await readShown(session, f.customerId)
      console.info(`[TERM01.01] app visar (binding_months=${bindingMonths}, DB ${db.binding_months}, notice ${db.notice_months}, auto_renew ${db.auto_renew_enabled}, ends_at ${db.ends_at}): Slut=${shown.summarySlut ?? '— (ingen slutdatumtext)'}; Aktuellt slutdatum=${shown.aktuelltSlutdatum ?? '—'}; Explicit slut=${shown.explicitSlut ?? '—'}; Nästa förlängning=${shown.nextRenewal ?? '—'}; Bindningstid=${shown.bindingMonthsText} mån; Bindning aktiv nu=${shown.bindingActive}; Auto renew=${shown.autoRenewText}; (appen har ingen text "Tillsvidare")`)
      expect(shown.summarySlut, `Slut visas för binding ${bindingMonths}`).toBeNull()
      expect(shown.aktuelltSlutdatum, `Aktuellt slutdatum för binding ${bindingMonths}`).toBeNull()
      expect(shown.explicitSlut).toBeNull()
      expect(shown.currentTermEnd).toBeNull()
      expect(shown.nextRenewal, 'ingen förnyelse').toBeNull()
      expect(shown.autoRenewText).toBe('Nej')
      expect(shown.bindingActive).toBe('Nej')
    }
  })

  it('TERM01.02 12 månader från 2026-11-01 upphör vid 2027-11-01 (exklusivt); datumen beror inte på deklarerat signeringsdatum', async () => {
    expect(oracleAddMonths('2026-11-01', 12)).toBe('2027-11-01')
    expect(oracleDayBefore('2027-11-01')).toBe('2027-10-31')
    const f = await signed({ bindingMonths: 12, startsAt: '2026-11-01', signedAt: '2026-10-15' })
    const first = await assertBindingEnd('TERM01.02', f, 12, '2026-11-01', '2027-11-01')
    // Samma start men annat deklarerat signeringsdatum => oförändrade datum i appen.
    const g = await signed({ bindingMonths: 12, startsAt: '2026-11-01', signedAt: '2026-09-01' })
    const second = await assertBindingEnd('TERM01.02', g, 12, '2026-11-01', '2027-11-01')
    expect({ end: second.shown.aktuelltSlutdatum, start: second.shown.detailStart }).toEqual({ end: first.shown.aktuelltSlutdatum, start: first.shown.detailStart })
    console.info(`[TERM01.02] deklarerat ${f.declaredSignedAt} resp. ${g.declaredSignedAt}; verkligt signed_at ${f.actualSignedAt} resp. ${g.actualSignedAt}; visade slutdatum lika (${first.shown.aktuelltSlutdatum})`)
  })

  it('TERM01.03 24 månader från 2026-11-15 upphör vid 2028-11-15 (exklusivt)', async () => {
    const f = await signed({ bindingMonths: 24, startsAt: '2026-11-15' })
    expect(oracleAddMonths('2026-11-15', 24)).toBe('2028-11-15')
    await assertBindingEnd('TERM01.03', f, 24, '2026-11-15', '2028-11-15')
  })

  const clampCases: { name: string; start: string; months: number; expected: string }[] = [
    { name: 'TERM01.04 skottdag 2028-02-29 + 12 -> 2029-02-28', start: '2028-02-29', months: 12, expected: '2029-02-28' },
    { name: 'TERM01.04 skottdag 2028-02-29 + 24 -> 2030-02-28', start: '2028-02-29', months: 24, expected: '2030-02-28' },
    { name: 'TERM01.04 månadsslut 2027-01-31 + 12 -> 2028-01-31', start: '2027-01-31', months: 12, expected: '2028-01-31' },
  ]
  for (const c of clampCases) {
    it(c.name, async () => {
      expect(oracleAddMonths(c.start, c.months)).toBe(c.expected)
      const f = await signed({ bindingMonths: c.months, startsAt: c.start })
      await assertBindingEnd('TERM01.04', f, c.months, c.start, c.expected)
    })
  }

  const oneMonthCases = [
    { start: '2027-01-31', expected: '2027-02-28' },
    { start: '2028-01-31', expected: '2028-02-29' },
  ]
  for (const c of oneMonthCases) {
    it(`TERM01.04 binding_months=1: ${c.start} + 1 -> ${c.expected} (ett nekande av giltig bindning är ett fel)`, async () => {
      expect(oracleAddMonths(c.start, 1)).toBe(c.expected)
      const f = await createSignedContract(tenant, withDefaults({ bindingMonths: 1, startsAt: c.start }))
      assertBindingChain(f)
      await assertBindingEnd('TERM01.04', f, 1, c.start, c.expected)
    })
  }

  describe('TERM01.05 signerat avtal är oföränderligt', () => {
    let f: SignedContractFixture
    const fixture = async () => (f ??= await signed({ bindingMonths: 12, startsAt: '2026-11-01', monthlyFeeSek: 59 }))

    it('TERM01.05 UPDATE av monthly_fee_sek / binding_months / ends_at / contract_price_snapshot_id nekas med 55000', async () => {
      const c = await fixture()
      // Avtalspris/månadsavgift: raden (59) och snapshotens värde ska stämma före försöken.
      expect(Number(c.sources.contractRow.monthly_fee_sek)).toBe(59)
      expect(c.sources.snapshotMonthlyFeeSek, 'snapshot_json.monthly_fee_sek').toBe(59)
      const before = rowHash('customer_contracts', c.contractId)
      const updates: Record<string, string> = {
        monthly_fee_sek: 'monthly_fee_sek = coalesce(monthly_fee_sek,0) + 1',
        binding_months: 'binding_months = coalesce(binding_months,0) + 1',
        ends_at: `ends_at = date '2099-12-31'`,
        contract_price_snapshot_id: 'contract_price_snapshot_id = NULL',
      }
      for (const [column, set] of Object.entries(updates)) {
        const err = psqlExpectError(`UPDATE public.customer_contracts SET ${set} WHERE id='${c.contractId}';`)
        expect(err, `UPDATE ${column} på signerat avtal lyckades (borde nekas)`).not.toBeNull()
        expect(err!.sqlstate, err!.raw).toBe('55000')
        expect(err!.message).toBe(`signed_customer_contract_immutable:${column}`)
      }
      expect(rowHash('customer_contracts', c.contractId), 'avtalsraden ska vara oförändrad').toBe(before)
    })

    it('TERM01.05 förbjudna ändringar: customer_id, site_id, metering_point_id, starts_at, signed_at, DELETE nekas', async () => {
      const c = await fixture()
      const other = await signed({ bindingMonths: 12, startsAt: '2026-11-01' }) // annan kund/anläggning/mätpunkt i samma tenant
      const before = rowHash('customer_contracts', c.contractId)
      const updates: Record<string, string> = {
        customer_id: `customer_id = '${other.customerId}'`,
        site_id: `site_id = '${other.siteId}'`,
        metering_point_id: `metering_point_id = '${other.meteringPointId}'`,
        starts_at: `starts_at = starts_at + 1`,
        signed_at: `signed_at = signed_at + interval '1 day'`,
      }
      for (const [column, set] of Object.entries(updates)) {
        const err = psqlExpectError(`UPDATE public.customer_contracts SET ${set} WHERE id='${c.contractId}';`)
        expect(err, `UPDATE ${column} på signerat avtal lyckades (borde nekas)`).not.toBeNull()
        expect(err!.sqlstate, `${column}: ${err!.raw}`).toBe('55000')
        expect(err!.message, `${column}`).toBe(`signed_customer_contract_immutable:${column}`)
      }
      const del = psqlExpectError(`DELETE FROM public.customer_contracts WHERE id='${c.contractId}';`)
      expect(del, 'DELETE av signerat avtal lyckades').not.toBeNull()
      expect(del!.sqlstate, del!.raw).toBe('55000')
      expect(del!.message).toMatch(/signed_customer_contract_delete_forbidden/)
      expect(rowHash('customer_contracts', c.contractId)).toBe(before)
    })

    it('TERM01.05 normalt redigeringsformulär: oförändrad kontroll sparas, låsta villkor nekas med feedback och native state bevaras', async () => {
      const c = await fixture()
      const [row] = psqlRows<ContractRow>(`select * from public.customer_contracts where id='${c.contractId}'`)
      const nativeState = () => ({
        contract: rowHash('customer_contracts', c.contractId),
        snapshot: rowHash('contract_price_snapshots', c.priceSnapshotId),
        events: psql(`select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb)::text)
          from public.customer_contract_events e where e.company_id='${c.companyId}' and e.customer_contract_id='${c.contractId}'`),
      })
      const before = nativeState()
      const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
      const attempts: Record<string, Record<string, string>> = {
        'kontroll: oförändrade värden': {},
        monthly_fee_sek: { monthly_fee_sek: String(Number(row.monthly_fee_sek) + 1) },
        binding_months: { binding_months: String(Number(row.binding_months) + 1) },
        ends_at: { ends_at: '2099-12-31' },
        starts_at: { starts_at: '2026-11-02' },
      }
      const outcomes: Record<string, { http: number; feedback: string; field?: string }> = {}
      for (const [column, change] of Object.entries(attempts)) {
        const form = new FormData()
        const values: Record<string, string> = {
          customer_id: c.customerId, customer_contract_id: c.contractId, status: row.status, site_id: str(row.site_id), metering_point_id: str(row.metering_point_id),
          contract_name: str(row.contract_name), contract_type: str(row.contract_type), starts_at: str(row.starts_at), ends_at: str(row.ends_at), signed_at: str(row.signed_at),
          binding_months: str(row.binding_months), notice_months: str(row.notice_months), monthly_fee_sek: str(row.monthly_fee_sek), invoice_fee_sek: str(row.invoice_fee_sek),
          fixed_price_ore_per_kwh: str(row.fixed_price_ore_per_kwh), spot_markup_ore_per_kwh: str(row.spot_markup_ore_per_kwh), variable_fee_ore_per_kwh: str(row.variable_fee_ore_per_kwh),
          terms_version: str(row.terms_version), price_version: str(row.price_version), campaign_name: str(row.campaign_name), campaign_code: str(row.campaign_code), campaign_version: str(row.campaign_version),
          green_fee_mode: str(row.green_fee_mode) || 'none', override_reason: 'sim: oföränderlighetsprov', ...change,
        }
        for (const [k, v] of Object.entries(values)) form.append(k, v)
        const r = await callServerAction(await tenantSessionFor(), {
          // EditContractForm imports this feedback action on the customer page.
          // Its manifest binding is checked by findActionId; no route is guessed
          // from the action module's signature/ pathname.
          route: `/admin/customers/${c.customerId}`, filename: 'app/admin/customers/[id]/contracts/[contractId]/signature/actions.ts', exportedName: 'saveContractWithFeedbackAction',
          args: [form], worker: 'app/admin/customers/[id]/page',
        })
        const feedback = assertContractEditFeedback(r, column === 'kontroll: oförändrade värden'
          ? { status: 'saved' }
          : column === 'monthly_fee_sek'
            ? { status: 'invalid', field: 'monthly_fee_sek', message: 'Priset hör till en låst avtalsversion som används vid signering och fakturering. Skapa en ny avtalsversion för att ändra priser eller avgifter; den här ändringen har inte sparats.' }
            : { status: 'invalid', message: 'Signerat avtal kan inte ändras – använd avtalsåtgärder.' })
        expect(nativeState(), `redigeringsformuläret ${column} ändrade avtal, snapshot eller avtalshändelser`).toEqual(before)
        outcomes[column] = { http: r.httpStatus, feedback: feedback.status, ...('field' in feedback ? { field: feedback.field } : {}) }
      }
      // Original FYND 007/HTTP500 receipts remain in the donor packet. A later
      // native rerun of this regression must pass before changing its status.
      console.info(`[TERM01.05 edit feedback] ${JSON.stringify(outcomes)}`)
    })

    it('TERM01.05 contract_price_snapshots UPDATE/DELETE nekas och snapshotraden är oförändrad', async () => {
      const c = await fixture()
      const before = rowHash('contract_price_snapshots', c.priceSnapshotId)
      const upd = psqlExpectError(`UPDATE public.contract_price_snapshots SET public_price_text='tamper' WHERE id='${c.priceSnapshotId}';`)
      expect(upd, 'UPDATE på snapshot lyckades').not.toBeNull()
      expect(upd!.message, upd!.raw).toMatch(/immutable/i)
      const del = psqlExpectError(`DELETE FROM public.contract_price_snapshots WHERE id='${c.priceSnapshotId}';`)
      expect(del, 'DELETE på snapshot lyckades').not.toBeNull()
      expect(del!.message, del!.raw).toMatch(/immutable/i)
      console.info(`[TERM01.05] snapshot UPDATE -> ${upd!.sqlstate}, DELETE -> ${del!.sqlstate}`)
      expect(rowHash('contract_price_snapshots', c.priceSnapshotId)).toBe(before)
      expect(psql(`select count(*) from public.contract_price_snapshots where id='${c.priceSnapshotId}'`)).toBe('1')
    })

    it('TERM01.05 ändringsflöde måste verifiera ny version och bevarad historik', () => {
      // Object names cannot prove an executed customer-contract amendment.
      // Keep the preceding immutability assertions, but require the normal
      // amendment, effective date, new version and preserved predecessor before
      // this scenario can pass. No such qualified step is implemented here yet.
      throw new Error('TERM01.05 HOLD: ordinarie ändringsflöde med ny avtalsversion och bevarad föregångare är inte verifierat')
    })
  })

  it('TERM01.TEN tenant 2:s admin kan inte öppna tenant 1:s kund', async () => {
    // Kodbeteende: layout.tsx:19 + lib/tenant/entityGuards.ts:42-44 (guard.companyId !== kundens company => throw), och
    // page.part-4.tsx:107-141 visar CustomerLookupProblem ("Kunden finns inte"/"tillhör ett annat bolag") som är en
    // 200-vy med enbart den efterfrågade id:t ("Referens: {id}", page.part-1.tsx:581) och params i RSC-payloaden.
    // Status 200 är därför i sig inget läckage; innehållet avgör. Det efterfrågade kund-id:t är request-eko och
    // används inte som markör (det finns bara i markörer där det är en del av längre sträng, t.ex. e-postadressen).
    const f = await signed({ bindingMonths: 12, startsAt: '2026-11-01' })
    const [cust] = psqlRows<{ name: string; personal_number: string | null; email: string | null }>(`select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),name) as name,personal_number,email from public.customers where id='${f.customerId}'`)
    const [co] = psqlRows<{ org_number: string | null }>(`select org_number from public.companies where id='${f.companyId}'`)
    const pn = cust.personal_number
    const markers: Record<string, string> = {
      kundnamn: cust.name,
      ...(pn ? { personnummer: pn, personnummer_bindestreck: `${pn.slice(0, 8)}-${pn.slice(8)}` } : {}),
      ...(cust.email ? { kund_epost: cust.email } : {}),
      ...(co.org_number ? { orgnummer: co.org_number } : {}),
      avtals_id: f.contractId, anlaggnings_id: f.siteId, matpunkts_id: f.meteringPointId, gsrn: f.gsrn,
    }
    for (const [k, v] of Object.entries(markers)) expect(v, `marköransats ${k}`).toBeTruthy()
    const tabs = ['contracts', 'overview', 'sites', 'metering-points']
    const readTabs = async (s: AppSession) => {
      const out: { tab: string; status: number; location: string | null; text: string }[] = []
      for (const tab of tabs) {
        const res = await s.fetch(`/admin/customers/${f.customerId}?tab=${tab}`)
        out.push({ tab, status: res.status, location: res.headers.get('location'), text: await tenantPrivacyText(await res.text()) })
      }
      return out
    }
    const present = (pages: { text: string }[]) => Object.entries(markers).filter(([, v]) => pages.some((p) => p.text.includes(v))).map(([k]) => k)

    // Positiv kontroll: tenant 1:s egen admin ser markörerna (annars har den negativa kontrollen ingen styrka).
    const own = await readTabs(session)
    const ownPresent = present(own)
    console.info(`[TERM01.TEN] positiv kontroll (tenant 1-admin): status ${own.map((o) => `${o.tab}=${o.status}`).join(',')}; markörer som syns: ${ownPresent.join(', ') || '(inga)'}; syns ej: ${Object.keys(markers).filter((k) => !ownPresent.includes(k)).join(', ') || '-'}`)
    // Kundnamnet renderas från first_name+last_name (formatCustomerName, page.part-1.tsx:124), inte kolumnen `name`;
    // fixturen ger därför kunden ett unikt efternamn. Personnummer/orgnummer syns ev. inte på dessa flikar.
    expect(own.every((o) => o.status === 200), 'tenant 1-admin får 200 på sina egna flikar').toBe(true)
    expect(ownPresent, 'positiv kontroll: kund_epost och gsrn syns i tenant 1-adminens egen vy').toEqual(expect.arrayContaining(['kund_epost', 'gsrn']))

    const tenant2 = await createTermTenant()
    try {
      const variants: [string, AppSession][] = [
        ['egen company-cookie', await loginSession(tenant2.admin.email, tenant2.admin.password, { companyId: tenant2.companyId })],
        ['tenant 1:s company-cookie', await loginSession(tenant2.admin.email, tenant2.admin.password, { companyId: tenant.companyId, intent: 'expected_denial' })],
      ]
      const leaks: string[] = []
      const unexpected: string[] = []
      for (const [label, s2] of variants) {
        for (const tab of tabs) {
          let status = -1; let location: string | null = null; let text = ''
          try {
            const res = await s2.fetch(`/admin/customers/${f.customerId}?tab=${tab}`)
            status = res.status; location = res.headers.get('location'); text = await tenantPrivacyText(await res.text())
          } catch (error) { unexpected.push(`${label}/${tab}: fetch-fel ${(error as Error).message.slice(0, 120)}`) }
          const found = Object.entries(markers).filter(([, v]) => text.includes(v)).map(([k]) => k)
          const klass = found.length > 0 ? 'LÄCKAGE' : [302, 303, 307, 308, 403, 404].includes(status) ? 'korrekt nekande' : status === 200 ? 'mjukt nekande (200 utan data)' : `oväntad status ${status}`
          console.info(`[TERM01.TEN] ${label} tab=${tab}: status ${status} Location=${location ?? '-'} => ${klass}; synliga markörtyper: ${found.join(', ') || '-'}`)
          if (found.length > 0) leaks.push(`${label}/${tab}: ${found.join(',')}`)
          if (![200, 302, 303, 307, 308, 403, 404].includes(status)) unexpected.push(`${label}/${tab}: status ${status}`)
        }
      }
      expect(leaks, 'tenant 1-data i tenant 2-adminens svar').toEqual([])
      expect(unexpected, 'oväntade svar').toEqual([])
    } finally {
      await removeAdminFixtureUser(tenant2.admin)
    }
  })

  it('TERM01.OBS trg_gridex_customer_contracts_auto_renew_guard och gridex_add_months_timestamptz (observation, ej orakel)', () => {
    const trigger = psqlRows(`select tgname, tgrelid::regclass::text as tbl from pg_trigger where tgname='trg_gridex_customer_contracts_auto_renew_guard' and not tgisinternal`)
    const addMonths = psqlRows(`select oid::regprocedure::text as sig from pg_proc where proname='gridex_add_months_timestamptz'`)
    const guardFn = psqlRows(`select oid::regprocedure::text as sig from pg_proc where proname='gridex_customer_contracts_auto_renew_guard'`)
    const guardUsers = psqlRows(`select tgname, tgrelid::regclass::text as tbl from pg_trigger where tgfoid in (select oid from pg_proc where proname='gridex_customer_contracts_auto_renew_guard') and not tgisinternal`)
    console.info(`[TERM01.OBS] ${JSON.stringify({ trigger_trg_gridex_customer_contracts_auto_renew_guard: trigger, function_gridex_add_months_timestamptz: addMonths, function_auto_renew_guard: guardFn, triggers_using_guard_function: guardUsers })}`)
    expect(true).toBe(true)
  })
})

// COMPONENT only: the oracle rejects uncertain/failed transport and a false save.
// These tests run without Auth/DB and do not prove native immutability or TERM01.05.
describe('TERM01.COMPONENT contract edit feedback oracle', () => {
  const result = (value: unknown, overrides: Partial<ServerActionResult> = {}): ServerActionResult => ({
    httpStatus: 200, redirect: null, value, threw: false, errorRows: [], excerpt: '', ...overrides,
  })
  const sealedMessage = 'Signerat avtal kan inte ändras – använd avtalsåtgärder.'

  it('accepts an ordinary unchanged save and an explicit sealed-contract refusal', () => {
    expect(assertContractEditFeedback(result({ status: 'saved' }), { status: 'saved' })).toEqual({ status: 'saved' })
    expect(assertContractEditFeedback(result({ status: 'invalid', message: sealedMessage }), {
      status: 'invalid', message: sealedMessage,
    })).toEqual({ status: 'invalid', message: sealedMessage })
    expect(assertContractEditFeedback(result({ status: 'invalid', field: 'monthly_fee_sek', message: 'Locked price version' }), {
      status: 'invalid', field: 'monthly_fee_sek', message: 'Locked price version',
    })).toMatchObject({ status: 'invalid', field: 'monthly_fee_sek' })
  })

  it.each([
    ['wrong actor', result({ status: 'saved' }, { httpStatus: 403 }), 'contract_edit_feedback_http'],
    ['unauthenticated actor', result({ status: 'saved' }, { httpStatus: 401 }), 'contract_edit_feedback_http'],
    ['invalid contract', result({ status: 'saved' }, { httpStatus: 404 }), 'contract_edit_feedback_http'],
    ['server error', result({ status: 'saved' }, { httpStatus: 500 }), 'contract_edit_feedback_http'],
    ['thrown action', result({ status: 'saved' }, { threw: true }), 'contract_edit_feedback_action_failed'],
    ['Flight error row', result({ status: 'saved' }, { errorRows: ['1:E{"digest":"synthetic"}'] }), 'contract_edit_feedback_action_failed'],
    ['unexpected redirect', result({ status: 'saved' }, { redirect: '/login' }), 'contract_edit_feedback_redirect'],
    ['unknown outcome', result({ status: 'unconfirmed', message: 'Inspect saved state before retry' }), 'contract_edit_feedback_status'],
    ['missing return', result(null), 'contract_edit_feedback_shape'],
    ['invalid shape', result([{ status: 'saved' }]), 'contract_edit_feedback_shape'],
  ] as const)('refuses %s as evidence of a successful save', (_label, actual, error) => {
    expect(() => assertContractEditFeedback(actual, { status: 'saved' })).toThrowError(error)
  })

  it('fails if a changed sealed field was saved or the refusal is unrelated', () => {
    const expected = { status: 'invalid' as const, field: 'monthly_fee_sek', message: 'Locked price version' }
    for (const [value, error] of [
      [{ status: 'saved' }, 'contract_edit_feedback_status'],
      [{ status: 'invalid', field: 'override_reason', message: 'Locked price version' }, 'contract_edit_feedback_field'],
      [{ status: 'invalid', field: 'monthly_fee_sek', message: 'Unrelated validation' }, 'contract_edit_feedback_message'],
      [{ status: 'invalid', field: 'monthly_fee_sek', message: '' }, 'contract_edit_feedback_message'],
    ] as const) expect(() => assertContractEditFeedback(result(value), expected)).toThrowError(error)
  })
})
