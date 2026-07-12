import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { gridexBusinessMessageLabel } from '@/lib/ediel/businessLabels'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'

export type InboundBusinessOutcome =
  | 'grid_owner_information_received'
  | 'supplier_switch_accepted'
  | 'supplier_switch_completed'
  | 'supplier_switch_cancelled_before_start'
  | 'assigned_supply_started'
  | 'mandatory_purchase_supply_started'
  | 'supply_termination_requested'
  | 'supply_terminated'
  | 'permission_requested'
  | 'permission_confirmed'
  | 'permission_rejected'
  | 'permission_ended'
  | 'supplier_switch_changed'
  | 'supplier_switch_review_required'
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

async function endActiveSupplyPeriod(message: EdielMessageRow): Promise<string> {
  const payload = readPayloadRecord(message)
  const companyId = message.company_id ?? text(payload.resolved_company_id)
  const customerId = message.customer_id ?? null
  const meteringPointId = message.metering_point_id ?? null
  const endDate = dateOnly(payload.end_date) ?? dateOnly(payload.endDate) ?? dateOnly(payload.supply_end_date)
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
  if (outcome === 'supplier_switch_accepted') return 'Leverantörsbytet är bekräftat.'
  if (outcome === 'supplier_switch_cancelled_before_start') return 'Leverantörsbytet har cancellerats och ska inte starta.'
  if (outcome === 'assigned_supply_started') return 'Anvisad elleverans har registrerats.'
  if (outcome === 'mandatory_purchase_supply_started') return 'Mottagningspliktig leverans har registrerats.'
  if (outcome === 'supply_termination_requested') return 'Begäran om hävning av leveransen är mottagen.'
  if (outcome === 'supply_terminated') return 'Leveransen har avslutats enligt nätägarens bekräftelse.'
  if (outcome === 'permission_requested') return 'Begäran om mätvärdestillstånd är mottagen.'
  if (outcome === 'permission_confirmed') return 'Mätvärdestillståndet är bekräftat.'
  if (outcome === 'permission_rejected') return 'Mätvärdestillståndet har avvisats.'
  if (outcome === 'permission_ended') return 'Mätvärdestillståndet har avslutats.'
  if (outcome === 'supplier_switch_completed') return 'Leveransförändringen är mottagen.'
  if (outcome === 'supplier_switch_review_required') return 'Meddelande om leveransstart/inflyttning mottaget. Granska innan leverantörsbytet markeras klart.'
  if (outcome === 'supplier_switch_changed') return 'Ändrade anläggningsuppgifter är mottagna och behöver granskas innan masterdata uppdateras.'
  if (outcome === 'metering_values_received') return 'Mätvärden är mottagna och behandlas för fakturering.'
  if (outcome === 'business_rejection') return 'Mottagaren har avvisat meddelandet. Åtgärd krävs.'
  if (outcome === 'technical_rejection') return 'Meddelandet har tekniskt formatfel. Plattformsadministratör behöver granska.'
  if (outcome === 'metering_values_error') return 'Fel i mätvärdesmeddelande. Plattformsadministratör behöver granska.'
  return gridexBusinessMessageLabel({ family: message.message_family, code: message.message_code }, 'tenant')
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
  const reviewRequired = ['supplier_switch_changed', 'supplier_switch_review_required', 'business_rejection', 'technical_rejection', 'metering_values_error', 'manual_review_required', 'permission_rejected'].includes(outcome)
  const tenantMessage = tenantMessageForOutcome(outcome, input.message)
  const companyId = input.message.company_id ?? text(readPayloadRecord(input.message).resolved_company_id) ?? null
  if (!companyId && outcome !== 'ignored') throw new Error('business_state_company_required')
  const prodatLifecycle = String(input.message.message_family ?? '').toUpperCase() === 'PRODAT'
    ? decideProdatLifecycle(input.message)
    : null

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
    if (await strictUpdate('supplier_switch_requests', {
      status: 'accepted',
      external_reference: input.message.external_reference ?? undefined,
      updated_at: new Date().toISOString(),
    }, { id: input.matchedSwitchRequestId, company_id: companyId })) updated.push('supplier_switch_requests')
    const supplyPeriodId = await ensureSupplyPeriodFromSwitch({ message: input.message, status: 'confirmed_by_grid_owner' })
    if (supplyPeriodId) updated.push('customer_supply_periods')
  }

  if (outcome === 'assigned_supply_started' || outcome === 'mandatory_purchase_supply_started') {
    const supplyPeriodId = await ensureSupplyPeriodFromSwitch({ message: input.message, status: 'active' })
    if (supplyPeriodId) updated.push('customer_supply_periods')
  }

  if (outcome === 'supply_terminated') {
    const supplyPeriodId = await endActiveSupplyPeriod(input.message)
    if (supplyPeriodId) updated.push('customer_supply_periods')
  }

  if (outcome === 'supplier_switch_completed' && input.matchedSwitchRequestId) {
    if (await strictUpdate('supplier_switch_requests', {
      status: 'completed',
      completed_at: new Date().toISOString(),
      external_reference: input.message.external_reference ?? undefined,
      updated_at: new Date().toISOString(),
    }, { id: input.matchedSwitchRequestId, company_id: companyId })) updated.push('supplier_switch_requests')
    const supplyPeriodId = await ensureSupplyPeriodFromSwitch({ message: input.message, status: 'active' })
    if (supplyPeriodId) updated.push('customer_supply_periods')
  }

  if (outcome === 'supplier_switch_review_required' && input.matchedSwitchRequestId) {
    if (await strictUpdate('supplier_switch_requests', {
      status: 'manual_followup_required',
      external_reference: input.message.external_reference ?? undefined,
      updated_at: new Date().toISOString(),
    }, { id: input.matchedSwitchRequestId, company_id: companyId })) updated.push('supplier_switch_requests')
    await strictInsert('customer_cases', {
      company_id: companyId,
      customer_id: input.message.customer_id ?? null,
      customer_site_id: input.message.site_id ?? null,
      supplier_switch_request_id: input.matchedSwitchRequestId,
      case_type: 'supplier_switch_review',
      status: 'open',
      priority: 'normal',
      title: 'Leveransstart mottagen – granska leverantörsbytet',
      description: 'Nätägaren har skickat ett meddelande om leveransstart/inflyttning (PRODAT Z05). Granska och bekräfta att leverantörsbytet ska markeras som klart.',
      reason_category: 'ediel_inbound_review',
      next_action: 'Granska meddelandet och bekräfta leveransstart på kundkortet.',
      source: 'ediel_inbound_state_machine',
      metadata: { source_ediel_message_id: input.message.id, message_code: 'Z05' },
    })
  }

  if (outcome === 'business_rejection' || outcome === 'technical_rejection' || outcome === 'metering_values_error') {
    await strictInsert('customer_cases', {
      company_id: companyId,
      customer_id: input.message.customer_id ?? null,
      customer_site_id: input.message.site_id ?? null,
      supplier_switch_request_id: input.matchedSwitchRequestId ?? input.message.switch_request_id ?? null,
      case_type: outcome,
      status: 'open',
      priority: outcome === 'technical_rejection' ? 'high' : 'normal',
      title: tenantMessage,
      description: tenantMessage,
      source: 'inbound_business_state_machine',
      metadata: {
        edielMessageId: input.message.id,
        family: input.message.message_family,
        code: input.message.message_code,
        source: input.source ?? null,
      },
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
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
  return result
}
