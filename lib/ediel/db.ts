// lib/ediel/db.ts

import { supabaseService } from '@/lib/supabase/service'
import { assertNoTgtLeakageInProductionInput } from '@/lib/ediel/core/productionGuards'
import type {
  AttachEdielMessageToTestRunInput,
  CreateEdielMessageEventInput,
  CreateEdielMessageInput,
  CreateEdielTestRunInput,
  EdielMessageAckStateRow,
  EdielMessageEventRow,
  EdielMessageEventType,
  EdielMessageRow,
  EdielRouteProfileRow,
  EdielTestRunMessageRow,
  EdielTestRunRow,
  LinkEdielMessageInput,
  UpdateEdielMessageStatusInput,
  UpdateEdielTestRunStatusInput,
} from '@/lib/ediel/types'

export type DuplicateAckCandidateRow = {
  related_message_id: string
  message_family: string
  duplicate_count: number
  message_ids: string[]
}

export type RuleAmbiguityRow = {
  message_family: string
  message_code: string
  message_standard: string
  direction: string
  active_rule_count: number
  version_codes: string[]
}

export type CanonicalDuplicateBlockLayer =
  | 'canonical_inbound'
  | 'canonical_outbound'
  | 'canonical_ack'

export type CanonicalDuplicateBlockInput = {
  actorUserId?: string | null
  edielMessageId: string
  layer: CanonicalDuplicateBlockLayer
  message: string
  payload?: Record<string, unknown>
}

export type CanonicalAckConflictInput = {
  actorUserId?: string | null
  edielMessageId: string
  ackFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  sourceMessageId: string
  attemptedOutcome?: 'positive' | 'negative' | null
  existingAckMessageId?: string | null
  existingOutcome?: 'positive' | 'negative' | null
  reason:
    | 'duplicate_same_outcome'
    | 'conflicting_outcome'
    | 'duplicate_same_family'
  payload?: Record<string, unknown>
}

export type CanonicalIssueKind =
  | 'duplicate_block'
  | 'ack_conflict'
  | 'version_mismatch'
  | 'invalid_code_usage'

export type CanonicalIssueEventRow = EdielMessageEventRow & {
  issue_kind: CanonicalIssueKind
  dedupe_layer: CanonicalDuplicateBlockLayer | null
  ack_family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | null
  source_message_id: string | null
  existing_ack_message_id: string | null
  attempted_outcome: 'positive' | 'negative' | null
  existing_outcome: 'positive' | 'negative' | null
  reason: string | null
}

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return Object.fromEntries(entries) as T
}

function applyCompanyScope<T>(query: T, companyId?: string | null): T {
  const normalized = typeof companyId === 'string' && companyId.trim().length > 0 ? companyId.trim() : null
  if (!normalized) return query
  return (query as unknown as { eq: (column: string, value: string) => T }).eq('company_id', normalized)
}

function ensureJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function mapStatusToEventType(status: string): EdielMessageEventType {
  if (status === 'queued') return 'queued'
  if (status === 'prepared') return 'prepared'
  if (status === 'sent') return 'sent'
  if (status === 'received') return 'received'
  if (status === 'parsed') return 'parsed'
  if (status === 'validated') return 'validated'
  if (status === 'acknowledged') return 'linked'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return 'manual_note'
}

function mapStatusToEventStatus(status: string): 'info' | 'success' | 'warning' | 'error' {
  if (status === 'failed') return 'error'
  if (status === 'cancelled') return 'warning'
  return 'success'
}

function inferAckOutcome(row: EdielMessageRow): 'positive' | 'negative' | null {
  if (row.ack_outcome === 'positive' || row.ack_outcome === 'negative') {
    return row.ack_outcome
  }

  const parsedPayload = row.parsed_payload ?? {}
  const payloadOutcome =
    parsedPayload.ackOutcome === 'positive' || parsedPayload.ackOutcome === 'negative'
      ? payloadOutcomeOrNull(parsedPayload.ackOutcome)
      : null

  if (payloadOutcome) return payloadOutcome

  if (row.message_family === 'CONTRL') {
    if (row.syntax_check_status === 'ok' || row.syntax_check_status === 'warning') return 'positive'
    if (row.syntax_check_status === 'failed') {
      return 'negative'
    }
    return null
  }

  if (row.message_family === 'APERAK' || row.message_family === 'UTILTS_ERR') {
    if (row.functional_check_status === 'ok' || row.functional_check_status === 'warning') return 'positive'
    if (
      row.functional_check_status === 'failed'
    ) {
      return 'negative'
    }
  }

  return null
}

