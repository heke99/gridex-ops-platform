import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { createOutboundRequest } from '@/lib/cis/db'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { coordinateEdielServicePermission } from '@/lib/ediel/services/commands'
import { readServicePermissionOrigin } from '@/lib/ediel/services/permissionOrigin'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import { resolveApplicationReferenceForProcess } from '@/lib/ediel/intent/applicationReferencePolicy'
import { createEdielMessageIntent } from '@/lib/ediel/intent/intentEngine'
import { renderAndQueueServicePermission } from '@/lib/ediel/intent/renderGateway'

export type PrepareServicePermissionParams = {
  providerCompanyId: string; assignmentId: string; actorUserId: string; expectedVersion: number;
  permissionId?: string; preferredRouteId?: string | null
}

async function prepare(input: PrepareServicePermissionParams, code: 'Z13' | 'Z18') {
  await assertEdielTenantActor({ companyId: input.providerCompanyId, actorUserId: input.actorUserId, permission: 'metering.write' })
  let permissionId = input.permissionId
  if (!permissionId && code === 'Z13') {
    const coordinated = await coordinateEdielServicePermission({ ...input, command: 'request_access' })
    if (coordinated.status === 'held' || !coordinated.permissionId) return { status: 'held' as const, missing: coordinated.missing ?? ['permission_coordination_held'] }
    permissionId = coordinated.permissionId
  }
  if (!permissionId) return { status: 'held' as const, missing: ['source_bound_permission_required'] }
  const origin = { ...input, permissionId, code }
  const basis = await readServicePermissionOrigin(origin)
  if (basis.status === 'held') return basis
  const applicationReference = resolveApplicationReferenceForProcess('metering_permission')
  const route = await resolveCanonicalOutboundContext({ requestType: 'metering_access', companyId: input.providerCompanyId,
    environment: basis.environment, receiverEdielId: basis.legalReceiverId,
    preferredRouteId: input.preferredRouteId, applicationReference })
  if (route.actor.tenantIdentity?.legalActorId !== basis.providerActorId || route.actor.legalActorEdielId !== basis.legalSenderId || !route.actor.marketRoles.includes('energy_service_company')) throw new Error('ediel_permission_canonical_legal_esco_required')
  const routeProfileId = route.routeRuntime?.route_profile_id
  if (!routeProfileId) throw new Error('ediel_permission_canonical_route_profile_required')
  // Protocol references are independent random wire values persisted by the
  // existing idempotent intent engine; no internal beneficiary/tenant ID leaks.
  const reference = randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()
  const intent = await createEdielMessageIntent({ companyId: basis.companyId, environment: basis.environment,
    market: 'electricity', messageFamily: 'PRODAT', messageCode: code, businessProcess: 'metering_permission',
    senderEdielId: route.senderEdielId, senderSubaddress: route.senderSubAddress,
    receiverEdielId: route.receiverEdielId, receiverSubaddress: route.receiverMessageSubAddress ?? route.receiverSubAddress,
    applicationReference, routeProfileId, communicationRouteId: route.route.id,
    customerId: basis.customerId, operationId: basis.permissionId,
    interchangeReference: reference, messageReference: '1', transactionReference: basis.li ?? reference,
    idempotencyKey: `service-permission:${basis.permissionId}:${code}${code === 'Z18' ? `:${basis.evidenceId}:${basis.permissionStateVersion}` : ''}`,
    payload: { sourcePermissionBasis: basis, actorRole: 'esco', externalReference: reference, authorizationReference: randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase() }, actorUserId: input.actorUserId,
    routeProfile: { actorRole: 'esco', applicationReference: route.applicationReference } })
  // Use an actual tenant-owned outbound request so canonical duplicate lookup
  // cannot fall through to an unrelated message of the same family/code.
  const { data: requests, error } = await supabaseService.from('outbound_requests').select('id,company_id')
    .eq('company_id', basis.companyId).eq('source_type', 'manual').eq('source_id', intent.id)
    .eq('request_type', 'metering_access').contains('payload',{servicePermissionCommandKey:intent.id}).order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  const existing = requests?.[0]
  const outboundRequestId = existing?.id ?? (await createOutboundRequest({ actorUserId: input.actorUserId,
    customerId: basis.customerId, requestType: 'metering_access', sourceType: 'manual', sourceId: intent.id,
    communicationRouteId: route.route.id, operationId: basis.permissionId, environment: basis.environment, failOnMissingEnvironment: true,
    payload: { serviceAssignmentId: basis.assignmentId, permissionId: basis.permissionId, servicePermissionCommandKey:intent.id, messageCode: code, sourceEvidenceId: basis.evidenceId } })).id
  return renderAndQueueServicePermission({ intentId: intent.id, origin, basis, routeContext: route, outboundRequestId })
}

export function prepareAndQueueServicePermissionZ13(input: PrepareServicePermissionParams) { return prepare(input, 'Z13') }
/** Ending an internal assignment and originating market termination are separate
 * commands. The latter requires its own assessed source reason/time and no
 * currently shared assignment. This API never manufactures those decisions. */
export function prepareAndQueueServicePermissionZ18(input: PrepareServicePermissionParams & { permissionId: string }) { return prepare(input, 'Z18') }
