import { resolveCanonicalActorContext, type CanonicalActorContext } from '@/lib/ediel/core/actorRegistry'
import { createEdielExecutionContext, stockholmBusinessDate, type EdielExecutionContext, type EdielExecutionFamily } from '@/lib/ediel/core/executionContext'
import { processActorRole } from '@/lib/ediel/core/marketRole'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'

/** Business families sent in the tenant's own market role (DDQ/DGI). */
const ROLE_BOUND_FAMILIES = new Set(['PRODAT', 'UTILTS'])

/**
 * TEN-01/TEN-02: before an outbound business message can mutate anything, the
 * process selects the tenant's role profile, the verified tenant identity must
 * hold that market role, and the wire sender must be that profile's transport
 * identity. Technical families without a market role return null.
 */
export async function assertOutboundActorIdentity(draft: CreateEdielMessageInput): Promise<CanonicalActorContext | null> {
  if (!ROLE_BOUND_FAMILIES.has(draft.messageFamily)) return null
  const role = processActorRole(draft.applicationReference)
  if (!role) throw new Error(`canonical_outbound_process_role_unresolved:${draft.messageFamily}:${draft.messageCode}`)
  const actor = await resolveCanonicalActorContext(draft.environment!, draft.companyId!, role)
  if ((draft.senderEdielId ?? '').trim() !== actor.senderEdielId) {
    throw new Error(`canonical_outbound_sender_identity_mismatch:${role}`)
  }
  return actor
}

export function buildOutboundExecutionContext(params: {
  draft: CreateEdielMessageInput
  actor: CanonicalActorContext
  rulePackId: string
}): EdielExecutionContext {
  const { draft, actor } = params
  return createEdielExecutionContext({
    companyId: draft.companyId,
    environment: draft.environment,
    market: 'electricity',
    direction: draft.direction,
    family: draft.messageFamily as EdielExecutionFamily,
    messageCode: String(draft.messageCode),
    transactionSubtype: null,
    businessProcess: draft.processType ?? `${draft.messageFamily}:${draft.messageCode}`,
    businessDate: stockholmBusinessDate(),
    senderActorId: actor.actor.id,
    legalActorEdielId: actor.legalActorEdielId,
    senderEdielId: draft.senderEdielId,
    senderRole: actor.actorRole,
    senderSubAddress: draft.senderSubAddress ?? null,
    receiverActorId: null,
    receiverEdielId: draft.receiverEdielId,
    receiverRole: null,
    receiverSubAddress: draft.receiverSubAddress ?? null,
    gridAreaCode: null,
    rulePackId: params.rulePackId,
    communicationRouteId: draft.communicationRouteId,
    routeProfileId: draft.routeProfileId ?? null,
    certificateProfileId: null,
    applicationReference: draft.applicationReference,
    sourceOperationId: draft.sourceOperationId,
  })
}
