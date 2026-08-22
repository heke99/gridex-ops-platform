import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { gridexBusinessMessageLabel } from '@/lib/ediel/businessLabels'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { applyInboundZ15PermissionState } from '@/lib/ediel/flows/prodatPermissionLifecycle'
import { enqueueCustomerLifecycleNotification } from '@/lib/customer-notifications/notificationOrchestrator'
import { transitionCorrelatedCustomerApplicationWorkflow } from '@/lib/website/customerApplicationWorkflowBridge'

export type InboundBusinessOutcome =
  | 'grid_owner_information_received'
  | 'supplier_switch_accepted'
  | 'supplier_switch_completed'
  | 'supplier_switch_cancelled_before_start'
  | 'assigned_supply_started'
  | 'mandatory_purchase_supply_started'
  | 'supply_termination_requested'
  | 'supply_terminated'
  | 'supply_continuation_confirmed'
  | 'masterdata_update_received'
  | 'meter_change_received'
  | 'permission_requested'
  | 'permission_confirmed'
  | 'permission_rejected'
  | 'permission_ended'
  | 'permission_continues'
  | 'unexpected_direction_review'
  | 'metering_values_received'
  | 'business_rejection'
  | 'technical_rejection'
  | 'metering_values_error'
  | 'manual_review_required'
  | 'ignored'

