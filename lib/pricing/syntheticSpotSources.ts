import { createHash } from 'node:crypto'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { supabaseService } from '@/lib/supabase/service'

export const SYNTHETIC_SPOT_MAX_BYTES = 1_048_576
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const hashPattern = /^[a-f0-9]{64}$/
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const utcPattern = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:00\.000Z$/
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
type ObjectValue = Record<string, unknown>
export type SyntheticSpotScope = { companyId: string; actorUserId: string }
type Resolution = 'PT60M' | 'PT15M'
type PriceArea = 'SE1' | 'SE2' | 'SE3' | 'SE4'
type Status = 'captured' | 'held' | 'rejected' | 'reviewed_capture_only'
type Decision = 'hold' | 'reject' | 'review_capture'
export type SyntheticSpotManifest = {
  sourceVersion: string; billingMonth: string; priceArea: PriceArea; resolution: Resolution
  periodStart: string; periodEnd: string; intervalCount: number; coveredMinutes: number
  originalByteLength: number; originalSha256: string
}
export type SyntheticSpotReceipt = {
  source_id: string; original_sha256: string; source_version: string; billing_month: string; price_area: PriceArea; resolution: Resolution
  period_start: string; period_end: string; interval_count: number; expected_interval_count: number; covered_minutes: number
  original_byte_length: number; capture_event_id: string; latest_event_id: string; latest_event_sha256: string
  status: Status; consumer_enabled: false; replayed: boolean
}
export type SyntheticSpotReviewCommand = { commandKey: string; expectedPreviousEventId: string; decision: Decision; reason: string }
type ReviewReceipt = SyntheticSpotReceipt & { event_id: string; decision: Decision }

export class SyntheticSpotSourceError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
const invalid = (): never => { throw new SyntheticSpotSourceError(400, 'synthetic_spot_source_invalid') }
const unqualified = (): never => { throw new SyntheticSpotSourceError(502, 'synthetic_spot_receipt_unqualified') }
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value)
function exactObject(value: unknown, keys: readonly string[], fail = invalid): ObjectValue {
  if (!object(value) || Object.keys(value).sort().join('\n') !== [...keys].sort().join('\n')) return fail()
  return value
}
export function syntheticSpotUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) return invalid()
  return value.toLowerCase()
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Read actual streamed bytes; a claimed Content-Length never grants space. */
export async function readSyntheticSpotBody(request: Request): Promise<Buffer> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = request.body?.getReader()
    if (!reader) return invalid()
    const parts: Buffer[] = []; let size = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      const part = Buffer.from(chunk.value)
      size += part.length
      if (size > SYNTHETIC_SPOT_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new SyntheticSpotSourceError(413, 'synthetic_spot_source_too_large')
      }
      parts.push(part)
    }
    if (!size) return invalid()
    return Buffer.concat(parts, size)
  } catch (error) {
    if (error instanceof SyntheticSpotSourceError) throw error
    return invalid()
  } finally { reader?.releaseLock() }
}

/** JSON.parse validates grammar; this bounded scanner additionally rejects
 * duplicate decoded object keys, including escaped names, at every depth. */
