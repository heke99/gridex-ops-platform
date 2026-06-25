// lib/ediel/intent/renderGateway.ts
//
// RenderGateway (Batch 1). The single sanctioned bridge that turns a validated
// EdielMessageIntent into a rendered + queued Ediel message. It is the only place
// allowed to invoke renderers and the finalize/queue chain on behalf of business
// processes. Business processes create intents and call the gateway; they never
// render or queue directly.

import {
  finalizeOutboundDraft,
  queuePreparedEdielMessage,
} from '@/lib/ediel/flows/shared'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  getEdielMessageIntentById,
  evaluateIntentValidation,
  updateIntentLifecycle,
} from '@/lib/ediel/intent/intentEngine'
import {
  buildFacilityLookupZ01Draft,
  type FacilityLookupZ01RenderRequest,
} from '@/lib/ediel/intent/renderers/facilityLookupZ01'
import type { EdielIntentBlockingReason, EdielMessageIntent } from '@/lib/ediel/intent/types'

export type RenderGatewayResult =
  | {
      status: 'queued'
      intentId: string
      message: EdielMessageRow
      blockingReasons: never[]
    }
  | {
      status: 'blocked'
      intentId: string
      message: null
      blockingReasons: EdielIntentBlockingReason[]
    }

// Hard gate: an intent must be present and validated before any render/queue.
// This is what guarantees ediel_outbox only ever receives validated intents.
async function loadValidatedIntent(intentId: string): Promise<
  | { ok: true; intent: EdielMessageIntent }
  | { ok: false; reasons: EdielIntentBlockingReason[] }
> {
  const intent = await getEdielMessageIntentById(intentId)
  if (!intent) {
    return {
      ok: false,
      reasons: [{ code: 'intent_not_found', message: `Intent ${intentId} hittades inte.`, severity: 'block' }],
    }
  }
  const validation = evaluateIntentValidation(intent)
  if (!validation.ok) {
    if (intent.validationStatus !== 'blocked') {
      await updateIntentLifecycle(intentId, {
        validationStatus: 'blocked',
        validationResult: validation as unknown as Record<string, unknown>,
        blockingReasons: validation.blockingReasons,
        renderStatus: 'failed',
      })
    }
    return { ok: false, reasons: validation.blockingReasons }
  }
  return { ok: true, intent }
}

// Facility lookup PRODAT Z01. Customer operations call this instead of rendering.
export async function renderAndQueueFacilityLookupZ01(params: {
  intentId: string
  actorUserId: string
  request: FacilityLookupZ01RenderRequest
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  outboundRequestId: string
  operationId: string
}): Promise<RenderGatewayResult> {
  const gate = await loadValidatedIntent(params.intentId)
  if (!gate.ok) {
    return { status: 'blocked', intentId: params.intentId, message: null, blockingReasons: gate.reasons }
  }

  const { draft } = await buildFacilityLookupZ01Draft({
    actorUserId: params.actorUserId,
    request: params.request,
    routeContext: params.routeContext,
    outboundRequestId: params.outboundRequestId,
    operationId: params.operationId,
    intentId: params.intentId,
    gridOwner: null,
  })

  const message = await finalizeOutboundDraft({
    actorUserId: params.actorUserId,
    requestType: 'customer_masterdata',
    routeContext: params.routeContext,
    draft,
    outboundRequestId: params.outboundRequestId,
    duplicateCheck: {
      sourceType: 'grid_owner_information_request',
      sourceId: params.request.id,
      receiverEdielId: params.routeContext.receiverEdielId,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      messageVersion: draft.messageVersion,
    },
  })

  await updateIntentLifecycle(params.intentId, {
    renderStatus: 'rendered',
    edielMessageId: message.id,
    outboundRequestId: params.outboundRequestId,
    actorUserId: params.actorUserId,
  })

  await queuePreparedEdielMessage({
    actorUserId: params.actorUserId,
    messageId: message.id,
    outboundRequestId: params.outboundRequestId,
    externalReference: message.external_reference ?? draft.externalReference,
    intentId: params.intentId,
    payload: {
      gridOwnerInformationRequestId: params.request.id,
      intentId: params.intentId,
      operationId: params.operationId,
      messageFamily: 'PRODAT',
      messageCode: 'Z01',
      routeId: params.routeContext.route.id,
      dispatchKind: 'facility_lookup_edifact',
    },
  })

  await updateIntentLifecycle(params.intentId, {
    outboxStatus: 'queued',
    actorUserId: params.actorUserId,
  })

  return { status: 'queued', intentId: params.intentId, message, blockingReasons: [] }
}
