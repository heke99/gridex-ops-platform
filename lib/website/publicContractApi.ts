import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { API_CONTRACT_RESPONSE_SCHEMA_VERSION } from '@/lib/external-contracts/publicationDto'
import {
  API_CONTRACT_PROFILE_REGISTRY,
  assessApiContractCompatibility,
  type ApiContractProfile,
} from '@/lib/integrations/apiContractCompatibility'
import { profileRepresentationKey } from '@/lib/integrations/apiContractProjection'

export type PublicContractsQuery = {
  customerType: 'private' | 'business' | null
  channel: 'website'
  diagnostics: boolean
}

export class PublicContractsQueryError extends Error {
  readonly code = 'invalid_query_parameter'
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'PublicContractsQueryError'
    this.field = field
  }
}

function oneValue(request: NextRequest, name: string): string | null {
  const values = request.nextUrl.searchParams.getAll(name)
  if (values.length > 1) throw new PublicContractsQueryError(name, `${name} may only be specified once.`)
  return values[0]?.trim() || null
}

export function parsePublicContractsQuery(request: NextRequest): PublicContractsQuery {
  const supported = new Set(['customer_type', 'channel', 'diagnostics'])
  for (const key of request.nextUrl.searchParams.keys()) {
    if (!supported.has(key)) throw new PublicContractsQueryError(key, `Query-parametern ${key} stöds inte.`)
  }

  const rawCustomerType = oneValue(request, 'customer_type')
  const normalizedCustomerType = normalizeExternalCustomerType(rawCustomerType)
  if (!normalizedCustomerType.ok) {
    throw new PublicContractsQueryError('customer_type', 'customer_type must be private or business. company is temporarily accepted as a deprecated alias for business.')
  }
  const customerType = normalizedCustomerType.value
  const channel = oneValue(request, 'channel') ?? 'website'
  if (channel !== 'website') {
    throw new PublicContractsQueryError('channel', 'The public website endpoint only accepts channel=website.')
  }
  const diagnosticsValue = oneValue(request, 'diagnostics')
  if (diagnosticsValue !== null && !['0', '1', 'false', 'true'].includes(diagnosticsValue)) {
    throw new PublicContractsQueryError('diagnostics', 'diagnostics must be 0, 1, false or true.')
  }
  return {
    customerType,
    channel: 'website',
    diagnostics: diagnosticsValue === '1' || diagnosticsValue === 'true',
  }
}

export const PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION = WEBSITE_INTEGRATION_CONTRACT_VERSION

/**
 * Revision of the public-contract DTO representation produced by this server
 * (mapping/serialization of a publication). Bump it whenever the body for an
 * unchanged database publication changes. A documentation-only release that
 * leaves the body unchanged does not need to bump it.
 */
export const PUBLIC_CONTRACT_REPRESENTATION_REVISION = '2026-10-09.1'

/** Selected representation profile for the public-contract feed (package 4). */
export function selectPublicContractProfile(): ApiContractProfile {
  const result = assessApiContractCompatibility({
    surface: 'website',
    major: 'v1',
    clientProfile: null,
    requiredCapabilities: ['contracts.read'],
    registry: API_CONTRACT_PROFILE_REGISTRY,
  })
  if (!result.ok) throw new Error('public_contract_profile_unavailable')
  return result.profile
}

/**
 * Cheap conditional-GET ETag (F16). The database fingerprint covers tenant,
 * customer type, channel, date and publication revision; the server-side
 * representation identity (schema version, representation revision and the
 * selected profile) is mixed in so a release that changes the body for the
 * same publication never replays an old body via 304. Tenant/customer
 * type/channel are included explicitly so two scopes never share a tag.
 */