export type InboundBusinessStateResult = {
  outcome: InboundBusinessOutcome
  tenantMessage: string
  reviewRequired: boolean
  updated: string[]
  metadata: Record<string, unknown>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dateOnly(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

function readPayloadRecord(message: EdielMessageRow): Record<string, unknown> {
  const parsed = message.parsed_payload
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

async function strictUpdate(table: string, values: Record<string, unknown>, filters: Record<string, string | null | undefined>) {
  let query = supabaseService.from(table).update(values)
  for (const [key, value] of Object.entries(filters)) {
    if (!value) throw new Error(`business_state_filter_required:${table}:${key}`)
    query = query.eq(key, value)
  }
  const { data, error } = await query.select('id')
  if (error) throw error
  if (!Array.isArray(data) || data.length !== 1) throw new Error(`business_state_update_missed:${table}`)
  return true
}

async function strictInsert(table: string, values: Record<string, unknown>) {
  const { data, error } = await supabaseService.from(table).insert(values).select('id').single()
  if (error) throw error
  const id = text((data as { id?: string } | null)?.id)
  if (!id) throw new Error(`business_state_insert_missing_id:${table}`)
  return id
}

async function recordEvent(input: {
  actorUserId: string
  message: EdielMessageRow
  result: InboundBusinessStateResult
}) {
  await createEdielMessageEvent({
    actorUserId: input.actorUserId,
    edielMessageId: input.message.id,
    eventType: 'manual_note',
    eventStatus: input.result.reviewRequired ? 'warning' : 'success',
    message: input.result.tenantMessage,
    payload: {
      businessStateMachine: true,
      outcome: input.result.outcome,
      tenantMessage: input.result.tenantMessage,
      updated: input.result.updated,
      reviewRequired: input.result.reviewRequired,
      ...input.result.metadata,
    },
  })
}

async function ensureSupplyPeriodFromSwitch(input: {
  message: EdielMessageRow
  status: 'active' | 'confirmed_by_grid_owner' | 'ended'
}) {
  const companyId = input.message.company_id ?? text(readPayloadRecord(input.message).resolved_company_id) ?? null
  const customerId = input.message.customer_id ?? null
  const meteringPointId = input.message.metering_point_id ?? null
  if (!companyId || !customerId || !meteringPointId) return null

  const parsed = readPayloadRecord(input.message)
  const startDate = dateOnly(parsed.start_date) ?? dateOnly(parsed.startDate) ?? dateOnly(parsed.supply_start_date)
  if (!startDate) throw new Error('supply_period_start_date_required')
  const endDate = input.status === 'ended'
    ? dateOnly(parsed.end_date) ?? dateOnly(parsed.endDate) ?? dateOnly(parsed.supply_end_date)
    : null

  const { data: existing, error: existingError } = await supabaseService
    .from('customer_supply_periods')
    .select('id')
    .eq('company_id', companyId)
    .eq('metering_point_id', meteringPointId)
    .eq('customer_id', customerId)
    .lte('start_date', startDate)
    .or(`end_date.is.null,end_date.gte.${startDate}`)
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  if ((existing as { id?: string } | null)?.id) {
    const id = (existing as { id: string }).id
    await strictUpdate('customer_supply_periods', {
      status: input.status,
      end_date: endDate ?? undefined,
      source_message_id: input.message.id,
      updated_at: new Date().toISOString(),
    }, { id, company_id: companyId })
    return id
  }

  return strictInsert('customer_supply_periods', {
    company_id: companyId,
    customer_id: customerId,
    metering_point_id: meteringPointId,
    contract_id: text(readPayloadRecord(input.message).contract_id) ?? null,
    start_date: startDate,
    end_date: endDate,
    source: 'ediel_inbound_state_machine',
    source_message_id: input.message.id,
    status: input.status,
  })
}

async function activateCustomerSupplyAtomically(input: {
  message: EdielMessageRow
  switchRequestId: string
  actorUserId: string
}) {
  const payload = readPayloadRecord(input.message)
  const companyId = input.message.company_id ?? text(payload.resolved_company_id)
  if (!companyId) throw new Error('supply_activation_company_required')
  const actualStartDate = dateOnly(payload.actual_start_date)
    ?? dateOnly(payload.start_date)
    ?? dateOnly(payload.startDate)
    ?? dateOnly(payload.supply_start_date)
  const response = await supabaseService.rpc('activate_customer_supply_v1', {
    p_company_id: companyId,
    p_supplier_switch_request_id: input.switchRequestId,
    p_source_message_id: input.message.id,
    p_actual_start_date: actualStartDate,
    p_actor_user_id: input.actorUserId,
    p_idempotency_key: `activate_customer_supply_v1:${input.message.id}:${input.switchRequestId}`,
  })
  if (response.error) throw response.error
  const row = Array.isArray(response.data) ? response.data[0] : response.data
  if (!row || typeof row !== 'object') throw new Error('supply_activation_result_missing')
  return row as Record<string, unknown>
}

async function endActiveSupplyPeriod(message: EdielMessageRow): Promise<string> {
  const payload = readPayloadRecord(message)
  const companyId = message.company_id ?? text(payload.resolved_company_id)
  const customerId = message.customer_id ?? null
  const meteringPointId = message.metering_point_id ?? null
  const endDate = dateOnly(payload.end_date) ?? dateOnly(payload.endDate) ?? dateOnly(payload.supply_end_date) ?? dateOnly(payload.start_date)
  if (!companyId) throw new Error('supply_period_company_required')
  if (!customerId) throw new Error('supply_period_customer_required')
  if (!meteringPointId) throw new Error('supply_period_metering_point_required')
  if (!endDate) throw new Error('supply_period_end_date_required')

  const { data, error } = await supabaseService
    .from('customer_supply_periods')
    .select('id')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .eq('metering_point_id', meteringPointId)
    .is('end_date', null)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const id = text((data as { id?: string } | null)?.id)
  if (!id) throw new Error('active_supply_period_not_found')
  await strictUpdate('customer_supply_periods', {
    status: 'ended',
    end_date: endDate,
    source_message_id: message.id,
    updated_at: new Date().toISOString(),
  }, { id, company_id: companyId })
  return id
}

async function continueSupplyPeriodFromZ05C(message: EdielMessageRow): Promise<{ id: string | null; changed: boolean; review: boolean }> {
  const payload = readPayloadRecord(message)
  const companyId = message.company_id ?? text(payload.resolved_company_id)
  const customerId = message.customer_id ?? null
  const meteringPointId = message.metering_point_id ?? null
  if (!companyId || !customerId || !meteringPointId) return { id: null, changed: false, review: true }

  const { data, error } = await supabaseService
    .from('customer_supply_periods')
    .select('id,status,start_date,end_date')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .eq('metering_point_id', meteringPointId)
    .order('start_date', { ascending: false })
    .limit(3)
  if (error) throw error

  const rows = (data ?? []) as Array<{ id: string; status?: string | null; start_date?: string | null; end_date?: string | null }>
  const active = rows.find((row) => !row.end_date && row.status !== 'ended')
  if (active) return { id: active.id, changed: false, review: false }

  const cancellationDate =
    dateOnly(payload.end_date)
    ?? dateOnly(payload.endDate)
    ?? dateOnly(payload.supply_end_date)
    ?? dateOnly(payload.start_date)
    ?? dateOnly(payload.startDate)

  const candidates = rows.filter((row) => row.end_date && (!cancellationDate || row.end_date === cancellationDate))
  if (candidates.length !== 1) return { id: null, changed: false, review: true }

  const candidate = candidates[0]
  await strictUpdate('customer_supply_periods', {
    status: 'active',
    end_date: null,
    source_message_id: message.id,
    updated_at: new Date().toISOString(),
  }, { id: candidate.id, company_id: companyId })
  return { id: candidate.id, changed: true, review: false }
}

async function createReviewCase(input: {
  message: EdielMessageRow
  companyId: string
  switchRequestId?: string | null
  caseType: string
  title: string
  description: string
  nextAction?: string | null
  priority?: 'normal' | 'high'
}) {
  return strictInsert('customer_cases', {
    company_id: input.companyId,
    customer_id: input.message.customer_id ?? null,
    customer_site_id: input.message.site_id ?? null,
    supplier_switch_request_id: input.switchRequestId ?? input.message.switch_request_id ?? null,
    case_type: input.caseType,
    status: 'open',
    priority: input.priority ?? 'normal',
    title: input.title,
    description: input.description,
    reason_category: 'ediel_inbound_review',
    next_action: input.nextAction ?? null,
    source: 'ediel_inbound_state_machine',
    metadata: {
      source_ediel_message_id: input.message.id,
      message_family: input.message.message_family,
      message_code: input.message.message_code,
      payload: readPayloadRecord(input.message),
    },
  })
}

function outcomeForMessage(message: EdielMessageRow): InboundBusinessOutcome {
  const family = String(message.message_family ?? '').toUpperCase()
  const code = String(message.message_code ?? '').toUpperCase()
  const outcome = String(message.ack_outcome ?? '').toLowerCase()
  const status = String(message.status ?? '').toLowerCase()

  if (family === 'APERAK' && (outcome === 'negative' || status === 'failed')) return 'business_rejection'
  if (family === 'CONTRL' && (outcome === 'negative' || status === 'failed')) return 'technical_rejection'
  if (family === 'UTILTS_ERR') return 'metering_values_error'
  if (family === 'UTILTS' && code === 'E66') return 'metering_values_received'
  if (family === 'PRODAT') {
    const lifecycle = decideProdatLifecycle(message)
    if (lifecycle) return lifecycle.outcome
  }
  return 'ignored'
}

function tenantMessageForOutcome(outcome: InboundBusinessOutcome, message: EdielMessageRow): string {
  if (outcome === 'grid_owner_information_received') return 'Svar från nätägaren mottaget.'
  if (outcome === 'supplier_switch_accepted') return 'Leverantörsbytet är bekräftat av nätägaren.'
  if (outcome === 'supplier_switch_cancelled_before_start') return 'Leverantörsbytet har återtagits och ska inte starta.'
  if (outcome === 'assigned_supply_started') return 'Anvisad elleverans har registrerats.'
  if (outcome === 'mandatory_purchase_supply_started') return 'Mottagningspliktig leverans har registrerats.'
  if (outcome === 'supply_termination_requested') return 'Begäran om att avsluta leveransen är registrerad.'
  if (outcome === 'supply_terminated') return 'Leveransen upphör enligt nätägarens besked.'
  if (outcome === 'supply_continuation_confirmed') return 'Leveransen fortsätter. Tidigare avslut har återtagits.'
  if (outcome === 'masterdata_update_received') return 'Ändrade kund-/anläggningsuppgifter är mottagna och väntar på säker granskning.'
  if (outcome === 'meter_change_received') return 'Mätarbyte är mottaget och väntar på säker granskning.'
  if (outcome === 'permission_requested') return 'Begäran om mätvärdesrapportering är registrerad.'
  if (outcome === 'permission_confirmed') return 'Mätvärdesåtkomsten är godkänd.'
  if (outcome === 'permission_rejected') return 'Mätvärdesåtkomsten har nekats.'
  if (outcome === 'permission_ended') return 'Mätvärdesrapporteringen har avslutats.'
  if (outcome === 'permission_continues') return 'Mätvärdesrapporteringen fortsätter. Tidigare avslut har återtagits.'
  if (outcome === 'unexpected_direction_review') return 'Ediel-meddelandet har oväntad riktning för Gridex marknadsroll och har stoppats för granskning.'
  if (['supplier_switch_completed'].includes(outcome)) return 'Leveransförändringen är mottagen.'
  if (outcome === 'metering_values_received') return 'Mätvärden är mottagna och behandlas för fakturering.'
  if (outcome === 'business_rejection') return 'Mottagaren har avvisat meddelandet. Åtgärd krävs.'
  if (outcome === 'technical_rejection') return 'Meddelandet har tekniskt formatfel. Plattformsadministratör behöver granska.'
  if (outcome === 'metering_values_error') return 'Fel i mätvärdesmeddelande. Plattformsadministratör behöver granska.'
  const lifecycle = decideProdatLifecycle(message)
  return gridexBusinessMessageLabel({
    family: message.message_family,
    code: message.message_code,
    subtype: lifecycle?.subtype ?? null,
  }, 'tenant')
}

export async function applyInboundBusinessStateMachine(input: {
  actorUserId: string
  message: EdielMessageRow
  matchedSwitchRequestId?: string | null
  customerInfoRequestId?: string | null
  source?: string
}): Promise<InboundBusinessStateResult> {
  const outcome = outcomeForMessage(input.message)
  const updated: string[] = []
  let reviewRequired = [
    'business_rejection',
    'technical_rejection',
    'metering_values_error',
    'manual_review_required',
    'permission_rejected',
    'masterdata_update_received',
    'meter_change_received',
    'unexpected_direction_review',
  ].includes(outcome)
  const tenantMessage = tenantMessageForOutcome(outcome, input.message)
  const companyId = input.message.company_id ?? text(readPayloadRecord(input.message).resolved_company_id) ?? null
  if (!companyId && outcome !== 'ignored') throw new Error('business_state_company_required')
  const prodatLifecycle = String(input.message.message_family ?? '').toUpperCase() === 'PRODAT'
    ? decideProdatLifecycle(input.message)
    : null
  let supplyActivationCommitted = false

  if (outcome === 'grid_owner_information_received') {
    const customerInfoRequestId = input.customerInfoRequestId ?? text(readPayloadRecord(input.message).customer_info_request_id) ?? null
    if (await strictUpdate('customer_info_requests', {
      status: 'z02_received',
      completed_at: new Date().toISOString(),
      ediel_message_id: input.message.id,
      updated_at: new Date().toISOString(),
      verified_payload: {
        businessState: 'grid_owner_information_received',
        sourceEdielMessageId: input.message.id,
      },
    }, { id: customerInfoRequestId, company_id: companyId })) updated.push('customer_info_requests')
  }

  if (outcome === 'supplier_switch_cancelled_before_start' && input.matchedSwitchRequestId) {
    if (await strictUpdate('supplier_switch_requests', {
      status: 'cancelled_before_start',
      completed_at: new Date().toISOString(),
      external_reference: input.message.external_reference ?? undefined,
      inbound_z04_message_id: input.message.id,
      updated_at: new Date().toISOString(),
    }, { id: input.matchedSwitchRequestId, company_id: companyId })) updated.push('supplier_switch_requests')
  }

  if (outcome === 'supplier_switch_accepted' && input.matchedSwitchRequestId) {
    const payload = readPayloadRecord(input.message)
    if (await strictUpdate('supplier_switch_requests', {
      status: 'accepted',
      external_reference: input.message.external_reference ?? undefined,
      inbound_z04_message_id: input.message.id,
      confirmed_start_date:
        dateOnly(payload.actual_start_date)
        ?? dateOnly(payload.start_date)
        ?? dateOnly(payload.startDate)
        ?? undefined,
      updated_at: new Date().toISOString(),
    }, { id: input.matchedSwitchRequestId, company_id: companyId })) updated.push('supplier_switch_requests')
    // Z04 confirms the market change; it does not activate supply before the
    // effective date. The supply period remains confirmed_by_grid_owner.
    const supplyPeriodId = await ensureSupplyPeriodFromSwitch({ message: input.message, status: 'confirmed_by_grid_owner' })
    if (supplyPeriodId) updated.push('customer_supply_periods')
  }

  if (outcome === 'assigned_supply_started' || outcome === 'mandatory_purchase_supply_started') {
    if (!input.matchedSwitchRequestId) throw new Error('regulated_supply_contract_and_switch_required')
    const confirmed = await strictUpdate('supplier_switch_requests', {
      status: 'accepted',
      external_reference: input.message.external_reference ?? undefined,
      inbound_z04_message_id: input.message.id,
      confirmed_start_date:
        dateOnly(readPayloadRecord(input.message).actual_start_date)
        ?? dateOnly(readPayloadRecord(input.message).start_date)
        ?? undefined,
      updated_at: new Date().toISOString(),
    }, { id: input.matchedSwitchRequestId, company_id: companyId })
    if (!confirmed) throw new Error('regulated_supply_switch_confirmation_failed')
    await activateCustomerSupplyAtomically({
      message: input.message,
      switchRequestId: input.matchedSwitchRequestId,
      actorUserId: input.actorUserId,
    })
    supplyActivationCommitted = true
    updated.push(
      'supplier_switch_requests',
      'customer_supply_periods',
      'customer_contracts',
      'customer_application_workflows',
      'website_customer_applications',
      'domain_events',
      'customer_operation_jobs',
      'webhook_deliveries',
    )
  }

  if (outcome === 'supply_terminated') {
    const supplyPeriodId = await endActiveSupplyPeriod(input.message)
    if (supplyPeriodId) updated.push('customer_supply_periods')
    if (companyId) {
      const caseId = await createReviewCase({
        message: input.message,
        companyId,
        switchRequestId: input.matchedSwitchRequestId ?? null,
        caseType: 'final_metering_and_billing',
        title: 'Leveransen upphör – slutför mätvärden och fakturering',
        description: 'Nätägaren har meddelat att leveransen upphör. Säkerställ slutmätvärden och slutfakturering utan att ändra historiska leveransperioder.',
        nextAction: 'Kontrollera slutmätvärden och faktureringsberedskap för leveransens slutdatum.',
      })
      if (caseId) updated.push('customer_cases')
    }
  }

  if (outcome === 'supply_continuation_confirmed') {
    const continuation = await continueSupplyPeriodFromZ05C(input.message)
    if (continuation.changed) updated.push('customer_supply_periods')
    if (continuation.review && companyId) {
      reviewRequired = true
      const caseId = await createReviewCase({
        message: input.message,
        companyId,
        switchRequestId: input.matchedSwitchRequestId ?? null,
        caseType: 'supply_continuation_review',
        title: 'Leveransen ska fortsätta – kontroll krävs',
        description: 'PRODAT Z05C återtar ett tidigare leveransavslut, men systemet kunde inte entydigt identifiera vilken avslutad leveransperiod som ska återöppnas.',
        nextAction: 'Verifiera leveransperioden och återställ den endast om Z05C refererar till samma avslut.',
      })
      if (caseId) updated.push('customer_cases')
    }
  }

  if (outcome === 'supplier_switch_completed' && input.matchedSwitchRequestId) {
    await activateCustomerSupplyAtomically({
      message: input.message,
      switchRequestId: input.matchedSwitchRequestId,
      actorUserId: input.actorUserId,
    })
    supplyActivationCommitted = true
    updated.push(
      'supplier_switch_requests',
      'customer_supply_periods',
      'customer_contracts',
      'customer_application_workflows',
      'website_customer_applications',
      'domain_events',
      'customer_operation_jobs',
      'webhook_deliveries',
    )
  }

  if (outcome === 'permission_ended' || outcome === 'permission_continues') {
    const permissionResult = await applyInboundZ15PermissionState({
      actorUserId: input.actorUserId,
      message: input.message,
    })
    if (permissionResult.applied) updated.push('metering_permissions')
    if (!permissionResult.applied) reviewRequired = true
  }

  if ((outcome === 'masterdata_update_received' || outcome === 'meter_change_received') && companyId) {
    const caseId = await createReviewCase({
      message: input.message,
      companyId,
      caseType: outcome === 'meter_change_received' ? 'meter_change_review' : 'masterdata_update_review',
      title: outcome === 'meter_change_received'
        ? 'Mätarbyte mottaget – granska säker uppdatering'
        : 'Masterdataändring mottagen – granska säker uppdatering',
      description: outcome === 'meter_change_received'
        ? 'PRODAT Z10M mottogs. Nuvarande mätarhistorik får inte skrivas över destruktivt; använd safe-apply/granskning.'
        : 'PRODAT Z06 mottogs. Uppdatera endast verifierade fält via safe-apply och bevara historik/effective date.',
      nextAction: 'Granska Ediel safe-apply-förslaget innan masterdata ändras.',
    })
    if (caseId) updated.push('customer_cases')
  }

  if (outcome === 'unexpected_direction_review' && companyId) {
    const caseId = await createReviewCase({
      message: input.message,
      companyId,
      caseType: 'ediel_unexpected_direction',
      title: 'Ediel-meddelande med oväntad marknadsriktning',
      description: 'Meddelandekoden ska normalt origineras av Gridex i den här marknadsrollen och får därför inte automatiskt ändra kund-, leverans- eller tillståndsstatus när den kommer inbound.',
      nextAction: 'Verifiera avsändarroll, meddelandekod, subtype och route innan någon affärseffekt tillåts.',
      priority: 'high',
    })
    if (caseId) updated.push('customer_cases')
  }

  if (outcome === 'business_rejection' || outcome === 'technical_rejection' || outcome === 'metering_values_error') {
    if (!companyId) throw new Error('business_state_company_required')
    await createReviewCase({
      message: input.message,
      companyId,
      switchRequestId: input.matchedSwitchRequestId ?? null,
      caseType: outcome,
      title: tenantMessage,
      description: tenantMessage,
      priority: outcome === 'technical_rejection' ? 'high' : 'normal',
    }).then((id) => { if (id) updated.push('customer_cases') })
  }

  const result: InboundBusinessStateResult = {
    outcome,
    tenantMessage,
    reviewRequired,
    updated,
    metadata: {
      companyId,
      messageFamily: input.message.message_family,
      messageCode: input.message.message_code,
      matchedSwitchRequestId: input.matchedSwitchRequestId ?? null,
      customerInfoRequestId: input.customerInfoRequestId ?? null,
      source: input.source ?? null,
      prodatProcess: prodatLifecycle?.process ?? null,
      prodatSubtype: prodatLifecycle?.subtype ?? null,
      prodatState: prodatLifecycle?.state ?? null,
    },
  }

  if (outcome !== 'ignored') await recordEvent({ actorUserId: input.actorUserId, message: input.message, result })

  const workflowState =
    outcome === 'supplier_switch_accepted' ? 'switch_confirmed'
      : outcome === 'supplier_switch_completed' || outcome === 'assigned_supply_started' || outcome === 'mandatory_purchase_supply_started' ? 'completed'
        : outcome === 'business_rejection' || outcome === 'technical_rejection' ? 'switch_rejected'
          : outcome === 'manual_review_required' || outcome === 'unexpected_direction_review' ? 'manual_review'
            : null
  if (!supplyActivationCommitted && workflowState && companyId && input.message.customer_id) {
    await transitionCorrelatedCustomerApplicationWorkflow({
      companyId,
      customerId: input.message.customer_id,
      siteId: input.message.site_id ?? null,
      operationId: text(readPayloadRecord(input.message).operation_id),
      state: workflowState,
      eventCode: `workflow.ediel.${outcome}`,
      reasonCode: workflowState === 'switch_rejected' || workflowState === 'manual_review' ? outcome : null,
      idempotencyKey: `workflow.ediel:${input.message.id}:${outcome}`,
      snapshotPatch: {
        next_action: workflowState === 'completed' ? 'none' : workflowState,
        ediel_message_id: input.message.id,
        supplier_switch_request_id: input.matchedSwitchRequestId ?? null,
        inbound_outcome: outcome,
      },
    })
  }

  const notificationEvent =
    outcome === 'supplier_switch_accepted' ? 'supplier_switch.accepted'
      : outcome === 'supplier_switch_completed' || outcome === 'assigned_supply_started' || outcome === 'mandatory_purchase_supply_started' ? 'supply_period.activated'
        : outcome === 'business_rejection' || outcome === 'technical_rejection' ? 'supplier_switch.rejected'
          : null
  if (!supplyActivationCommitted && notificationEvent && companyId && input.message.customer_id) {
    await enqueueCustomerLifecycleNotification({
      companyId,
      customerId: input.message.customer_id,
      eventType: notificationEvent,
      sourceEventId: `ediel:${input.message.id}:${outcome}`,
      siteId: input.message.site_id ?? null,
      meteringPointId: input.message.metering_point_id ?? null,
      contractId: text(readPayloadRecord(input.message).contract_id),
      payload: {
        ediel_message_id: input.message.id,
        supplier_switch_request_id: input.matchedSwitchRequestId ?? null,
        outcome,
        ...result.metadata,
      },
    }).catch((error) => {
      console.warn('[inbound-business-state] lifecycle notification enqueue skipped', error)
    })
  }
  return result
}
