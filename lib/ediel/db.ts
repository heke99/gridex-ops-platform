// lib/ediel/db.ts
import { supabaseService } from '@/lib/supabase/service'
import type {
  CreateEdielMessageEventInput,
  CreateEdielMessageInput,
  CreateEdielTestRunInput,
  EdielMessageEventRow,
  EdielMessageRow,
  EdielRouteProfileRow,
  EdielTestRunMessageRow,
  EdielTestRunRow,
  UpsertEdielRouteProfileInput,
} from '@/lib/ediel/types'
import {
  buildEdielCorrelationReference,
  buildEdielExternalReference,
  buildEdielTransactionReference,
  deriveEdielAckDefaults,
} from '@/lib/ediel/references'

function normalizeQuery(value?: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

function matchesQuery(
  values: Array<string | null | undefined>,
  query: string
): boolean {
  if (!query) return true

  return values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query)
}

export async function createEdielMessage(
  input: CreateEdielMessageInput
): Promise<EdielMessageRow> {
  const ackDefaults = deriveEdielAckDefaults({
    family: input.messageFamily,
    code: input.messageCode,
  })

  const correlationReference =
    input.correlationReference ??
    buildEdielCorrelationReference({
      prefix: input.messageFamily,
      customerId: input.customerId,
      siteId: input.siteId,
      meteringPointId: input.meteringPointId,
    })

  const transactionReference =
    input.transactionReference ??
    buildEdielTransactionReference({
      family: input.messageFamily,
      code: input.messageCode,
    })

  const externalReference =
    input.externalReference ??
    buildEdielExternalReference({
      family: input.messageFamily,
      code: input.messageCode,
      switchRequestId: input.switchRequestId,
      gridOwnerDataRequestId: input.gridOwnerDataRequestId,
      outboundRequestId: input.outboundRequestId,
    })

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .insert({
      direction: input.direction,
      message_family: input.messageFamily,
      message_code: input.messageCode,
      message_version: input.messageVersion ?? null,
      status: input.status ?? (input.direction === 'inbound' ? 'received' : 'draft'),

      transport_type: input.transportType ?? 'unknown',
      mailbox: input.mailbox ?? null,
      mailbox_message_id: input.mailboxMessageId ?? null,
      sender_ediel_id: input.senderEdielId ?? null,
      sender_sub_address: input.senderSubAddress ?? null,
      receiver_ediel_id: input.receiverEdielId ?? null,
      receiver_sub_address: input.receiverSubAddress ?? null,
      sender_email: input.senderEmail ?? null,
      receiver_email: input.receiverEmail ?? null,
      subject: input.subject ?? null,
      file_name: input.fileName ?? null,
      mime_type: input.mimeType ?? null,

      external_reference: externalReference,
      correlation_reference: correlationReference,
      transaction_reference: transactionReference,
      application_reference: input.applicationReference ?? null,
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
      parsed_payload: input.parsedPayload ?? {},
      validation_report: input.validationReport ?? {},

      requires_contrl: input.requiresContrl ?? ackDefaults.requiresContrl,
      requires_aperak: input.requiresAperak ?? ackDefaults.requiresAperak,
      contrl_status: input.contrlStatus ?? ackDefaults.contrlStatus,
      aperak_status: input.aperakStatus ?? ackDefaults.aperakStatus,
      utilts_err_status: input.utiltsErrStatus ?? ackDefaults.utiltsErrStatus,
      failure_reason: input.failureReason ?? null,

      message_created_at: input.messageCreatedAt ?? null,
      message_received_at: input.messageReceivedAt ?? null,
      message_sent_at: input.messageSentAt ?? null,
      parsed_at: input.parsedAt ?? null,
      validated_at: input.validatedAt ?? null,
      acknowledged_at: input.acknowledgedAt ?? null,
      failed_at: input.failedAt ?? null,

      created_by: input.actorUserId ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error

  const row = data as EdielMessageRow

  await createEdielMessageEvent({
    actorUserId: input.actorUserId ?? null,
    edielMessageId: row.id,
    eventType: 'created',
    eventStatus: 'success',
    message: `Created ${row.message_family} ${row.message_code} (${row.direction})`,
    payload: {
      status: row.status,
      externalReference: row.external_reference,
      transactionReference: row.transaction_reference,
      correlationReference: row.correlation_reference,
    },
  })

  return row
}

export async function createEdielMessageEvent(
  input: CreateEdielMessageEventInput
): Promise<EdielMessageEventRow> {
  const { data, error } = await supabaseService
    .from('ediel_message_events')
    .insert({
      ediel_message_id: input.edielMessageId,
      event_type: input.eventType,
      event_status: input.eventStatus ?? 'info',
      message: input.message ?? null,
      payload: input.payload ?? {},
      created_by: input.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as EdielMessageEventRow
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

export async function listEdielMessages(options: {
  direction?: string | null
  family?: string | null
  code?: string | null
  status?: string | null
  query?: string | null
  limit?: number
} = {}): Promise<EdielMessageRow[]> {
  let queryBuilder = supabaseService
    .from('ediel_messages')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.direction && options.direction !== 'all') {
    queryBuilder = queryBuilder.eq('direction', options.direction)
  }

  if (options.family && options.family !== 'all') {
    queryBuilder = queryBuilder.eq('message_family', options.family)
  }

  if (options.code && options.code !== 'all') {
    queryBuilder = queryBuilder.eq('message_code', options.code)
  }

  if (options.status && options.status !== 'all') {
    queryBuilder = queryBuilder.eq('status', options.status)
  }

  if (options.limit && options.limit > 0) {
    queryBuilder = queryBuilder.limit(options.limit)
  }

  const { data, error } = await queryBuilder
  if (error) throw error

  const rows = (data ?? []) as EdielMessageRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.direction,
        row.message_family,
        row.message_code,
        row.status,
        row.mailbox,
        row.mailbox_message_id,
        row.sender_ediel_id,
        row.receiver_ediel_id,
        row.sender_email,
        row.receiver_email,
        row.external_reference,
        row.correlation_reference,
        row.transaction_reference,
        row.application_reference,
        row.subject,
        row.file_name,
        row.failure_reason,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
      ],
      query
    )
  )
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

export async function updateEdielMessageStatus(input: {
  actorUserId?: string | null
  id: string
  status: EdielMessageRow['status']
  failureReason?: string | null
  parsedPayload?: Record<string, unknown>
  validationReport?: Record<string, unknown>
  responseAperakStatus?: EdielMessageRow['aperak_status']
  responseContrlStatus?: EdielMessageRow['contrl_status']
  utiltsErrStatus?: EdielMessageRow['utilts_err_status']
}): Promise<EdielMessageRow> {
  const current = await getEdielMessageById(input.id)

  if (!current) {
    throw new Error(`Ediel message not found: ${input.id}`)
  }

  const patch: Record<string, unknown> = {
    status: input.status,
    updated_by: input.actorUserId ?? null,
  }

  if (typeof input.failureReason !== 'undefined') {
    patch.failure_reason = input.failureReason
    patch.failed_at = input.status === 'failed' ? new Date().toISOString() : null
  }

  if (typeof input.parsedPayload !== 'undefined') {
    patch.parsed_payload = input.parsedPayload
    patch.parsed_at = new Date().toISOString()
  }

  if (typeof input.validationReport !== 'undefined') {
    patch.validation_report = input.validationReport
    patch.validated_at = new Date().toISOString()
  }

  if (typeof input.responseAperakStatus !== 'undefined') {
    patch.aperak_status = input.responseAperakStatus
  }

  if (typeof input.responseContrlStatus !== 'undefined') {
    patch.contrl_status = input.responseContrlStatus
  }

  if (typeof input.utiltsErrStatus !== 'undefined') {
    patch.utilts_err_status = input.utiltsErrStatus
  }

  if (input.status === 'acknowledged') {
    patch.acknowledged_at = new Date().toISOString()
  }

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .update(patch)
    .eq('id', input.id)
    .select('*')
    .single()

  if (error) throw error

  const row = data as EdielMessageRow

  await createEdielMessageEvent({
    actorUserId: input.actorUserId ?? null,
    edielMessageId: row.id,
    eventType:
      input.status === 'failed'
        ? 'failed'
        : input.status === 'validated'
          ? 'validated'
          : input.status === 'parsed'
            ? 'parsed'
            : input.status === 'acknowledged'
              ? 'linked'
              : 'manual_note',
    eventStatus: input.status === 'failed' ? 'error' : 'success',
    message: `Status changed from ${current.status} to ${row.status}`,
    payload: {
      previousStatus: current.status,
      nextStatus: row.status,
      failureReason: row.failure_reason,
    },
  })

  return row
}

export async function linkEdielMessage(input: {
  actorUserId?: string | null
  edielMessageId: string
  outboundRequestId?: string | null
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  partnerExportId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  communicationRouteId?: string | null
  relatedMessageId?: string | null
}): Promise<EdielMessageRow> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .update({
      outbound_request_id: input.outboundRequestId ?? null,
      switch_request_id: input.switchRequestId ?? null,
      grid_owner_data_request_id: input.gridOwnerDataRequestId ?? null,
      partner_export_id: input.partnerExportId ?? null,
      customer_id: input.customerId ?? null,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      communication_route_id: input.communicationRouteId ?? null,
      related_message_id: input.relatedMessageId ?? null,
      updated_by: input.actorUserId ?? null,
    })
    .eq('id', input.edielMessageId)
    .select('*')
    .single()

  if (error) throw error

  const row = data as EdielMessageRow

  await createEdielMessageEvent({
    actorUserId: input.actorUserId ?? null,
    edielMessageId: row.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: 'Linked Ediel message to platform entities',
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
    },
  })

  return row
}

