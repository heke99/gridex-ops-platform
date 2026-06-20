// lib/ediel/flows/shared.ts

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { CreateEdielMessageInput, EdielEnvironment } from '@/lib/ediel/types'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  isActiveEdielMessageFamily,
} from '@/lib/ediel/types'
import {
  finalizeCanonicalOutboundDraft,
  resolveCanonicalOutboundContext,
} from '@/lib/ediel/core/kernel'
import {
  cancelSupplierSwitchOutboundAttemptsForReplacement,
  createOutboundRequest,
  findOpenOutboundBySource,
  updateOutboundRequestStatus,
} from '@/lib/cis/db'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import { supabaseService } from '@/lib/supabase/service'

type ActiveReleaseFamily =
  | 'PRODAT'
  | 'UTILTS'
  | 'APERAK'
  | 'CONTRL'
  | 'UTILTS_ERR'
  | 'AI_LIST'



function normalizeEdielEnvironment(value?: string | null): EdielEnvironment | null {
  return value === 'production' || value === 'test' ? value : null
}

export async function resolveOutboundRuntimeEnvironment(params: {
  preferredRouteId?: string | null
  explicitEnvironment?: EdielEnvironment | null
}): Promise<EdielEnvironment> {
  const explicit = normalizeEdielEnvironment(params.explicitEnvironment ?? null)
  if (explicit) return explicit

  if (!params.preferredRouteId) {
    throw new Error('environment_not_resolved: route eller explicit miljö krävs innan Ediel-runtime kan väljas.')
  }

  const { data, error } = await supabaseService
    .from('communication_routes')
    .select('target_system,target_email')
    .eq('id', params.preferredRouteId)
    .maybeSingle()

  if (error) throw error

  const targetSystem = String((data as { target_system?: string | null } | null)?.target_system ?? '').toLowerCase()
  const targetEmail = String((data as { target_email?: string | null } | null)?.target_email ?? '').toLowerCase()

  if (
    targetSystem.includes('tgt') ||
    targetSystem.includes('test') ||
    targetEmail.endsWith('@ediel.se')
  ) {
    return 'test'
  }

  return 'production'
}

export function ensureActorUserId(value?: string | null): string {
  return value && value.trim() ? value.trim() : 'system'
}

export function assertActiveFamily(
  family: string | null | undefined,
  context: string
): asserts family is ActiveReleaseFamily {
  if (!isActiveEdielMessageFamily(family)) {
    throw new Error(
      `${context}: message family ${family ?? 'null'} ligger utanför aktiv release (${ACTIVE_EDIEL_MESSAGE_FAMILIES.join(', ')})`
    )
  }
}

export async function getGridOwnerDataRequestById(
  id: string
): Promise<GridOwnerDataRequestRow | null> {
  const { data, error } = await supabaseService
    .from('grid_owner_data_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as GridOwnerDataRequestRow | null) ?? null
}

export async function findOrCreateSwitchOutbound(params: {
  actorUserId: string
  switchRequestId: string
  customerId: string
  siteId: string
  meteringPointId: string
  gridOwnerId: string | null
  communicationRouteId?: string | null
  externalReference: string | null
  payload: Record<string, unknown>
  forceCreateNewAttempt?: boolean
}) {
  if (!params.forceCreateNewAttempt) {
    const existing = await findOpenOutboundBySource({
      sourceType: 'supplier_switch_request',
      sourceId: params.switchRequestId,
      requestType: 'supplier_switch',
    })

    if (existing) return existing
  } else {
    await cancelSupplierSwitchOutboundAttemptsForReplacement({
      actorUserId: params.actorUserId,
      sourceId: params.switchRequestId,
      reason: 'Avbrutet automatiskt för nytt Edielportal TGT/IMAP-testförsök.',
    })
  }

  return createOutboundRequest({
    actorUserId: params.actorUserId,
    customerId: params.customerId,
    siteId: params.siteId,
    meteringPointId: params.meteringPointId,
    gridOwnerId: params.gridOwnerId,
    communicationRouteId: params.communicationRouteId ?? null,
    requestType: 'supplier_switch',
    sourceType: 'supplier_switch_request',
    sourceId: params.switchRequestId,
    externalReference: params.externalReference,
    replaceOpenSupplierSwitchAttempt: Boolean(params.forceCreateNewAttempt),
    payload: params.payload,
  })
}

export async function findOrCreateDataRequestOutbound(params: {
  actorUserId: string
  requestType: 'customer_masterdata' | 'meter_values' | 'billing_underlay'
  communicationRouteId?: string | null
  dataRequest: GridOwnerDataRequestRow
  payload: Record<string, unknown>
}) {
  const existing = await findOpenOutboundBySource({
    sourceType: 'grid_owner_data_request',
    sourceId: params.dataRequest.id,
    requestType: params.requestType,
  })

  if (existing) return existing

  return createOutboundRequest({
    actorUserId: params.actorUserId,
    customerId: params.dataRequest.customer_id,
    siteId: params.dataRequest.site_id,
    meteringPointId: params.dataRequest.metering_point_id,
    gridOwnerId: params.dataRequest.grid_owner_id,
    communicationRouteId: params.communicationRouteId ?? null,
    requestType: params.requestType,
    sourceType: 'grid_owner_data_request',
    sourceId: params.dataRequest.id,
    periodStart: params.dataRequest.requested_period_start,
    periodEnd: params.dataRequest.requested_period_end,
    externalReference: params.dataRequest.external_reference,
    payload: params.payload,
  })
}

export async function finalizeOutboundDraft(params: {
  actorUserId: string
  requestType:
    | 'supplier_switch'
    | 'customer_masterdata'
    | 'metering_access'
    | 'meter_values'
    | 'billing_underlay'
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  draft: CreateEdielMessageInput
  outboundRequestId?: string | null
  duplicateCheck: {
    sourceType?: string | null
    sourceId?: string | null
    receiverEdielId?: string | null
    messageFamily: string
    messageCode: string
    messageVersion?: string | null
    periodStart?: string | null
    periodEnd?: string | null
  }
}) {
  const messageFamily = params.draft.messageFamily

  assertActiveFamily(messageFamily, 'finalizeOutboundDraft')

  return finalizeCanonicalOutboundDraft({
    actorUserId: params.actorUserId,
    requestType: params.requestType,
    routeContext: params.routeContext,
    draft: params.draft,
    outboundRequestId: params.outboundRequestId ?? null,
    duplicateCheck: params.duplicateCheck,
  })
}

export async function queuePreparedEdielMessage(params: {
  actorUserId: string
  messageId: string
  outboundRequestId?: string | null
  externalReference?: string | null
  payload?: Record<string, unknown>
}) {
  const { updateEdielMessageStatus } = await import('@/lib/ediel/db')

  await updateEdielMessageStatus({
    actorUserId: params.actorUserId,
    edielMessageId: params.messageId,
    status: 'queued',
  })

  if (params.outboundRequestId) {
    await updateOutboundRequestStatus({
      actorUserId: params.actorUserId,
      outboundRequestId: params.outboundRequestId,
      status: 'prepared',
      externalReference: params.externalReference ?? null,
      responsePayload: {
        edielMessageId: params.messageId,
        ...(params.payload ?? {}),
      },
    })
  }
}

export async function makeServerClient() {
  return createSupabaseServerClient()
}