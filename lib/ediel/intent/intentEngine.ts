// lib/ediel/intent/intentEngine.ts
//
// EdielMessageIntentEngine (Batch 1). Business processes create intents only.
// The engine persists intents to ediel_message_intents, enforces idempotency,
// and runs the pre-render validation gate (required metadata, no-placeholder,
// Application Reference policy). It never renders or queues EDIFACT/XML.

import { supabaseService } from '@/lib/supabase/service'
import {
  collectPlaceholderViolations,
} from '@/lib/ediel/intent/noPlaceholderGuard'
import { validateApplicationReferencePolicy } from '@/lib/ediel/intent/applicationReferencePolicy'
import type {
  CreateEdielMessageIntentInput,
  EdielIntentBlockingReason,
  EdielIntentMessageFamily,
  EdielIntentOutboxStatus,
  EdielIntentRenderStatus,
  EdielIntentValidationResult,
  EdielIntentValidationStatus,
  EdielMessageIntent,
} from '@/lib/ediel/intent/types'

type IntentRow = Record<string, unknown>

const REQUIRED_METADATA_FIELDS: Array<{ key: keyof CreateEdielMessageIntentInput; label: string }> = [
  { key: 'companyId', label: 'company_id' },
  { key: 'environment', label: 'environment' },
  { key: 'messageFamily', label: 'message_family' },
  { key: 'messageCode', label: 'message_code' },
  { key: 'businessProcess', label: 'business_process' },
  { key: 'senderEdielId', label: 'sender_ediel_id' },
  { key: 'receiverEdielId', label: 'receiver_ediel_id' },
  { key: 'applicationReference', label: 'application_reference' },
  { key: 'routeProfileId', label: 'route_profile_id' },
  { key: 'interchangeReference', label: 'interchange_reference' },
  { key: 'messageReference', label: 'message_reference' },
  { key: 'idempotencyKey', label: 'idempotency_key' },
]

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mapRowToIntent(row: IntentRow): EdielMessageIntent {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    environment: (row.environment === 'production' ? 'production' : 'test'),
    market: (row.market === 'gas' ? 'gas' : 'electricity'),
    messageFamily: String(row.message_family) as EdielIntentMessageFamily,
    messageCode: String(row.message_code ?? ''),
    businessProcess: String(row.business_process) as EdielMessageIntent['businessProcess'],
    direction: (row.direction === 'inbound_response' ? 'inbound_response' : 'outbound'),
    senderEdielId: String(row.sender_ediel_id ?? ''),
    senderSubaddress: str(row.sender_subaddress),
    receiverEdielId: String(row.receiver_ediel_id ?? ''),
    receiverSubaddress: str(row.receiver_subaddress),
    applicationReference: String(row.application_reference ?? ''),
    routeProfileId: String(row.route_profile_id ?? ''),
    communicationRouteId: str(row.communication_route_id),
    certificateProfileId: str(row.certificate_profile_id),
    customerId: str(row.customer_id),
    customerSiteId: str(row.customer_site_id),
    gridOwnerInformationRequestId: str(row.grid_owner_information_request_id),
    supplierSwitchRequestId: str(row.supplier_switch_request_id),
    customerInfoRequestId: str(row.customer_info_request_id),
    operationId: str(row.operation_id),
    facilityId: str(row.facility_id),
    meteringPointId: str(row.metering_point_id),
    gridAreaCode: str(row.grid_area_code),
    requestedEffectiveDate: str(row.requested_effective_date),
    sendNotBefore: str(row.send_not_before),
    sendWindowOpensAt: str(row.send_window_opens_at),
    sendWindowClosesAt: str(row.send_window_closes_at),
    interchangeReference: String(row.interchange_reference ?? ''),
    messageReference: String(row.message_reference ?? ''),
    transactionReference: str(row.transaction_reference),
    payload: (row.payload as Record<string, unknown>) ?? {},
    expectedRuleVersion: str(row.expected_rule_version),
    expectedFieldMatrixVersion: str(row.expected_field_matrix_version),
    idempotencyKey: String(row.idempotency_key ?? ''),
    validationStatus: String(row.validation_status ?? 'draft') as EdielIntentValidationStatus,
    renderStatus: String(row.render_status ?? 'not_rendered') as EdielIntentRenderStatus,
    outboxStatus: String(row.outbox_status ?? 'not_queued') as EdielIntentOutboxStatus,
    validationResult: (row.validation_result as Record<string, unknown>) ?? {},
    blockingReasons: Array.isArray(row.blocking_reasons) ? (row.blocking_reasons as EdielIntentBlockingReason[]) : [],
    edielMessageId: str(row.ediel_message_id),
    outboundRequestId: str(row.outbound_request_id),
  }
}

