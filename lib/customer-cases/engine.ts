import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessage } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { renderProdat26A } from '@/lib/ediel/prodat/engine'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import type { CustomerCaseRow, WithdrawalScenario } from './types'
import {
  createLifecycleDecisionFromCase,
  pauseOpenSupplierSwitchesForLifecycleBlock,
  switchLifecycleBlockFromCase,
} from '@/lib/operations/switchLifecycleBlocks'

export type WithdrawalAssessmentInput = {
  caseType: string
  agreementCreatedAt?: string | null
  agreementChannel?: string | null
  isDistanceAgreement?: boolean | null
  withdrawalInformationSentAt?: string | null
  withdrawalRequestedAt?: string | null
  deliveryStartAt?: string | null
  prodatSentAt?: string | null
  now?: Date
}

export type WithdrawalAssessment = {
  isWithdrawal: boolean
  withdrawalDeadlineAt: string | null
  withdrawalPossible: boolean
  switchCanBeStopped: boolean
  cancellationRequired: boolean
  cancellationStatus: 'not_required' | 'draft_required' | 'not_possible' | 'manual_review'
  scenario: WithdrawalScenario
  nextAction: string | null
  billingBlocked: boolean
  billingManualReview: boolean
  breakFeeFlagged: boolean
}

function addDays(date: Date, days: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isDistanceChannel(channel: string | null | undefined) {
  return ['phone', 'web', 'email', 'sms', 'distance', 'external_sales'].includes(String(channel ?? '').trim())
}


type DynamicRow = Record<string, unknown>

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asNumberOrString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return asString(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const stringValue = asNumberOrString(value)
    if (stringValue) return stringValue
  }
  return null
}

function compactReference(value: string | null | undefined, fallback: string): string {
  const raw = (value && value.trim() ? value : fallback).replace(/[^A-Za-z0-9_.\/-]/g, '')
  return raw.slice(0, 35) || fallback.slice(0, 35)
}

async function maybeSelectById(table: string, id: string | null | undefined, companyId: string): Promise<DynamicRow | null> {
  if (!id) return null
  const { data, error } = await supabaseService
    .from(table)
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) throw error
  return (data as DynamicRow | null) ?? null
}

