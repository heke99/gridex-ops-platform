// lib/ediel/types.ts

export type EdielDirection = 'inbound' | 'outbound'

export type EdielMessageFamily =
  | 'PRODAT'
  | 'UTILTS'
  | 'APERAK'
  | 'CONTRL'
  | 'UTILTS_ERR'

export type EdielMessageStatus =
  | 'draft'
  | 'prepared'
  | 'queued'
  | 'sent'
  | 'received'
  | 'parsed'
  | 'validated'
  | 'acknowledged'
  | 'failed'
  | 'cancelled'

export type EdielTransportType =
  | 'email'
  | 'smtp'
  | 'imap'
  | 'manual_upload'
  | 'api'
  | 'sftp'
  | 'unknown'

export type EdielAckStatus =
  | 'not_required'
  | 'pending'
  | 'sent'
  | 'received'
  | 'failed'

export type EdielMessageCode =
  | 'Z01'
  | 'Z02'
  | 'Z03'
  | 'Z04'
  | 'Z05'
  | 'Z06'
  | 'Z09'
  | 'Z10'
  | 'Z13'
  | 'Z14'
  | 'Z15'
  | 'Z18'
  | 'S01'
  | 'S02'
  | 'S03'
  | 'S04'
  | 'E31'
  | 'E66'
  | 'APERAK'
  | 'CONTRL'
  | 'UTILTS_ERR'

export type EdielKnownMessageCode = EdielMessageCode | string

