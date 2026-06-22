/**
 * Z01 Grid Owner Data Request Finalizer
 *
 * Handles stuck PRODAT Z01 grid_owner_data_requests that never got an
 * outbound_request or ediel_message because prepareAndQueueProdatZ01FromDataRequest
 * threw before creating one (e.g., during route materialization when no route existed).
 *
 * The relationship between grid_owner_data_requests and outbound_requests is:
 *   outbound_requests.source_type = 'grid_owner_data_request'
 *   outbound_requests.source_id   = grid_owner_data_requests.id
 *
 * Does NOT send SMTP directly. Sending only happens via the normal guarded path.
 */

import { supabaseService } from '@/lib/supabase/service'
import {
  prepareAndQueueProdatZ01FromDataRequest,
} from '@/lib/ediel/flows/prodatCustomerMasterdata'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
import type { EdielEnvironment } from '@/lib/ediel/types'

export type Z01FinalizerInput = {
  companyId: string
  actorUserId: string
  gridOwnerDataRequestId?: string | null
  customerInfoRequestId?: string | null
  environment?: EdielEnvironment | null
  dryRun?: boolean
}

export type Z01FinalizerWarning = {
  code: string
  message: string
}

export type Z01DryRunResult = {
  dryRun: true
  selectedCustomerInfoRequest: CustomerInfoRequestRow | null
  selectedGridOwnerDataRequest: GridOwnerDataRequestRow | null
  existingOutboundForGodr: { id: string; status: string; communication_route_id: string | null } | null
  existingEdielMessageForGodr: { id: string; status: string } | null
  selectedCommunicationRouteId: string | null
  selectedRouteProfileId: string | null
  wouldCreateOutbound: boolean
  wouldPrepareEdielMessage: boolean
  wouldClearBlocker: boolean
  warnings: Z01FinalizerWarning[]
}

