import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { isSchemaError } from '@/lib/http/apiError'
import { emitDomainEvent } from '@/lib/events/domainEvents'

export type CustomerApplicationWorkflowState =
  | 'received'
  | 'provisioning'
  | 'provisioned'
  | 'pending_customer_data'
  | 'ready_for_switch'
  | 'pending_review'
  | 'application_received'
  | 'validation_failed'
  | 'canonical_data_committed'
  | 'initial_notifications_pending'
  | 'initial_notifications_queued'
  | 'facility_information_check'
  | 'facility_information_required'
  | 'facility_request_pending'
  | 'facility_request_sent'
  | 'waiting_for_facility_response'
  | 'facility_response_received'
  | 'facility_response_needs_review'
  | 'facility_information_completed'
  | 'switch_readiness_check'
  | 'waiting_for_customer_data_response'
  | 'switch_blocked'
  | 'switch_request_pending'
  | 'switch_request_queued'
  | 'switch_dispatched'
  | 'waiting_for_switch_response'
  | 'switch_confirmed'
  | 'switch_rejected'
  | 'supply_activation_pending'
  | 'supply_active'
  | 'completed'
  | 'manual_review'
  | 'failed'
  | 'cancelled'

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const SWITCH_WORKFLOW_STATES = new Set<CustomerApplicationWorkflowState>([
  'switch_readiness_check',
  'switch_blocked',
  'switch_request_pending',
  'switch_request_queued',
  'switch_dispatched',
  'waiting_for_switch_response',
  'switch_confirmed',
  'switch_rejected',
  'supply_activation_pending',
  'supply_active',
])

type ApplicationTransitionProjection = {
  application_number?: unknown
  customer_id?: unknown
  customer_number?: unknown
  contract_number?: unknown
  external_customer_id?: unknown
  status?: unknown
  next_step?: unknown
}

async function emitCustomerApplicationTransitionEvents(input: {
  companyId: string
  applicationId: string
  state: CustomerApplicationWorkflowState
  eventCode: string
  reasonCode: string | null
  actorUserId: string | null
  idempotencyKey: string | null
  snapshotPatch: Record<string, unknown>
  workflowVersion: number
}) {
  const { data, error } = await supabaseService
    .from('website_customer_applications')
    .select('application_number,customer_id,customer_number,contract_number,external_customer_id,status,next_step')
    .eq('company_id', input.companyId)
    .eq('id', input.applicationId)
    .single()
  if (error) {
    if (isSchemaError(error)) {
      throw new Error('Kundansökans statusschema saknas. Kör den senaste OPS-migrationen innan workflow övergår.')
    }
    throw error
  }

  const application = (data ?? {}) as ApplicationTransitionProjection
  const applicationNumber = clean(application.application_number)
  const transitionReference = input.idempotencyKey ?? `${input.eventCode}:${input.state}:v${input.workflowVersion}`
  const payload = {
    ...input.snapshotPatch,
    application_number: applicationNumber,
    customer_number: clean(application.customer_number),
    customer_reference: clean(application.external_customer_id),
    contract_number: clean(application.contract_number),
    status: ['failed', 'cancelled', 'validation_failed', 'switch_rejected'].includes(input.state)
      ? 'failed'
      : ['completed', 'supply_active'].includes(input.state)
        ? 'completed'
        : ['pending_customer_data', 'waiting_for_customer_data_response', 'facility_information_required', 'facility_response_needs_review', 'manual_review', 'pending_review'].includes(input.state)
          ? 'needs_information'
          : 'processing',
    workflow_state: input.state,
    next_step: clean(application.next_step),
    reason_code: input.reasonCode,
    event_code: input.eventCode,
  }

  await emitDomainEvent({
    companyId: input.companyId,
    eventType: 'customer_application.status_changed',
    aggregateType: 'website_customer_application',
    aggregateId: input.applicationId,
    subjectCustomerId: clean(application.customer_id),
    actorUserId: input.actorUserId,
    source: 'customer_application_workflow',
    payload,
    idempotencyKey: `customer-application-status:${input.companyId}:${input.applicationId}:${transitionReference}`,
  })

  if (SWITCH_WORKFLOW_STATES.has(input.state)) {
    await emitDomainEvent({
      companyId: input.companyId,
      eventType: 'supplier_switch.updated',
      aggregateType: 'website_customer_application',
      aggregateId: input.applicationId,
      subjectCustomerId: clean(application.customer_id),
      actorUserId: input.actorUserId,
      source: 'customer_application_workflow',
      payload: {
        ...payload,
        supplier_switch_status: input.state,
      },
      idempotencyKey: `supplier-switch-status:${input.companyId}:${input.applicationId}:${transitionReference}`,
    })
  }
}