async function findSourceSwitchMessage(caseRow: CustomerCaseRow): Promise<EdielMessageRow | null> {
  if (caseRow.outbound_request_id) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('*')
      .eq('company_id', caseRow.company_id)
      .eq('outbound_request_id', caseRow.outbound_request_id)
      .eq('direction', 'outbound')
      .eq('message_family', 'PRODAT')
      .eq('message_code', 'Z03')
      .neq('process_type', 'supplier_switch_cancellation')
      .order('message_sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) throw error
    if (data) return data as EdielMessageRow
  }

  if (!caseRow.supplier_switch_request_id) return null

  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('company_id', caseRow.company_id)
    .eq('switch_request_id', caseRow.supplier_switch_request_id)
    .eq('direction', 'outbound')
    .eq('message_family', 'PRODAT')
    .eq('message_code', 'Z03')
    .neq('process_type', 'supplier_switch_cancellation')
    .order('message_sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) throw error
  return (data as EdielMessageRow | null) ?? null
}

function buildCustomerDisplayName(customer: DynamicRow | null, sourcePayload: Record<string, unknown>): string {
  return firstString(
    sourcePayload.customerName,
    customer?.full_name,
    [customer?.first_name, customer?.last_name].filter(Boolean).join(' '),
    customer?.company_name,
    customer?.name
  ) ?? 'Kund'
}

function buildCancellationProdatPayload(params: {
  caseRow: CustomerCaseRow
  sourceMessage: EdielMessageRow
  customer: DynamicRow | null
  site: DynamicRow | null
  meteringPoint: DynamicRow | null
  switchRequest: DynamicRow | null
}) {
  const sourcePayload = asRecord(params.sourceMessage.parsed_payload)
  const senderEdielId = firstString(params.sourceMessage.sender_ediel_id, sourcePayload.senderEdielId)
  const receiverEdielId = firstString(params.sourceMessage.receiver_ediel_id, sourcePayload.receiverEdielId, sourcePayload.gridOwnerEdielId)

  if (!senderEdielId || !receiverEdielId) {
    return {
      rawPayload: null,
      context: null,
      validationReport: {
        status: 'manual_review_required',
        reason: 'Ursprungligt Z03 saknar Ediel-avsändare eller mottagare. Annullering kräver manuell route-kontroll.',
      },
    }
  }

  const cancellationReference = compactReference(
    params.caseRow.cancellation_reference,
    `C${params.caseRow.id.replace(/-/g, '').slice(0, 18)}`
  )
  const originalTransactionReference = firstString(
    params.sourceMessage.transaction_reference,
    sourcePayload.transactionReference,
    sourcePayload.edielReference,
    sourcePayload.switchRequestId,
    params.caseRow.supplier_switch_request_id
  )
  const transactionReference = compactReference(originalTransactionReference, cancellationReference)
  const meterPointId = firstString(
    params.meteringPoint?.meter_point_id,
    params.meteringPoint?.metering_point_id,
    params.site?.facility_id,
    sourcePayload.meterPointId,
    sourcePayload.facilityId
  ) ?? 'UNKNOWN'

  const context: ProdatEngineProductionContext = {
    code: 'Z03',
    bgmReference: cancellationReference,
    transactionReference,
    senderEdielId,
    receiverEdielId,
    customerName: buildCustomerDisplayName(params.customer, sourcePayload),
    customerId: firstString(
      sourcePayload.customerId,
      params.customer?.customer_number,
      params.customer?.personal_identity_number,
      params.customer?.organization_number,
      params.customer?.org_number
    ),
    customerIdCodeListQualifier: firstString(sourcePayload.customerIdCodeListQualifier),
    meterPointId,
    gridAreaId: firstString(params.site?.grid_area_code, params.meteringPoint?.grid_area_code, sourcePayload.gridAreaId, sourcePayload.netArea),
    startDate: firstString(params.switchRequest?.requested_start_date, sourcePayload.requestedStartDate, params.caseRow.delivery_start_at),
    customerAddress: firstString(params.customer?.address_line1, params.customer?.street_address, sourcePayload.customerAddress),
    customerCity: firstString(params.customer?.city, sourcePayload.customerCity),
    customerPostalCode: firstString(params.customer?.postal_code, sourcePayload.customerPostalCode),
    customerCountry: firstString(params.customer?.country_code, sourcePayload.customerCountry) ?? 'SE',
    siteAddress: firstString(params.site?.address_line1, params.site?.street_address, sourcePayload.siteAddress),
    siteCity: firstString(params.site?.city, sourcePayload.siteCity),
    sitePostalCode: firstString(params.site?.postal_code, sourcePayload.sitePostalCode),
    siteCountry: firstString(params.site?.country_code, sourcePayload.siteCountry) ?? 'SE',
    reasonForTransaction: 'Z24',
    meteringMethod: firstString(params.meteringPoint?.metering_method, params.site?.metering_method, sourcePayload.meteringMethod),
    powerOfAttorneyReference: firstString(sourcePayload.powerOfAttorneyReference, params.switchRequest?.power_of_attorney_id, params.switchRequest?.authorization_document_id),
    balanceResponsibleId: firstString(sourcePayload.balanceResponsibleId),
  }

  const rendered = renderProdat26A({ context })
  const envelope = buildEdifactEnvelope({
    senderEdielId,
    senderSubAddress: params.sourceMessage.sender_sub_address,
    receiverEdielId,
    receiverSubAddress: params.sourceMessage.receiver_sub_address,
    applicationReference: params.sourceMessage.application_reference ?? '23-DDQ-PRODAT',
    testFlag: params.sourceMessage.test_flag === 0 ? 0 : 1,
    messageTypeToken: `PRODAT:D:97A:UN:${params.sourceMessage.message_version === '25A' ? 'E2SE5A' : 'E2SE6A'}`,
    segments: rendered.segments,
  })

  return {
    rawPayload: envelope.raw,
    context,
    validationReport: {
      status: rendered.issues.some((issue) => issue.severity === 'error') ? 'warning' : 'ok',
      cancellation: true,
      prodatFunction: 'Z03',
      reasonForTransaction: 'Z24',
      originalEdielMessageId: params.sourceMessage.id,
      originalTransactionReference,
      issues: rendered.issues,
      diagnostics: rendered.diagnostics,
      ruleBasis: 'PRODAT Z03C annullering enligt C/Z24 och koppling till ursprungligt ärende.',
    },
  }
}

export function assessWithdrawal(input: WithdrawalAssessmentInput): WithdrawalAssessment {
  const now = input.now ?? new Date()
  const isWithdrawal = input.caseType === 'withdrawal'
  const agreementDate = parseDate(input.agreementCreatedAt)
  const infoDate = parseDate(input.withdrawalInformationSentAt) ?? agreementDate
  const requestedAt = parseDate(input.withdrawalRequestedAt) ?? now
  const deliveryStart = parseDate(input.deliveryStartAt)
  const prodatSentAt = parseDate(input.prodatSentAt)
  const distanceAgreement = Boolean(input.isDistanceAgreement) || isDistanceChannel(input.agreementChannel)
  const deadline = isWithdrawal && distanceAgreement && infoDate ? addDays(infoDate, 14) : null
  const withdrawalPossible = Boolean(isWithdrawal && distanceAgreement && deadline && requestedAt.getTime() <= deadline.getTime())
  const switchStopDeadline = deliveryStart ? addDays(deliveryStart, -4) : null
  const switchCanBeStopped = Boolean(!deliveryStart || (switchStopDeadline && now.getTime() <= switchStopDeadline.getTime()))

  if (!isWithdrawal) {
    return {
      isWithdrawal,
      withdrawalDeadlineAt: deadline?.toISOString() ?? null,
      withdrawalPossible: false,
      switchCanBeStopped: false,
      cancellationRequired: false,
      cancellationStatus: 'not_required',
      scenario: 'not_withdrawal',
      nextAction: 'Följ upp ärendet och dokumentera beslut innan operativa flöden fortsätter.',
      billingBlocked: true,
      billingManualReview: true,
      breakFeeFlagged: false,
    }
  }

  if (!prodatSentAt) {
    return {
      isWithdrawal,
      withdrawalDeadlineAt: deadline?.toISOString() ?? null,
      withdrawalPossible,
      switchCanBeStopped: true,
      cancellationRequired: false,
      cancellationStatus: 'not_required',
      scenario: 'before_prodat_sent',
      nextAction: 'Stoppa onboarding, Ediel-utskick, mätvärdesbegäran och faktureringsstart. Behåll historiken på kundkortet.',
      billingBlocked: true,
      billingManualReview: false,
      breakFeeFlagged: false,
    }
  }

  if (switchCanBeStopped && withdrawalPossible) {
    return {
      isWithdrawal,
      withdrawalDeadlineAt: deadline?.toISOString() ?? null,
      withdrawalPossible,
      switchCanBeStopped,
      cancellationRequired: true,
      cancellationStatus: 'draft_required',
      scenario: 'after_prodat_before_start',
      nextAction: 'Skapa annullering kopplad till originalärendet och invänta CONTRL/APERAK innan fakturering släpps.',
      billingBlocked: true,
      billingManualReview: true,
      breakFeeFlagged: false,
    }
  }

  return {
    isWithdrawal,
    withdrawalDeadlineAt: deadline?.toISOString() ?? null,
    withdrawalPossible,
    switchCanBeStopped,
    cancellationRequired: false,
    cancellationStatus: 'not_possible',
    scenario: 'cannot_stop_switch',
    nextAction: 'Återkallelse kan inte stoppa bytet automatiskt. Skapa manuell uppföljning och bedöm brytkostnad/fakturering.',
    billingBlocked: true,
    billingManualReview: true,
    breakFeeFlagged: true,
  }
}

async function updateTableSafely(
  table: string,
  patch: Record<string, unknown>,
  filters: Array<{ column: string; value: string | string[]; op?: 'eq' | 'in' }>
) {
  let query = supabaseService.from(table).update(patch)
  for (const filter of filters) {
    query = filter.op === 'in' && Array.isArray(filter.value)
      ? query.in(filter.column, filter.value)
      : query.eq(filter.column, String(filter.value))
  }
  const { error } = await query
  if (error && !['42P01', '42703', 'PGRST205', '23514'].includes(error.code ?? '')) throw error
}

export async function applyCustomerCaseOperationalStops(caseRow: CustomerCaseRow, actorUserId: string | null) {
  const now = new Date().toISOString()
  const baseFilters = [
    { column: 'company_id', value: caseRow.company_id },
    { column: 'customer_id', value: caseRow.customer_id },
  ]

  await Promise.all([
    updateTableSafely(
      'customer_info_requests',
      {
        status: 'cancelled',
        blocker_reason: `Stoppat av kundärende ${caseRow.id}: ${caseRow.title}`,
        updated_by: actorUserId,
        updated_at: now,
      },
      baseFilters
    ),
    updateTableSafely(
      'metering_permissions',
      {
        status: 'cancelled',
        last_blocker: `Stoppat av kundärende ${caseRow.id}: ${caseRow.title}`,
        updated_by: actorUserId,
        updated_at: now,
      },
      baseFilters
    ),
    updateTableSafely(
      'outbound_requests',
      {
        status: 'cancelled',
        failure_reason: `Stoppat av kundärende ${caseRow.id}: ${caseRow.title}`,
        customer_case_id: caseRow.id,
        updated_by: actorUserId,
        updated_at: now,
      },
      [
        ...baseFilters,
        { column: 'status', op: 'in', value: ['draft', 'pending', 'queued', 'prepared', 'ready_to_send'] },
      ]
    ),
    updateTableSafely(
      'partner_exports',
      {
        status: 'cancelled',
        failure_reason: `Stoppat av kundärende ${caseRow.id}: ${caseRow.title}`,
        customer_case_id: caseRow.id,
        updated_by: actorUserId,
        updated_at: now,
      },
      [
        ...baseFilters,
        { column: 'status', op: 'in', value: ['draft', 'pending', 'queued', 'prepared', 'ready'] },
      ]
    ),
    updateTableSafely(
      'billing_underlays',
      {
        readiness_status: 'blocked',
        failure_reason: `Manuell kontroll krävs på grund av kundärende ${caseRow.id}.`,
        billing_blocked_by_case_id: caseRow.id,
        updated_by: actorUserId,
        updated_at: now,
      },
      baseFilters
    ),
  ])

  if (caseRow.customer_contract_id) {
    await updateTableSafely(
      'customer_contracts',
      {
        status: caseRow.withdrawal_scenario === 'before_prodat_sent' ? 'cancelled_by_customer' : 'manual_review',
        billing_blocked_by_case_id: caseRow.id,
        updated_by: actorUserId,
        updated_at: now,
      },
      [
        { column: 'id', value: caseRow.customer_contract_id },
        { column: 'company_id', value: caseRow.company_id },
      ]
    )
  }

  const lifecycleDecisionId = await createLifecycleDecisionFromCase(
    supabaseService,
    caseRow,
    actorUserId
  )
  const lifecycleBlock = switchLifecycleBlockFromCase(caseRow)
  if (lifecycleBlock) {
    const pausedSwitches = await pauseOpenSupplierSwitchesForLifecycleBlock(
      supabaseService,
      {
        block: lifecycleDecisionId
          ? {
              ...lifecycleBlock,
              source: 'customer_lifecycle_decision',
              id: lifecycleDecisionId,
            }
          : lifecycleBlock,
        actorUserId,
        customerCaseId: caseRow.id,
      }
    )

    if (pausedSwitches.paused > 0) {
      await supabaseService.from('customer_case_events').insert({
        company_id: caseRow.company_id,
        customer_case_id: caseRow.id,
        customer_id: caseRow.customer_id,
        event_type: 'supplier_switches_paused',
        event_status: 'warning',
        message: `${pausedSwitches.paused} leverantörsbyte stoppades eller pausades av ärendet.`,
        payload: {
          requestIds: pausedSwitches.requestIds,
          lifecycleDecisionId,
        },
        created_by: actorUserId,
      })
    }
  }
}

export async function createCancellationDraftForCase(caseRow: CustomerCaseRow, actorUserId: string | null) {
  if (!caseRow.cancellation_required || caseRow.cancellation_ediel_message_id) return null

  const sourceMessage = await findSourceSwitchMessage(caseRow)
  const [customer, site, meteringPoint, switchRequest] = await Promise.all([
    maybeSelectById('customers', caseRow.customer_id, caseRow.company_id),
    maybeSelectById('customer_sites', caseRow.site_id, caseRow.company_id),
    maybeSelectById('metering_points', caseRow.metering_point_id, caseRow.company_id),
    maybeSelectById('supplier_switch_requests', caseRow.supplier_switch_request_id, caseRow.company_id),
  ])

  const cancellation = sourceMessage
    ? buildCancellationProdatPayload({ caseRow, sourceMessage, customer, site, meteringPoint, switchRequest })
    : {
        rawPayload: null,
        context: null,
        validationReport: {
          status: 'manual_review_required',
          reason: 'Ursprungligt PRODAT Z03 kunde inte hittas. Annullering kan inte skickas automatiskt innan originalärendet är identifierat.',
        },
      }

  const message = await createEdielMessage({
    companyId: caseRow.company_id,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    messageVersion: sourceMessage?.message_version ?? 'E2SE6A',
    processType: 'supplier_switch_cancellation',
    environment: sourceMessage?.environment === 'production' ? 'production' : 'test',
    testFlag: sourceMessage?.test_flag === 0 ? 0 : 1,
    status: cancellation.rawPayload ? 'prepared' : 'draft',
    transportType: sourceMessage?.transport_type ?? 'smtp',
    mailbox: sourceMessage?.mailbox ?? null,
    senderEdielId: sourceMessage?.sender_ediel_id ?? null,
    senderName: sourceMessage?.sender_name ?? null,
    senderSubAddress: sourceMessage?.sender_sub_address ?? null,
    receiverEdielId: sourceMessage?.receiver_ediel_id ?? null,
    receiverName: sourceMessage?.receiver_name ?? null,
    receiverSubAddress: sourceMessage?.receiver_sub_address ?? null,
    senderEmail: sourceMessage?.sender_email ?? null,
    receiverEmail: sourceMessage?.receiver_email ?? null,
    subject: sourceMessage?.subject ? `Annullering ${sourceMessage.subject}` : 'PRODAT Z03C annullering',
    fileName: cancellation.rawPayload ? `PRODAT-Z03C-${caseRow.cancellation_reference ?? caseRow.id}.edi` : null,
    mimeType: cancellation.rawPayload ? 'application/EDIFACT' : null,
    customerId: caseRow.customer_id,
    siteId: caseRow.site_id,
    meteringPointId: caseRow.metering_point_id,
    switchRequestId: caseRow.supplier_switch_request_id,
    outboundRequestId: caseRow.outbound_request_id,
    externalReference: caseRow.cancellation_reference ?? `CANCEL-${caseRow.id.slice(0, 8).toUpperCase()}`,
    transactionReference: cancellation.context?.transactionReference ?? sourceMessage?.transaction_reference ?? null,
    applicationReference: sourceMessage?.application_reference ?? '23-DDQ-PRODAT',
    originalMessageId: sourceMessage?.external_reference ?? sourceMessage?.id ?? null,
    originalTransactionId: sourceMessage?.transaction_reference ?? null,
    originalMessageCode: sourceMessage?.message_code ?? 'Z03',
    relatedMessageId: sourceMessage?.id ?? null,
    correlationReference: caseRow.id,
    rawPayload: cancellation.rawPayload,
    parsedPayload: {
      caseId: caseRow.id,
      cancellation: true,
      prodatFunction: 'Z03',
      prodatSubtype: 'C',
      reasonForTransaction: 'Z24',
      reason: caseRow.reason_category,
      scenario: caseRow.withdrawal_scenario,
      originalEdielMessageId: sourceMessage?.id ?? null,
      originalExternalReference: sourceMessage?.external_reference ?? null,
      originalTransactionReference: sourceMessage?.transaction_reference ?? null,
      generatedEdifact: Boolean(cancellation.rawPayload),
    },
    validationReport: cancellation.validationReport,
    requiresContrl: true,
    requiresAperak: true,
    contrlStatus: 'pending',
    aperakStatus: 'pending',
    actorUserId: actorUserId ?? '00000000-0000-0000-0000-000000000000',
  })

  const { error } = await supabaseService
    .from('customer_cases')
    .update({
      cancellation_ediel_message_id: message.id,
      cancellation_status: cancellation.rawPayload ? 'draft_created' : 'manual_review',
      updated_by: actorUserId,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(caseRow.metadata ?? {}),
        cancellationEdifactCreated: Boolean(cancellation.rawPayload),
        originalEdielMessageId: sourceMessage?.id ?? null,
        cancellationValidation: cancellation.validationReport,
      },
    })
    .eq('id', caseRow.id)
    .eq('company_id', caseRow.company_id)

  if (error) throw error
  return message
}