function payloadOutcomeOrNull(
  value: unknown
): 'positive' | 'negative' | null {
  return value === 'positive' || value === 'negative' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function hasVersionMismatch(row: EdielMessageRow): boolean {
  const payload = row.parsed_payload ?? {}
  const report = row.validation_report ?? {}

  if (asBoolean(report.versionMismatch)) return true
  if (asBoolean(report.invalidVersion)) return true
  if (Array.isArray(report.versionErrors) && report.versionErrors.length > 0) return true
  if (Array.isArray(report.acceptedVersions) && row.message_version) {
    const acceptedVersions = report.acceptedVersions.filter(
      (item): item is string => typeof item === "string"
    )
    if (acceptedVersions.length > 0 && !acceptedVersions.includes(row.message_version)) {
      return true
    }
  }

  if (asBoolean(payload.versionMismatch)) return true
  if (Array.isArray(payload.versionErrors) && payload.versionErrors.length > 0) return true

  return false
}

function hasInvalidCodeUsage(row: EdielMessageRow): boolean {
  const payload = row.parsed_payload ?? {}
  const report = row.validation_report ?? {}

  if (asBoolean(report.invalidCodeUsage)) return true
  if (asBoolean(report.codeListViolation)) return true
  if (asBoolean(report.invalidCodeListUsage)) return true
  if (Array.isArray(report.codeListErrors) && report.codeListErrors.length > 0) return true
  if (Array.isArray(report.invalidCodes) && report.invalidCodes.length > 0) return true

  if (asBoolean(payload.invalidCodeUsage)) return true
  if (Array.isArray(payload.codeListErrors) && payload.codeListErrors.length > 0) return true
  if (Array.isArray(payload.invalidCodes) && payload.invalidCodes.length > 0) return true

  return false
}

function mapCanonicalIssueEvent(row: EdielMessageEventRow): CanonicalIssueEventRow | null {
  const payload = ensureJson(row.payload)

  const duplicateBlocked = asBoolean(payload.duplicateBlocked)
  const ackConflict = asBoolean(payload.ackConflict)
  const versionMismatch = asBoolean(payload.versionMismatch)
  const invalidCodeUsage =
    asBoolean(payload.invalidCodeUsage) ||
    asBoolean(payload.codeListViolation) ||
    asBoolean(payload.invalidCodeListUsage)

  let issueKind: CanonicalIssueKind | null = null

    if (ackConflict) {
    issueKind = 'ack_conflict'
  } else if (duplicateBlocked) {
    issueKind = 'duplicate_block'
  } else if (versionMismatch) {
    issueKind = 'version_mismatch'
  } else if (invalidCodeUsage) {
    issueKind = 'invalid_code_usage'
  }

  if (!issueKind) return null

  const dedupeLayerRaw = payload.dedupeLayer
  const dedupeLayer: CanonicalDuplicateBlockLayer | null =
    dedupeLayerRaw === 'canonical_inbound' ||
    dedupeLayerRaw === 'canonical_outbound' ||
    dedupeLayerRaw === 'canonical_ack'
      ? dedupeLayerRaw
      : null

  const ackFamilyRaw = payload.ackFamily
  const ackFamily =
    ackFamilyRaw === 'CONTRL' || ackFamilyRaw === 'APERAK' || ackFamilyRaw === 'UTILTS_ERR'
      ? ackFamilyRaw
      : null

  return {
    ...row,
    issue_kind: issueKind,
    dedupe_layer: dedupeLayer,
    ack_family: ackFamily,
    source_message_id: asString(payload.sourceMessageId),
    existing_ack_message_id: asString(payload.existingAckMessageId),
    attempted_outcome: payloadOutcomeOrNull(payload.attemptedOutcome),
    existing_outcome: payloadOutcomeOrNull(payload.existingOutcome),
    reason: asString(payload.reason),
  }
}

async function listRecentManualIssueEvents(limit = 200): Promise<CanonicalIssueEventRow[]> {
  const { data, error } = await supabaseService
    .from('ediel_message_events')
    .select('*')
    .eq('event_type', 'manual_note')
    .in('event_status', ['warning', 'error'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = (data ?? []) as EdielMessageEventRow[]
  return rows
    .map(mapCanonicalIssueEvent)
    .filter((row): row is CanonicalIssueEventRow => row !== null)
}

export async function createEdielMessage(
  input: CreateEdielMessageInput
): Promise<EdielMessageRow> {
  assertNoTgtLeakageInProductionInput(input)

  const payload = cleanObject({
    company_id: input.companyId ?? null,
    direction: input.direction,
    message_standard: input.messageStandard,
    message_family: input.messageFamily,
    message_code: input.messageCode,
    message_version: input.messageVersion ?? null,
    process_type: input.processType ?? null,
    environment: input.environment ?? 'test',
    test_flag: input.testFlag ?? 1,
    status: input.status ?? 'draft',

    transport_type: input.transportType ?? 'smtp',
    mailbox: input.mailbox ?? null,
    mailbox_message_id: input.mailboxMessageId ?? null,
    sender_ediel_id: input.senderEdielId ?? null,
    sender_name: input.senderName ?? null,
    sender_sub_address: input.senderSubAddress ?? null,
    receiver_ediel_id: input.receiverEdielId ?? null,
    receiver_name: input.receiverName ?? null,
    receiver_sub_address: input.receiverSubAddress ?? null,
    sender_email: input.senderEmail ?? null,
    receiver_email: input.receiverEmail ?? null,
    subject: input.subject ?? null,
    file_name: input.fileName ?? null,
    mime_type: input.mimeType ?? null,

    interchange_reference: input.interchangeReference ?? null,
    external_reference: input.externalReference ?? null,
    correlation_reference: input.correlationReference ?? null,
    transaction_reference: input.transactionReference ?? null,
    application_reference: input.applicationReference ?? null,
    original_message_id: input.originalMessageId ?? null,
    original_transaction_id: input.originalTransactionId ?? null,
    original_message_code: input.originalMessageCode ?? null,
    related_message_id: input.relatedMessageId ?? null,

    communication_route_id: input.communicationRouteId ?? null,
    outbound_request_id: input.outboundRequestId ?? null,
    switch_request_id: input.switchRequestId ?? null,
    grid_owner_data_request_id: input.gridOwnerDataRequestId ?? null,
    partner_export_id: input.partnerExportId ?? null,

    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_owner_id: input.gridOwnerId ?? null,

    raw_payload: input.rawPayload ?? null,
    parsed_payload: ensureJson(input.parsedPayload),
    validation_report: ensureJson(input.validationReport),

    requires_contrl: input.requiresContrl ?? true,
    requires_aperak: input.requiresAperak ?? false,
    contrl_status: input.contrlStatus ?? null,
    aperak_status: input.aperakStatus ?? null,
    utilts_err_status: input.utiltsErrStatus ?? null,
    ack_outcome: input.ackOutcome ?? null,
    syntax_check_status: input.syntaxCheckStatus ?? null,
    functional_check_status: input.functionalCheckStatus ?? null,
    failure_reason: input.failureReason ?? null,

    message_created_at: input.messageCreatedAt ?? null,
    message_received_at: input.messageReceivedAt ?? null,
    message_sent_at: input.messageSentAt ?? null,
    parsed_at: input.parsedAt ?? null,
    validated_at: input.validatedAt ?? null,
    acknowledged_at: input.acknowledgedAt ?? null,
    failed_at: input.failedAt ?? null,
    ack_due_at: input.ackDueAt ?? null,

    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  })

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error

  const row = data as EdielMessageRow

  await createEdielMessageEvent({
    actorUserId: input.actorUserId ?? null,
    edielMessageId: row.id,
    eventType: 'created',
    eventStatus: 'info',
    message: `Ediel message ${row.message_family} ${row.message_code} skapad.`,
    payload: {
      status: row.status,
      direction: row.direction,
      externalReference: row.external_reference,
      communicationRouteId: row.communication_route_id,
    },
  })

  return row
}

export async function getEdielMessageById(
  id: string,
  options?: { companyId?: string | null }
): Promise<EdielMessageRow | null> {
  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('id', id)

  query = applyCompanyScope(query, options?.companyId)

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}


export async function findSequencedAckForSource(params: {
  sourceMessageId: string
  ackFamily: 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative' | null
  sequenceField: 'relatedTransactionReference' | 'utiltsErrSequenceToken' | 'aperakSequenceToken'
  sequenceValue: string
}): Promise<EdielMessageRow | null> {
  const sequenceValue = params.sequenceValue.trim()
  if (!sequenceValue) return null

  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('direction', 'outbound')
    .eq('related_message_id', params.sourceMessageId)
    .eq('message_family', params.ackFamily)
    .eq(`parsed_payload->>${params.sequenceField}`, sequenceValue)
    .not('status', 'in', '(cancelled,failed)')
    .order('created_at', { ascending: false })
    .limit(1)

  if (params.outcome) {
    query = query.eq('ack_outcome', params.outcome)
  }

  const { data, error } = await query
  if (error) throw error

  return ((data ?? [])[0] as EdielMessageRow | undefined) ?? null
}

export async function listAckMessagesForSource(params: {
  sourceMessageId: string
  ackFamily?: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  outcome?: 'positive' | 'negative'
  companyId?: string | null
}): Promise<EdielMessageRow[]> {
  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('related_message_id', params.sourceMessageId)
    .in('message_family', ['CONTRL', 'APERAK', 'UTILTS_ERR'])

  query = applyCompanyScope(query, params.companyId)

  if (params.ackFamily) {
    query = query.eq('message_family', params.ackFamily)
  }

  if (params.outcome) {
    query = query.eq('ack_outcome', params.outcome)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as EdielMessageRow[]
  if (!params.outcome) return rows

  return rows.filter((row) => inferAckOutcome(row) === params.outcome)
}

export async function getEdielMessageAckStateById(
  id: string,
  companyId?: string | null
): Promise<EdielMessageAckStateRow | null> {
  let query = supabaseService
    .from('ediel_message_ack_state_v')
    .select('*')
    .eq('id', id)

  query = applyCompanyScope(query, companyId)

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as EdielMessageAckStateRow | null) ?? null
}

export async function findEdielMessageByMailboxIdentity(params: {
  mailbox: string
  mailboxMessageId: string
  companyId?: string | null
}): Promise<EdielMessageRow | null> {
  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('mailbox', params.mailbox)
    .eq('mailbox_message_id', params.mailboxMessageId)

  query = applyCompanyScope(query, params.companyId)

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}

export async function listEdielMessages(params?: {
  family?: string
  direction?: 'inbound' | 'outbound'
  status?: string
  companyId?: string | null
  limit?: number
}): Promise<EdielMessageRow[]> {
  const limit = params?.limit ?? 50

  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  query = applyCompanyScope(query, params?.companyId)

  if (params?.family) {
    query = query.eq('message_family', params.family)
  }

  if (params?.direction) {
    query = query.eq('direction', params.direction)
  }

  if (params?.status) {
    query = query.eq('status', params.status)
  }

  const { data, error } = await query

  if (error) throw error
  return (data ?? []) as EdielMessageRow[]
}

export async function listOverdueAckMessages(params?: {
  limit?: number
  companyId?: string | null
}): Promise<EdielMessageAckStateRow[]> {
  const limit = params?.limit ?? 100

  let query = supabaseService
    .from('ediel_overdue_message_acks_v')
    .select('*')
    .order('ack_due_at', { ascending: true })
    .limit(limit)

  query = applyCompanyScope(query, params?.companyId)

  const { data, error } = await query

  if (error) throw error
  return (data ?? []) as EdielMessageAckStateRow[]
}

export async function listDuplicateAckCandidates(): Promise<DuplicateAckCandidateRow[]> {
  const { data, error } = await supabaseService
    .from('ediel_duplicate_ack_candidates_v')
    .select('*')

  if (error) throw error
  return (data ?? []) as DuplicateAckCandidateRow[]
}

export async function listRuleAmbiguities(): Promise<RuleAmbiguityRow[]> {
  const { data, error } = await supabaseService
    .from('ediel_rule_ambiguities_v')
    .select('*')

  if (error) throw error
  return (data ?? []) as RuleAmbiguityRow[]
}

export async function createEdielMessageEvent(
  input: CreateEdielMessageEventInput
): Promise<EdielMessageEventRow> {
  const payload = cleanObject({
    ediel_message_id: input.edielMessageId,
    event_type: input.eventType,
    event_status: input.eventStatus ?? 'info',
    message: input.message ?? null,
    payload: ensureJson(input.payload),
    created_by: input.actorUserId ?? null,
  })

  const { data, error } = await supabaseService
    .from('ediel_message_events')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return data as EdielMessageEventRow
}

export async function createCanonicalDuplicateBlockEvent(
  input: CanonicalDuplicateBlockInput
): Promise<EdielMessageEventRow> {
  return createEdielMessageEvent({
    actorUserId: input.actorUserId ?? 'system',
    edielMessageId: input.edielMessageId,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message: input.message,
    payload: {
      dedupeLayer: input.layer,
      duplicateBlocked: true,
      ...(input.payload ?? {}),
    },
  })
}

export async function createCanonicalAckConflictEvent(
  input: CanonicalAckConflictInput
): Promise<EdielMessageEventRow> {
  return createEdielMessageEvent({
    actorUserId: input.actorUserId ?? 'system',
    edielMessageId: input.edielMessageId,
    eventType: 'manual_note',
    eventStatus: 'warning',
    message:
      input.reason === 'conflicting_outcome'
        ? `Ack-konflikt blockerad för ${input.ackFamily}.`
        : `Ack-dublett blockerad för ${input.ackFamily}.`,
    payload: {
      dedupeLayer: 'canonical_ack',
      duplicateBlocked: true,
      ackConflict: true,
      ackFamily: input.ackFamily,
      sourceMessageId: input.sourceMessageId,
      attemptedOutcome: input.attemptedOutcome ?? null,
      existingAckMessageId: input.existingAckMessageId ?? null,
      existingOutcome: input.existingOutcome ?? null,
      reason: input.reason,
      ...(input.payload ?? {}),
    },
  })
}

export async function listCanonicalDuplicateBlockEvents(params?: {
  limit?: number
  layer?: CanonicalDuplicateBlockLayer
}): Promise<CanonicalIssueEventRow[]> {
  const rows = await listRecentManualIssueEvents(Math.max(params?.limit ?? 100, 50))

  return rows
    .filter(
      (row) =>
        row.issue_kind === 'duplicate_block' &&
        (!params?.layer || row.dedupe_layer === params.layer)
    )
    .slice(0, params?.limit ?? 100)
}

export async function listCanonicalAckConflictEvents(params?: {
  limit?: number
  ackFamily?: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
}): Promise<CanonicalIssueEventRow[]> {
  const rows = await listRecentManualIssueEvents(Math.max(params?.limit ?? 100, 50))

  return rows
    .filter(
      (row) =>
        row.issue_kind === 'ack_conflict' &&
        (!params?.ackFamily || row.ack_family === params.ackFamily)
    )
    .slice(0, params?.limit ?? 100)
}

export async function listRecentVersionMismatchMessages(params?: {
  limit?: number
  companyId?: string | null
}): Promise<EdielMessageRow[]> {
  const recentMessages = await listEdielMessages({
    limit: Math.max(params?.limit ?? 50, 150),
    companyId: params?.companyId ?? null,
  })

  return recentMessages.filter(hasVersionMismatch).slice(0, params?.limit ?? 50)
}

export async function listRecentInvalidCodeUsageMessages(params?: {
  limit?: number
  companyId?: string | null
}): Promise<EdielMessageRow[]> {
  const recentMessages = await listEdielMessages({
    limit: Math.max(params?.limit ?? 50, 150),
    companyId: params?.companyId ?? null,
  })

  return recentMessages.filter(hasInvalidCodeUsage).slice(0, params?.limit ?? 50)
}

export async function listEdielMessageEvents(
  edielMessageId: string,
  companyId?: string | null
): Promise<EdielMessageEventRow[]> {
  if (companyId) {
    const parent = await getEdielMessageById(edielMessageId, { companyId })
    if (!parent) return []
  }

  const { data, error } = await supabaseService
    .from('ediel_message_events')
    .select('*')
    .eq('ediel_message_id', edielMessageId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as EdielMessageEventRow[]
}

export async function updateEdielMessageStatus(
  input: UpdateEdielMessageStatusInput & {
    id?: string
    parsedPayload?: Record<string, unknown>
    validationReport?: Record<string, unknown>
  }
): Promise<EdielMessageRow> {
  const edielMessageId = input.edielMessageId ?? input.id
  if (!edielMessageId) {
    throw new Error('updateEdielMessageStatus requires edielMessageId or id')
  }

  const patch = cleanObject({
    status: input.status,
    failure_reason: input.failureReason ?? undefined,
    parsed_at: input.parsedAt ?? undefined,
    validated_at: input.validatedAt ?? undefined,
    acknowledged_at: input.acknowledgedAt ?? undefined,
    failed_at: input.failedAt ?? undefined,
    message_sent_at: input.messageSentAt ?? undefined,
    message_received_at: input.messageReceivedAt ?? undefined,
    parsed_payload:
      input.parsedPayload !== undefined ? ensureJson(input.parsedPayload) : undefined,
    validation_report:
      input.validationReport !== undefined
        ? ensureJson(input.validationReport)
        : undefined,
    updated_by: input.actorUserId ?? null,
    updated_at: new Date().toISOString(),
  })

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .update(patch)
    .eq('id', edielMessageId)
    .select('*')
    .single()

  if (error) throw error

  const row = data as EdielMessageRow

  await createEdielMessageEvent({
    actorUserId: input.actorUserId ?? null,
    edielMessageId,
    eventType: mapStatusToEventType(input.status),
    eventStatus: mapStatusToEventStatus(input.status),
    message: `Status uppdaterad till ${input.status}.`,
    payload: {
      failureReason: input.failureReason ?? null,
    },
  })

  return row
}

export async function linkEdielMessage(
  input: LinkEdielMessageInput & {
    communicationRouteId?: string | null
  }
): Promise<EdielMessageRow> {
  const patch = cleanObject({
    outbound_request_id: input.outboundRequestId ?? undefined,
    switch_request_id: input.switchRequestId ?? undefined,
    grid_owner_data_request_id: input.gridOwnerDataRequestId ?? undefined,
    partner_export_id: input.partnerExportId ?? undefined,
    customer_id: input.customerId ?? undefined,
    site_id: input.siteId ?? undefined,
    metering_point_id: input.meteringPointId ?? undefined,
    grid_owner_id: input.gridOwnerId ?? undefined,
    related_message_id: input.relatedMessageId ?? undefined,
    communication_route_id: input.communicationRouteId ?? undefined,
    updated_by: input.actorUserId ?? null,
    updated_at: new Date().toISOString(),
  })

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .update(patch)
    .eq('id', input.edielMessageId)
    .select('*')
    .single()

  if (error) throw error

  const row = data as EdielMessageRow

  await createEdielMessageEvent({
    actorUserId: input.actorUserId ?? null,
    edielMessageId: input.edielMessageId,
    eventType: 'linked',
    eventStatus: 'success',
    message: 'Ediel message länkat till processobjekt.',
    payload: {
      outboundRequestId: input.outboundRequestId ?? null,
      switchRequestId: input.switchRequestId ?? null,
      gridOwnerDataRequestId: input.gridOwnerDataRequestId ?? null,
      partnerExportId: input.partnerExportId ?? null,
      customerId: input.customerId ?? null,
      siteId: input.siteId ?? null,
      meteringPointId: input.meteringPointId ?? null,
      gridOwnerId: input.gridOwnerId ?? null,
      relatedMessageId: input.relatedMessageId ?? null,
      communicationRouteId: input.communicationRouteId ?? null,
    },
  })

  return row
}

export async function createEdielTestRun(
  input: CreateEdielTestRunInput
): Promise<EdielTestRunRow> {
  const payload = cleanObject({
    company_id: input.companyId ?? null,
    approval_version: input.approvalVersion ?? null,
    role_code: input.roleCode,
    test_suite: input.testSuite,
    test_case_code: input.testCaseCode,
    title: input.title ?? null,
    status: input.status ?? 'draft',
    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_owner_id: input.gridOwnerId ?? null,
    started_at: input.startedAt ?? null,
    completed_at: input.completedAt ?? null,
    failure_reason: input.failureReason ?? null,
    notes: input.notes ?? null,
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  })

  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return data as EdielTestRunRow
}

export async function listEdielTestRuns(options?: { companyId?: string | null }): Promise<EdielTestRunRow[]> {
  let query = supabaseService
    .from('ediel_test_runs')
    .select('*')

  query = applyCompanyScope(query, options?.companyId)

  const { data, error } = await query
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as EdielTestRunRow[]
}


export async function listEdielTestRunMessages(params: {
  testRunId: string
}): Promise<EdielTestRunMessageRow[]> {
  const { data, error } = await supabaseService
    .from('ediel_test_run_messages')
    .select('*')
    .eq('test_run_id', params.testRunId)
    .order('step_no', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as EdielTestRunMessageRow[]
}

export async function listEdielMessagesByIds(
  ids: string[],
  options?: { companyId?: string | null }
): Promise<EdielMessageRow[]> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => id && id.trim().length > 0)))
  if (uniqueIds.length === 0) return []

  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .in('id', uniqueIds)

  query = applyCompanyScope(query, options?.companyId)

  const { data, error } = await query

  if (error) throw error

  const rows = (data ?? []) as EdielMessageRow[]
  const order = new Map(uniqueIds.map((id, index) => [id, index]))
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}


export async function updateEdielTestRunNotes(input: {
  actorUserId: string
  testRunId: string
  notes: string | null
}): Promise<EdielTestRunRow> {
  const payload = cleanObject({
    notes: input.notes ?? null,
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  })

  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .update(payload)
    .eq('id', input.testRunId)
    .select('*')
    .single()

  if (error) throw error
  return data as EdielTestRunRow
}

export async function updateEdielTestRunStatus(
  input: UpdateEdielTestRunStatusInput
): Promise<EdielTestRunRow> {
  const payload = cleanObject({
    status: input.status,
    failure_reason: input.failureReason ?? null,
    completed_at: input.completedAt ?? (input.status === 'passed' || input.status === 'failed' || input.status === 'cancelled' ? new Date().toISOString() : null),
    updated_by: input.actorUserId,
    updated_at: new Date().toISOString(),
  })

  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .update(payload)
    .eq('id', input.testRunId)
    .select('*')
    .single()

  if (error) throw error
  return data as EdielTestRunRow
}

export async function attachEdielMessageToTestRun(
  input: AttachEdielMessageToTestRunInput
): Promise<EdielTestRunMessageRow> {
  const payload = cleanObject({
    test_run_id: input.testRunId,
    ediel_message_id: input.edielMessageId,
    step_no: input.stepNo ?? null,
    expected_direction: input.expectedDirection ?? null,
    expected_family: input.expectedFamily ?? null,
    expected_code: input.expectedCode ?? null,
  })

  const { data, error } = await supabaseService
    .from('ediel_test_run_messages')
    .insert(payload)
    .select('*')
    .single()

  if (!error) return data as EdielTestRunMessageRow

  // Idempotent TGT-koppling: samma steg/meddelande ska inte krascha UI med 23505.
  if (error.code === '23505') {
    let exactQuery = supabaseService
      .from('ediel_test_run_messages')
      .select('*')
      .eq('test_run_id', input.testRunId)
      .eq('ediel_message_id', input.edielMessageId)

    if (input.stepNo !== undefined && input.stepNo !== null) {
      exactQuery = exactQuery.eq('step_no', input.stepNo)
    }

    const exact = await exactQuery.order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (exact.error) throw exact.error
    if (exact.data) return exact.data as EdielTestRunMessageRow

    if (input.stepNo !== undefined && input.stepNo !== null) {
      const byStep = await supabaseService
        .from('ediel_test_run_messages')
        .select('*')
        .eq('test_run_id', input.testRunId)
        .eq('step_no', input.stepNo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (byStep.error) throw byStep.error
      if (byStep.data) return byStep.data as EdielTestRunMessageRow
    }
  }

  throw error
}


export async function getEdielRouteProfileByCommunicationRouteId(
  communicationRouteId: string,
  options?: { companyId?: string | null }
): Promise<EdielRouteProfileRow | null> {
  let query = supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('communication_route_id', communicationRouteId)

  query = applyCompanyScope(query, options?.companyId)

  const { data, error } = await query.maybeSingle()

  if (error) throw error
  return (data as EdielRouteProfileRow | null) ?? null
}