// lib/ediel/db.ts

import { supabaseService } from '@/lib/supabase/service'
import type {
  AttachEdielMessageToTestRunInput,
  CreateEdielMessageEventInput,
  CreateEdielMessageInput,
  CreateEdielTestRunInput,
  EdielMessageEventRow,
  EdielMessageEventType,
  EdielMessageRow,
  EdielTestRunMessageRow,
  EdielTestRunRow,
  LinkEdielMessageInput,
  UpdateEdielMessageStatusInput,
} from '@/lib/ediel/types'

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return Object.fromEntries(entries) as T
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

export async function createEdielMessage(
  input: CreateEdielMessageInput
): Promise<EdielMessageRow> {
  const payload = cleanObject({
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
  id: string
): Promise<EdielMessageRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}

export async function findEdielMessageByMailboxIdentity(params: {
  mailbox: string
  mailboxMessageId: string
}): Promise<EdielMessageRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('mailbox', params.mailbox)
    .eq('mailbox_message_id', params.mailboxMessageId)
    .maybeSingle()

  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}

export async function listEdielMessages(params?: {
  family?: string
  direction?: 'inbound' | 'outbound'
  status?: string
  limit?: number
}): Promise<EdielMessageRow[]> {
  const limit = params?.limit ?? 50

  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

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
}): Promise<EdielMessageRow[]> {
  const limit = params?.limit ?? 100
  const nowIso = new Date().toISOString()

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('direction', 'inbound')
    .in('message_standard', ['edifact'])
    .lt('ack_due_at', nowIso)
    .or(
      [
        'contrl_status.eq.pending',
        'aperak_status.eq.pending',
        'utilts_err_status.eq.pending',
      ].join(',')
    )
    .order('ack_due_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as EdielMessageRow[]
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

export async function listEdielMessageEvents(
  edielMessageId: string
): Promise<EdielMessageEventRow[]> {
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

export async function listEdielTestRuns(): Promise<EdielTestRunRow[]> {
  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as EdielTestRunRow[]
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

  if (error) throw error
  return data as EdielTestRunMessageRow
}

export async function getEdielRouteProfileByCommunicationRouteId(
  communicationRouteId: string
) {
  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('communication_route_id', communicationRouteId)
    .maybeSingle()

  if (error) throw error
  return data
}