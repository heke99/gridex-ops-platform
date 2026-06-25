// lib/ediel/intent/types.ts
//
// Core model for the mandatory EdielMessageIntent pipeline. Business processes
// (customer operations) create intents only. The RenderGateway is the single
// sanctioned caller of EDIFACT/XML renderers. No customer-operation module may
// render or queue outbound Ediel directly.

export type EdielIntentEnvironment = 'test' | 'production'
export type EdielIntentMarket = 'electricity' | 'gas'

export type EdielIntentMessageFamily =
  | 'PRODAT'
  | 'UTILTS'
  | 'APERAK'
  | 'CONTRL'
  | 'UTILTS_ERR'
  | 'AI_LIST'
  | 'ESETT_XML'

export type EdielIntentBusinessProcess =
  | 'facility_lookup'
  | 'supplier_switch'
  | 'customer_masterdata'
  | 'metering_permission'
  | 'metering_values'
  | 'settlement'
  | 'timeseries_request'
  | 'acknowledgement'
  | 'reconciliation'

export type EdielIntentDirection = 'outbound' | 'inbound_response'

export type EdielIntentValidationStatus = 'draft' | 'blocked' | 'validated'
export type EdielIntentRenderStatus = 'not_rendered' | 'rendered' | 'failed'
export type EdielIntentOutboxStatus = 'not_queued' | 'queued' | 'sent' | 'failed'

export type EdielMessageIntent = {
  id: string
  companyId: string
  environment: EdielIntentEnvironment
  market: EdielIntentMarket

  messageFamily: EdielIntentMessageFamily
  messageCode: string
  businessProcess: EdielIntentBusinessProcess
  direction: EdielIntentDirection

  senderEdielId: string
  senderSubaddress?: string | null
  receiverEdielId: string
  receiverSubaddress?: string | null

  applicationReference: string

  routeProfileId: string
  communicationRouteId?: string | null
  certificateProfileId?: string | null

  customerId?: string | null
  customerSiteId?: string | null
  gridOwnerInformationRequestId?: string | null
  supplierSwitchRequestId?: string | null
  customerInfoRequestId?: string | null
  operationId?: string | null

  facilityId?: string | null
  meteringPointId?: string | null
  gridAreaCode?: string | null

  requestedEffectiveDate?: string | null
  sendNotBefore?: string | null
  sendWindowOpensAt?: string | null
  sendWindowClosesAt?: string | null

  interchangeReference: string
  messageReference: string
  transactionReference?: string | null

  payload: Record<string, unknown>

  expectedRuleVersion?: string | null
  expectedFieldMatrixVersion?: string | null

  idempotencyKey: string

  validationStatus: EdielIntentValidationStatus
  renderStatus: EdielIntentRenderStatus
  outboxStatus: EdielIntentOutboxStatus

  validationResult?: Record<string, unknown>
  blockingReasons?: EdielIntentBlockingReason[]
  edielMessageId?: string | null
  outboundRequestId?: string | null
}

export type EdielIntentBlockingReason = {
  code: string
  message: string
  field?: string | null
  severity?: 'block' | 'warning'
  details?: Record<string, unknown>
}

export type EdielIntentValidationResult = {
  ok: boolean
  status: EdielIntentValidationStatus
  blockingReasons: EdielIntentBlockingReason[]
  checks: Record<string, boolean>
  checkedAt: string
}

// Input accepted by the intent engine. Status/lifecycle fields are managed by the
// engine and gateway, not by callers.
export type CreateEdielMessageIntentInput = {
  companyId: string
  environment: EdielIntentEnvironment
  market?: EdielIntentMarket
  messageFamily: EdielIntentMessageFamily
  messageCode: string
  businessProcess: EdielIntentBusinessProcess
  direction?: EdielIntentDirection

  senderEdielId: string
  senderSubaddress?: string | null
  receiverEdielId: string
  receiverSubaddress?: string | null

  applicationReference: string

  routeProfileId: string
  communicationRouteId?: string | null
  certificateProfileId?: string | null

  customerId?: string | null
  customerSiteId?: string | null
  gridOwnerInformationRequestId?: string | null
  supplierSwitchRequestId?: string | null
  customerInfoRequestId?: string | null
  operationId?: string | null

  facilityId?: string | null
  meteringPointId?: string | null
  gridAreaCode?: string | null

  requestedEffectiveDate?: string | null
  sendNotBefore?: string | null
  sendWindowOpensAt?: string | null
  sendWindowClosesAt?: string | null

  interchangeReference: string
  messageReference: string
  transactionReference?: string | null

  payload?: Record<string, unknown>

  expectedRuleVersion?: string | null
  expectedFieldMatrixVersion?: string | null

  idempotencyKey: string

  actorUserId?: string | null

  // Optional route-declared metadata used only to validate (never override) the
  // Application Reference policy at creation time (PART 6). A mismatch becomes a
  // controlled intent blocker instead of a send-time crash.
  routeProfile?: {
    applicationReference?: string | null
    actorRole?: string | null
    companyRole?: string | null
  } | null
}

// Required intent metadata that ediel_outbox must observe before a message can be
// queued (mirrors PART 3 of the hardening brief).
export const REQUIRED_INTENT_OUTBOX_FIELDS = [
  'intentId',
  'companyId',
  'environment',
  'messageFamily',
  'messageCode',
  'routeProfileId',
  'applicationReference',
] as const
