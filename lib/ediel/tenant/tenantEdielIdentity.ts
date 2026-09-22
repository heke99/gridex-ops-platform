import { supabaseService } from '@/lib/supabase/service'
import { createIdentityEvaluation, identityRows, type IdentityEvaluation, type TenantIdentityEvidence } from './tenantEdielIdentityEvidence'

export const EDIEL_TRANSPORT_AGENT_RELATION_TYPE = 'ediel_transport_agent' as const

export type CanonicalTenantEdielIdentity = {
  companyId: string
  environment: 'test' | 'production'
  legalActorId: string
  legalEdielId: string
  transportActorId: string
  transportEdielId: string
  roleCodes: string[]
  representedByTransportAgent: boolean
  transportRelationId: string | null
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(clean).filter((value): value is string => Boolean(value))))
}

function activeAtNow<T extends { valid_from?: string | null; valid_to?: string | null }>(row: T, now = Date.now()): boolean {
  const from = row.valid_from ? new Date(row.valid_from).getTime() : Number.NEGATIVE_INFINITY
  const to = row.valid_to ? new Date(row.valid_to).getTime() : Number.POSITIVE_INFINITY
  return !Number.isNaN(from) && !Number.isNaN(to) && from <= now && to > now
}

async function activeTenantEdielProfile(companyId: string, environment: 'test' | 'production', evaluation: IdentityEvaluation): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('tenant_ediel_profiles')
    .select('id,company_id,environment,market,is_enabled,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('market', 'electricity')
    .eq('is_enabled', true)

  if (error) throw error
  return identityRows(data, evaluation, 'profiles', {company_id:companyId,environment,market:'electricity',is_enabled:true}).some((row) => evaluation.active(row))
}

