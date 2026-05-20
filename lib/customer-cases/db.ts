import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { assessWithdrawal, applyCustomerCaseOperationalStops, createCancellationDraftForCase } from './engine'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CustomerCaseEventRow, CustomerCaseListRow, CustomerCaseRow, CustomerCaseType } from './types'

type CustomerCaseInput = {
  companyId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  customerContractId?: string | null
  supplierSwitchRequestId?: string | null
  outboundRequestId?: string | null
  caseType: CustomerCaseType
  priority?: string | null
  title: string
  description?: string | null
  reasonCategory?: string | null
  agreementChannel?: string | null
  isDistanceAgreement?: boolean | null
  agreementCreatedAt?: string | null
  withdrawalInformationSentAt?: string | null
  withdrawalRequestedAt?: string | null
  deliveryStartAt?: string | null
  prodatSentAt?: string | null
  nextAction?: string | null
  assignedTo?: string | null
  source?: string | null
  actorUserId?: string | null
}

export function customerCaseTypeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    withdrawal: 'Ånger',
    rejected_customer: 'Nekad kund',
    onboarding_aborted: 'Avbruten onboarding',
    supplier_switch_aborted: 'Avbrutet leverantörsbyte',
    sales_misunderstanding: 'Missförstått säljare',
    dual_invoice_concern: 'Kunden vill inte ha två fakturor',
    binding_period_too_long: 'För lång bindningstid',
    incorrect_identity: 'Fel personuppgifter',
    incorrect_site_data: 'Fel anläggningsuppgifter',
    missing_authorization: 'Saknad fullmakt',
    credit_risk: 'Kredit-/riskorsak',
    technical_blocker: 'Teknisk blockerare',
    other: 'Annan orsak',
  }

  return labels[String(value ?? '')] ?? 'Kundärende'
}

export function customerCaseStatusLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    open: 'Öppen',
    action_required: 'Kräver åtgärd',
    awaiting_external_response: 'Väntar externt svar',
    billing_blocked: 'Fakturering blockerad',
    manual_follow_up: 'Manuell uppföljning',
    resolved: 'Löst',
    cancelled: 'Avbruten',
    closed: 'Stängd',
  }

  return labels[String(value ?? '')] ?? String(value ?? 'Okänd')
}

export async function listCustomerCases(options: {
  companyId?: string | null
  customerId?: string | null
  status?: string | null
  type?: string | null
  query?: string | null
  limit?: number
} = {}): Promise<CustomerCaseListRow[]> {
  let query = supabaseService
    .from('customer_cases')
    .select('*, customers(full_name, first_name, last_name, company_name, email, customer_number)')
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 200)

  if (options.companyId) query = query.eq('company_id', options.companyId)
  if (options.customerId) query = query.eq('customer_id', options.customerId)
  if (options.status && options.status !== 'all') query = query.eq('status', options.status)
  if (options.type && options.type !== 'all') query = query.eq('case_type', options.type)
  if (options.query?.trim()) {
    query = query.or(`title.ilike.%${options.query.trim()}%,description.ilike.%${options.query.trim()}%,reason_category.ilike.%${options.query.trim()}%`)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    const personName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
    const customerName = customer?.full_name ?? (personName || customer?.company_name || null)

    const { customers: _customers, ...rest } = row as Record<string, unknown>
    return {
      ...(rest as CustomerCaseRow),
      customer_name: customerName,
      customer_email: typeof customer?.email === 'string' ? customer.email : null,
      customer_number: typeof customer?.customer_number === 'string' ? customer.customer_number : null,
    }
  })
}

export async function getCustomerCaseById(id: string, companyId?: string | null): Promise<CustomerCaseRow | null> {
  let query = supabaseService.from('customer_cases').select('*').eq('id', id)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return (data as CustomerCaseRow | null) ?? null
}

export async function listCustomerCaseEvents(caseId: string, companyId?: string | null): Promise<CustomerCaseEventRow[]> {
  let query = supabaseService
    .from('customer_case_events')
    .select('*')
    .eq('customer_case_id', caseId)
    .order('created_at', { ascending: false })
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as CustomerCaseEventRow[]
}

export async function createCustomerCaseEvent(input: {
  companyId: string
  customerCaseId: string
  customerId: string
  eventType: string
  eventStatus?: 'info' | 'success' | 'warning' | 'error'
  message: string
  payload?: Record<string, unknown>
  actorUserId?: string | null
}) {
  const { error } = await supabaseService.from('customer_case_events').insert({
    company_id: input.companyId,
    customer_case_id: input.customerCaseId,
    customer_id: input.customerId,
    event_type: input.eventType,
    event_status: input.eventStatus ?? 'info',
    message: input.message,
    payload: input.payload ?? {},
    created_by: input.actorUserId ?? null,
  })
  if (error) throw error
}