function uniqueJsonKeys(text: string): void {
  let at = 0
  const space = () => { while (/[ \t\r\n]/.test(text[at] ?? '') && at < text.length) at++ }
  const string = () => {
    const start = at++
    while (at < text.length) {
      const character = text[at++]
      if (character === '\\') at++
      else if (character === '"') return JSON.parse(text.slice(start, at)) as string
    }
    return invalid()
  }
  const value = (depth: number): void => {
    if (depth > 16) return invalid()
    space()
    if (text[at] === '{') {
      at++; space(); const keys = new Set<string>()
      if (text[at] === '}') { at++; return }
      for (;;) {
        const key = string()
        if (keys.has(key)) return invalid()
        keys.add(key); space(); at++; value(depth + 1); space()
        if (text[at++] === '}') return
        space()
      }
    }
    if (text[at] === '[') {
      at++; space()
      if (text[at] === ']') { at++; return }
      for (;;) { value(depth + 1); space(); if (text[at++] === ']') return }
    }
    if (text[at] === '"') { string(); return }
    while (at < text.length && !/[\s,}\]]/.test(text[at])) at++
  }
  value(0)
}
function jsonBytes(bytes: Uint8Array, canonical: boolean): unknown {
  if (!bytes.length || bytes.length > SYNTHETIC_SPOT_MAX_BYTES) return invalid()
  try {
    // Preserve a BOM in decoded text so JSON rejects it instead of silently
    // removing bytes from the required public canonical representation.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const parsed: unknown = JSON.parse(text)
    uniqueJsonKeys(text)
    if (canonical && JSON.stringify(parsed) !== text) return invalid()
    return parsed
  } catch { return invalid() }
}

const stockholm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
function monthStart(year: number, month: number): number {
  const target = Date.UTC(year, month - 1, 1); let instant = target
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = stockholm.formatToParts(new Date(instant))
    const part = (name: string) => Number(parts.find(value => value.type === name)?.value)
    const rendered = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
    instant = target - (rendered - instant)
  }
  return instant
}
function bounds(month: unknown): { start: number; end: number } {
  if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) return invalid()
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5))
  if (year < 1900 || year > 2100) return invalid()
  return { start: monthStart(year, number), end: number === 12 ? monthStart(year + 1, 1) : monthStart(year, number + 1) }
}
function utc(value: unknown): number {
  if (typeof value !== 'string' || !utcPattern.test(value)) return invalid()
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) return invalid()
  return time
}
function decimal(value: unknown): void {
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/.test(value)) return invalid()
  const negative = value.startsWith('-'), [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  const magnitude = BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, '0'))
  if (magnitude > BigInt(100_000_000_000) || negative && magnitude === BigInt(0)) return invalid()
}

/** canonical=false is only for reading exact SQL-validated archived originals;
 * direct SQL capture permits semantic whitespace while public POST does not. */
export function parseSyntheticSpotOriginal(bytes: Uint8Array, canonical = true): SyntheticSpotManifest {
  const input = exactObject(jsonBytes(bytes, canonical), ['schema', 'declaration', 'sourceVersion', 'billingMonth', 'civilZone', 'priceArea', 'resolution', 'currency', 'intervals'])
  if (input.schema !== 'gridex-synthetic-spot-source-v1' || input.declaration !== 'SYNTHETIC_TEST_DATA_NOT_MARKET_ORIGINAL'
    || typeof input.sourceVersion !== 'string' || !versionPattern.test(input.sourceVersion) || input.civilZone !== 'Europe/Stockholm'
    || typeof input.priceArea !== 'string' || !['SE1', 'SE2', 'SE3', 'SE4'].includes(input.priceArea)
    || typeof input.resolution !== 'string' || !['PT60M', 'PT15M'].includes(input.resolution)
    || input.currency !== 'SEK_PER_KWH' || !Array.isArray(input.intervals)) return invalid()
  const period = bounds(input.billingMonth), step = input.resolution === 'PT60M' ? 3_600_000 : 900_000
  if (input.intervals.length !== (period.end - period.start) / step) return invalid()
  for (const [index, raw] of input.intervals.entries()) {
    const interval = exactObject(raw, ['start', 'end', 'priceSekPerKwh'])
    if (utc(interval.start) !== period.start + index * step || utc(interval.end) !== period.start + (index + 1) * step) return invalid()
    decimal(interval.priceSekPerKwh)
  }
  return { sourceVersion: input.sourceVersion, billingMonth: input.billingMonth as string, priceArea: input.priceArea as PriceArea,
    resolution: input.resolution as Resolution, periodStart: new Date(period.start).toISOString(), periodEnd: new Date(period.end).toISOString(),
    intervalCount: input.intervals.length, coveredMinutes: (period.end - period.start) / 60_000, originalByteLength: bytes.length, originalSha256: digest(bytes) }
}

