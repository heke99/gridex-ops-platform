import { createHash } from 'node:crypto'
import { segmentComposite, tokenizeEdifact, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

// Resource ceilings are inspection limits, not national wire rejection rules.
// A breached ceiling invalidates the WHOLE returned inventory, never a prefix.
const MAX_SOURCES = 1000
const MAX_WIRE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_WIRE_SEGMENTS = 8192
const MAX_TOTAL_SEGMENTS = 32768
const CONTEXT_KEYS = ['version', 'contextOrigin', 'sourceMessageId', 'companyId', 'environment', 'messageCode', 'payloadHash', 'sourceReceivedAt', 'capturedAt']

type JsonRecord = Record<string, unknown>
type Issue = { code: string; sourceMessageId?: string }
export type SourceObjectOccurrence = {
  ordinal: number
  segmentIndex: number
  messageIndex: number | null
  lineNumber: string | null
  objectId: string | null
  identityAgency: string | null
  identityStatus: 'observed' | 'unresolved'
}
export type SourceObjectMembership = {
  messageIndex: number
  objectId: string
  identityAgency: string
  occurrenceOrdinals: number[]
}
export type InventoriedReceivedSource = {
  sourceMessageId: string
  sourcePayloadHash: string | null
  sourceReceivedAt: string | null
  capturedAt: string
  receiptStatus: 'recorded' | 'unavailable'
  // This module MUST NOT derive acceptance from receipt, status JSON or a hash.
  disposition: 'not_checked'
  status: 'enumerated' | 'incomplete'
  occurrences: SourceObjectOccurrence[]
  objects: SourceObjectMembership[]
  issues: string[]
}
export type DurableReceivedSourceInventory = {
  version: 1
  universe: 'durable_received_sources'
  historyCoverage: 'before_ledger_unknown'
  authorityStatus: 'not_established'
  selection: 'not_performed'
  status: 'unavailable' | 'read_failed' | 'incomplete' | 'enumerated'
  sources: InventoriedReceivedSource[]
  issues: Issue[]
}

type SourceRow = {
  sourceMessageId: string
  companyId: string
  environment: string
  origin: 'database_insert'
  messageCode: string | null
  sourceReceivedAt: string | null
  capturedAt: string
  rawPayload: string | null
  payloadHash: string | null
  receivedContext?: unknown
}
function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
}
function exactId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && value === value.trim()
    && Array.from(value).every(char => {
      const code = char.codePointAt(0)!
      return code >= 32 && code !== 127 && !(code >= 0xd800 && code <= 0xdfff)
    })
}
function report(status: DurableReceivedSourceInventory['status'], code?: string): DurableReceivedSourceInventory {
  return { version: 1, universe: 'durable_received_sources', historyCoverage: 'before_ledger_unknown',
    authorityStatus: 'not_established', selection: 'not_performed', status, sources: [], issues: code ? [{ code }] : [] }
}

/** Exact PostgreSQL microseconds. Calendar validation precedes Date.parse so an
 * impossible day cannot roll over into an apparently valid receipt. The caller
 * retains the original literal when calling SQL; this is comparison only. */
