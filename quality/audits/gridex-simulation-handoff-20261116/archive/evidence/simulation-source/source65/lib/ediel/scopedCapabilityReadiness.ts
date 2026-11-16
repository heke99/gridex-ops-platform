import { supabaseService } from '@/lib/supabase/service'
import { AI_LIST_SOURCE_PROFILE, assertAiListOutboundMessage, parseAiBiTechnicalFile } from '@/lib/ediel/aiListFormat'
import { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import { canonicalBusinessSemanticsProjection } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import { resolveCanonicalTenantEdielIdentity } from '@/lib/ediel/tenant/tenantEdielIdentity'
import { requireTenantOperationAllowed } from '@/lib/tenant/operationPolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'

const HELD = 'ediel_scoped_capability_evidence_required'
type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
export type ScopedEdielReadiness = {
  authorityVersion: 1
  scope: { companyId: string; actorId: string; actorRole: string; market: 'electricity'; environment: 'production'; family: string; code: string; subtype: string | null; assignmentId: string | null }
  dependencyHash: string
  dependencies: Record<string, unknown>
  ready: boolean
  evidenceId: string | null
  expiresAt: string | null
}

function releaseSha(): string {
  const value = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA
  if (!value || !/^[0-9a-f]{40}$/.test(value)) throw new Error('ediel_release_sha_unavailable')
  return value
}

// Only role spelling is projected here. Message meaning/allowed roles comes
// from the canonical authority; this module never selects a guide or rulepack.
function semanticRole(role: string): string {
  return role === 'electricity_supplier' ? 'supplier' : role === 'energy_service_company' ? 'esco' : role
}

function prescribedResponse(message: EdielMessageRow): boolean {
  // Wire/tenant/source validation and immutable ACK outcome gates still run.
  // Expiring business readiness must not stop an incoming required response.
  return ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(message.message_family) ||
    (message.message_family === 'UTILTS' && message.message_code === 'ERR')
}

async function requestScope(message: EdielMessageRow) {
  if (!message.company_id || message.direction !== 'outbound' || !message.raw_payload) throw new Error(HELD)
  if (message.message_family === 'AI_LIST') {
    assertAiListOutboundMessage(message)
    const ai = parseAiBiTechnicalFile(message.raw_payload, 'AI')
    const identity = await resolveCanonicalTenantEdielIdentity({ companyId: message.company_id, environment: 'production' })
    if (identity.legalEdielId !== ai.header.supplierEdielId || !identity.roleCodes.includes('electricity_supplier') || message.message_code !== 'AI') throw new Error(HELD)
    return { p_company_id: message.company_id, p_message_id: message.id, p_legal_actor_id: identity.legalActorId,
      p_actor_role: 'electricity_supplier', p_family: 'AI_LIST', p_code: 'AI', p_subtype: null,
      p_assignment_id: null, p_release_sha: releaseSha(), p_rulepack_hash: AI_LIST_SOURCE_PROFILE.sourceSha256 }
  }
  if (!message.rule_pack_checksum || !/^[0-9a-f]{64}$/.test(message.rule_pack_checksum)) throw new Error(HELD)
  const parsed = parseRulebookMessage(message.raw_payload)
  if (parsed.family !== message.message_family || parsed.code !== message.message_code) throw new Error(HELD)
  const semantics = canonicalBusinessSemanticsProjection({ family: parsed.family, code: parsed.code!, subtype: parsed.subtype })
  if (!semantics) throw new Error(HELD)
  const identity = await resolveCanonicalTenantEdielIdentity({ companyId: message.company_id, environment: 'production' })
  if (parsed.sender !== identity.transportEdielId) throw new Error(HELD)
  const roles = identity.roleCodes.filter(role => semantics.senderRoles.includes(semanticRole(role)))
  if (roles.length !== 1) throw new Error(HELD)
  const assignment = message.parsed_payload?.serviceAssignmentId
  if (assignment != null && (typeof assignment !== 'string' || !/^[0-9a-f-]{36}$/.test(assignment))) throw new Error(HELD)
  if (semanticRole(roles[0]) === 'esco' && !assignment) throw new Error(HELD)
  return { p_company_id: message.company_id, p_message_id: message.id, p_legal_actor_id: identity.legalActorId,
    p_actor_role: roles[0], p_family: parsed.family, p_code: parsed.code, p_subtype: semantics.subtype,
    p_assignment_id: assignment ?? null, p_release_sha: releaseSha(), p_rulepack_hash: message.rule_pack_checksum }
}

/** Read-only operational projection. A company summary is never this authority. */
export async function getScopedEdielProductionReadiness(message: EdielMessageRow): Promise<ScopedEdielReadiness> {
  const args = await requestScope(message)
  // Generated signatures follow authentic native replay, never handwritten types.
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as Rpc
  const { data, error } = await rpc('ediel_scoped_capability_readiness_v1', args)
  if (error) throw new Error(HELD, { cause: error })
  const result = data as ScopedEdielReadiness | null
  if (!result || !result.scope || result.authorityVersion !== 1 || result.scope.companyId !== args.p_company_id || result.scope.actorId !== args.p_legal_actor_id ||
      result.scope.actorRole !== args.p_actor_role || result.scope.family !== args.p_family || result.scope.code !== args.p_code ||
      result.scope.subtype !== args.p_subtype || result.scope.assignmentId !== args.p_assignment_id ||
      result.scope.environment !== 'production' || result.scope.market !== 'electricity' || !/^[0-9a-f]{64}$/.test(result.dependencyHash)) throw new Error(HELD)
  return result
}

export async function assertScopedEdielProductionCapability(message: EdielMessageRow): Promise<void> {
  if (message.environment !== 'production' || prescribedResponse(message)) return
  if (!message.company_id) throw new Error(HELD)
  await requireTenantOperationAllowed(message.company_id, 'ediel.production.send')
  const result = await getScopedEdielProductionReadiness(message)
  if (result.ready !== true || !result.evidenceId || !result.expiresAt || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error(HELD)
}

/** Future test-phase publication requires real approved, scope-bound evidence.
 * No migration seeds evidence and callers cannot supply an approved flag. */
export async function recordScopedEdielProductionEvidence(input: { message: EdielMessageRow; expectedDependencyHash: string; certificationEvidenceIds: string[]; expiresAt: string }) {
  const args = await requestScope(input.message)
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as Rpc
  const { data, error } = await rpc('ediel_record_scoped_capability_evidence_v1', { ...args,
    p_expected_dependency_hash: input.expectedDependencyHash, p_certification_evidence_ids: input.certificationEvidenceIds, p_expires_at: input.expiresAt })
  if (error) throw new Error(HELD, { cause: error })
  if (typeof data !== 'string') throw new Error(HELD)
  return data
}