// The pre-render validation gate. Pure function so it can be unit/regression tested
// without a database.
export function evaluateIntentValidation(
  input: CreateEdielMessageIntentInput | EdielMessageIntent,
): EdielIntentValidationResult {
  const blockingReasons: EdielIntentBlockingReason[] = []
  const checks: Record<string, boolean> = {}

  // 1) Required metadata.
  const missing: string[] = []
  for (const field of REQUIRED_METADATA_FIELDS) {
    if (!str((input as Record<string, unknown>)[field.key as string])) missing.push(field.label)
  }
  checks.required_metadata = missing.length === 0
  if (missing.length > 0) {
    blockingReasons.push({
      code: 'required_intent_metadata_missing',
      message: `Obligatoriska intent-fält saknas: ${missing.join(', ')}.`,
      severity: 'block',
      details: { missing },
    })
  }

  // 2) No placeholder identifiers.
  const placeholderReasons = collectPlaceholderViolations({
    facilityId: input.facilityId,
    meteringPointId: input.meteringPointId,
    gridAreaCode: input.gridAreaCode,
    senderEdielId: input.senderEdielId,
    receiverEdielId: input.receiverEdielId,
    transactionReference: input.transactionReference,
  })
  checks.no_placeholder_identifiers = placeholderReasons.length === 0
  blockingReasons.push(...placeholderReasons)

  // 3) Application Reference policy (route may declare, not override).
  const appref = validateApplicationReferencePolicy({
    messageFamily: input.messageFamily,
    messageType: input.messageCode,
    businessCode: input.messageCode,
    applicationReference: input.applicationReference,
    environment: input.environment,
    sender: input.senderEdielId,
    receiver: input.receiverEdielId,
  })
  checks.application_reference_policy = appref.ok
  blockingReasons.push(...appref.blockingReasons)

  // 4) Tenant scope present (company_id resolved, not mailbox-only).
  checks.tenant_scope = Boolean(str(input.companyId))
  if (!checks.tenant_scope) {
    blockingReasons.push({
      code: 'tenant_scope_missing',
      message: 'company_id saknas – tenant måste vara upplöst innan rendering.',
      severity: 'block',
    })
  }

  const ok = blockingReasons.filter((r) => (r.severity ?? 'block') === 'block').length === 0
  return {
    ok,
    status: ok ? 'validated' : 'blocked',
    blockingReasons,
    checks,
    checkedAt: new Date().toISOString(),
  }
}