export function parseSourceReceiptInstant(value: unknown): bigint | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/)
  if (!m) return null
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null
  const zone = m[8]
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null
  const milliseconds = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`)
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * BigInt(1000) + BigInt((m[7] ?? '').padEnd(6, '0')) : null
}

function contextMatches(row: SourceRow): boolean {
  const context = row.receivedContext
  // Missing insertion evidence remains unavailable; never synthesize it here.
  if (context === null || context === undefined) return true
  if (!record(context) || Object.keys(context).length !== CONTEXT_KEYS.length
    || !CONTEXT_KEYS.every(key => Object.prototype.hasOwnProperty.call(context, key))
    || context.version !== 1 || context.contextOrigin !== 'database_insert'
    || context.sourceMessageId !== row.sourceMessageId || context.companyId !== row.companyId
    || context.environment !== row.environment || context.messageCode !== row.messageCode
    || typeof context.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(context.payloadHash)
    || context.payloadHash !== row.payloadHash) return false
  const received = parseSourceReceiptInstant(context.sourceReceivedAt)
  const rowReceived = parseSourceReceiptInstant(row.sourceReceivedAt)
  const captured = parseSourceReceiptInstant(context.capturedAt)
  const ledgerCaptured = parseSourceReceiptInstant(row.capturedAt)
  return received !== null && rowReceived !== null && received === rowReceived
    && captured !== null && ledgerCaptured !== null && captured <= ledgerCaptured
}

function sourceBoundary(value: unknown, companyId: string, environment: string, opened: bigint, cutoff: bigint): value is SourceRow {
  if (!record(value) || !uuid(value.sourceMessageId) || value.companyId !== companyId
    || value.environment !== environment || value.origin !== 'database_insert'
    || !(value.rawPayload === null || typeof value.rawPayload === 'string')
    || !(value.payloadHash === null || typeof value.payloadHash === 'string')
    || !(value.messageCode === null || typeof value.messageCode === 'string')) return false
  const captured = parseSourceReceiptInstant(value.capturedAt)
  const received = parseSourceReceiptInstant(value.sourceReceivedAt)
  if (captured === null || captured < opened || captured > cutoff
    || (value.sourceReceivedAt !== null && (received === null || received > cutoff))) return false
  return contextMatches(value as SourceRow)
}

function scalar(segment: EdifactTokenizedSegment, element: number, una: EdifactServiceStringAdvice): string | null {
  const parts = segmentComposite(segment, element, una)
  return parts.length === 1 && exactId(parts[0]) ? parts[0] : null
}
function terminated(raw: string, una: EdifactServiceStringAdvice): boolean {
  const text = raw.replace(/\r?\n/g, '').trimEnd()
  if (!text.endsWith(una.segmentTerminator)) return false
  let releases = 0
  for (let i = text.length - 2; i >= 0 && text[i] === una.releaseCharacter; i--) releases++
  return releases % 2 === 0
}

/** Enumerate physical LIN occurrences only. This is NOT a second canonical
 * register grouper, PRODAT validator, tenant resolver or legal-party checker.
 * A membership groups observations by exact message/identity/agency; it does
 * not infer first-register inheritance, register validity, meter state or dates. */
function inspectOne(row: SourceRow): { source: InventoriedReceivedSource; segmentCount: number; exceeded: boolean } {
  const issues = new Set<string>()
  const source: InventoriedReceivedSource = {
    sourceMessageId: row.sourceMessageId, sourcePayloadHash: row.payloadHash,
    sourceReceivedAt: row.sourceReceivedAt, capturedAt: row.capturedAt,
    receiptStatus: row.receivedContext == null || row.sourceReceivedAt === null ? 'unavailable' : 'recorded',
    disposition: 'not_checked', status: 'enumerated', occurrences: [], objects: [], issues: [],
  }
  if (source.receiptStatus === 'unavailable') issues.add('source_receipt_context_unavailable')
  const finish = (segmentCount = 0, exceeded = false) => {
    source.issues = [...issues]
    if (issues.size || exceeded) source.status = 'incomplete'
    return { source, segmentCount, exceeded }
  }
  const raw = row.rawPayload
  if (typeof raw !== 'string' || typeof row.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadHash)
    || createHash('sha256').update(raw, 'utf8').digest('hex') !== row.payloadHash) {
    issues.add('source_integrity_unavailable'); return finish()
  }
  try {
    const { una, segments } = tokenizeEdifact(raw)
    if (segments.length > MAX_WIRE_SEGMENTS) return finish(segments.length, true)
    const separators = [una.componentDataElementSeparator, una.dataElementSeparator, una.decimalMark,
      una.releaseCharacter, una.repetitionSeparator, una.segmentTerminator]
    if (new Set(separators).size !== separators.length || !terminated(raw, una)) issues.add('source_envelope_unresolved')
    const unbs = segments.filter(segment => segment.tag === 'UNB')
    const unzs = segments.filter(segment => segment.tag === 'UNZ')
    if (unbs.length !== 1 || unzs.length !== 1 || segments[0]?.tag !== 'UNB'
      || segments.at(-1)?.tag !== 'UNZ') issues.add('source_envelope_unresolved')
    let active: { index: number; start: number; reference: string | null; prodat: boolean } | null = null
    let messageIndex = -1
    let completedMessages = 0
    const messageReferences = new Set<string>()
    const objects = new Map<string, SourceObjectMembership>()
    for (const segment of segments) {
      if (segment.tag === 'UNH') {
        if (active) issues.add('source_envelope_unresolved')
        messageIndex++
        const reference = scalar(segment, 1, una)
        const prodat = segmentComposite(segment, 2, una)[0] === 'PRODAT'
        if (!reference || messageReferences.has(reference) || !prodat) issues.add('source_message_scope_unresolved')
        if (reference) messageReferences.add(reference)
        active = { index: messageIndex, start: segment.index, reference, prodat }
      } else if (segment.tag === 'UNT') {
        const count = scalar(segment, 1, una)
        if (!active || !count || !/^\d+$/.test(count) || Number(count) !== segment.index - active.start + 1
          || scalar(segment, 2, una) !== active.reference) issues.add('source_envelope_unresolved')
        if (active) completedMessages++
        active = null
      } else if (['UNB', 'UNZ', 'UNG', 'UNE'].includes(segment.tag) && active) {
        issues.add('source_envelope_unresolved')
        active = null
      }
      if (['UNG', 'UNE'].includes(segment.tag)) issues.add('source_envelope_unresolved')
      if (segment.tag !== 'LIN') continue
      const parts = segmentComposite(segment, 3, una)
      const scoped = active?.prodat === true && active.reference !== null
      const identityKnown = scoped && parts.length === 4 && exactId(parts[0]) && ['9', '89'].includes(parts[3])
      const occurrence: SourceObjectOccurrence = {
        ordinal: source.occurrences.length + 1, segmentIndex: segment.index,
        messageIndex: scoped ? active!.index : null, lineNumber: scalar(segment, 1, una),
        objectId: identityKnown ? parts[0] : null, identityAgency: identityKnown ? parts[3] : null,
        identityStatus: identityKnown ? 'observed' : 'unresolved',
      }
      source.occurrences.push(occurrence)
      if (!identityKnown) { issues.add('source_object_identity_unresolved'); continue }
      const key = JSON.stringify([active!.index, parts[0], parts[3]])
      const membership = objects.get(key) ?? { messageIndex: active!.index, objectId: parts[0], identityAgency: parts[3], occurrenceOrdinals: [] }
      membership.occurrenceOrdinals.push(occurrence.ordinal)
      objects.set(key, membership)
    }
    if (active || completedMessages === 0 || completedMessages !== messageIndex + 1) issues.add('source_envelope_unresolved')
    if (unbs.length === 1 && unzs.length === 1) {
      const reference = scalar(unbs[0], 5, una), count = scalar(unzs[0], 1, una)
      if (!reference || scalar(unzs[0], 2, una) !== reference || !count || !/^\d+$/.test(count)
        || Number(count) !== completedMessages) issues.add('source_envelope_unresolved')
    }
    if (source.occurrences.length === 0) issues.add('source_objects_unavailable')
    source.objects = [...objects.values()]
    return finish(segments.length)
  } catch {
    // Parser errors are availability evidence, not an ACK or national rejection.
    issues.add('source_wire_unavailable'); return finish()
  }
}

function inspect(input: unknown): DurableReceivedSourceInventory {
  if (!record(input) || !uuid(input.companyId) || (input.environment !== 'test' && input.environment !== 'production')) {
    return report('unavailable', 'source_scope_unavailable')
  }
  const cutoff = parseSourceReceiptInstant(input.cutoffAt)
  if (cutoff === null) return report('unavailable', 'source_scope_unavailable')
  const snapshot = input.snapshot
  if (!record(snapshot) || snapshot.version !== 1 || snapshot.companyId !== input.companyId
    || snapshot.environment !== input.environment || parseSourceReceiptInstant(snapshot.cutoffAt) !== cutoff
    || !Array.isArray(snapshot.sources)) return report('read_failed', 'source_snapshot_unavailable')
  const opened = parseSourceReceiptInstant(snapshot.openedAt), read = parseSourceReceiptInstant(snapshot.readAt)
  if (opened === null || read === null || read < cutoff || opened > read) return report('read_failed', 'source_snapshot_unavailable')
  if (opened > cutoff) return report('unavailable', 'source_ledger_not_active_at_cutoff')
  if (snapshot.exhaustive !== true || !Number.isSafeInteger(snapshot.sourceCount)
    || typeof snapshot.sourceCount !== 'number' || snapshot.sourceCount < 0 || snapshot.sourceCount > MAX_SOURCES
    || snapshot.sources.length !== snapshot.sourceCount) return report('incomplete', 'source_snapshot_incomplete')
  const rows = snapshot.sources
  // Validate ALL row/context scope before returning any ID/hash/object/date.
  if (!rows.every(value => sourceBoundary(value, input.companyId as string, input.environment as string, opened, cutoff))) {
    return report('read_failed', 'source_snapshot_scope_unavailable')
  }
  const sources = rows as SourceRow[]
  if (new Set(sources.map(row => row.sourceMessageId)).size !== sources.length) return report('incomplete', 'source_snapshot_incomplete')
  let totalBytes = 0
  for (const row of sources) {
    if (row.rawPayload === null) continue
    if (row.rawPayload.length > MAX_WIRE_BYTES) return report('incomplete', 'source_inspection_budget_exceeded')
    const bytes = Buffer.byteLength(row.rawPayload, 'utf8')
    totalBytes += bytes
    if (bytes > MAX_WIRE_BYTES || totalBytes > MAX_TOTAL_BYTES) return report('incomplete', 'source_inspection_budget_exceeded')
  }
  const output = report('enumerated')
  let totalSegments = 0
  for (const row of sources) {
    const inspected = inspectOne(row)
    totalSegments += inspected.segmentCount
    if (inspected.exceeded || totalSegments > MAX_TOTAL_SEGMENTS) return report('incomplete', 'source_inspection_budget_exceeded')
    output.sources.push(inspected.source)
    if (inspected.source.status !== 'enumerated') output.status = 'incomplete'
    output.issues.push(...inspected.source.issues.map(code => ({ code, sourceMessageId: row.sourceMessageId })))
  }
  // UUID ordering is presentation only, never a temporal or supersession choice.
  output.sources.sort((a, b) => a.sourceMessageId < b.sourceMessageId ? -1 : a.sourceMessageId > b.sourceMessageId ? 1 : 0)
  output.issues.sort((a, b) => {
    const left = `${a.sourceMessageId ?? ''}:${a.code}`, right = `${b.sourceMessageId ?? ''}:${b.code}`
    return left < right ? -1 : left > right ? 1 : 0
  })
  return output
}

/** Validates the single-snapshot durable-ledger contract before any identifiers
 * escape the original scope. Complete physical enumeration never certifies
 * pre-ledger history, source acceptance, register structure or E61/E62 scope. */
export function inspectDurableReceivedSourceInventory(input: unknown): DurableReceivedSourceInventory {
  try { return inspect(input) } catch { return report('read_failed', 'source_snapshot_unavailable') }
}