export function parseSyntheticSpotReview(bytes: Uint8Array): SyntheticSpotReviewCommand {
  return reviewCommand(jsonBytes(bytes, false))
}
function reviewCommand(value: unknown): SyntheticSpotReviewCommand {
  const body = exactObject(value, ['commandKey', 'expectedPreviousEventId', 'decision', 'reason'])
  if (typeof body.decision !== 'string' || !['hold', 'reject', 'review_capture'].includes(body.decision) || typeof body.reason !== 'string') return invalid()
  const characters = [...body.reason]
  if (characters.length < 1 || characters.length > 500 || characters.some(c => c === '\0'
    || c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)) return invalid()
  return { commandKey: syntheticSpotUuid(body.commandKey), expectedPreviousEventId: syntheticSpotUuid(body.expectedPreviousEventId), decision: body.decision as Decision, reason: body.reason }
}

// New generated RPC declarations are intentionally not widened. This local
// port admits exactly these three commands and validates every returned DTO.
type RpcReply = { data: unknown; error: unknown }
interface SyntheticSpotRpc {
  (name: 'gridex_capture_synthetic_spot_source_v1', args: { p_company_id: string; p_actor_user_id: string; p_request_key: string; p_original_base64: string }): PromiseLike<RpcReply>
  (name: 'gridex_read_synthetic_spot_source_v1', args: { p_company_id: string; p_actor_user_id: string; p_source_id: string | null; p_include_original: boolean; p_request_key: string | null }): PromiseLike<RpcReply>
  (name: 'gridex_review_synthetic_spot_source_v1', args: { p_company_id: string; p_actor_user_id: string; p_source_id: string; p_request_key: string; p_expected_previous_event_id: string; p_decision: Decision; p_reason: string }): PromiseLike<RpcReply>
}
const rpc = () => supabaseService.rpc.bind(supabaseService) as unknown as SyntheticSpotRpc
async function rpcData(call: () => PromiseLike<RpcReply>): Promise<unknown> {
  try {
    const result = await call()
    if (!object(result) || !('data' in result) || !('error' in result)) return unqualified()
    if (result.error) {
      const code = object(result.error) ? result.error.code : null
      if (code === 'P0002') throw new SyntheticSpotSourceError(404, 'synthetic_spot_source_not_found')
      if (code === '42501') throw new SyntheticSpotSourceError(403, 'synthetic_spot_source_forbidden')
      if (code === '23505' || code === '40001') throw new SyntheticSpotSourceError(409, 'synthetic_spot_source_conflict')
      if (code === '22023') return invalid()
      throw new SyntheticSpotSourceError(503, 'synthetic_spot_source_unavailable')
    }
    return result.data
  } catch (error) {
    if (error instanceof SyntheticSpotSourceError) throw error
    throw new SyntheticSpotSourceError(503, 'synthetic_spot_source_unconfirmed')
  }
}
const receiptKeys = ['source_id', 'original_sha256', 'source_version', 'billing_month', 'price_area', 'resolution', 'period_start', 'period_end', 'interval_count', 'expected_interval_count', 'covered_minutes', 'original_byte_length', 'capture_event_id', 'latest_event_id', 'latest_event_sha256', 'status', 'consumer_enabled', 'replayed'] as const
function receipt(value: unknown, extra: string[] = []): SyntheticSpotReceipt {
  const r = exactObject(value, [...receiptKeys, ...extra], unqualified)
  try {
    const period = bounds(r.billing_month), step = r.resolution === 'PT60M' ? 3_600_000 : 900_000
    if (![r.source_id, r.capture_event_id, r.latest_event_id].every(v => typeof v === 'string' && uuidPattern.test(v))
      || typeof r.original_sha256 !== 'string' || !hashPattern.test(r.original_sha256)
      || typeof r.latest_event_sha256 !== 'string' || !hashPattern.test(r.latest_event_sha256)
      || typeof r.source_version !== 'string' || !versionPattern.test(r.source_version)
      || typeof r.price_area !== 'string' || !['SE1', 'SE2', 'SE3', 'SE4'].includes(r.price_area)
      || typeof r.resolution !== 'string' || !['PT60M', 'PT15M'].includes(r.resolution)
      || utc(r.period_start) !== period.start || utc(r.period_end) !== period.end
      || r.interval_count !== (period.end - period.start) / step || r.expected_interval_count !== r.interval_count
      || r.covered_minutes !== (period.end - period.start) / 60_000 || !Number.isSafeInteger(r.original_byte_length)
      || Number(r.original_byte_length) < 1 || Number(r.original_byte_length) > SYNTHETIC_SPOT_MAX_BYTES
      || typeof r.status !== 'string' || !['captured', 'held', 'rejected', 'reviewed_capture_only'].includes(r.status) || r.consumer_enabled !== false || typeof r.replayed !== 'boolean') return unqualified()
  } catch { return unqualified() }
  // The exact whitelist above makes this projection safe: raw Auth/provider
  // diagnostics or unexpected SQL fields can never reach a response.
  return Object.fromEntries(receiptKeys.map(key => [key, r[key]])) as SyntheticSpotReceipt
}
function matchesManifest(r: SyntheticSpotReceipt, m: SyntheticSpotManifest): void {
  if (r.original_sha256 !== m.originalSha256 || r.source_version !== m.sourceVersion || r.billing_month !== m.billingMonth
    || r.price_area !== m.priceArea || r.resolution !== m.resolution || r.period_start !== m.periodStart || r.period_end !== m.periodEnd
    || r.interval_count !== m.intervalCount || r.covered_minutes !== m.coveredMinutes || r.original_byte_length !== m.originalByteLength) return unqualified()
}
function immutableTuple(r: SyntheticSpotReceipt): unknown[] {
  return [r.source_id, r.original_sha256, r.source_version, r.billing_month, r.price_area, r.resolution, r.period_start, r.period_end,
    r.interval_count, r.expected_interval_count, r.covered_minutes, r.original_byte_length, r.capture_event_id, r.consumer_enabled]
}

