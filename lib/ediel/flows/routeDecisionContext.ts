// Bridges outbound EDIFACT builders to the hardened route decision engine.

import {
  resolveCanonicalOutboundContext,
} from '@/lib/ediel/core/kernel'
import { resolveEdielRoute } from '@/lib/routes/routeDecisionEngine'
import type {
  BusinessProcess,
  RouteDecisionIssue,
  RouteDecisionOutput,
} from '@/lib/routes/routeDecisionTypes'
import type { CanonicalRouteRequestType } from '@/lib/ediel/core/routeRegistry'
import type {
  EdielEnvironment,
  EdielMessageFamily,
  EdielMessageStandard,
} from '@/lib/ediel/types'
import type { GridOwnerRow } from '@/lib/masterdata/types'

type CanonicalOutboundContext = Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>

export type DecisionBackedOutboundContext = CanonicalOutboundContext & {
  routeDecision: RouteDecisionOutput
}

function issueText(issue: RouteDecisionIssue): string {
  return `${issue.code}: ${issue.message}`
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function resolveDecisionBackedOutboundContext(params: {
  requestType: CanonicalRouteRequestType
  businessProcess?: BusinessProcess
  messageFamily: EdielMessageFamily | string
  messageCode?: string | null
  gridOwner?: GridOwnerRow | null
  preferredRouteId?: string | null
  companyId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  supplierSwitchRequestId?: string | null
  dataRequestId?: string | null
  outboundRequestId?: string | null
  inboundMessageId?: string | null
  environment: EdielEnvironment
  messageStandard?: EdielMessageStandard
  actorUserId?: string | null
  payload?: Record<string, unknown>
}): Promise<DecisionBackedOutboundContext> {
  const businessProcess = params.businessProcess ?? (params.requestType as BusinessProcess)
  const decision = await resolveEdielRoute({
    companyId: params.companyId ?? null,
    customerId: params.customerId ?? null,
    siteId: params.siteId ?? null,
    meteringPointId: params.meteringPointId ?? null,
    gridOwnerId: params.gridOwner?.id ?? null,
    businessProcess,
    messageFamily: params.messageFamily,
    messageCode: params.messageCode ?? null,
    environment: params.environment,
    preferredRouteId: params.preferredRouteId ?? null,
    supplierSwitchRequestId: params.supplierSwitchRequestId ?? null,
    dataRequestId: params.dataRequestId ?? null,
    outboundRequestId: params.outboundRequestId ?? null,
    inboundMessageId: params.inboundMessageId ?? null,
    actorUserId: params.actorUserId ?? null,
    payload: params.payload ?? {},
  })

  if (decision.blockingReasons.length > 0 || decision.decisionStatus === 'blocked') {
    throw new Error(
      [
        'Ediel-routing blockerades av backend route engine.',
        ...decision.blockingReasons.map(issueText),
      ].join(' ')
    )
  }

  if (!decision.communicationRouteId) {
    throw new Error('Ediel-routing saknar aktiv route. Skapa eller aktivera route innan EDIFACT byggs.')
  }

  if (!nonEmpty(decision.senderEdielId)) {
    throw new Error('Bolaget saknar Ediel-ID för vald miljö.')
  }

  if (!nonEmpty(decision.receiverEdielId)) {
    throw new Error('Ediel-routing saknar mottagande Ediel-ID. Välj nätägare eller motpart innan EDIFACT byggs.')
  }

  const canonical = await resolveCanonicalOutboundContext({
    requestType: params.requestType,
    gridOwner: params.gridOwner ?? null,
    preferredRouteId: decision.communicationRouteId,
    companyId: params.companyId ?? null,
    environment: params.environment,
    messageStandard: params.messageStandard ?? 'edifact',
  })

  return {
    ...canonical,
    companyId: params.companyId ?? canonical.companyId,
    senderEdielId: decision.senderEdielId ?? canonical.senderEdielId,
    senderSubAddress: decision.senderSubAddress ?? canonical.senderSubAddress,
    receiverEdielId: decision.receiverEdielId ?? canonical.receiverEdielId,
    receiverName:
      payloadString(decision.payload, 'selected_grid_owner_name') ?? canonical.receiverName,
    receiverSubAddress: decision.receiverSubAddress ?? canonical.receiverSubAddress,
    applicationReference: decision.applicationReference ?? canonical.applicationReference,
    defaultMessageVersion: decision.messageVersion ?? canonical.defaultMessageVersion,
    routeDecisionReason: [
      canonical.routeDecisionReason,
      `Backend route engine valde ${decision.receiverSource ?? 'okänd mottagarkälla'}${
        decision.dynamicReceiverStrategy
          ? ` via ${decision.dynamicReceiverStrategy}`
          : ''
      }.`,
    ].join(' '),
    routeDecision: decision,
  }
}
