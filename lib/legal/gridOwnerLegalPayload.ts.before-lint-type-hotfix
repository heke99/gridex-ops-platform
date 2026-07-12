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

async function safeMaybe(table: string, select: string, build: (q: any) => any): Promise<Record<string, unknown> | null> {
  const query = build(supabaseService.from(table).select(select))
  const { data, error } = await query.maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data ?? null) as Record<string, unknown> | null
}

async function safeList(table: string, select: string, build: (q: any) => any): Promise<Array<Record<string, unknown>>> {
  const query = build(supabaseService.from(table).select(select))
  const { data, error } = await query
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return (data ?? []) as Array<Record<string, unknown>>
}

export async function prepareLegalPayloadForGridOwner(input: LegalPayloadInput): Promise<LegalPayload> {
  const powerOfAttorney = await safeMaybe('powers_of_attorney', '*', (q) => {
    q = q.eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('status', 'signed').order('accepted_at', { ascending: false }).order('created_at', { ascending: false })
    if (input.siteId) q = q.or(`customer_site_id.eq.${input.siteId},site_id.eq.${input.siteId}`)
    return q.limit(1)
  })

  const document = await safeMaybe('customer_documents', '*', (q) => {
    q = q.eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('document_type', 'power_of_attorney').in('status', ['available', 'uploaded', 'signed', 'active']).order('created_at', { ascending: false })
    if (input.siteId) q = q.or(`customer_site_id.eq.${input.siteId},customer_site_id.is.null`)
    return q.limit(1)
  })

  const legalAcceptances = await safeList('customer_legal_acceptances', 'id,legal_text_version_id,accepted_at,created_at,metadata', (q) =>
    q.eq('company_id', input.companyId).eq('customer_id', input.customerId).order('accepted_at', { ascending: false }).limit(50)
  )

  const contract = await safeMaybe('customer_contracts', '*', (q) => {
    q = q.eq('company_id', input.companyId).eq('customer_id', input.customerId).order('created_at', { ascending: false })
    if (input.contractId) q = q.eq('id', input.contractId)
    return q.limit(1)
  })

  const missing: string[] = []
  if (!powerOfAttorney && !document) missing.push('fullmakt')
  if (legalAcceptances.length === 0) missing.push('juridiska godkännanden')

  return { ok: missing.length === 0, missing, powerOfAttorney, document, legalAcceptances, contract }
}
