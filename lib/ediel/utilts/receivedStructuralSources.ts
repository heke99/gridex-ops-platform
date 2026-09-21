import { createHash } from 'node:crypto'
import { tenantDb } from '@/lib/supabase/tenantDb'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { UtiltsTransactionMatch } from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import { parseCanonicalEdifactAst, type CanonicalEdifactAst } from '@/lib/ediel/core/canonicalEdifactAst'
import { segmentComposite, tokenizeEdifact, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseProdatMessage, parsedProdatObjects } from '@/lib/ediel/prodat/parser'
import { isProdatCalendarMinute, prodatMarketMinuteToUtc } from '@/lib/ediel/prodat/render/dates'

// Diagnostic budgets only. Exceeding one never means a national wire rejection
// or that a selected prefix is a complete expected register inventory.
const MAX_ROWS = 100
const MAX_WIRE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024
const MAX_WIRE_SEGMENTS = 512
const MAX_TOTAL_SEGMENTS = 4096
const READ_DEADLINE_MS = 2000
const COLUMNS = 'id,company_id,environment,direction,message_standard,message_family,message_code,metering_point_id,message_received_at,raw_payload,immutable_payload_hash'

type Issue = { code: string; sourceMessageId?: string }
export type ReceivedStructuralSource = {
  sourceMessageId: string
  sourcePayloadHash: string
  sourceReceivedAt: string
  meteringPointId: string
  objectId: string
  identityAgency: string
  legalSenderId: string
  legalReceiverId: string
  messageCode: string
  effectiveFrom: { fieldNumber: '210' | '216'; marketMinute: string; utc: string }
  contractStartMinute: string | null
  meterNumber: string | null
  oldMeterNumber: string | null
  registers: Array<{ sourceOrder: number; registerIndex: string | null; registerId: string | null }>
  acceptance: 'not_checked'
}
export type ReceivedStructuralSources = {
  version: 1
  universe: 'linked_received_sources'
  authorityStatus: 'not_established'
  selection: 'not_performed'
  status: 'not_requested' | 'inspected' | 'incomplete' | 'read_failed'
  sources: ReceivedStructuralSource[]
  issues: Issue[]
}
type Scope = { meteringPointId: string; objectId: string; agency: string }
type Receipt = { milliseconds: number; microseconds: number }
type QueryResult = { data: unknown; count: number | null; error: unknown }
// tenantDb intentionally exposes an unknown builder; narrow only the methods
// this SELECT uses. No unscoped client, query mutation or database write.
type SourceQuery = PromiseLike<QueryResult> & {
  eq(column: string, value: string): SourceQuery
  in(column: string, values: string[]): SourceQuery
  lte(column: string, value: string): SourceQuery
  limit(value: number): SourceQuery
}
class InspectionBudgetExceeded extends Error {}

function report(status: ReceivedStructuralSources['status'], code?: string): ReceivedStructuralSources {
  return { version: 1, universe: 'linked_received_sources', authorityStatus: 'not_established', selection: 'not_performed', status, sources: [], issues: code ? [{ code }] : [] }
}
function exactId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim()
    && Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Receipt instants retain PostgreSQL microseconds. Never feed a rounded Date
 * back into the query: the original validated literal is its cutoff. */
function receipt(value: unknown): Receipt | null {
  if (typeof value !== 'string') return null
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/)
  if (!parts || !isProdatCalendarMinute(parts.slice(1, 6).join('')) || Number(parts[6]) > 59) return null
  const zone = parts[8]
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null
  const milliseconds = Date.parse(`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}${zone}`)
  return Number.isFinite(milliseconds) ? { milliseconds, microseconds: Number((parts[7] ?? '').padEnd(6, '0')) } : null
}
function notAfter(value: Receipt, cutoff: Receipt): boolean {
  return value.milliseconds < cutoff.milliseconds || (value.milliseconds === cutoff.milliseconds && value.microseconds <= cutoff.microseconds)
}

