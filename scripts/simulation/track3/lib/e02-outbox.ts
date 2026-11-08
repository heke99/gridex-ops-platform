// E02 receipt ownership and global-worker admission. Reads do not acquire a
// producer lease: the caller must retain its qualified exclusive, quiescent phase.
import { createHash } from 'node:crypto'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { lit, sqlJson } from './seed.mjs'

type Scope = Readonly<{ companyId: string; environment: 'test' | 'production'; mailboxId: string }>
export type E02SourceReceipt = Readonly<Scope & {
  sourceMessageId: string; inboundEmailMessageId: string; mimeSha256: string; sourcePayloadSha256: string; direction: 'inbound'
}>
// Unattributed protected sources prove reception only. They never authorize
// reviewed history grants, business processing, output capture or a worker.
export type E02TechnicalSourceReceipt = Readonly<Omit<E02SourceReceipt, 'companyId'> & { companyId: null }>
export type E02OutboxReceipt = Readonly<E02SourceReceipt & {
  id: string; ackMessageId: string; ackFamily: string; ackCompanyId: string; ackEnvironment: string
  ackSourceMessageId: string; ackDirection: string; outboxFamily: string; ackPayloadSha256: string
}>
type Row = Record<string, unknown>
const sourceKeys = ['companyId', 'environment', 'mailboxId', 'sourceMessageId', 'inboundEmailMessageId', 'mimeSha256', 'sourcePayloadSha256', 'direction'] as const
const outputKeys = ['id', 'ackMessageId', 'ackFamily', 'ackCompanyId', 'ackEnvironment', 'ackSourceMessageId', 'ackDirection', 'outboxFamily', 'ackPayloadSha256'] as const
const activeStatuses = new Set(['prepared', 'queued', 'sending'])
const statuses = new Set(['draft', 'prepared', 'queued', 'sending', 'sent', 'failed', 'superseded', 'blocked', 'blocked_tenant_state', 'delivery_uncertain'])
const families = new Set(['CONTRL', 'APERAK', 'UTILTS_ERR'])
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
function fail(message: string): never { throw new Error(`T3_HARNESS_PRECONDITION: ${message}`) }
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function ids(value: readonly string[]): void {
  if (!Array.isArray(value) || value.some(id => !text(id)) || new Set(value).size !== value.length) fail('explicit unique IDs required')
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail('receipt inventory malformed')
  return value as Row[]
}
function equal(row: Row, receipt: object): boolean {
  return Object.entries(receipt).every(([key, value]) => row[key] === value)
}

// The same finite join is used for initial receipt capture and subsequent
// verification. Inventory discovery never establishes ownership.
const outputSelection = `jsonb_build_object(
  'id',o.id,'companyId',o.company_id,'environment',o.environment,'ackMessageId',o.ediel_message_id,'sourceMessageId',o.source_message_id,'status',o.status,
  'ackCompanyId',a.company_id,'ackEnvironment',a.environment,'ackSourceMessageId',a.related_message_id,'ackDirection',a.direction,'ackFamily',a.message_family,
  'outboxFamily',o.message_family,'ackPayloadSha256',encode(sha256(convert_to(a.raw_payload,'UTF8')),'hex'),
  'direction',s.direction,'inboundEmailMessageId',s.inbound_email_message_id,'mailboxId',e.mailbox_id,'mimeSha256',e.raw_message_sha256,
  'sourcePayloadSha256',encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex'),
  'sourceCompanyId',s.company_id,'sourceEnvironment',s.environment,'emailCompanyId',e.company_id,'emailEnvironment',e.environment)`
const outputJoins = `FROM public.ediel_outbox o
  LEFT JOIN public.ediel_messages a ON a.id=o.ediel_message_id
  LEFT JOIN public.ediel_messages s ON s.id=o.source_message_id
  LEFT JOIN public.inbound_email_messages e ON e.id=s.inbound_email_message_id`