export type Z01ApplyResult = {
  dryRun: false
  gridOwnerDataRequestId: string
  customerInfoRequestId: string | null
  outboundRequestId: string | null
  edielMessageId: string | null
  communicationRouteId: string | null
  routeProfileId: string | null
  prepared: boolean
  blockerCode: string | null
  blockerReason: string | null
  warnings: Z01FinalizerWarning[]
  auditEvent: string
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

async function findGridOwnerDataRequest(
  companyId: string,
  gridOwnerDataRequestId: string,
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', gridOwnerDataRequestId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  return (data as GridOwnerDataRequestRow | null) ?? null
}

async function findCustomerInfoRequestByGodr(
  companyId: string,
  gridOwnerDataRequestId: string,
): Promise<CustomerInfoRequestRow | null> {
  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('grid_owner_data_request_id', gridOwnerDataRequestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error && !['42703', 'PGRST204', 'PGRST205'].includes(String((error as { code?: string }).code ?? ''))) throw error
  return (data as CustomerInfoRequestRow | null) ?? null
}

async function findCustomerInfoRequestById(
  companyId: string,
  requestId: string,
): Promise<CustomerInfoRequestRow | null> {
  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  return (data as CustomerInfoRequestRow | null) ?? null
}

async function findOutboundForGodr(
  godrId: string,
): Promise<{ id: string; status: string; communication_route_id: string | null } | null> {
  const { data, error } = await supabaseService
    .from('outbound_requests')
    .select('id, status, communication_route_id')
    .eq('source_type', 'grid_owner_data_request')
    .eq('source_id', godrId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error && !['42703', 'PGRST204', 'PGRST205'].includes(String((error as { code?: string }).code ?? ''))) throw error
  return (data as { id: string; status: string; communication_route_id: string | null } | null) ?? null
}

async function findEdielMessageForGodr(
  godrId: string,
): Promise<{ id: string; status: string } | null> {
  const { data, error } = await supabaseService
    .from('ediel_messages')
    .select('id, status')
    .eq('grid_owner_data_request_id', godrId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error && !['42703', 'PGRST204', 'PGRST205'].includes(String((error as { code?: string }).code ?? ''))) throw error
  return (data as { id: string; status: string } | null) ?? null
}

/**
 * Dry-run: inspect current state and return what would be done without making changes.
 */
export async function dryRunZ01Finalizer(input: Z01FinalizerInput): Promise<Z01DryRunResult> {
  const warnings: Z01FinalizerWarning[] = []

  if (!input.gridOwnerDataRequestId && !input.customerInfoRequestId) {
    warnings.push({ code: 'no_identifier', message: 'Vare sig grid_owner_data_request_id eller customer_info_request_id angavs.' })
    return {
      dryRun: true,
      selectedCustomerInfoRequest: null,
      selectedGridOwnerDataRequest: null,
      existingOutboundForGodr: null,
      existingEdielMessageForGodr: null,
      selectedCommunicationRouteId: null,
      selectedRouteProfileId: null,
      wouldCreateOutbound: false,
      wouldPrepareEdielMessage: false,
      wouldClearBlocker: false,
      warnings,
    }
  }

  let godr: GridOwnerDataRequestRow | null = null
  let cir: CustomerInfoRequestRow | null = null

  if (input.gridOwnerDataRequestId) {
    godr = await findGridOwnerDataRequest(input.companyId, input.gridOwnerDataRequestId)
    if (!godr) {
      warnings.push({ code: 'godr_not_found', message: `grid_owner_data_request ${input.gridOwnerDataRequestId} hittades inte för bolaget.` })
    }
  }

  if (input.customerInfoRequestId) {
    cir = await findCustomerInfoRequestById(input.companyId, input.customerInfoRequestId)
    if (!cir) {
      warnings.push({ code: 'cir_not_found', message: `customer_info_request ${input.customerInfoRequestId} hittades inte för bolaget.` })
    }
    if (cir && !godr && cir.grid_owner_data_request_id) {
      godr = await findGridOwnerDataRequest(input.companyId, cir.grid_owner_data_request_id)
    }
  }

  if (!godr) {
    return {
      dryRun: true,
      selectedCustomerInfoRequest: cir,
      selectedGridOwnerDataRequest: null,
      existingOutboundForGodr: null,
      existingEdielMessageForGodr: null,
      selectedCommunicationRouteId: null,
      selectedRouteProfileId: null,
      wouldCreateOutbound: false,
      wouldPrepareEdielMessage: false,
      wouldClearBlocker: false,
      warnings,
    }
  }

  if (!cir && godr) {
    cir = await findCustomerInfoRequestByGodr(input.companyId, godr.id)
  }

  const existingOutbound = await findOutboundForGodr(godr.id)
  const existingEdielMessage = await findEdielMessageForGodr(godr.id)

  if (existingOutbound?.communication_route_id) {
    warnings.push({
      code: 'outbound_already_has_route',
      message: `Det finns redan en outbound_request (${existingOutbound.id}) med communication_route_id för detta godr. Kontrollera om finalisering redan är klar.`,
    })
  }

  const wouldCreateOutbound = !existingOutbound
  const wouldPrepareEdielMessage = !existingEdielMessage
  const wouldClearBlocker = cir
    ? ['blocked', 'route_missing'].includes(cir.status) &&
      String(cir.blocker_code ?? '') === 'operational_route_missing'
    : false

  const responsePayload = asRecord(godr.response_payload)

  return {
    dryRun: true,
    selectedCustomerInfoRequest: cir,
    selectedGridOwnerDataRequest: godr,
    existingOutboundForGodr: existingOutbound,
    existingEdielMessageForGodr: existingEdielMessage,
    selectedCommunicationRouteId: existingOutbound?.communication_route_id ?? null,
    selectedRouteProfileId: null,
    wouldCreateOutbound,
    wouldPrepareEdielMessage,
    wouldClearBlocker,
    warnings: [
      ...warnings,
      ...(responsePayload.blockerCode === 'operational_route_missing'
        ? [{ code: 'previously_blocked_route_missing', message: 'Begäran blockerades tidigare av saknad route. Om route nu finns kan finalisering köras.' }]
        : []),
    ],
  }
}

/**
 * Apply: create/update outbound_request and ediel_message for the stuck GODR.
 * Does NOT send SMTP. Delegates to the normal Z01 preparation flow.
 */
export async function finalizeStuckZ01GridOwnerDataRequest(
  input: Z01FinalizerInput,
): Promise<Z01ApplyResult> {
  if (input.dryRun) {
    throw new Error('Use dryRunZ01Finalizer for dry-run mode.')
  }

  const warnings: Z01FinalizerWarning[] = []

  if (!input.gridOwnerDataRequestId && !input.customerInfoRequestId) {
    throw new Error('Ange minst grid_owner_data_request_id eller customer_info_request_id.')
  }

  let godr: GridOwnerDataRequestRow | null = null
  let cir: CustomerInfoRequestRow | null = null

  if (input.gridOwnerDataRequestId) {
    godr = await findGridOwnerDataRequest(input.companyId, input.gridOwnerDataRequestId)
  }

  if (input.customerInfoRequestId) {
    cir = await findCustomerInfoRequestById(input.companyId, input.customerInfoRequestId)
    if (cir && !godr && cir.grid_owner_data_request_id) {
      godr = await findGridOwnerDataRequest(input.companyId, cir.grid_owner_data_request_id)
    }
  }

  if (!godr) {
    throw new Error('grid_owner_data_request hittades inte.')
  }

  if (!cir && godr) {
    cir = await findCustomerInfoRequestByGodr(input.companyId, godr.id)
  }

  if (godr.request_scope !== 'customer_masterdata') {
    throw new Error(`Finalisering stöder endast request_scope=customer_masterdata, fick: ${godr.request_scope}`)
  }

  const existingOutbound = await findOutboundForGodr(godr.id)
  const existingEdielMessage = await findEdielMessageForGodr(godr.id)

  if (existingOutbound?.communication_route_id && existingEdielMessage) {
    warnings.push({
      code: 'already_finalized',
      message: 'Det finns redan en outbound med route och ett ediel_message. Finalisering är möjligen redan klar.',
    })
  }

  const operationId = godr.operation_id ?? cir?.operation_id ?? null

  // Delegate to the canonical Z01 preparation flow — it handles idempotency
  // via findOrCreateDataRequestOutbound and will repair or create as needed.
  const z01 = await prepareAndQueueProdatZ01FromDataRequest({
    actorUserId: input.actorUserId,
    gridOwnerDataRequestId: godr.id,
    environment: input.environment ?? null,
    operationId,
  })

  // Update customer_info_request if it exists and was blocked by missing route
  if (cir && ['blocked', 'route_missing'].includes(cir.status)) {
    const now = new Date().toISOString()
    const nextStatus = z01.prepared ? 'z01_prepared' : cir.status
    const updatePayload: Record<string, unknown> = {
      outbound_request_id: z01.outbound.id,
      ediel_message_id: z01.message?.id ?? cir.ediel_message_id ?? null,
      route_resolution_status: z01.prepared ? 'prepared' : String(z01.blockerCode ?? 'z01_prepare_failed'),
      route_resolution_reason: z01.prepared ? 'PRODAT Z01 finaliserad via reparationsväg.' : (z01.blockerReason ?? null),
      next_required_action: z01.prepared
        ? 'Kontrollera outbox/send guard innan meddelandet räknas som skickat.'
        : (asRecord(z01.blockerDetails).next_required_action ?? null),
      updated_by: input.actorUserId,
      updated_at: now,
    }

    if (z01.prepared) {
      updatePayload.status = nextStatus
      updatePayload.blocker_code = null
      updatePayload.blocker_reason = null
      updatePayload.blocker_details = null
    } else {
      updatePayload.blocker_code = z01.blockerCode ?? null
      updatePayload.blocker_reason = z01.blockerReason ?? null
      updatePayload.blocker_details = z01.blockerDetails ?? null
    }

    const { error: updateError } = await supabaseService
      .from('customer_info_requests')
      .update(updatePayload)
      .eq('id', cir.id)
      .eq('company_id', input.companyId)

    if (updateError && !['42703', 'PGRST204', 'PGRST205'].includes(String((updateError as { code?: string }).code ?? ''))) {
      warnings.push({ code: 'cir_update_failed', message: `Kunde inte uppdatera customer_info_request: ${updateError.message}` })
    }

    // Audit the finalization via the customer_info_request_events table
    await supabaseService
      .from('customer_info_request_events')
      .insert({
        company_id: input.companyId,
        customer_info_request_id: cir.id,
        customer_id: cir.customer_id,
        event_type: 'z01_grid_owner_data_request_finalized_after_route_ready',
        message: z01.prepared
          ? 'Nätägarbegäran finaliserades via reparationsväg. PRODAT Z01 är förberedd.'
          : `Nätägarbegäran finaliserades men blockeras fortfarande: ${z01.blockerReason ?? z01.blockerCode}`,
        payload: {
          old_blocker_code: cir.blocker_code ?? null,
          grid_owner_data_request_id: godr.id,
          outbound_request_id: z01.outbound.id,
          ediel_message_id: z01.message?.id ?? null,
          communication_route_id: z01.outbound.communication_route_id,
          ediel_route_profile_id: z01.outbound.ediel_route_profile_id ?? null,
          operation_id: operationId,
          smtp_sent: false,
          prepared: z01.prepared,
        },
        created_by: input.actorUserId,
      })
      .then(({ error: auditError }) => {
        if (auditError && !['42703', 'PGRST204', 'PGRST205'].includes(String((auditError as { code?: string }).code ?? ''))) {
          warnings.push({ code: 'audit_failed', message: `Audit-event kunde inte sparas: ${auditError.message}` })
        }
      })
  }

  return {
    dryRun: false,
    gridOwnerDataRequestId: godr.id,
    customerInfoRequestId: cir?.id ?? null,
    outboundRequestId: z01.outbound.id,
    edielMessageId: z01.message?.id ?? null,
    communicationRouteId: z01.outbound.communication_route_id,
    routeProfileId: z01.outbound.ediel_route_profile_id ?? null,
    prepared: z01.prepared,
    blockerCode: z01.blockerCode ?? null,
    blockerReason: z01.blockerReason ?? null,
    warnings,
    auditEvent: 'z01_grid_owner_data_request_finalized_after_route_ready',
  }
}
