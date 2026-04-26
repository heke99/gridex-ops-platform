// lib/operations/edielAutomation.ts

import { supabaseService } from '@/lib/supabase/service'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { findOpenOutboundBySource } from '@/lib/cis/db'
import { createSupplierSwitchEvent, getSupplierSwitchRequestById } from '@/lib/operations/db'
import { getCustomerSiteById, getGridOwnerById, getMeteringPointById } from '@/lib/masterdata/db'
import { prepareAndQueueEdielZ03, prepareAndQueueEdielZ05, prepareAndQueueEdielZ09 } from '@/lib/ediel/orchestrator'

export type EnsureSwitchAutomationInput = {
  actorUserId: string
  switchRequestId: string
  communicationRouteId?: string | null
}

export type ContinueSwitchAutomationInput = {
  actorUserId: string
  switchRequestId: string
  step: 'Z03' | 'Z05' | 'Z09'
  communicationRouteId?: string | null
}

function ensureJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

async function loadSwitchContext(
  switchRequestId: string
): Promise<{
  switchRequest: SupplierSwitchRequestRow
  site: Awaited<ReturnType<typeof getCustomerSiteById>> | null
  meteringPoint: Awaited<ReturnType<typeof getMeteringPointById>> | null
  gridOwner: Awaited<ReturnType<typeof getGridOwnerById>> | null
}> {
  const switchRequest = await getSupplierSwitchRequestById(supabaseService, switchRequestId)
  if (!switchRequest) {
    throw new Error('Switch request hittades inte')
  }

  const [site, meteringPoint, gridOwner] = await Promise.all([
    switchRequest.site_id ? getCustomerSiteById(supabaseService, switchRequest.site_id) : null,
    switchRequest.metering_point_id
      ? getMeteringPointById(supabaseService, switchRequest.metering_point_id)
      : null,
    switchRequest.grid_owner_id
      ? getGridOwnerById(supabaseService, switchRequest.grid_owner_id)
      : null,
  ])

  return {
    switchRequest,
    site,
    meteringPoint,
    gridOwner,
  }
}

function buildSwitchReadinessSnapshot(params: {
  switchRequest: SupplierSwitchRequestRow
  site: Awaited<ReturnType<typeof getCustomerSiteById>> | null
  meteringPoint: Awaited<ReturnType<typeof getMeteringPointById>> | null
  gridOwner: Awaited<ReturnType<typeof getGridOwnerById>> | null
}) {
  return {
    switchRequestId: params.switchRequest.id,
    switchStatus: params.switchRequest.status,
    requestType: params.switchRequest.request_type,
    customerId: params.switchRequest.customer_id,
    siteId: params.switchRequest.site_id,
    meteringPointId: params.switchRequest.metering_point_id,
    gridOwnerId: params.switchRequest.grid_owner_id,
    hasSite: Boolean(params.site),
    hasMeteringPoint: Boolean(params.meteringPoint),
    hasGridOwner: Boolean(params.gridOwner),
    siteName: params.site?.site_name ?? null,
    meterPointId: params.meteringPoint?.meter_point_id ?? null,
    gridOwnerName: params.gridOwner?.name ?? null,
    gridOwnerEdielId: params.gridOwner?.ediel_id ?? null,
    requestedStartDate: params.switchRequest.requested_start_date,
    externalReference: params.switchRequest.external_reference ?? null,
  }
}

async function writeSwitchValidationSnapshot(params: {
  actorUserId: string
  switchRequestId: string
  validationSnapshot: Record<string, unknown>
}) {
  const { error } = await supabaseService
    .from('supplier_switch_requests')
    .update({
      validation_snapshot: params.validationSnapshot,
      updated_at: new Date().toISOString(),
      updated_by: params.actorUserId,
    })
    .eq('id', params.switchRequestId)

  if (error) throw error
}

async function createAutomationEvent(params: {
  actorUserId: string
  switchRequestId: string
  message: string
  payload?: Record<string, unknown>
}) {
  return createSupplierSwitchEvent(supabaseService, {
    switchRequestId: params.switchRequestId,
    eventType: 'automation',
    eventStatus: 'info',
    message: params.message,
    payload: {
      ...(ensureJson(params.payload)),
      automationSource: 'lib/operations/edielAutomation.ts',
    },
  })
}

export async function ensureSwitchAutomationReadiness(
  input: EnsureSwitchAutomationInput
) {
  const context = await loadSwitchContext(input.switchRequestId)

  const snapshot = buildSwitchReadinessSnapshot(context)

  await writeSwitchValidationSnapshot({
    actorUserId: input.actorUserId,
    switchRequestId: context.switchRequest.id,
    validationSnapshot: {
      ...(ensureJson(context.switchRequest.validation_snapshot)),
      edielAutomationReadiness: snapshot,
      updatedVia: 'lib/operations/edielAutomation.ts',
    },
  })

  await createAutomationEvent({
    actorUserId: input.actorUserId,
    switchRequestId: context.switchRequest.id,
    message: 'Switch readiness snapshot uppdaterad för Ediel-automation.',
    payload: snapshot,
  })

  return snapshot
}

