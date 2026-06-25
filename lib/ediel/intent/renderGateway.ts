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

// Classifies a thrown render/finalize/queue error into a controlled blocking
// reason. A throw must never leave an intent stuck at not_rendered/not_queued with
// empty blocking_reasons; it becomes render_status='failed' + a recorded reason.
function classifyRenderError(error: unknown): EdielIntentBlockingReason {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  let code = 'render_failed'
  if (lower.includes('application reference') || lower.includes('application_reference')) {
    code = 'render_application_reference_error'
  } else if (lower.includes('environment')) {
    code = 'render_environment_not_resolved'
  } else if (lower.includes('regel') || lower.includes('rule')) {
    code = 'render_field_rule_blocked'
  } else if (lower.includes('route')) {
    code = 'render_route_error'
  }
  return {
    code,
    message,
    severity: 'block',
    details: { source: 'render_gateway' },
  }
}

// Facility lookup PRODAT Z01. Customer operations call this instead of rendering.
//
// Controlled-failure guarantee: any thrown error during render/finalize/queue is
// captured and recorded on the intent (render_status='failed' + blocking_reasons)
// and returned as a `blocked` result. The gateway never throws an unhandled error
// that would leave the intent stuck at not_rendered with empty blocking_reasons.
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

  try {
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
  } catch (error) {
    const reason = classifyRenderError(error)
    await updateIntentLifecycle(params.intentId, {
      renderStatus: 'failed',
      blockingReasons: [...gate.intent.blockingReasons ?? [], reason],
      validationResult: {
        ...(gate.intent.validationResult ?? {}),
        renderError: { code: reason.code, message: reason.message, at: new Date().toISOString() },
      },
      actorUserId: params.actorUserId,
    })
    return { status: 'blocked', intentId: params.intentId, message: null, blockingReasons: [reason] }
  }
}
