// Bridges outbound EDIFACT builders to the hardened route decision engine.

import { resolveApplicationReference } from '@/lib/ediel/core/applicationReferenceResolver'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'
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

export class RouteDecisionBlockedError extends Error {
  readonly decision: RouteDecisionOutput

  constructor(decision: RouteDecisionOutput) {
    super([
      'Ediel-routing blockerades av backend route engine.',
      ...decision.blockingReasons.map(issueText),
    ].join(' '))
    this.name = 'RouteDecisionBlockedError'
    this.decision = decision
  }
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

function payloadStringAny(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payloadString(payload, key)
    if (value) return value
  }
  return null
}

function sameToken(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = nonEmpty(a)?.toUpperCase() ?? null
  const right = nonEmpty(b)?.toUpperCase() ?? null
  return Boolean(left && right && left === right)
}

export async function resolveDecisionBackedOutboundContext(params: {
  requestType: CanonicalRouteRequestType
  businessProcess?: BusinessProcess
  messageFamily: EdielMessageFamily | string
  messageCode?: string | null
  gridOwner?: GridOwnerRow | null
  preferredRouteId?: string | null
  companyId: string
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
  const payload = params.payload ?? {}
  const decision = await resolveEdielRoute({
    companyId: params.companyId,
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
    payload,
  })

  if (decision.blockingReasons.length > 0 || decision.decisionStatus === 'blocked') {
    throw new RouteDecisionBlockedError(decision)
  }

  if (!decision.communicationRouteId) {
    throw new Error('Ediel-routing saknar aktiv route. Skapa eller aktivera route innan EDIFACT byggs.')
  }
  if (!nonEmpty(decision.senderEdielId)) throw new Error('Bolaget saknar Ediel-ID för vald miljö.')
  if (!nonEmpty(decision.receiverEdielId)) {
    throw new Error('Ediel-routing saknar mottagande Ediel-ID. Välj nätägare eller motpart innan EDIFACT byggs.')
  }

  const canonical = await resolveCanonicalOutboundContext({
    requestType: params.requestType,
    gridOwner: params.gridOwner ?? null,
    preferredRouteId: decision.communicationRouteId,
    companyId: params.companyId,
    environment: params.environment,
    messageStandard: params.messageStandard ?? 'edifact',
  })

  const family = String(params.messageFamily ?? '').trim().toUpperCase()
  const code = nonEmpty(params.messageCode)
  const standard = params.messageStandard ?? 'edifact'
  const canonicalBusinessFamily = standard === 'edifact' && (family === 'PRODAT' || family === 'UTILTS')

  let authoritativeApplicationReference: string | null = null
  let authoritativeVersion: string | null = null

  if (canonicalBusinessFamily) {
    if (!code) throw new Error(`canonical_message_code_required:${family}`)

    const declaredApplicationReference =
      payloadStringAny(payload, 'applicationReference', 'application_reference') ??
      nonEmpty(decision.applicationReference) ??
      nonEmpty(canonical.applicationReference)
    const requestedMessageCode = payloadStringAny(payload, 'requestedMessageCode', 'requested_message_code')

    authoritativeApplicationReference = resolveApplicationReference({
      messageFamily: family,
      businessCode: code,
      requestedMessageCode,
      routeProfile: declaredApplicationReference
        ? { applicationReference: declaredApplicationReference }
        : null,
    })

    for (const [source, declared] of [
      ['route_decision', decision.applicationReference],
      ['route_context', canonical.applicationReference],
    ] as const) {
      if (nonEmpty(declared) && !sameToken(declared, authoritativeApplicationReference)) {
        throw new Error(
          `canonical_application_reference_mismatch:${source}:${declared}:${authoritativeApplicationReference}`,
        )
      }
    }

    authoritativeVersion = await resolveCanonicalOutboundVersion({
      family,
      code,
      standard,
      environment: params.environment,
    })
    if (!authoritativeVersion) throw new Error(`canonical_message_version_missing:${family}:${code}`)
  }

  const ignoredRouteVersion =
    authoritativeVersion && nonEmpty(decision.messageVersion) && !sameToken(decision.messageVersion, authoritativeVersion)
      ? ` Route-version ${decision.messageVersion} ignorerades; canonical runtime kräver ${authoritativeVersion}.`
      : ''

  return {
    ...canonical,
    companyId: params.companyId,
    senderEdielId: decision.senderEdielId ?? canonical.senderEdielId,
    senderSubAddress: decision.senderSubAddress ?? canonical.senderSubAddress,
    receiverEdielId: decision.receiverEdielId ?? canonical.receiverEdielId,
    receiverName: payloadString(decision.payload, 'selected_grid_owner_name') ?? canonical.receiverName,
    receiverSubAddress: decision.receiverSubAddress ?? canonical.receiverSubAddress,
    applicationReference:
      authoritativeApplicationReference ?? decision.applicationReference ?? canonical.applicationReference,
    defaultMessageVersion:
      authoritativeVersion ?? canonical.defaultMessageVersion,
    routeDecisionReason: [
      canonical.routeDecisionReason,
      `Backend route engine valde ${decision.receiverSource ?? 'okänd mottagarkälla'}${
        decision.dynamicReceiverStrategy ? ` via ${decision.dynamicReceiverStrategy}` : ''
      }.${ignoredRouteVersion}`,
    ].join(' '),
    routeDecision: decision,
  }
}