async function logAudit(input: {
  companyId: string
  customerCaseId: string
  customerId: string
  action: string
  actorUserId?: string | null
  newValues?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    company_id: input.companyId,
    actor_user_id: input.actorUserId ?? null,
    entity_type: 'customer_case',
    entity_id: input.customerCaseId,
    action: input.action,
    new_values: input.newValues ?? null,
    metadata: {
      customer_id: input.customerId,
    },
  })

  if (error && !['42P01', '42703', 'PGRST205'].includes(error.code ?? '')) throw error
}

export async function createCustomerCase(input: CustomerCaseInput): Promise<CustomerCaseRow> {
  const assessment = assessWithdrawal({
    caseType: input.caseType,
    agreementCreatedAt: input.agreementCreatedAt,
    agreementChannel: input.agreementChannel,
    isDistanceAgreement: input.isDistanceAgreement,
    withdrawalInformationSentAt: input.withdrawalInformationSentAt,
    withdrawalRequestedAt: input.withdrawalRequestedAt,
    deliveryStartAt: input.deliveryStartAt,
    prodatSentAt: input.prodatSentAt,
  })

  const initialStatus = assessment.billingBlocked
    ? assessment.scenario === 'cannot_stop_switch'
      ? 'manual_follow_up'
      : 'billing_blocked'
    : 'open'

  const payload = {
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    customer_contract_id: input.customerContractId ?? null,
    supplier_switch_request_id: input.supplierSwitchRequestId ?? null,
    outbound_request_id: input.outboundRequestId ?? null,
    case_type: input.caseType,
    status: initialStatus,
    priority: input.priority ?? 'normal',
    title: input.title.trim(),
    description: input.description ?? null,
    reason_category: input.reasonCategory ?? input.caseType,
    agreement_channel: input.agreementChannel ?? null,
    is_distance_agreement: Boolean(input.isDistanceAgreement),
    agreement_created_at: input.agreementCreatedAt ?? null,
    withdrawal_information_sent_at: input.withdrawalInformationSentAt ?? null,
    withdrawal_deadline_at: assessment.withdrawalDeadlineAt,
    withdrawal_requested_at: input.withdrawalRequestedAt ?? (input.caseType === 'withdrawal' ? new Date().toISOString() : null),
    withdrawal_possible: assessment.withdrawalPossible,
    switch_can_be_stopped: assessment.switchCanBeStopped,
    delivery_start_at: input.deliveryStartAt ?? null,
    withdrawal_scenario: assessment.scenario,
    cancellation_required: assessment.cancellationRequired,
    cancellation_status: assessment.cancellationStatus,
    cancellation_reference: assessment.cancellationRequired ? `CANCEL-${randomUUID().slice(0, 8).toUpperCase()}` : null,
    billing_blocked: assessment.billingBlocked,
    billing_manual_review: assessment.billingManualReview,
    break_fee_flagged: assessment.breakFeeFlagged,
    next_action: input.nextAction ?? assessment.nextAction,
    assigned_to: input.assignedTo ?? null,
    source: input.source ?? 'admin_customer_cases',
    metadata: {
      prodatSentAt: input.prodatSentAt ?? null,
      assessment,
    },
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  }

  const { data, error } = await supabaseService.from('customer_cases').insert(payload).select('*').single()
  if (error) throw error

  const row = data as CustomerCaseRow

  await createCustomerCaseEvent({
    companyId: row.company_id,
    customerCaseId: row.id,
    customerId: row.customer_id,
    eventType: 'created',
    eventStatus: row.case_type === 'withdrawal' ? 'warning' : 'info',
    message: `${customerCaseTypeLabel(row.case_type)} registrerat. ${row.next_action ?? ''}`.trim(),
    payload: { assessment },
    actorUserId: input.actorUserId ?? null,
  })

  if (row.billing_blocked || row.case_type === 'withdrawal') {
    await applyCustomerCaseOperationalStops(row, input.actorUserId ?? null)
    await createCustomerCaseEvent({
      companyId: row.company_id,
      customerCaseId: row.id,
      customerId: row.customer_id,
      eventType: 'operational_stop_applied',
      eventStatus: 'warning',
      message: 'Onboarding, outbound, mätvärdesbegäran och fakturering blockerades enligt ärendets status.',
      payload: { scenario: row.withdrawal_scenario, billingBlocked: row.billing_blocked },
      actorUserId: input.actorUserId ?? null,
    })
  }

  if (row.cancellation_required) {
    const message = await createCancellationDraftForCase(row, input.actorUserId ?? null)
    if (message) {
      await createCustomerCaseEvent({
        companyId: row.company_id,
        customerCaseId: row.id,
        customerId: row.customer_id,
        eventType: 'cancellation_draft_created',
        eventStatus: 'warning',
        message: 'Annulleringsutkast skapades och kopplades till ångerärendet.',
        payload: { edielMessageId: message.id },
        actorUserId: input.actorUserId ?? null,
      })
    }
  }

  await logAudit({
    companyId: row.company_id,
    customerCaseId: row.id,
    customerId: row.customer_id,
    action: row.case_type === 'withdrawal' ? 'withdrawal_registered' : 'customer_case_registered',
    actorUserId: input.actorUserId ?? null,
    newValues: row,
  })

  return (await getCustomerCaseById(row.id, row.company_id)) ?? row
}