/** One supported physical envelope, not a whole-message grammar certificate. */
function singleMessage(raw: string, family: 'UTILTS' | 'PRODAT'): CanonicalEdifactAst | null {
  if (Buffer.byteLength(raw, 'utf8') > MAX_WIRE_BYTES) throw new InspectionBudgetExceeded()
  const tokens = tokenizeEdifact(raw)
  if (tokens.segments.length > MAX_WIRE_SEGMENTS) throw new InspectionBudgetExceeded()
  const index = (tag: string) => tokens.segments.filter(segment => segment.tag === tag)
  const unb = index('UNB'), unh = index('UNH'), unt = index('UNT'), unz = index('UNZ')
  if ([unb, unh, unt, unz].some(items => items.length !== 1)) return null
  if (unb[0].index !== 0 || unh[0].index !== 1 || unt[0].index !== tokens.segments.length - 2 || unz[0].index !== tokens.segments.length - 1) return null
  const scalar = (segment: EdifactTokenizedSegment, element: number) => {
    const parts = segmentComposite(segment, element, tokens.una)
    return parts.length === 1 && exactId(parts[0]) ? parts[0] : null
  }
  if (!scalar(unh[0], 1) || scalar(unh[0], 1) !== scalar(unt[0], 2)) return null
  if (!scalar(unb[0], 5) || scalar(unb[0], 5) !== scalar(unz[0], 2)) return null
  if (segmentComposite(unh[0], 2, tokens.una)[0] !== family) return null
  const ast = parseCanonicalEdifactAst(raw)
  return ast.messages.length === 1 && ast.messages[0].family === family ? ast : null
}
function legalParty(ast: CanonicalEdifactAst, role: string, boundary: 'IDE' | 'LIN', codes: readonly [string, string]): string | null {
  const segments = ast.messages[0].segments
  const stop = segments.findIndex(segment => segment.tag === boundary)
  const header = stop < 0 ? segments : segments.slice(0, stop)
  const parties = header.filter(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, ast.una)[0] === role)
  if (parties.length !== 1 || segmentComposite(parties[0], 1, ast.una).length !== 1) return null
  const parts = segmentComposite(parties[0], 2, ast.una)
  return parts.length === 3 && exactId(parts[0]) && parts[1] === codes[0] && parts[2] === codes[1] ? parts[0] : null
}
function matchedScopes(ast: CanonicalEdifactAst, matches: readonly UtiltsTransactionMatch[]): Scope[] {
  const transactions = ast.messages[0].utiltsTransactions ?? []
  const scopes: Scope[] = []
  for (const transaction of transactions) {
    if (transaction.identityQualifier !== '24' || transaction.identityComponents.length !== 1 || !exactId(transaction.transactionId)) continue
    if (transactions.filter(item => item.transactionId === transaction.transactionId).length !== 1) continue
    const end = transaction.segments.findIndex(segment => segment.tag === 'SEQ')
    const header = end < 0 ? transaction.segments : transaction.segments.slice(0, end)
    const locations = header.filter(segment => segment.tag === 'LOC' && segmentComposite(segment, 1, ast.una)[0] === '172')
    if (locations.length !== 1 || segmentComposite(locations[0], 1, ast.una).length !== 1) continue
    const parts = segmentComposite(locations[0], 2, ast.una)
    if (parts.length !== 3 || !exactId(parts[0]) || parts[1] !== '' || !['9', '89'].includes(parts[2])) continue
    const candidates = matches.filter(match => match.transactionReference === transaction.transactionId)
    if (candidates.length !== 1) continue
    const match = candidates[0]
    if (match.matchStatus !== 'matched' || match.externalMeteringPointId !== parts[0] || !exactId(match.meteringPointId)) continue
    scopes.push({ meteringPointId: match.meteringPointId, objectId: parts[0], agency: parts[2] })
  }
  // A mutable internal link cannot resolve contradictory wire identities.
  return scopes.filter(scope => scopes.every(other => other.meteringPointId !== scope.meteringPointId || (other.objectId === scope.objectId && other.agency === scope.agency)))
}

async function boundedRead(query: SourceQuery): Promise<QueryResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(query),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), READ_DEADLINE_MS) }),
    ])
  } catch { return null } finally { if (timer !== undefined) clearTimeout(timer) }
}

/** Actual linked-source candidates only. A correct hash does not qualify
 * context, disposition, completeness, deletion history or supersession. */
