import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { API_CONTRACT_RESPONSE_SCHEMA_VERSION } from '@/lib/external-contracts/publicationDto'

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
  if (values.length > 1) throw new PublicContractsQueryError(name, `${name} får bara anges en gång.`)
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
    throw new PublicContractsQueryError('customer_type', 'customer_type måste vara private eller business. company accepteras tillfälligt som deprecated alias för business.')
  }
  const customerType = normalizedCustomerType.value
  const channel = oneValue(request, 'channel') ?? 'website'
  if (channel !== 'website') {
    throw new PublicContractsQueryError('channel', 'Den publika website-endpointen accepterar endast channel=website.')
  }
  const diagnosticsValue = oneValue(request, 'diagnostics')
  if (diagnosticsValue !== null && !['0', '1', 'false', 'true'].includes(diagnosticsValue)) {
    throw new PublicContractsQueryError('diagnostics', 'diagnostics måste vara 0, 1, false eller true.')
  }
  return {
    customerType,
    channel: 'website',
    diagnostics: diagnosticsValue === '1' || diagnosticsValue === 'true',
  }
}

export const PUBLIC_CONTRACT_RESPONSE_SCHEMA_VERSION = WEBSITE_INTEGRATION_CONTRACT_VERSION

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
  tenantReference: string
  channel: 'website' | 'api'
  customerType: 'private' | 'business' | null
  contractSchemaVersion: string
  contracts: unknown[]
  feedState: 'contracts_present' | 'canonical_empty'
  emptyFeedAuthorization: unknown | null
  diagnostics?: unknown
}): string {
  const representation = canonicalJson({
    tenant_reference: input.tenantReference,
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

export type PublicContractFeedFingerprint = {
  fingerprint: string
  revision: number
  updatedAt: string | null
  stockholmDate: string
  etag: string
}

function missingFingerprintRpc(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42883', 'PGRST202'].includes(code)
    || /public_contract_feed_fingerprint_v1.*not found|schema cache/i.test(message)
}

/**
 * Returns a conservative dependency fingerprint when the forward migration is
 * installed. `null` means the current environment has not yet received the
 * migration and callers must use the existing representation-hash fallback.
 */
export async function loadPublicContractFeedFingerprint(input: {
  companyId: string
  customerType: 'private' | 'business' | null
  channel: 'website'
}): Promise<PublicContractFeedFingerprint | null> {
  const { data, error } = await supabaseService.rpc('public_contract_feed_fingerprint_v1', {
    p_company_id: input.companyId,
    p_customer_type: input.customerType,
    p_channel: input.channel,
  })
  if (error) {
    if (missingFingerprintRpc(error)) return null
    throw error
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  const fingerprint = typeof row?.fingerprint === 'string' ? row.fingerprint : ''
  if (!fingerprint) return null
  const revision = Number(row?.publication_revision ?? 0)
  const updatedAt = row?.publication_updated_at ? String(row.publication_updated_at) : null
  const stockholmDate = row?.stockholm_date ? String(row.stockholm_date) : ''
  return {
    fingerprint,
    revision: Number.isFinite(revision) ? revision : 0,
    updatedAt,
    stockholmDate,
    etag: `"contracts-feed-${fingerprint}"`,
  }
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

export function ifNoneMatchMatches(request: NextRequest, etag: string): boolean {
  const header = request.headers.get('if-none-match')
  if (!header) return false
  return header.split(',').map((value) => value.trim()).includes(etag)
}