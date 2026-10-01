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
import {
  buildCustomerMasterdataZ01Draft,
  type CustomerMasterdataZ01RenderRequest,
} from '@/lib/ediel/intent/renderers/customerMasterdataZ01'
import type { EdielIntentBlockingReason, EdielMessageIntent } from '@/lib/ediel/intent/types'
import { assertProdatZ01Renderable } from '@/lib/ediel/profiles/prodatZ01Guard'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { buildServicePermissionDraft } from '@/lib/ediel/intent/renderers/servicePermission'
import { reserveServicePermissionOrigin, type ServicePermissionOriginBasis, type ServicePermissionOriginInput } from '@/lib/ediel/services/permissionOrigin'
import { getEdielMessageById } from '@/lib/ediel/db'
import { buildServiceReportingContext } from '@/lib/ediel/services/reporting'

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

export async function renderAndQueueServicePermission(params: {
  intentId: string; origin: ServicePermissionOriginInput; basis: ServicePermissionOriginBasis;
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>; outboundRequestId: string
}): Promise<RenderGatewayResult | { status: 'existing'; intentId: string; message: EdielMessageRow; blockingReasons: never[] }> {
  const gate = await loadValidatedIntent(params.intentId)
  if (!gate.ok) return { status: 'blocked', intentId: params.intentId, message: null, blockingReasons: gate.reasons }
  const reservation = await reserveServicePermissionOrigin({ ...params.origin, intentId: params.intentId })
  if (reservation.status === 'held') return { status: 'blocked', intentId: params.intentId, message: null, blockingReasons: reservation.missing.map(code => ({ code, message: code, severity: 'block' })) }
  let message = reservation.messageId ? await getEdielMessageById(reservation.messageId) : null
  if (message && message.company_id !== params.origin.providerCompanyId) throw new Error('ediel_permission_existing_message_tenant_mismatch')
  if (message && message.status !== 'draft') return { status: 'existing', intentId: params.intentId, message, blockingReasons: [] }
  try {
    if (!message) {
      const draft = await buildServicePermissionDraft({ actorUserId: params.origin.actorUserId, basis: params.basis, intent: gate.intent, routeContext: params.routeContext, outboundRequestId: params.outboundRequestId })
      try {
        message = await finalizeOutboundDraft({ actorUserId: params.origin.actorUserId, requestType: 'metering_access', routeContext: params.routeContext, draft, outboundRequestId: params.outboundRequestId,
          reportingContext: params.basis.code === 'Z13' ? buildServiceReportingContext(params.basis,gate.intent,params.routeContext,params.origin.actorUserId) : undefined,
          duplicateCheck: { sourceType: 'manual', sourceId: params.intentId, receiverEdielId: params.routeContext.receiverEdielId, messageFamily: 'PRODAT', messageCode: params.origin.code, messageVersion: draft.messageVersion } })
      } catch (error) {
        // A concurrent canonical insert is atomically bound by the database.
        // Reuse only that exact permission's persisted message, never rerender.
        if ((error as { code?: string })?.code !== '23505') throw error
        const concurrent = await reserveServicePermissionOrigin({ ...params.origin, intentId: params.intentId })
        if (concurrent.status !== 'reserved' || !concurrent.messageId) throw error
        message = await getEdielMessageById(concurrent.messageId)
        if (!message || message.company_id !== params.origin.providerCompanyId) throw error
        if (message.status !== 'draft') return { status: 'existing', intentId: params.intentId, message, blockingReasons: [] }
      }
    }
    // A canonical duplicate is reusable only when the database has bound it to
    // this immutable operation. A prior sent Z18 may never be linked or queued.
    const bound = await reserveServicePermissionOrigin({ ...params.origin, intentId: params.intentId })
    if (bound.status !== 'reserved' || bound.messageId !== message.id || message.intent_id !== params.intentId || message.outbound_request_id !== params.outboundRequestId) throw new Error('ediel_permission_current_operation_message_required')
    if (message.status !== 'draft') return { status: 'existing', intentId: params.intentId, message, blockingReasons: [] }
    await updateIntentLifecycle(params.intentId, { renderStatus: 'rendered', edielMessageId: message.id, outboundRequestId: params.outboundRequestId, actorUserId: params.origin.actorUserId })
    await queuePreparedEdielMessage({ actorUserId: params.origin.actorUserId, messageId: message.id, intentId: params.intentId, outboundRequestId: params.outboundRequestId, externalReference: message.external_reference })
    await updateIntentLifecycle(params.intentId, { outboxStatus: 'queued', actorUserId: params.origin.actorUserId })
    return { status: 'queued', intentId: params.intentId, message, blockingReasons: [] }
  } catch (error) {
    const reason = classifyRenderError(error)
    await updateIntentLifecycle(params.intentId, { renderStatus: 'failed', blockingReasons: [reason], actorUserId: params.origin.actorUserId })
    return { status: 'blocked', intentId: params.intentId, message: null, blockingReasons: [reason] }
  }
}

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

function structuredErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const candidate = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
    }
    const parts = [candidate.message, candidate.details, candidate.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
    const code = typeof candidate.code === 'string' && candidate.code.trim()
      ? candidate.code.trim()
      : null
    if (parts.length > 0) return code ? `${code}: ${parts.join(' | ')}` : parts.join(' | ')
    if (code) return code
    try {
      return JSON.stringify(error)
    } catch {
      return 'unknown_render_error'
    }
  }
  return String(error ?? 'unknown_render_error')
}