async function legalActorIdentifiers(companyId: string, environment: 'test' | 'production', evaluation: IdentityEvaluation) {
  const { data, error } = await supabaseService
    .from('tenant_actor_identifiers')
    .select('id,company_id,environment,actor_id,identifier_type,identifier_value,qualifier,subaddress,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('identifier_type', 'EdielId')

  if (error) throw error
  return identityRows(data, evaluation, 'identifiers', {company_id:companyId,environment,identifier_type:'EdielId'}).filter((row) => evaluation.active(row))
}

async function actorRoles(companyId: string, environment: 'test' | 'production', actorId: string, evaluation: IdentityEvaluation): Promise<string[]> {
  const { data, error } = await supabaseService
    .from('tenant_actor_roles')
    .select('id,company_id,environment,actor_id,role_code,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('actor_id', actorId)

  if (error) throw error
  return unique(
    identityRows(data, evaluation, 'roles', {company_id:companyId,environment,actor_id:actorId})
      .filter((row) => evaluation.active(row))
      .map((row) => clean(row.role_code)),
  )
}

async function transportAgentRelation(companyId: string, environment: 'test' | 'production', evaluation: IdentityEvaluation) {
  const { data, error } = await supabaseService
    .from('tenant_counterparty_relations')
    .select('id,company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('relation_type', EDIEL_TRANSPORT_AGENT_RELATION_TYPE)
    .eq('is_enabled', true)

  if (error) throw error
  const rows = identityRows(data, evaluation, 'relations', {company_id:companyId,environment,relation_type:EDIEL_TRANSPORT_AGENT_RELATION_TYPE,is_enabled:true}).filter((row) => evaluation.active(row))
  if (rows.length > 1) throw new Error(`tenant_ediel_transport_agent_ambiguous:${companyId}:${environment}`)
  return rows[0] ?? null
}

async function platformActorEdielId(actorId: string, evaluation: IdentityEvaluation): Promise<string> {
  const { data, error } = await supabaseService
    .from('platform_actor_identifiers')
    .select('id,actor_id,identifier_type,identifier_value,id_code_qualifier,id_code_responsible,source,is_verified,valid_from,valid_to,created_at,updated_at')
    .eq('actor_id', actorId)
    .eq('identifier_type', 'EdielId')

  if (error) throw error
  const rows = identityRows(data, evaluation, 'transportIdentifiers', {actor_id:actorId,identifier_type:'EdielId'})
  // Legacy callers retain their existing platform identifier semantics. Explicit
  // temporal evaluation also checks the directory's nullable DATE bounds.
  const values = unique(rows.filter(row => (!evaluation.explicit && !evaluation.collect) || evaluation.active(row, true)).map((row) => clean(row.identifier_value)))
  if (values.length !== 1) throw new Error(`transport_actor_ediel_identity_not_unique:${actorId}:${values.length}`)
  return values[0]
}

/**
 * Resolve the tenant's legal market actor separately from the UNB transport
 * actor. If no explicit transport-agent relation exists, the legal actor is
 * also the transport actor. If a relation exists, the relation is mandatory
 * evidence; shared mailbox/route configuration never grants representation.
 */
type TenantIdentityInput = { companyId: string; environment: 'test' | 'production'; asOf?: string }

export async function resolveCanonicalTenantEdielIdentity(input: TenantIdentityInput): Promise<CanonicalTenantEdielIdentity> {
  return resolveIdentity(input, createIdentityEvaluation(input.asOf, false))
}

/** Current database records evaluated at an instant, never proof that the rows
 * were known then. This adds provenance, not inbound source approval. */
export async function resolveCanonicalTenantEdielIdentityWithEvidence(input: TenantIdentityInput): Promise<{identity: CanonicalTenantEdielIdentity; evidence: TenantIdentityEvidence}> {
  const evaluation = createIdentityEvaluation(input.asOf, true)
  const identity = await resolveIdentity(input, evaluation)
  return {identity, evidence: evaluation.evidence}
}

async function resolveIdentity(input: TenantIdentityInput, evaluation: IdentityEvaluation): Promise<CanonicalTenantEdielIdentity> {
  const enabled = await activeTenantEdielProfile(input.companyId, input.environment, evaluation)
  if (!enabled) throw new Error(`tenant_ediel_profile_not_enabled:${input.companyId}:${input.environment}`)

  const identifiers = await legalActorIdentifiers(input.companyId, input.environment, evaluation)
  const legalActorIds = unique(identifiers.map((row) => clean(row.actor_id)))
  const legalEdielIds = unique(identifiers.map((row) => clean(row.identifier_value)))
  if (legalActorIds.length !== 1 || legalEdielIds.length !== 1) {
    throw new Error(`tenant_legal_ediel_identity_not_unique:${input.companyId}:${input.environment}:${legalActorIds.length}:${legalEdielIds.length}`)
  }

  const legalActorId = legalActorIds[0]
  const legalEdielId = legalEdielIds[0]
  const roleCodes = await actorRoles(input.companyId, input.environment, legalActorId, evaluation)
  if (roleCodes.length === 0) throw new Error(`tenant_market_roles_missing:${input.companyId}:${input.environment}`)

  const relation = await transportAgentRelation(input.companyId, input.environment, evaluation)
  if (!relation) {
    return {
      companyId: input.companyId,
      environment: input.environment,
      legalActorId,
      legalEdielId,
      transportActorId: legalActorId,
      transportEdielId: legalEdielId,
      roleCodes,
      representedByTransportAgent: false,
      transportRelationId: null,
    }
  }

  const transportActorId = clean(relation.counterparty_actor_id)
  if (!transportActorId) throw new Error(`tenant_ediel_transport_agent_actor_missing:${input.companyId}:${input.environment}`)
  const transportEdielId = await platformActorEdielId(transportActorId, evaluation)
  if (transportActorId === legalActorId || transportEdielId === legalEdielId) {
    throw new Error(`tenant_ediel_transport_agent_not_distinct:${input.companyId}:${input.environment}`)
  }

  return {
    companyId: input.companyId,
    environment: input.environment,
    legalActorId,
    legalEdielId,
    transportActorId,
    transportEdielId,
    roleCodes,
    representedByTransportAgent: true,
    transportRelationId: clean(relation.id),
  }
}

export async function findCanonicalTenantCandidatesByLegalEdielId(input: {
  legalEdielId: string
  environment: 'test' | 'production'
}): Promise<string[]> {
  const { data, error } = await supabaseService
    .from('tenant_actor_identifiers')
    .select('company_id,valid_from,valid_to')
    .eq('environment', input.environment)
    .eq('identifier_type', 'EdielId')
    .eq('identifier_value', input.legalEdielId)

  if (error) throw error
  return unique(
    ((data ?? []) as Array<Record<string, unknown> & { valid_from?: string | null; valid_to?: string | null }>)
      .filter((row) => activeAtNow(row))
      .map((row) => clean(row.company_id)),
  )
}

export function assertInboundTransportMatchesTenantIdentity(input: {
  identity: CanonicalTenantEdielIdentity
  unbReceiverEdielId: string | null | undefined
}): void {
  const receiver = clean(input.unbReceiverEdielId)
  if (!receiver) throw new Error('inbound_unb_receiver_missing')
  if (receiver !== input.identity.transportEdielId) {
    throw new Error(`inbound_transport_identity_mismatch:${receiver}:${input.identity.transportEdielId}`)
  }
}

export function tenantHasMarketRole(identity: CanonicalTenantEdielIdentity, role: 'electricity_supplier' | 'energy_service_company'): boolean {
  return identity.roleCodes.includes(role)
}