export async function readReceivedStructuralSources(input: {
  message: EdielMessageRow
  transactionMatches: readonly UtiltsTransactionMatch[]
}): Promise<ReceivedStructuralSources> {
  const { message, transactionMatches } = input
  const cutoff = receipt(message.message_received_at)
  if (!exactId(message.company_id) || !['test', 'production'].includes(message.environment) || !cutoff || typeof message.message_received_at !== 'string' || typeof message.raw_payload !== 'string') {
    return report('not_requested', 'incoming_source_scope_unavailable')
  }
  let ast: CanonicalEdifactAst | null
  let scopes: Scope[]
  let sender: string | null
  let receiver: string | null
  try {
    ast = singleMessage(message.raw_payload, 'UTILTS')
    if (!ast) return report('not_requested', 'incoming_source_scope_unavailable')
    sender = legalParty(ast, 'MS', 'IDE', ['SVK', '260'])
    receiver = legalParty(ast, 'MR', 'IDE', ['SVK', '260'])
    scopes = matchedScopes(ast, transactionMatches)
  } catch { return report('not_requested', 'incoming_source_scope_unavailable') }
  if (!sender || !receiver || scopes.length === 0) return report('not_requested', 'incoming_source_scope_unavailable')
  const meteringPointIds = [...new Set(scopes.map(scope => scope.meteringPointId))]
  let result: QueryResult | null
  try {
    const select = tenantDb(message.company_id).from('ediel_messages').select(COLUMNS, { count: 'exact' }) as SourceQuery
    result = await boundedRead(select.eq('environment', message.environment).eq('direction', 'inbound').eq('message_standard', 'edifact')
      .eq('message_family', 'PRODAT').in('metering_point_id', meteringPointIds).lte('message_received_at', message.message_received_at).limit(MAX_ROWS + 1))
  } catch { result = null }
  if (!result || result.error || !Array.isArray(result.data)) return report('read_failed', 'source_read_failed')
  const rows = result.data
  // Validate the entire response boundary BEFORE returning any source ID.
  if (rows.some(row => !record(row) || row.company_id !== message.company_id || row.environment !== message.environment || row.direction !== 'inbound'
    || row.message_standard !== 'edifact' || row.message_family !== 'PRODAT' || typeof row.metering_point_id !== 'string' || !meteringPointIds.includes(row.metering_point_id)
    || !receipt(row.message_received_at) || !notAfter(receipt(row.message_received_at)!, cutoff))) return report('read_failed', 'source_read_failed')
  if (!Number.isInteger(result.count) || result.count === null || result.count < 0 || result.count > MAX_ROWS || rows.length !== result.count
    || rows.some(row => !exactId(row.id)) || new Set(rows.map(row => row.id)).size !== rows.length) return report('incomplete', 'source_query_incomplete')
  let totalBytes = 0
  let totalSegments = 0
  const output = report('inspected')
  for (const row of rows as Record<string, unknown>[]) {
    const id = row.id as string
    const raw = row.raw_payload
    const seal = row.immutable_payload_hash
    if (typeof raw === 'string') {
      if (raw.length > MAX_WIRE_BYTES) return report('incomplete', 'source_inspection_budget_exceeded')
      totalBytes += Buffer.byteLength(raw, 'utf8')
      if (totalBytes > MAX_TOTAL_BYTES) return report('incomplete', 'source_inspection_budget_exceeded')
    }
    if (typeof raw !== 'string' || typeof seal !== 'string' || !/^[a-f0-9]{64}$/.test(seal) || createHash('sha256').update(raw, 'utf8').digest('hex') !== seal) {
      output.issues.push({ code: 'source_integrity_unavailable', sourceMessageId: id }); continue
    }
    try {
      const sourceAst = singleMessage(raw, 'PRODAT')
      if (!sourceAst || legalParty(sourceAst, 'FR', 'LIN', ['160', 'SVK']) !== sender || legalParty(sourceAst, 'DO', 'LIN', ['160', 'SVK']) !== receiver) {
        output.issues.push({ code: 'source_wire_scope_unavailable', sourceMessageId: id }); continue
      }
      totalSegments += sourceAst.segments.length
      if (totalSegments > MAX_TOTAL_SEGMENTS) return report('incomplete', 'source_inspection_budget_exceeded')
      const parsed = parseProdatMessage(raw)
      if (!['Z04', 'Z06', 'Z10'].includes(parsed.messageCode) || parsed.messageCode !== row.message_code) {
        output.issues.push({ code: 'source_message_unavailable', sourceMessageId: id }); continue
      }
      const scope = scopes.find(item => item.meteringPointId === row.metering_point_id)!
      const objects = parsedProdatObjects(parsed).filter(object => object.meteringPointId === scope.objectId && object.identityAgency === scope.agency)
      if (objects.length !== 1 || !objects[0].validRegisterChain || objects[0].registers.length === 0) {
        output.issues.push({ code: 'source_wire_scope_unavailable', sourceMessageId: id }); continue
      }
      const first = objects[0].registers[0]
      const fieldNumber = parsed.messageCode === 'Z04' ? '210' : '216'
      const minute = fieldNumber === '210' ? first.contractStartDate : first.validityStartDate
      const utc = prodatMarketMinuteToUtc(minute)
      if (!minute || !utc || parsed.timezoneOffset !== '1') {
        output.issues.push({ code: 'source_effective_date_unavailable', sourceMessageId: id }); continue
      }
      output.sources.push({
        sourceMessageId: id, sourcePayloadHash: seal, sourceReceivedAt: row.message_received_at as string,
        meteringPointId: scope.meteringPointId, objectId: scope.objectId, identityAgency: scope.agency,
        legalSenderId: sender, legalReceiverId: receiver, messageCode: parsed.messageCode,
        effectiveFrom: { fieldNumber, marketMinute: minute, utc }, contractStartMinute: first.contractStartDate,
        meterNumber: first.meterNumber, oldMeterNumber: first.oldMeterNumber ?? null,
        registers: objects[0].registers.map(register => ({ sourceOrder: register.sourceOrder, registerIndex: register.registerIndex, registerId: register.meterTimeFrame })),
        acceptance: 'not_checked',
      })
    } catch (error) {
      if (error instanceof InspectionBudgetExceeded) return report('incomplete', 'source_inspection_budget_exceeded')
      output.issues.push({ code: 'source_wire_scope_unavailable', sourceMessageId: id })
    }
  }
  // Stable diagnostic presentation only; equal dates are neither merged nor
  // superseded and a future change is not silently selected as current.
  output.sources.sort((a, b) => a.sourceMessageId < b.sourceMessageId ? -1 : a.sourceMessageId > b.sourceMessageId ? 1 : 0)
  return output
}