export async function findEdielMessageByMailboxIdentity(input: {
  mailbox: string
  mailboxMessageId: string
}): Promise<EdielMessageRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('mailbox', input.mailbox)
    .eq('mailbox_message_id', input.mailboxMessageId)
    .maybeSingle()

  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}

export async function getEdielRouteProfileByCommunicationRouteId(
  communicationRouteId: string
): Promise<EdielRouteProfileRow | null> {
  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .select('*')
    .eq('communication_route_id', communicationRouteId)
    .maybeSingle()

  if (error) throw error
  return (data as EdielRouteProfileRow | null) ?? null
}

export async function upsertEdielRouteProfile(
  input: UpsertEdielRouteProfileInput
): Promise<EdielRouteProfileRow> {
  const existing = await getEdielRouteProfileByCommunicationRouteId(
    input.communicationRouteId
  )

  const payload = {
    communication_route_id: input.communicationRouteId,
    is_enabled: input.isEnabled,
    sender_ediel_id: input.senderEdielId ?? null,
    sender_sub_address: input.senderSubAddress ?? null,
    receiver_ediel_id: input.receiverEdielId ?? null,
    receiver_sub_address: input.receiverSubAddress ?? null,
    application_reference: input.applicationReference ?? null,
    smtp_host: input.smtpHost ?? null,
    smtp_port: input.smtpPort ?? null,
    imap_host: input.imapHost ?? null,
    imap_port: input.imapPort ?? null,
    mailbox: input.mailbox ?? null,
    encryption_mode: input.encryptionMode ?? null,
    payload_format: input.payloadFormat ?? 'edifact',
    notes: input.notes ?? null,
    updated_by: input.actorUserId ?? null,
  }

  if (existing) {
    const { data, error } = await supabaseService
      .from('ediel_route_profiles')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single()

    if (error) throw error
    return data as EdielRouteProfileRow
  }

  const { data, error } = await supabaseService
    .from('ediel_route_profiles')
    .insert({
      ...payload,
      created_by: input.actorUserId ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as EdielRouteProfileRow
}

export async function createEdielTestRun(
  input: CreateEdielTestRunInput
): Promise<EdielTestRunRow> {
  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .insert({
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
    .select('*')
    .single()

  if (error) throw error
  return data as EdielTestRunRow
}

export async function listEdielTestRuns(options: {
  status?: string | null
  suite?: string | null
  roleCode?: string | null
  query?: string | null
} = {}): Promise<EdielTestRunRow[]> {
  let queryBuilder = supabaseService
    .from('ediel_test_runs')
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status && options.status !== 'all') {
    queryBuilder = queryBuilder.eq('status', options.status)
  }

  if (options.suite && options.suite !== 'all') {
    queryBuilder = queryBuilder.eq('test_suite', options.suite)
  }

  if (options.roleCode && options.roleCode !== 'all') {
    queryBuilder = queryBuilder.eq('role_code', options.roleCode)
  }

  const { data, error } = await queryBuilder
  if (error) throw error

  const rows = (data ?? []) as EdielTestRunRow[]
  const query = normalizeQuery(options.query)

  return rows.filter((row) =>
    matchesQuery(
      [
        row.id,
        row.approval_version,
        row.role_code,
        row.test_suite,
        row.test_case_code,
        row.title,
        row.status,
        row.failure_reason,
        row.notes,
        row.customer_id,
        row.site_id,
        row.metering_point_id,
        row.grid_owner_id,
      ],
      query
    )
  )
}

export async function attachEdielMessageToTestRun(input: {
  testRunId: string
  edielMessageId: string
  stepNo?: number | null
  expectedDirection?: 'inbound' | 'outbound' | null
  expectedFamily?: string | null
  expectedCode?: string | null
}): Promise<EdielTestRunMessageRow> {
  const { data, error } = await supabaseService
    .from('ediel_test_run_messages')
    .insert({
      test_run_id: input.testRunId,
      ediel_message_id: input.edielMessageId,
      step_no: input.stepNo ?? null,
      expected_direction: input.expectedDirection ?? null,
      expected_family: input.expectedFamily ?? null,
      expected_code: input.expectedCode ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as EdielTestRunMessageRow
}