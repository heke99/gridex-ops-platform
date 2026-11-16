import { supabaseService } from '@/lib/supabase/service'

type LegalPayloadInput = { companyId: string; customerId: string; siteId?: string | null; contractId?: string | null }

type LegalPayload = {
  ok: boolean
  missing: string[]
  powerOfAttorney: Record<string, unknown> | null
  document: Record<string, unknown> | null
  legalAcceptances: Array<Record<string, unknown>>
  contract: Record<string, unknown> | null
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(code) || /does not exist|schema cache|column .* does not exist/i.test(message)
}

type QueryResponse = { data: unknown; error: unknown }
type MaybeSingleQuery = { maybeSingle: () => PromiseLike<QueryResponse> }
type ListQuery = PromiseLike<QueryResponse>

async function safeMaybe(query: MaybeSingleQuery): Promise<Record<string, unknown> | null> {
  const { data, error } = await query.maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data ?? null) as Record<string, unknown> | null
}

async function safeList(query: ListQuery): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await query
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return (data ?? []) as Array<Record<string, unknown>>
}

export async function prepareLegalPayloadForGridOwner(input: LegalPayloadInput): Promise<LegalPayload> {
  let powerOfAttorneyQuery = supabaseService
    .from('powers_of_attorney')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('status', 'signed')
    .order('accepted_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (input.siteId) {
    powerOfAttorneyQuery = powerOfAttorneyQuery.or(`customer_site_id.eq.${input.siteId},site_id.eq.${input.siteId}`)
  }
  const powerOfAttorney = await safeMaybe(powerOfAttorneyQuery.limit(1))

  let documentQuery = supabaseService
    .from('customer_documents')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('document_type', 'power_of_attorney')
    .in('status', ['available', 'uploaded', 'signed', 'active'])
    .order('created_at', { ascending: false })
  if (input.siteId) {
    documentQuery = documentQuery.or(`customer_site_id.eq.${input.siteId},customer_site_id.is.null`)
  }
  const document = await safeMaybe(documentQuery.limit(1))

  const legalAcceptances = await safeList(
    supabaseService
      .from('customer_legal_acceptances')
      .select('id,legal_bundle_version_document_id,legal_module_key,legal_document_version,legal_document_sha256,legal_text_version_id,accepted_at,created_at,metadata')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .order('accepted_at', { ascending: false })
      .limit(50),
  )

  let contractQuery = supabaseService
    .from('customer_contracts')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false })
  if (input.contractId) contractQuery = contractQuery.eq('id', input.contractId)
  const contract = await safeMaybe(contractQuery.limit(1))

  const missing: string[] = []
  if (!powerOfAttorney && !document) missing.push('fullmakt')
  if (legalAcceptances.length === 0) missing.push('juridiska godkännanden')

  return { ok: missing.length === 0, missing, powerOfAttorney, document, legalAcceptances, contract }
}
