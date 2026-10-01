import { applySupplyMarketSource } from './supplyMarketTransition'
import {publishSourceSwitchCommit, type SourceSwitchCommitObserver} from './sourceSwitchCommit'
import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { gridexBusinessMessageLabel } from '@/lib/ediel/businessLabels'
import { decideProdatLifecycle } from '@/lib/ediel/stateMachines/prodatLifecycle'
import { applyInboundZ15PermissionState } from '@/lib/ediel/flows/prodatPermissionLifecycle'
import { enqueueCustomerLifecycleNotification } from '@/lib/customer-notifications/notificationOrchestrator'
import { transitionCorrelatedCustomerApplicationWorkflow } from '@/lib/website/customerApplicationWorkflowBridge'
import { deriveEdielReviewProcessDecision } from '@/lib/ediel/operations/processNextAction'

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

async function createReviewCase(input: {
  message: EdielMessageRow
  companyId: string
  switchRequestId?: string | null
  caseType: 'other' | 'business_rejection' | 'technical_rejection' | 'metering_values_error'
  reviewIntent?: 'final_metering_and_billing' | 'supply_continuation_review' | 'meter_change_review' | 'masterdata_update_review' | 'ediel_unexpected_direction'
  title: string
  description: string
  nextAction?: string | null
  priority?: 'normal' | 'high'
}) {
  return strictInsert('customer_cases', {
    company_id: input.companyId,
    customer_id: input.message.customer_id ?? null,
    site_id: input.message.site_id ?? null,
    metering_point_id: input.message.metering_point_id ?? null,
    supplier_switch_request_id: input.switchRequestId ?? input.message.switch_request_id ?? null,
    case_type: input.caseType,
    status: 'open',
    priority: input.priority ?? 'normal',
    title: input.title,
    description: input.description,
    reason_category: input.reviewIntent ?? 'ediel_inbound_review',
    next_action: input.nextAction ?? null,
    source: 'ediel_inbound_state_machine',
    metadata: {
      process_next_action: deriveEdielReviewProcessDecision({message:input.message,reviewIntent:input.reviewIntent,nextAction:input.nextAction}),
      ...(input.reviewIntent ? { review_intent: input.reviewIntent } : {}),
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
  permissionSourceResult?: { applied: boolean; targetId: string | null; reason?: string | null }
  source?: string
  onSourceSwitchCommitted?: SourceSwitchCommitObserver
}): Promise<InboundBusinessStateResult> {
  let outcome = outcomeForMessage(input.message)
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
  let tenantMessage = tenantMessageForOutcome(outcome, input.message)
  const companyId = input.message.company_id ?? text(readPayloadRecord(input.message).resolved_company_id) ?? null
  if (!companyId && outcome !== 'ignored') throw new Error('business_state_company_required')
  const prodatLifecycle = String(input.message.message_family ?? '').toUpperCase() === 'PRODAT'
    ? decideProdatLifecycle(input.message)
    : null
  if (outcome === 'permission_confirmed' || outcome === 'permission_rejected') {
    if (!input.permissionSourceResult?.applied) {
      reviewRequired = true
      tenantMessage = 'Mottaget tillståndssvar inväntar säker koppling till originalbegäran och berörda objekt.'
      outcome = 'manual_review_required'
    } else updated.push('metering_permissions', 'metering_permission_sites')
  }

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

  if (outcome === 'supplier_switch_accepted') {
    const sourceResult = await applySupplyMarketSource({ actorUserId: input.actorUserId,message: input.message })
    if (!sourceResult.applied) {
      outcome = 'manual_review_required';reviewRequired = true
      tenantMessage = 'Leverantörsbytet inväntar källbunden koppling till hela svaret, skickat original och rätt avtal.'
    } else {
      updated.push('supplier_switch_requests','customer_supply_periods')
      // A native whole-source transaction names every exact committed scope.
      // Correlation hints and mutable parsed dates cannot select a different row.
      for (const scope of sourceResult.commits) await publishSourceSwitchCommit(input.onSourceSwitchCommitted, {
        message: { ...input.message,customer_id: scope.customerId,metering_point_id: scope.meteringPointId,site_id: scope.siteId },
        switchRequestId: scope.switchRequestId,supplyPeriodId: scope.supplyPeriodId,
      })
    }
  }

  if (['assigned_supply_started', 'mandatory_purchase_supply_started', 'supplier_switch_cancelled_before_start', 'supply_terminated', 'supply_continuation_confirmed'].includes(outcome)) {
    const sourceResult = await applySupplyMarketSource({ actorUserId: input.actorUserId, message: input.message })
    if (!sourceResult.applied) {
      reviewRequired = true; outcome = 'manual_review_required'
      tenantMessage = sourceResult.reason === 'regulated_supply_authentic_ground_required'
        ? 'Anvisning eller mottagningsplikt inväntar dokumenterat mandat, rätt nätområde och verifierad rättslig grund.'
        : 'Leveranshändelsen inväntar säker koppling till rätt original, objekt och giltighetstid.'
    } else {
      updated.push('customer_supply_periods')
      if (outcome === 'supplier_switch_cancelled_before_start') updated.push('supplier_switch_requests')
      if (outcome === 'assigned_supply_started' || outcome === 'mandatory_purchase_supply_started') {
        tenantMessage = outcome === 'assigned_supply_started' ? 'Anvisningsprocessen och nätägarens starttid är registrerade.' : 'Den separata produktions- och mottagningsrelationen är registrerad.'
      }
      if (outcome === 'supply_terminated' && sourceResult.periods.some(p => p.status === 'ending')) tenantMessage = 'Leveransslutet är registrerat och träder i kraft vid nätägarens giltiga sluttid.'
      // Final-value/billing follow-up is an operational task, not authority to
      // delete a customer, close another object or revive a beneficiary grant.
      if (outcome === 'supply_terminated' && !sourceResult.idempotent && companyId) {
        const caseId = await createReviewCase({ message: input.message, companyId, switchRequestId: input.matchedSwitchRequestId ?? null,
          caseType: 'other', reviewIntent: 'final_metering_and_billing', title: 'Leveransen upphör – slutför mätvärden och fakturering',
          description: 'Ett källbundet leveransslut är registrerat. Säkerställ slutmätvärden och slutfakturering för just de berörda perioderna med bibehållen historik.',
          nextAction: 'Kontrollera slutmätvärden och faktureringsberedskap vid angiven giltig sluttid.' })
        if (caseId) updated.push('customer_cases')
      }
    }
  }


  if (outcome === 'permission_ended' || outcome === 'permission_continues') {
    const permissionResult = await applyInboundZ15PermissionState({
      actorUserId: input.actorUserId,
      message: input.message,
    })
    if (permissionResult.applied) updated.push('metering_permissions')
    if (!permissionResult.applied) {
      reviewRequired = true; outcome = 'manual_review_required'
      tenantMessage = 'Tillståndshändelsen inväntar säker original- och objektkoppling.'
    } else if (permissionResult.status === 'active' && outcome === 'permission_ended') {
      tenantMessage = 'Tillståndets upphörandetid är registrerad; övriga giltiga objekt och framtida rapporteringstider bevaras.'
    }
  }

  if ((outcome === 'masterdata_update_received' || outcome === 'meter_change_received') && companyId) {
    const caseId = await createReviewCase({
      message: input.message,
      companyId,
      caseType: 'other',
      reviewIntent: outcome === 'meter_change_received' ? 'meter_change_review' : 'masterdata_update_review',
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
      caseType: 'other',
      reviewIntent: 'ediel_unexpected_direction',
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
      : outcome === 'supplier_switch_completed' ? 'completed'
        : outcome === 'business_rejection' || outcome === 'technical_rejection' ? 'switch_rejected'
          : outcome === 'manual_review_required' || outcome === 'unexpected_direction_review' ? 'manual_review'
            : null
  if (workflowState && companyId && input.message.customer_id) {
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
      : outcome === 'supplier_switch_completed' ? 'supply_period.activated'
        : outcome === 'business_rejection' || outcome === 'technical_rejection' ? 'supplier_switch.rejected'
          : null
  if (notificationEvent && companyId && input.message.customer_id) {
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
