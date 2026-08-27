import { supabaseService } from '@/lib/supabase/service'

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

async function activeTenantEdielProfile(companyId: string, environment: 'test' | 'production'): Promise<boolean> {
  const { data, error } = await supabaseService
    .from('tenant_ediel_profiles')
    .select('id,is_enabled,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('market', 'electricity')
    .eq('is_enabled', true)

  if (error) throw error
  return ((data ?? []) as Array<{ valid_from?: string | null; valid_to?: string | null }>).some((row) => activeAtNow(row))
}

async function legalActorIdentifiers(companyId: string, environment: 'test' | 'production') {
  const { data, error } = await supabaseService
    .from('tenant_actor_identifiers')
    .select('id,actor_id,identifier_type,identifier_value,qualifier,subaddress,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('identifier_type', 'EdielId')

  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown> & { valid_from?: string | null; valid_to?: string | null }>).filter((row) => activeAtNow(row))
}

async function actorRoles(companyId: string, environment: 'test' | 'production', actorId: string): Promise<string[]> {
  const { data, error } = await supabaseService
    .from('tenant_actor_roles')
    .select('role_code,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('actor_id', actorId)

  if (error) throw error
  return unique(
    ((data ?? []) as Array<Record<string, unknown> & { valid_from?: string | null; valid_to?: string | null }>)
      .filter((row) => activeAtNow(row))
      .map((row) => clean(row.role_code)),
  )
}

async function transportAgentRelation(companyId: string, environment: 'test' | 'production') {
  const { data, error } = await supabaseService
    .from('tenant_counterparty_relations')
    .select('id,counterparty_actor_id,relation_type,is_enabled,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('environment', environment)
    .eq('relation_type', EDIEL_TRANSPORT_AGENT_RELATION_TYPE)
    .eq('is_enabled', true)

  if (error) throw error
  const rows = ((data ?? []) as Array<Record<string, unknown> & { valid_from?: string | null; valid_to?: string | null }>).filter((row) => activeAtNow(row))
  if (rows.length > 1) throw new Error(`tenant_ediel_transport_agent_ambiguous:${companyId}:${environment}`)
  return rows[0] ?? null
}

async function platformActorEdielId(actorId: string): Promise<string> {
  const { data, error } = await supabaseService
    .from('platform_actor_identifiers')
    .select('identifier_value')
    .eq('actor_id', actorId)
    .eq('identifier_type', 'EdielId')

  if (error) throw error
  const values = unique(((data ?? []) as Array<Record<string, unknown>>).map((row) => clean(row.identifier_value)))
  if (values.length !== 1) throw new Error(`transport_actor_ediel_identity_not_unique:${actorId}:${values.length}`)
  return values[0]
}

/**
 * Resolve the tenant's legal market actor separately from the UNB transport
 * actor. If no explicit transport-agent relation exists, the legal actor is
 * also the transport actor. If a relation exists, the relation is mandatory
 * evidence; shared mailbox/route configuration never grants representation.
 */
export async function resolveCanonicalTenantEdielIdentity(input: {
  companyId: string
  environment: 'test' | 'production'
}): Promise<CanonicalTenantEdielIdentity> {
  const enabled = await activeTenantEdielProfile(input.companyId, input.environment)
  if (!enabled) throw new Error(`tenant_ediel_profile_not_enabled:${input.companyId}:${input.environment}`)

  const identifiers = await legalActorIdentifiers(input.companyId, input.environment)
  const legalActorIds = unique(identifiers.map((row) => clean(row.actor_id)))
  const legalEdielIds = unique(identifiers.map((row) => clean(row.identifier_value)))
  if (legalActorIds.length !== 1 || legalEdielIds.length !== 1) {
    throw new Error(`tenant_legal_ediel_identity_not_unique:${input.companyId}:${input.environment}:${legalActorIds.length}:${legalEdielIds.length}`)
  }

  const legalActorId = legalActorIds[0]
  const legalEdielId = legalEdielIds[0]
  const roleCodes = await actorRoles(input.companyId, input.environment, legalActorId)
  if (roleCodes.length === 0) throw new Error(`tenant_market_roles_missing:${input.companyId}:${input.environment}`)

  const relation = await transportAgentRelation(input.companyId, input.environment)
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
  const transportEdielId = await platformActorEdielId(transportActorId)
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
