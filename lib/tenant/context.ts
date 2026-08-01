import { randomUUID } from 'node:crypto'

export type TenantActorType = 'user' | 'integration' | 'worker' | 'webhook' | 'system'

export type TenantSourceChannel =
  | 'admin'
  | 'public_website'
  | 'customer_portal'
  | 'partner_api'
  | 'import'
  | 'migration'
  | 'ediel_inbound'
  | 'worker'
  | 'webhook'
  | 'system'

export type TenantContext = Readonly<{
  companyId: string
  actorType: TenantActorType
  actorId: string
  permissions: readonly string[]
  scopes: readonly string[]
  correlationId: string
  sourceChannel: TenantSourceChannel
}>

export type TenantClaimPayload = Record<string, unknown>

const TENANT_CLAIM_KEYS = ['company_id', 'companyId', 'tenant_id', 'tenantId'] as const

export class TenantContextError extends Error {
  readonly status: number
  readonly code:
    | 'TENANT_CONTEXT_REQUIRED'
    | 'TENANT_CONTEXT_INVALID'
    | 'TENANT_CONTEXT_MISMATCH'

  constructor(input: {
    status: number
    code: TenantContextError['code']
    message: string
  }) {
    super(input.message)
    this.name = 'TenantContextError'
    this.status = input.status
    this.code = input.code
  }
}

function required(value: string | null | undefined, field: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new TenantContextError({
      status: 500,
      code: 'TENANT_CONTEXT_INVALID',
      message: `Betrodd tenantkontext saknar ${field}.`,
    })
  }
  return normalized
}

function stableUnique(values: readonly string[] | null | undefined): readonly string[] {
  return Object.freeze(
    [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort(),
  )
}

export function createTenantContext(input: {
  companyId: string
  actorType: TenantActorType
  actorId: string
  permissions?: readonly string[]
  scopes?: readonly string[]
  correlationId?: string | null
  sourceChannel: TenantSourceChannel
}): TenantContext {
  return Object.freeze({
    companyId: required(input.companyId, 'companyId'),
    actorType: input.actorType,
    actorId: required(input.actorId, 'actorId'),
    permissions: stableUnique(input.permissions),
    scopes: stableUnique(input.scopes),
    correlationId: input.correlationId?.trim() || randomUUID(),
    sourceChannel: input.sourceChannel,
  })
}

export function assertTenantContextCompany(
  context: TenantContext | null | undefined,
  companyId: string | null | undefined,
): string {
  if (!context) {
    throw new TenantContextError({
      status: 500,
      code: 'TENANT_CONTEXT_REQUIRED',
      message: 'Betrodd tenantkontext krävs för operationen.',
    })
  }

  const requestedCompanyId = required(companyId, 'companyId')
  if (requestedCompanyId !== context.companyId) {
    throw new TenantContextError({
      status: 403,
      code: 'TENANT_CONTEXT_MISMATCH',
      message: 'Begäran matchar inte den autentiserade tenantkontexten.',
    })
  }
  return context.companyId
}

function claimValues(payload: TenantClaimPayload): string[] {
  const values: string[] = []
  for (const key of TENANT_CLAIM_KEYS) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) values.push(value.trim())
  }
  return values
}

/**
 * Client supplied tenant identifiers are never authoritative. Matching claims
 * are tolerated for backwards compatibility and then removed. A mismatch is
 * rejected without revealing which tenant owns the authenticated identity.
 */
export function bindPayloadToTenant<T extends TenantClaimPayload>(
  context: TenantContext,
  payload: T,
): Omit<T, (typeof TENANT_CLAIM_KEYS)[number]> {
  for (const claim of claimValues(payload)) {
    assertTenantContextCompany(context, claim)
  }

  const bound = { ...payload }
  for (const key of TENANT_CLAIM_KEYS) delete bound[key]
  return bound
}

export function tenantContextForIntegration(input: {
  companyId: string
  clientId: string
  scopes: readonly string[]
  correlationId?: string | null
}): TenantContext {
  return createTenantContext({
    companyId: input.companyId,
    actorType: 'integration',
    actorId: input.clientId,
    scopes: input.scopes,
    permissions: [],
    correlationId: input.correlationId,
    sourceChannel: 'partner_api',
  })
}
