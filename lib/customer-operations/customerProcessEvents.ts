import { emitCustomerOperationEvent, type CustomerOperationEventSeverity, type CustomerOperationEventStatus } from '@/lib/customers/customerOperationEvents'

type JsonRecord = Record<string, unknown>

export type CustomerProcessEventCode =
  | 'facility_lookup.created'
  | 'facility_lookup.manual_sent'
  | 'facility_lookup.completed'
  | 'facility_data.received'
  | 'facility_data.verified'
  | 'z01.preparing'
  | 'z01.blocked'
  | 'z01.prepared'
  | 'supplier_switch.blocked'
  | 'supplier_switch.preparing'
  | 'supplier_switch.requested'
  | 'supplier_switch.waiting_ack'
  | 'supplier_switch.accepted'
  | 'supplier_switch.rejected'
  | 'inbound_facility_data_unmatched'
  | string

export type CustomerProcessEventInput = {
  companyId: string
  customerId: string
  eventType: CustomerProcessEventCode
  title: string
  message: string
  actorUserId?: string | null
  customerSiteId?: string | null
  meteringPointId?: string | null
  operationId?: string | null
  aggregateType?: string
  aggregateId?: string | null
  source?: string
  status?: CustomerOperationEventStatus
  severity?: CustomerOperationEventSeverity
  actionRequired?: boolean
  actionUrl?: string | null
  payload?: JsonRecord
  idempotencyKey?: string | null
  visibility?: 'tenant' | 'platform'
}

export async function emitCustomerProcessEvent(input: CustomerProcessEventInput): Promise<void> {
  await emitCustomerOperationEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.customerSiteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    operationId: input.operationId ?? null,
    eventType: input.eventType,
    title: input.title,
    message: input.message,
    actorUserId: input.actorUserId ?? null,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId ?? input.customerSiteId ?? input.customerId,
    source: input.source ?? 'customer_process_engine',
    status: input.status,
    severity: input.severity,
    actionRequired: input.actionRequired,
    actionUrl: input.actionUrl ?? null,
    visibility: input.visibility ?? 'tenant',
    payload: {
      tenant_message: input.message,
      technical_payload_available: Boolean(input.payload && Object.keys(input.payload).length > 0),
      ...(input.payload ?? {}),
    },
    idempotencyKey: input.idempotencyKey ?? null,
  })
}

export async function emitFacilityLookupCompletedEvent(input: {
  companyId: string
  customerId: string
  customerSiteId?: string | null
  meteringPointId?: string | null
  operationId?: string | null
  requestId: string
  actorUserId?: string | null
  source: 'manual' | 'ediel_inbound' | 'system'
  payload?: JsonRecord
}) {
  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.customerSiteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    operationId: input.operationId ?? null,
    eventType: 'facility_lookup.completed',
    title: 'Anläggningsuppgifter mottagna',
    message: input.source === 'ediel_inbound'
      ? 'Anläggningsuppgifter mottogs via Ediel och har kopplats till kunden.'
      : 'Anläggningsuppgifter har registrerats och kopplats till kunden.',
    actorUserId: input.actorUserId ?? null,
    status: 'completed',
    severity: 'info',
    actionRequired: false,
    source: 'facility_lookup_workflow',
    payload: {
      request_id: input.requestId,
      source: input.source,
      ...(input.payload ?? {}),
    },
    idempotencyKey: `facility_lookup.completed:${input.requestId}:${input.source}`,
  })
}

export async function emitInboundFacilityUnmatchedEvent(input: {
  companyId: string
  customerId?: string | null
  customerSiteId?: string | null
  edielMessageId: string
  actorUserId?: string | null
  reason: string
  payload?: JsonRecord
}) {
  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: input.customerId ?? '00000000-0000-0000-0000-000000000000',
    customerSiteId: input.customerSiteId ?? null,
    eventType: 'inbound_facility_data_unmatched',
    title: 'Inkommande anläggningsuppgifter kräver granskning',
    message: 'Ett inkommande Ediel-meddelande kan innehålla anläggningsuppgifter men kunde inte kopplas säkert automatiskt.',
    actorUserId: input.actorUserId ?? null,
    status: 'needs_review',
    severity: 'warning',
    actionRequired: true,
    source: 'inbound_facility_recognition',
    visibility: 'platform',
    payload: {
      ediel_message_id: input.edielMessageId,
      reason: input.reason,
      ...(input.payload ?? {}),
    },
    idempotencyKey: `inbound_facility_data_unmatched:${input.edielMessageId}`,
  })
}
