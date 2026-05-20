import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessage } from '@/lib/ediel/db'
import type { CustomerCaseRow, WithdrawalScenario } from './types'

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

async function updateTableSafely(table: string, patch: Record<string, unknown>, filters: Array<{ column: string; value: string }>) {
  let query = supabaseService.from(table).update(patch)
  for (const filter of filters) query = query.eq(filter.column, filter.value)
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
        updated_by: actorUserId,
        updated_at: now,
      },
      baseFilters
    ),
    updateTableSafely(
      'partner_exports',
      {
        status: 'cancelled',
        failure_reason: `Stoppat av kundärende ${caseRow.id}: ${caseRow.title}`,
        updated_by: actorUserId,
        updated_at: now,
      },
      baseFilters
    ),
    updateTableSafely(
      'billing_underlays',
      {
        readiness_status: 'blocked',
        failure_reason: `Manuell kontroll krävs på grund av kundärende ${caseRow.id}.`,
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
        status: 'cancelled',
        updated_by: actorUserId,
        updated_at: now,
      },
      [
        { column: 'id', value: caseRow.customer_contract_id },
        { column: 'company_id', value: caseRow.company_id },
      ]
    )
  }

  if (caseRow.supplier_switch_request_id) {
    await updateTableSafely(
      'supplier_switch_requests',
      {
        status: 'cancelled',
        failure_reason: `Stoppat av kundärende ${caseRow.id}: ${caseRow.title}`,
        updated_by: actorUserId,
        updated_at: now,
      },
      [
        { column: 'id', value: caseRow.supplier_switch_request_id },
        { column: 'company_id', value: caseRow.company_id },
      ]
    )
  }
}

export async function createCancellationDraftForCase(caseRow: CustomerCaseRow, actorUserId: string | null) {
  if (!caseRow.cancellation_required || caseRow.cancellation_ediel_message_id) return null

  const message = await createEdielMessage({
    companyId: caseRow.company_id,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode: 'Z03',
    messageVersion: 'E2SE6A',
    processType: 'supplier_switch_cancellation',
    environment: 'test',
    status: 'draft',
    customerId: caseRow.customer_id,
    siteId: caseRow.site_id,
    meteringPointId: caseRow.metering_point_id,
    switchRequestId: caseRow.supplier_switch_request_id,
    outboundRequestId: caseRow.outbound_request_id,
    externalReference: caseRow.cancellation_reference ?? `CANCEL-${caseRow.id.slice(0, 8).toUpperCase()}`,
    correlationReference: caseRow.id,
    rawPayload: null,
    parsedPayload: {
      caseId: caseRow.id,
      cancellation: true,
      reason: caseRow.reason_category,
      scenario: caseRow.withdrawal_scenario,
      note: 'Annulleringsutkast skapat från ångerärende. Granska och skapa korrekt PRODAT-annullering innan dispatch.',
    },
    validationReport: {
      status: 'manual_review_required',
      reason: 'Kundärende kräver annullering kopplad till originalärende.',
    },
    requiresContrl: true,
    requiresAperak: true,
    actorUserId: actorUserId ?? '00000000-0000-0000-0000-000000000000',
  })

  const { error } = await supabaseService
    .from('customer_cases')
    .update({
      cancellation_ediel_message_id: message.id,
      cancellation_status: 'draft_created',
      updated_by: actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseRow.id)

  if (error) throw error
  return message
}