export async function updateCustomerCaseStatus(input: {
  caseId: string
  companyId: string
  status: string
  message?: string | null
  actorUserId?: string | null
}) {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_by: input.actorUserId ?? null,
    updated_at: now,
  }

  if (input.status === 'resolved') patch.resolved_at = now
  if (input.status === 'closed') patch.closed_at = now

  const { data, error } = await supabaseService
    .from('customer_cases')
    .update(patch)
    .eq('id', input.caseId)
    .eq('company_id', input.companyId)
    .select('*')
    .single()
  if (error) throw error

  const row = data as CustomerCaseRow
  await createCustomerCaseEvent({
    companyId: row.company_id,
    customerCaseId: row.id,
    customerId: row.customer_id,
    eventType: 'status_changed',
    eventStatus: input.status === 'closed' || input.status === 'resolved' ? 'success' : 'info',
    message: input.message?.trim() || `Ärendet uppdaterades till ${input.status}.`,
    payload: { status: input.status },
    actorUserId: input.actorUserId ?? null,
  })

  await logAudit({
    companyId: row.company_id,
    customerCaseId: row.id,
    customerId: row.customer_id,
    action: 'customer_case_status_changed',
    actorUserId: input.actorUserId ?? null,
    newValues: { status: input.status, message: input.message ?? null },
  })

  return row
}


export async function syncCustomerCaseCancellationAck(params: {
  actorUserId: string
  sourceMessage: EdielMessageRow
  ackMessage: EdielMessageRow
  outcome: 'positive' | 'negative'
  finalAckReached: boolean
}) {
  if (!params.sourceMessage.company_id) return null

  const { data, error } = await supabaseService
    .from('customer_cases')
    .select('*')
    .eq('cancellation_ediel_message_id', params.sourceMessage.id)
    .eq('company_id', params.sourceMessage.company_id)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as CustomerCaseRow
  const now = new Date().toISOString()
  const negative = params.outcome === 'negative'
  const finalPositive = params.outcome === 'positive' && params.finalAckReached
  const nextCancellationStatus = negative ? 'rejected' : finalPositive ? 'accepted' : 'sent'
  const nextStatus = negative ? 'manual_follow_up' : finalPositive ? 'resolved' : 'awaiting_external_response'
  const nextAction = negative
    ? 'Annulleringen fick negativ kvittens. Kontrollera feltext, kontakta nätägare och håll fakturering blockerad.'
    : finalPositive
      ? 'Annullering kvitterad. Behåll historiken och säkerställ att fakturering inte startar för avbrutet byte.'
      : 'Annullering skickad. Väntar på komplett CONTRL/APERAK-kedja.'

  const metadata = {
    ...(row.metadata ?? {}),
    cancellationAck: {
      ackMessageId: params.ackMessage.id,
      ackFamily: params.ackMessage.message_family,
      outcome: params.outcome,
      finalAckReached: params.finalAckReached,
      processedAt: now,
    },
  }

  const { data: updated, error: updateError } = await supabaseService
    .from('customer_cases')
    .update({
      status: nextStatus,
      cancellation_status: nextCancellationStatus,
      billing_blocked: true,
      billing_manual_review: !finalPositive,
      next_action: nextAction,
      metadata,
      resolved_at: finalPositive ? now : row.resolved_at,
      updated_by: params.actorUserId,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('company_id', row.company_id)
    .select('*')
    .single()

  if (updateError) throw updateError

  await createCustomerCaseEvent({
    companyId: row.company_id,
    customerCaseId: row.id,
    customerId: row.customer_id,
    eventType: negative ? 'cancellation_ack_rejected' : finalPositive ? 'cancellation_ack_accepted' : 'cancellation_ack_received',
    eventStatus: negative ? 'error' : finalPositive ? 'success' : 'info',
    message: nextAction,
    payload: metadata.cancellationAck,
    actorUserId: params.actorUserId,
  })

  await logAudit({
    companyId: row.company_id,
    customerCaseId: row.id,
    customerId: row.customer_id,
    action: negative ? 'cancellation_ack_rejected' : finalPositive ? 'cancellation_ack_accepted' : 'cancellation_ack_received',
    actorUserId: params.actorUserId,
    newValues: {
      customerCaseId: row.id,
      cancellationEdielMessageId: params.sourceMessage.id,
      ackMessageId: params.ackMessage.id,
      outcome: params.outcome,
      finalAckReached: params.finalAckReached,
    },
  })

  return updated as CustomerCaseRow
}