export async function captureSyntheticSpotSource(scope: SyntheticSpotScope, requestKey: string, bytes: Uint8Array): Promise<SyntheticSpotReceipt> {
  const manifest = parseSyntheticSpotOriginal(bytes)
  const result = receipt(await rpcData(() => rpc()('gridex_capture_synthetic_spot_source_v1', {
    p_company_id: scope.companyId, p_actor_user_id: scope.actorUserId, p_request_key: syntheticSpotUuid(requestKey), p_original_base64: Buffer.from(bytes).toString('base64'),
  })))
  matchesManifest(result, manifest)
  if (!result.replayed && (result.status !== 'captured' || result.latest_event_id !== result.capture_event_id)) return unqualified()
  return result
}
export async function readSyntheticSpotSource(scope: SyntheticSpotScope, selector: { sourceId: string; requestKey?: never } | { requestKey: string; sourceId?: never }, includeOriginal: boolean): Promise<{ receipt: SyntheticSpotReceipt; original?: Buffer }> {
  const locator = exactObject(selector, 'sourceId' in selector ? ['sourceId'] : ['requestKey'])
  const id = 'sourceId' in locator ? syntheticSpotUuid(locator.sourceId) : null
  const key = 'requestKey' in locator ? syntheticSpotUuid(locator.requestKey) : null
  const data = await rpcData(() => rpc()('gridex_read_synthetic_spot_source_v1', { p_company_id: scope.companyId, p_actor_user_id: scope.actorUserId, p_source_id: id, p_include_original: includeOriginal, p_request_key: key }))
  const result = receipt(data, includeOriginal ? ['original_base64'] : [])
  if (id !== null && result.source_id !== id) return unqualified()
  if (!includeOriginal) return { receipt: result }
  const encoded = (data as ObjectValue).original_base64
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(SYNTHETIC_SPOT_MAX_BYTES / 3) * 4) return unqualified()
  const original = Buffer.from(encoded, 'base64')
  if (original.toString('base64') !== encoded || original.length !== result.original_byte_length || digest(original) !== result.original_sha256) return unqualified()
  try { matchesManifest(result, parseSyntheticSpotOriginal(original, false)) } catch { return unqualified() }
  return { receipt: result, original }
}
export async function reviewSyntheticSpotSource(scope: SyntheticSpotScope, sourceId: string, input: SyntheticSpotReviewCommand): Promise<ReviewReceipt> {
  const id = syntheticSpotUuid(sourceId), command = reviewCommand(input), previous = await readSyntheticSpotSource(scope, { sourceId: id }, false)
  // Do not precheck the current predecessor: exact replay of an old review is
  // resolved by SQL before its new-command predecessor/transition checks.
  const data = await rpcData(() => rpc()('gridex_review_synthetic_spot_source_v1', { p_company_id: scope.companyId, p_actor_user_id: scope.actorUserId,
    p_source_id: id, p_request_key: command.commandKey, p_expected_previous_event_id: command.expectedPreviousEventId, p_decision: command.decision, p_reason: command.reason }))
  const result = receipt(data, ['event_id', 'decision']), review = data as ObjectValue
  const expectedStatus = { hold: 'held', reject: 'rejected', review_capture: 'reviewed_capture_only' }[command.decision]
  if (result.source_id !== id || JSON.stringify(immutableTuple(result)) !== JSON.stringify(immutableTuple(previous.receipt))
    || typeof review.event_id !== 'string' || !uuidPattern.test(review.event_id) || review.decision !== command.decision
    || !result.replayed && (review.event_id !== result.latest_event_id || result.status !== expectedStatus || review.event_id === result.capture_event_id)) return unqualified()
  return { ...result, event_id: review.event_id, decision: command.decision }
}