export async function ensureInitialSwitchEdielAutomation(
  input: EnsureSwitchAutomationInput
) {
  const context = await loadSwitchContext(input.switchRequestId)

  await ensureSwitchAutomationReadiness(input)

  const existingOutbound = await findOpenOutboundBySource({
    sourceType: 'supplier_switch_request',
    sourceId: context.switchRequest.id,
    requestType: 'supplier_switch',
  })

  if (existingOutbound) {
    const { data: existingMessages, error: existingMessageError } = await supabaseService
      .from('ediel_messages')
      .select('id')
      .eq('outbound_request_id', existingOutbound.id)
      .eq('message_family', 'PRODAT')
      .eq('message_code', 'Z03')
      .neq('status', 'cancelled')
      .limit(1)

    if (existingMessageError) throw existingMessageError

    if ((existingMessages ?? []).length > 0) {
      await createAutomationEvent({
        actorUserId: input.actorUserId,
        switchRequestId: context.switchRequest.id,
        message: 'Befintlig outbound och PRODAT Z03 hittades för switch request. Ingen ny fil skapades.',
        payload: {
          outboundRequestId: existingOutbound.id,
          edielMessageId: existingMessages?.[0]?.id ?? null,
          status: existingOutbound.status,
        },
      })

      return {
        alreadyQueued: true,
        outboundRequestId: existingOutbound.id,
        message: null,
      }
    }

    await createAutomationEvent({
      actorUserId: input.actorUserId,
      switchRequestId: context.switchRequest.id,
      message: 'Befintlig outbound hittad, men ingen PRODAT Z03. Skapar Ediel-fil från samma outbound.',
      payload: {
        outboundRequestId: existingOutbound.id,
        status: existingOutbound.status,
      },
    })
  }

  const message = await prepareAndQueueEdielZ03({
    actorUserId: input.actorUserId,
    switchRequestId: context.switchRequest.id,
    communicationRouteId: input.communicationRouteId ?? null,
  })

  await createAutomationEvent({
    actorUserId: input.actorUserId,
    switchRequestId: context.switchRequest.id,
    message: 'Initial switch automation körd och Z03 förberedd/köad.',
    payload: {
      edielMessageId: message.id,
      messageCode: message.message_code,
      outboundRequestId: message.outbound_request_id,
      communicationRouteId: message.communication_route_id,
    },
  })

  return {
    alreadyQueued: false,
    outboundRequestId: message.outbound_request_id ?? null,
    message,
  }
}

export async function continueSwitchEdielAutomation(
  input: ContinueSwitchAutomationInput
) {
  const context = await loadSwitchContext(input.switchRequestId)

  await ensureSwitchAutomationReadiness({
    actorUserId: input.actorUserId,
    switchRequestId: context.switchRequest.id,
    communicationRouteId: input.communicationRouteId ?? null,
  })

  const message =
    input.step === 'Z03'
      ? await prepareAndQueueEdielZ03({
          actorUserId: input.actorUserId,
          switchRequestId: context.switchRequest.id,
          communicationRouteId: input.communicationRouteId ?? null,
        })
      : input.step === 'Z05'
        ? await prepareAndQueueEdielZ05({
            actorUserId: input.actorUserId,
            switchRequestId: context.switchRequest.id,
            communicationRouteId: input.communicationRouteId ?? null,
          })
        : await prepareAndQueueEdielZ09({
            actorUserId: input.actorUserId,
            switchRequestId: context.switchRequest.id,
            communicationRouteId: input.communicationRouteId ?? null,
          })

  await createAutomationEvent({
    actorUserId: input.actorUserId,
    switchRequestId: context.switchRequest.id,
    message: `Switch automation fortsatte med ${input.step}.`,
    payload: {
      edielMessageId: message.id,
      messageCode: message.message_code,
      outboundRequestId: message.outbound_request_id,
      communicationRouteId: message.communication_route_id,
    },
  })

  return message
}

export async function syncInboundProdatToSwitchStatus(params: {
  actorUserId: string
  switchRequestId: string
  edielMessageId: string
  messageCode: string
  parsedPayload?: Record<string, unknown> | null
}) {
  const switchRequest = await getSupplierSwitchRequestById(supabaseService, params.switchRequestId)
  if (!switchRequest) {
    throw new Error('Switch request hittades inte')
  }

  const nextStatus =
    params.messageCode === 'Z04'
      ? 'accepted'
      : params.messageCode === 'Z05'
        ? 'completed'
        : switchRequest.status

  const payload = {
    ...(ensureJson(switchRequest.validation_snapshot)),
    lastInboundProdat: {
      edielMessageId: params.edielMessageId,
      messageCode: params.messageCode,
      parsedPayload: ensureJson(params.parsedPayload),
      syncedAt: new Date().toISOString(),
    },
  }

  const { error } = await supabaseService
    .from('supplier_switch_requests')
    .update({
      status: nextStatus,
      validation_snapshot: payload,
      updated_at: new Date().toISOString(),
      updated_by: params.actorUserId,
    })
    .eq('id', switchRequest.id)

  if (error) throw error

  await createAutomationEvent({
    actorUserId: params.actorUserId,
    switchRequestId: switchRequest.id,
    message: `Inbound PRODAT ${params.messageCode} synkad mot switch status.`,
    payload: {
      edielMessageId: params.edielMessageId,
      oldStatus: switchRequest.status,
      newStatus: nextStatus,
    },
  })

  return {
    switchRequestId: switchRequest.id,
    oldStatus: switchRequest.status,
    newStatus: nextStatus,
  }
}