export class E02OutboxAdmission {
  private readonly scope: Scope
  private readonly query: (sql: string) => unknown
  private readonly injected = new Map<string, string | null>()
  private readonly sourceReceipts = new Map<string, E02SourceReceipt>()
  private readonly technicalReceipts = new Map<string, E02TechnicalSourceReceipt>()
  private readonly outputReceipts = new Map<string, E02OutboxReceipt>()
  private readonly capturedSources = new Set<string>()
  constructor(scope: Scope, query: (sql: string) => unknown = sqlJson) {
    if (!scope || !text(scope.companyId) || !text(scope.mailboxId) || !['test', 'production'].includes(scope.environment)) fail('explicit E02 scope required')
    this.scope = Object.freeze({ companyId: scope.companyId, environment: scope.environment, mailboxId: scope.mailboxId })
    this.query = query
  }
  get sources(): readonly E02SourceReceipt[] { return Object.freeze([...this.sourceReceipts.values()]) }
  get technicalSources(): readonly E02TechnicalSourceReceipt[] { return Object.freeze([...this.technicalReceipts.values()]) }
  get outboxes(): readonly E02OutboxReceipt[] { return Object.freeze([...this.outputReceipts.values()]) }

  /** Call only after successful owned APPEND; malformed/no-source MIME is still
   * a real input but cannot authorize any independently unextractable source. */
  rememberMime(mime: Buffer): void {
    if (!Buffer.isBuffer(mime) || !mime.length) fail('exact injected MIME required')
    let payloadHash: string | null = null
    try {
      const parsed = parseInboundEmailContent({ rawEmail: mime.toString('utf8') })
      if (parsed && parsed.rawPayload.length) payloadHash = sha(parsed.rawPayload)
    } catch { /* malformed input is not authority for a parsed source */ }
    this.injected.set(sha(mime), payloadHash)
  }

  private readSources(storedIds: readonly string[], sourceIds: readonly string[]): Row[] {
    if (!storedIds.length && !sourceIds.length) return []
    return rows(this.query(`/* t3-e02:sources */ SELECT coalesce(jsonb_agg(jsonb_build_object(
      'sourceMessageId',s.id,'companyId',s.company_id,'environment',s.environment,'direction',s.direction,
      'inboundEmailMessageId',s.inbound_email_message_id,'mailboxId',e.mailbox_id,'mimeSha256',e.raw_message_sha256,
      'sourcePayloadSha256',encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex'),
      'emailCompanyId',e.company_id,'emailEnvironment',e.environment) ORDER BY s.id),'[]')
      FROM public.ediel_messages s LEFT JOIN public.inbound_email_messages e ON e.id=s.inbound_email_message_id
      WHERE s.direction='inbound' AND (${[storedIds.length ? `s.inbound_email_message_id IN (${storedIds.map(lit).join(',')})` : '', sourceIds.length ? `s.id IN (${sourceIds.map(lit).join(',')})` : ''].filter(Boolean).join(' OR ')})`))
  }
  private source(row: Row): E02SourceReceipt {
    if (sourceKeys.some(key => !text(row[key])) || !equal(row, this.scope) || row.direction !== 'inbound'
      || row.emailCompanyId !== this.scope.companyId || row.emailEnvironment !== this.scope.environment
      || !hash(row.mimeSha256) || !hash(row.sourcePayloadSha256)) fail('source receipt binding differs')
    const expectedPayload = this.injected.get(row.mimeSha256 as string)
    if (!expectedPayload || expectedPayload !== row.sourcePayloadSha256) fail('source differs from independently extracted injected payload')
    return Object.freeze(Object.fromEntries(sourceKeys.map(key => [key, row[key]]))) as E02SourceReceipt
  }
  private technicalSource(row: Row): E02TechnicalSourceReceipt {
    if (sourceKeys.some(key => key !== 'companyId' && !text(row[key])) || row.companyId !== null || row.emailCompanyId !== null
      || row.environment !== this.scope.environment || row.emailEnvironment !== this.scope.environment || row.mailboxId !== this.scope.mailboxId
      || row.direction !== 'inbound' || !hash(row.mimeSha256) || !hash(row.sourcePayloadSha256)) fail('technical reception binding differs')
    const expectedPayload = this.injected.get(row.mimeSha256 as string)
    if (!expectedPayload || expectedPayload !== row.sourcePayloadSha256) fail('technical source differs from independently extracted injected payload')
    return Object.freeze(Object.fromEntries(sourceKeys.map(key => [key, row[key]]))) as E02TechnicalSourceReceipt
  }