function classifyRenderError(error: unknown): EdielIntentBlockingReason {
  const message = structuredErrorMessage(error)
  const lower = message.toLowerCase()
  let code = 'render_failed'
  if (lower.includes('process_variant') || lower.includes('process_type')) {
    code = 'render_process_variant_blocked'
  } else if (lower.includes('tenant_mismatch')) {
    code = 'render_tenant_mismatch'
  } else if (lower.includes('application reference') || lower.includes('application_reference')) {
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

async function ensureProdatZ01FacilityIdentifier(
  siteId: string | null,
  companyId: string | null | undefined,
) {
  if (!siteId) {
    return assertProdatZ01Renderable({ facilityId: null })
  }
  try {
    const db = tenantDb(companyId)
    const { data } = await db
      .unscoped()
      .from('customer_sites')
      .select('facility_id,normalized_facility_id')
      .eq('company_id', db.companyId)
      .eq('id', siteId)
      .maybeSingle()
    const row = (data ?? null) as { facility_id?: unknown; normalized_facility_id?: unknown } | null
    return assertProdatZ01Renderable({
      facilityId: row?.facility_id ?? null,
      normalizedFacilityId: row?.normalized_facility_id ?? null,
    })
  } catch {
    return assertProdatZ01Renderable({ facilityId: null })
  }
}

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

  const z01Gate = await ensureProdatZ01FacilityIdentifier(
    params.request.customer_site_id,
    params.routeContext.companyId,
  )
  if (!z01Gate.renderable) {
    const reason: EdielIntentBlockingReason = {
      code: z01Gate.blocker.blocker_code,
      message: z01Gate.blocker.blocker_reason,
      severity: 'block',
      details: {
        source: 'prodat_z01_facility_guard',
        superadmin_diagnostic: z01Gate.superadminDiagnostic,
        use_manual_information_request: true,
      },
    }
    await updateIntentLifecycle(params.intentId, {
      validationStatus: 'blocked',
      blockingReasons: [reason],
      validationResult: {
        ...(gate.intent.validationResult ?? {}),
        prodatZ01FacilityGuard: {
          blocked: true,
          code: reason.code,
          at: new Date().toISOString(),
        },
      },
      actorUserId: params.actorUserId,
    })
    return { status: 'blocked', intentId: params.intentId, message: null, blockingReasons: [reason] }
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

export async function renderAndQueueCustomerMasterdataZ01(params: {
  intentId: string
  actorUserId: string
  dataRequest: CustomerMasterdataZ01RenderRequest & Record<string, unknown>
  gridOwner: Record<string, unknown> | null
  routeContext: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
  outboundRequestId: string
  operationId: string | null
  externalReference: string
  transactionReference: string
  messageVersion: string
  routeProfileId: string
}): Promise<RenderGatewayResult> {
  const gate = await loadValidatedIntent(params.intentId)
  if (!gate.ok) {
    return { status: 'blocked', intentId: params.intentId, message: null, blockingReasons: gate.reasons }
  }

  try {
    const { linkEdielMessage } = await import('@/lib/ediel/db')

    const draft = await buildCustomerMasterdataZ01Draft({
      actorUserId: params.actorUserId,
      routeContext: params.routeContext,
      dataRequest: params.dataRequest,
      gridOwner: params.gridOwner,
      externalReference: params.externalReference,
      transactionReference: params.transactionReference,
      messageVersion: params.messageVersion,
      operationId: params.operationId,
    })
    draft.intentId = params.intentId

    const message = await finalizeOutboundDraft({
      actorUserId: params.actorUserId,
      requestType: 'customer_masterdata',
      routeContext: params.routeContext,
      draft,
      outboundRequestId: params.outboundRequestId,
      duplicateCheck: {
        sourceType: 'grid_owner_data_request',
        sourceId: params.dataRequest.id,
        receiverEdielId: params.routeContext.receiverEdielId,
        messageFamily: 'PRODAT',
        messageCode: 'Z01',
        messageVersion: params.messageVersion,
      },
    })

    await linkEdielMessage({
      actorUserId: params.actorUserId,
      edielMessageId: message.id,
      outboundRequestId: params.outboundRequestId,
      gridOwnerDataRequestId: params.dataRequest.id,
      customerId: params.dataRequest.customer_id,
      siteId: params.dataRequest.site_id,
      meteringPointId: params.dataRequest.metering_point_id,
      gridOwnerId: params.dataRequest.grid_owner_id,
      communicationRouteId: params.routeContext.route.id,
    })

    const messagePatch: Record<string, unknown> = {
      intent_id: params.intentId,
      route_profile_id: params.routeProfileId,
    }
    if (params.operationId) messagePatch.operation_id = params.operationId
    const db = tenantDb(params.routeContext.companyId)
    const { error: messageUpdateError } = await db
      .unscoped()
      .from('ediel_messages')
      .update(messagePatch)
      .eq('company_id', db.companyId)
      .eq('id', message.id)
    if (
      messageUpdateError &&
      !['42703', 'PGRST204', 'PGRST205'].includes(String((messageUpdateError as { code?: string }).code ?? ''))
    ) {
      throw messageUpdateError
    }

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
      externalReference: params.externalReference,
      intentId: params.intentId,
      payload: {
        edielCode: 'Z01',
        routeId: params.routeContext.route.id,
        routeProfileId: params.routeProfileId,
        operationId: params.operationId,
        intentId: params.intentId,
        gridOwnerDataRequestId: params.dataRequest.id,
        messageFamily: 'PRODAT',
        messageCode: 'Z01',
        messageVersion: params.messageVersion,
        processVariant: draft.parsedPayload?.prodatVariant ?? null,
        expectedZ02Variant: draft.parsedPayload?.expectedZ02Variant ?? null,
      },
    })

    await updateIntentLifecycle(params.intentId, {
      outboxStatus: 'queued',
      edielMessageId: message.id,
      outboundRequestId: params.outboundRequestId,
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