export function syntheticSpotJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders })
}
export async function syntheticSpotHttp(mode: 'read' | 'write', operation: (scope: SyntheticSpotScope) => Promise<Response>): Promise<Response> {
  try {
    const access = await requireAdminApiAccess(mode === 'write' ? ['pricing.write'] : { anyOf: ['pricing.read', 'pricing.write'] })
    if (access.response) return new Response(access.response.body, { status: access.response.status, headers: { ...Object.fromEntries(access.response.headers), ...privateHeaders } })
    if (access.guard.isPlatformAdmin !== false) throw new SyntheticSpotSourceError(403, 'synthetic_spot_source_forbidden')
    let companyId: string
    try { companyId = await requireAdminOperationalCompany(access.guard) } catch { throw new SyntheticSpotSourceError(403, 'synthetic_spot_source_forbidden') }
    if (!uuidPattern.test(companyId) || companyId !== access.guard.companyId || !uuidPattern.test(access.guard.userId)) throw new SyntheticSpotSourceError(403, 'synthetic_spot_source_forbidden')
    return await operation({ companyId, actorUserId: access.guard.userId })
  } catch (error) {
    const known = error instanceof SyntheticSpotSourceError ? error : new SyntheticSpotSourceError(503, 'synthetic_spot_source_unavailable')
    return syntheticSpotJson({ error: known.code, code: known.code }, known.status)
  }
}

export function syntheticSpotOriginalResponse(sourceId: string, bytes: Uint8Array): Response {
  return new Response(Buffer.from(bytes), { headers: { ...privateHeaders, 'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="synthetic-spot-${syntheticSpotUuid(sourceId)}.json"` } })
}