  /** Only current stored email IDs can introduce a new source. Returned old
   * IDs are allowed solely when an unchanged receipt already exists. */
  observePoll(storedIds: string[], returnedSourceIds: string[]): readonly string[] {
    ids(storedIds); ids(returnedSourceIds)
    const emails = storedIds.length ? rows(this.query(`/* t3-e02:emails */ SELECT coalesce(jsonb_agg(jsonb_build_object(
      'inboundEmailMessageId',id,'companyId',company_id,'environment',environment,'mailboxId',mailbox_id,'mimeSha256',raw_message_sha256) ORDER BY id),'[]')
      FROM public.inbound_email_messages WHERE id IN (${storedIds.map(lit).join(',')})`)) : []
    const seenEmails = new Map<string, Row>()
    for (const email of emails) {
      const emailId = email.inboundEmailMessageId
      if (!text(emailId) || !storedIds.includes(emailId) || seenEmails.has(emailId)
        || email.environment !== this.scope.environment || email.mailboxId !== this.scope.mailboxId
        || (email.companyId !== this.scope.companyId && email.companyId !== null)
        || !hash(email.mimeSha256) || !this.injected.has(email.mimeSha256)) fail('stored email is not the exact injected reception')
      seenEmails.set(emailId, email)
    }
    if (storedIds.some(id => !seenEmails.has(id))) fail('stored email receipt missing')
    const next = new Map<string, E02SourceReceipt>()
    const technical = new Map<string, E02TechnicalSourceReceipt>()
    for (const row of this.readSources(storedIds, returnedSourceIds)) {
      const receipt = row.companyId === null ? this.technicalSource(row) : this.source(row)
      const prior = this.sourceReceipts.get(receipt.sourceMessageId) ?? this.technicalReceipts.get(receipt.sourceMessageId)
      const email = seenEmails.get(receipt.inboundEmailMessageId)
      if (email && (row.emailCompanyId !== email.companyId || row.mimeSha256 !== email.mimeSha256)) fail('source does not bind the current received email')
      if (next.has(receipt.sourceMessageId) || technical.has(receipt.sourceMessageId)) fail('duplicate source receipt')
      if (prior ? !equal(row, prior) : !seenEmails.has(receipt.inboundEmailMessageId)) fail('unknown old source or changed known source')
      if (!seenEmails.has(receipt.inboundEmailMessageId) && !returnedSourceIds.includes(receipt.sourceMessageId)) fail('unrequested source receipt')
      if (receipt.companyId === null) technical.set(receipt.sourceMessageId, receipt as E02TechnicalSourceReceipt)
      else next.set(receipt.sourceMessageId, receipt as E02SourceReceipt)
    }
    if (returnedSourceIds.some(id => !next.has(id) && !technical.has(id))) fail('returned source receipt missing')
    for (const [id, receipt] of next) this.sourceReceipts.set(id, receipt)
    for (const [id, receipt] of technical) this.technicalReceipts.set(id, receipt)
    return Object.freeze([...next.keys()])
  }

  assertSources(sourceIds: readonly string[]): void {
    ids(sourceIds)
    if (sourceIds.some(id => !this.sourceReceipts.has(id))) fail('explicit known source receipts required')
    const seen = new Set<string>()
    for (const row of this.readSources([], sourceIds)) {
      const receipt = this.source(row), prior = this.sourceReceipts.get(receipt.sourceMessageId)
      if (!sourceIds.includes(receipt.sourceMessageId) || !prior || seen.has(receipt.sourceMessageId) || !equal(row, prior)) fail('known source binding changed')
      seen.add(receipt.sourceMessageId)
    }
    if (sourceIds.some(id => !seen.has(id))) fail('known source receipt missing')
  }