export async function ensureCustomerApplicationWorkflow(input: {
  companyId: string
  applicationId: string
  customerId: string
  customerSiteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  state: CustomerApplicationWorkflowState
  operationId?: string | null
  snapshot?: Record<string, unknown>
}) {
  const operationId = clean(input.operationId) ?? randomUUID()
  const row = {
    company_id: input.companyId,
    customer_application_id: input.applicationId,
    customer_id: input.customerId,
    customer_site_id: input.customerSiteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    contract_id: input.contractId ?? null,
    operation_id: operationId,
    state: input.state,
    snapshot: input.snapshot ?? {},
    last_transition_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabaseService
    .from('customer_application_workflows')
    .upsert(row, { onConflict: 'company_id,customer_application_id' })
    .select('id,operation_id,state,workflow_version,last_job_id')
    .single()
  if (error) {
    if (isSchemaError(error)) throw new Error('Kundansökans workflow-tabell saknas. Kör den senaste OPS-migrationen innan automation startas.')
    throw error
  }
  return {
    id: String(data.id),
    operationId: String(data.operation_id ?? operationId),
    state: String(data.state) as CustomerApplicationWorkflowState,
    workflowVersion: Number(data.workflow_version ?? 1),
    lastJobId: clean(data.last_job_id),
  }
}

export async function transitionCustomerApplicationWorkflow(input: {
  companyId: string
  applicationId: string
  state: CustomerApplicationWorkflowState
  eventCode?: string
  reasonCode?: string | null
  actorUserId?: string | null
  expectedVersion?: number | null
  idempotencyKey?: string | null
  failureCode?: string | null
  failureDetailInternal?: string | null
  snapshotPatch?: Record<string, unknown>
}) {
  const metadata = {
    ...(input.snapshotPatch ?? {}),
    ...(input.failureDetailInternal ? { failure_detail_internal: input.failureDetailInternal } : {}),
  }
  const { data, error } = await supabaseService.rpc('gridex_transition_customer_application_workflow', {
    p_company_id: input.companyId,
    p_customer_application_id: input.applicationId,
    p_to_state: input.state,
    p_event_code: input.eventCode ?? `workflow.${input.state}`,
    p_reason_code: input.reasonCode ?? input.failureCode ?? null,
    p_metadata: metadata,
    p_actor_user_id: input.actorUserId ?? null,
    p_expected_version: input.expectedVersion ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  })

  if (error) {
    if (isSchemaError(error)) {
      throw new Error('Kundansökans transition-RPC saknas. Kör den senaste OPS-migrationen innan workflow övergår.')
    }
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data
  const result = {
    id: clean((row as { workflow_id?: unknown } | null)?.workflow_id),
    operationId: clean((row as { operation_id?: unknown } | null)?.operation_id),
    state: (clean((row as { state?: unknown } | null)?.state) ?? input.state) as CustomerApplicationWorkflowState,
    workflowVersion: Number((row as { workflow_version?: unknown } | null)?.workflow_version ?? 1),
  }

  await emitCustomerApplicationTransitionEvents({
    companyId: input.companyId,
    applicationId: input.applicationId,
    state: result.state,
    eventCode: input.eventCode ?? `workflow.${result.state}`,
    reasonCode: input.reasonCode ?? input.failureCode ?? null,
    actorUserId: input.actorUserId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    snapshotPatch: metadata,
    workflowVersion: result.workflowVersion,
  })

  return result
}
