import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'

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
  const opaque = createHash('sha256').update(`${companyId}:${channel}:${revision}:${token}`).digest('base64url').slice(0, 32)
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