async function findExistingIntent(params: {
  companyId: string
  environment: string
  idempotencyKey: string
}): Promise<EdielMessageIntent | null> {
  const { data, error } = await supabaseService
    .from('ediel_message_intents')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('environment', params.environment)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return data ? mapRowToIntent(data as IntentRow) : null
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

export async function getEdielMessageIntentById(id: string): Promise<EdielMessageIntent | null> {
  const { data, error } = await supabaseService
    .from('ediel_message_intents')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return data ? mapRowToIntent(data as IntentRow) : null
}

// Creates (or returns the idempotent existing) intent and runs the validation gate.
// The returned intent's validationStatus reflects whether it may proceed to render.
export async function createEdielMessageIntent(
  input: CreateEdielMessageIntentInput,
): Promise<EdielMessageIntent> {
  const validation = evaluateIntentValidation(input)
  const actorUserId = str(input.actorUserId) ?? 'system'

  // Idempotency: a prior intent with the same business key is reused.
  if (str(input.companyId) && str(input.environment) && str(input.idempotencyKey)) {
    const existing = await findExistingIntent({
      companyId: input.companyId,
      environment: input.environment,
      idempotencyKey: input.idempotencyKey,
    })
    if (existing) return existing
  }

  const row = {
    company_id: input.companyId,
    environment: input.environment,
    market: input.market ?? 'electricity',
    message_family: input.messageFamily,
    message_code: input.messageCode,
    business_process: input.businessProcess,
    direction: input.direction ?? 'outbound',
    sender_ediel_id: input.senderEdielId,
    sender_subaddress: input.senderSubaddress ?? null,
    receiver_ediel_id: input.receiverEdielId,
    receiver_subaddress: input.receiverSubaddress ?? null,
    application_reference: input.applicationReference,
    route_profile_id: str(input.routeProfileId),
    communication_route_id: input.communicationRouteId ?? null,
    certificate_profile_id: input.certificateProfileId ?? null,
    customer_id: input.customerId ?? null,
    customer_site_id: input.customerSiteId ?? null,
    grid_owner_information_request_id: input.gridOwnerInformationRequestId ?? null,
    supplier_switch_request_id: input.supplierSwitchRequestId ?? null,
    customer_info_request_id: input.customerInfoRequestId ?? null,
    operation_id: input.operationId ?? null,
    facility_id: input.facilityId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    grid_area_code: input.gridAreaCode ?? null,
    requested_effective_date: input.requestedEffectiveDate ?? null,
    send_not_before: input.sendNotBefore ?? null,
    send_window_opens_at: input.sendWindowOpensAt ?? null,
    send_window_closes_at: input.sendWindowClosesAt ?? null,
    interchange_reference: input.interchangeReference,
    message_reference: input.messageReference,
    transaction_reference: input.transactionReference ?? null,
    payload: input.payload ?? {},
    validation_result: validation as unknown as Record<string, unknown>,
    blocking_reasons: validation.blockingReasons,
    idempotency_key: input.idempotencyKey,
    expected_rule_version: input.expectedRuleVersion ?? null,
    expected_field_matrix_version: input.expectedFieldMatrixVersion ?? null,
    validation_status: validation.status,
    render_status: 'not_rendered' as EdielIntentRenderStatus,
    outbox_status: 'not_queued' as EdielIntentOutboxStatus,
    created_by: actorUserId,
    updated_by: actorUserId,
  }

  const { data, error } = await supabaseService
    .from('ediel_message_intents')
    .upsert(row, { onConflict: 'company_id,environment,idempotency_key' })
    .select('*')
    .single()

  if (error) throw error
  return mapRowToIntent(data as IntentRow)
}

// Re-runs the validation gate against a persisted intent before render.
export async function validateIntentBeforeRender(
  intentId: string,
): Promise<{ intent: EdielMessageIntent | null; validation: EdielIntentValidationResult | null }> {
  const intent = await getEdielMessageIntentById(intentId)
  if (!intent) return { intent: null, validation: null }
  const validation = evaluateIntentValidation(intent)
  if (validation.status !== intent.validationStatus) {
    await updateIntentLifecycle(intentId, {
      validationStatus: validation.status,
      validationResult: validation as unknown as Record<string, unknown>,
      blockingReasons: validation.blockingReasons,
    })
  }
  return { intent: { ...intent, validationStatus: validation.status }, validation }
}

export async function updateIntentLifecycle(
  intentId: string,
  patch: {
    validationStatus?: EdielIntentValidationStatus
    renderStatus?: EdielIntentRenderStatus
    outboxStatus?: EdielIntentOutboxStatus
    validationResult?: Record<string, unknown>
    blockingReasons?: EdielIntentBlockingReason[]
    edielMessageId?: string | null
    outboundRequestId?: string | null
    actorUserId?: string | null
  },
): Promise<void> {
  const update: IntentRow = { updated_at: new Date().toISOString() }
  if (patch.validationStatus) update.validation_status = patch.validationStatus
  if (patch.renderStatus) update.render_status = patch.renderStatus
  if (patch.outboxStatus) update.outbox_status = patch.outboxStatus
  if (patch.validationResult) update.validation_result = patch.validationResult
  if (patch.blockingReasons) update.blocking_reasons = patch.blockingReasons
  if (patch.edielMessageId !== undefined) update.ediel_message_id = patch.edielMessageId
  if (patch.outboundRequestId !== undefined) update.outbound_request_id = patch.outboundRequestId
  if (str(patch.actorUserId)) update.updated_by = str(patch.actorUserId)

  const { error } = await supabaseService
    .from('ediel_message_intents')
    .update(update)
    .eq('id', intentId)
  if (error && !isMissingSchema(error)) throw error
}