export type EdielMessageRow = {
  id: string
  direction: EdielDirection
  message_family: EdielMessageFamily
  message_code: EdielKnownMessageCode
  message_version: string | null
  status: EdielMessageStatus

  transport_type: EdielTransportType
  mailbox: string | null
  mailbox_message_id: string | null
  sender_ediel_id: string | null
  sender_sub_address: string | null
  receiver_ediel_id: string | null
  receiver_sub_address: string | null
  sender_email: string | null
  receiver_email: string | null
  subject: string | null
  file_name: string | null
  mime_type: string | null

  external_reference: string | null
  correlation_reference: string | null
  transaction_reference: string | null
  application_reference: string | null
  related_message_id: string | null

  communication_route_id: string | null
  outbound_request_id: string | null
  switch_request_id: string | null
  grid_owner_data_request_id: string | null
  partner_export_id: string | null

  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null

  raw_payload: string | null
  parsed_payload: Record<string, unknown>
  validation_report: Record<string, unknown>

  requires_contrl: boolean
  requires_aperak: boolean
  contrl_status: EdielAckStatus | null
  aperak_status: EdielAckStatus | null
  utilts_err_status: EdielAckStatus | null
  failure_reason: string | null

  message_created_at: string | null
  message_received_at: string | null
  message_sent_at: string | null
  parsed_at: string | null
  validated_at: string | null
  acknowledged_at: string | null
  failed_at: string | null

  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type EdielMessageEventType =
  | 'created'
  | 'prepared'
  | 'queued'
  | 'sent'
  | 'received'
  | 'parsed'
  | 'validated'
  | 'linked'
  | 'contrl_sent'
  | 'contrl_received'
  | 'aperak_sent'
  | 'aperak_received'
  | 'utilts_err_sent'
  | 'utilts_err_received'
  | 'failed'
  | 'cancelled'
  | 'manual_note'

export type EdielMessageEventStatus = 'info' | 'success' | 'warning' | 'error'

export type EdielMessageEventRow = {
  id: string
  ediel_message_id: string
  event_type: EdielMessageEventType
  event_status: EdielMessageEventStatus
  message: string | null
  payload: Record<string, unknown>
  created_at: string
  created_by: string | null
}

export type EdielTestRoleCode =
  | 'supplier'
  | 'grid_owner'
  | 'balance_responsible'
  | 'esco'

export type EdielTestSuite = 'PRODAT' | 'UTILTS' | 'NBS_XML' | 'OTHER'

export type EdielTestRunStatus =
  | 'draft'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'

export type EdielTestRunRow = {
  id: string
  approval_version: string | null
  role_code: EdielTestRoleCode
  test_suite: EdielTestSuite
  test_case_code: string
  title: string | null
  status: EdielTestRunStatus

  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  grid_owner_id: string | null

  started_at: string | null
  completed_at: string | null
  failure_reason: string | null
  notes: string | null

  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type EdielTestRunMessageRow = {
  id: string
  test_run_id: string
  ediel_message_id: string
  step_no: number | null
  expected_direction: EdielDirection | null
  expected_family: string | null
  expected_code: string | null
  created_at: string
}

export type EdielRoutePayloadFormat = 'edifact' | 'xml' | 'raw'
export type EdielEncryptionMode = 'none' | 'smime' | 'pgp'

export type EdielRouteProfileRow = {
  id: string
  communication_route_id: string
  is_enabled: boolean
  sender_ediel_id: string | null
  sender_sub_address: string | null
  receiver_ediel_id: string | null
  receiver_sub_address: string | null
  application_reference: string | null
  smtp_host: string | null
  smtp_port: number | null
  imap_host: string | null
  imap_port: number | null
  mailbox: string | null
  encryption_mode: EdielEncryptionMode | null
  payload_format: EdielRoutePayloadFormat
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type CreateEdielMessageInput = {
  actorUserId?: string | null

  direction: EdielDirection
  messageFamily: EdielMessageFamily
  messageCode: EdielKnownMessageCode
  messageVersion?: string | null
  status?: EdielMessageStatus

  transportType?: EdielTransportType
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEdielId?: string | null
  senderSubAddress?: string | null
  receiverEdielId?: string | null
  receiverSubAddress?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  subject?: string | null
  fileName?: string | null
  mimeType?: string | null

  externalReference?: string | null
  correlationReference?: string | null
  transactionReference?: string | null
  applicationReference?: string | null
  relatedMessageId?: string | null

  communicationRouteId?: string | null
  outboundRequestId?: string | null
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null
  partnerExportId?: string | null

  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null

  rawPayload?: string | null
  parsedPayload?: Record<string, unknown>
  validationReport?: Record<string, unknown>

  requiresContrl?: boolean
  requiresAperak?: boolean
  contrlStatus?: EdielAckStatus | null
  aperakStatus?: EdielAckStatus | null
  utiltsErrStatus?: EdielAckStatus | null
  failureReason?: string | null

  messageCreatedAt?: string | null
  messageReceivedAt?: string | null
  messageSentAt?: string | null
  parsedAt?: string | null
  validatedAt?: string | null
  acknowledgedAt?: string | null
  failedAt?: string | null
}

export type CreateEdielMessageEventInput = {
  actorUserId?: string | null
  edielMessageId: string
  eventType: EdielMessageEventType
  eventStatus?: EdielMessageEventStatus
  message?: string | null
  payload?: Record<string, unknown>
}

export type UpsertEdielRouteProfileInput = {
  actorUserId?: string | null
  communicationRouteId: string
  isEnabled: boolean
  senderEdielId?: string | null
  senderSubAddress?: string | null
  receiverEdielId?: string | null
  receiverSubAddress?: string | null
  applicationReference?: string | null
  smtpHost?: string | null
  smtpPort?: number | null
  imapHost?: string | null
  imapPort?: number | null
  mailbox?: string | null
  encryptionMode?: EdielEncryptionMode | null
  payloadFormat?: EdielRoutePayloadFormat
  notes?: string | null
}

export type CreateEdielTestRunInput = {
  actorUserId?: string | null
  approvalVersion?: string | null
  roleCode: EdielTestRoleCode
  testSuite: EdielTestSuite
  testCaseCode: string
  title?: string | null
  status?: EdielTestRunStatus
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  startedAt?: string | null
  completedAt?: string | null
  failureReason?: string | null
  notes?: string | null
}