export function buildPublicContractFeedEtag(input: {
  companyId: string
  customerType: 'private' | 'business' | null
  channel: 'website' | 'api'
  dbFingerprint: string
  profile: Pick<ApiContractProfile, 'surface' | 'revision'>
  contractSchemaVersion?: string
  representationRevision?: string
}): string {
  const identity = canonicalJson({
    company_id: input.companyId,
    customer_type: input.customerType ?? 'all',
    channel: input.channel,
    db_fingerprint: input.dbFingerprint,
    profile: profileRepresentationKey(input.profile.surface, input.profile.revision),
    contract_schema_version: input.contractSchemaVersion ?? PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION,
    representation_revision: input.representationRevision ?? PUBLIC_CONTRACT_REPRESENTATION_REVISION,
  })
  return `"pcf-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}"`
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    const item = source[key]
    if (item !== undefined) result[key] = canonicalizeJson(item)
  }
  return result
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function buildPublicContractRepresentationEtag(input: {
  organizationReference: string
  channel: 'website' | 'api'
  customerType: 'private' | 'business' | null
  contractSchemaVersion: string
  contracts: unknown[]
  feedState: 'contracts_present' | 'canonical_empty'
  emptyFeedAuthorization: unknown | null
  diagnostics?: unknown
}): string {
  const representation = canonicalJson({
    organization_reference: input.organizationReference,
    channel: input.channel,
    customer_type: input.customerType,
    contract_schema_version: input.contractSchemaVersion,
    contracts: input.contracts,
    feed_state: input.feedState,
    empty_feed_authorization: input.emptyFeedAuthorization,
    ...(input.diagnostics === undefined ? {} : { diagnostics: input.diagnostics }),
  })
  const opaque = createHash('sha256')
    .update(representation)
    .digest('base64url')
    .slice(0, 43)
  return `"contracts-${opaque}"`
}

export type PublicationRevision = {
  revision: number
  token: string
  updatedAt: string | null
  etag: string
}

export async function loadPublicationRevision(companyId: string, channel: 'website' | 'api'): Promise<PublicationRevision> {
  const { data, error } = await supabaseService
    .from('contract_publication_revisions')
    .select('revision,revision_token,updated_at')
    .eq('company_id', companyId)
    .eq('channel', channel)
    .maybeSingle()
  if (error) throw error
  const revision = Number(data?.revision ?? 0)
  const token = String(data?.revision_token ?? 'initial')
  const representationVersion =
    channel === 'website'
      ? PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION
      : API_CONTRACT_RESPONSE_SCHEMA_VERSION
  const opaque = createHash('sha256').update(`${companyId}:${channel}:${revision}:${token}:${representationVersion}`).digest('base64url').slice(0, 32)
  return {
    revision,
    token,
    updatedAt: data?.updated_at ? String(data.updated_at) : null,
    etag: `"contracts-${opaque}"`,
  }
}

export function requestId(): string {
  return randomUUID()
}

/**
 * Parses an RFC 9110 If-None-Match field value. Returns `'*'` for the
 * wildcard, otherwise the list of entity-tags (quoted strings with optional
 * `W/` prefix). Malformed members are ignored so a broken list never matches.
 */
export function parseIfNoneMatch(header: string | null): '*' | string[] {
  if (!header) return []
  const trimmed = header.trim()
  if (trimmed === '*') return '*'
  const tags: string[] = []
  const pattern = /\s*(W\/)?("[\x21\x23-\x7e\x80-\xff]*")\s*(?:,|$)/gy
  let match: RegExpExecArray | null
  while (pattern.lastIndex < trimmed.length && (match = pattern.exec(trimmed))) {
    tags.push(`${match[1] ?? ''}${match[2]}`)
  }
  return tags
}

function opaqueTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/**
 * GET/HEAD If-None-Match evaluation (RFC 9110 section 13.1.2): weak
 * comparison, comma-separated lists and `*` (matches whenever a current
 * representation exists, which is the case once `etag` is known). Callers
 * must evaluate this only after authentication and tenant/profile resolution.
 */
export function ifNoneMatchMatches(request: NextRequest, etag: string): boolean {
  const parsed = parseIfNoneMatch(request.headers.get('if-none-match'))
  if (parsed === '*') return true
  const current = opaqueTag(etag)
  return parsed.some((tag) => opaqueTag(tag) === current)
}