  private output(row: Row): E02OutboxReceipt {
    const source = this.source(row), known = this.sourceReceipts.get(source.sourceMessageId)
    if (!known || !equal(row, known) || outputKeys.some(key => !text(row[key]))
      || row.sourceCompanyId !== this.scope.companyId || row.sourceEnvironment !== this.scope.environment
      || row.ackCompanyId !== this.scope.companyId || row.ackEnvironment !== this.scope.environment
      || row.ackSourceMessageId !== source.sourceMessageId || row.ackDirection !== 'outbound'
      || !families.has(String(row.ackFamily)) || row.outboxFamily !== row.ackFamily || !hash(row.ackPayloadSha256)
      || !statuses.has(String(row.status))) fail('outbox response binding differs')
    return Object.freeze({ ...source, ...Object.fromEntries(outputKeys.map(key => [key, row[key]])) }) as E02OutboxReceipt
  }

  /** Call once, after the source's own normal processing/ordinary refusal.
   * Unknown processing outcomes never authorize output capture or a worker. */
  captureOutboxes(sourceIds: readonly string[]): readonly E02OutboxReceipt[] {
    this.assertSources(sourceIds)
    if (sourceIds.some(id => this.capturedSources.has(id))) fail('source output capture already completed')
    if (!sourceIds.length) return Object.freeze([])
    const captured = new Map<string, E02OutboxReceipt>()
    for (const row of rows(this.query(`/* t3-e02:outputs */ SELECT coalesce(jsonb_agg(${outputSelection} ORDER BY o.id),'[]') ${outputJoins}
      WHERE o.source_message_id IN (${sourceIds.map(lit).join(',')})`))) {
      const receipt = this.output(row)
      if (!sourceIds.includes(receipt.sourceMessageId) || captured.has(receipt.id) || this.outputReceipts.has(receipt.id)) fail('unexpected or duplicate output receipt')
      captured.set(receipt.id, receipt)
    }
    for (const [id, receipt] of captured) this.outputReceipts.set(id, receipt)
    for (const id of sourceIds) this.capturedSources.add(id)
    return Object.freeze([...captured.values()])
  }

  /** No ownership is learned here. All active rows, including live sending
   * leases, must belong to this exact explicit phase assignment. */
  admit(assignedIds: readonly string[]): { workerNeeded: boolean; assigned: readonly E02OutboxReceipt[] } {
    ids(assignedIds)
    if (assignedIds.some(id => !this.outputReceipts.has(id))) fail('explicit captured outbox receipts required')
    const inventory = rows(this.query(`/* t3-e02:inventory */ SELECT coalesce(jsonb_agg(${outputSelection} ORDER BY o.id),'[]') ${outputJoins}
      WHERE (o.environment=${lit(this.scope.environment)} AND o.status IN ('prepared','queued','sending'))
      ${assignedIds.length ? `OR o.id IN (${assignedIds.map(lit).join(',')})` : ''}`))
    const seen = new Set<string>(), assigned: E02OutboxReceipt[] = []
    let workerNeeded = false
    for (const row of inventory) {
      if (!text(row.id) || !assignedIds.includes(row.id) || seen.has(row.id)) fail('unassigned active outbox row')
      const receipt = this.output(row), prior = this.outputReceipts.get(receipt.id)
      if (!prior || !equal(row, prior)) fail('captured outbox binding changed')
      seen.add(receipt.id); assigned.push(prior)
      if (activeStatuses.has(String(row.status))) workerNeeded = true
    }
    if (assignedIds.some(id => !seen.has(id))) fail('assigned outbox receipt missing')
    return { workerNeeded, assigned: Object.freeze(assigned) }
  }
}
