import { isMissingPortalSchemaError } from '@/lib/customer-portal/customerResolver'
import { normalizeFacility } from '@/lib/customer-portal/externalApi'
import { supabaseService } from '@/lib/supabase/service'

export type PortalCustomerCandidate = {
  id: string
  company_id: string
  customer_number: string | null
  email: string | null
  personal_number: string | null
  org_number: string | null
  flags: {
    emailMatched: boolean
    customerNumberMatched: boolean
    identifierMatched: boolean
    facilityMatched: boolean
  }
}

function missingResolverRpc(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return isMissingPortalSchemaError(error)
    || code === 'PGRST202'
    || code === '42883'
    || /resolve_portal_customer_identity_v1.*not found/i.test(message)
}

function candidateFromRpc(row: Record<string, unknown>): PortalCustomerCandidate {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    customer_number: typeof row.customer_number === 'string' ? row.customer_number : null,
    email: typeof row.email === 'string' ? row.email : null,
    personal_number: typeof row.personal_number === 'string' ? row.personal_number : null,
    org_number: typeof row.org_number === 'string' ? row.org_number : null,
    flags: {
      emailMatched: row.email_matched === true,
      customerNumberMatched: row.customer_number_matched === true,
      identifierMatched: row.identifier_matched === true,
      facilityMatched: row.facility_matched === true,
    },
  }
}

async function resolveViaCanonicalRpc(input: {
  companyId: string
  email: string
  customerNumber: string
  identifier: string
  facilityId: string
}): Promise<PortalCustomerCandidate[] | null> {
  const { data, error } = await supabaseService.rpc('resolve_portal_customer_identity_v1', {
    p_company_id: input.companyId,
    p_email: input.email || null,
    p_customer_number: input.customerNumber || null,
    p_identifier: input.identifier || null,
    p_facility_id: input.facilityId ? normalizeFacility(input.facilityId) : null,
    p_limit: 20,
  })
  if (error) {
    if (missingResolverRpc(error)) return null
    throw error
  }
  return ((data ?? []) as Record<string, unknown>[]).map(candidateFromRpc)
}

async function facilityCustomerIds(companyId: string, facilityId: string): Promise<Set<string>> {
  const normalized = normalizeFacility(facilityId)
  if (!normalized) return new Set()
  const variants = Array.from(new Set([facilityId.trim(), normalized].filter(Boolean)))
  const { data, error } = await supabaseService
    .from('customer_sites')
    .select('customer_id')
    .eq('company_id', companyId)
    .or(`facility_id.in.(${variants.join(',')}),normalized_facility_id.in.(${variants.join(',')})`)
  if (error) throw error
  return new Set((data ?? []).map((row) => String(row.customer_id)).filter(Boolean))
}

async function resolveViaCompatibilityQueries(input: {
  companyId: string
  email: string
  customerNumber: string
  identifier: string
  facilityId: string
}): Promise<PortalCustomerCandidate[]> {
  const customerIds = new Set<string>()
  const candidates: Omit<PortalCustomerCandidate, 'flags'>[] = []
  const facilityMatches = input.facilityId
    ? await facilityCustomerIds(input.companyId, input.facilityId)
    : new Set<string>()

  const addRows = (rows: Record<string, unknown>[] | null | undefined) => {
    for (const row of rows ?? []) {
      const id = String(row.id ?? '')
      if (!id || customerIds.has(id)) continue
      customerIds.add(id)
      candidates.push({
        id,
        company_id: String(row.company_id ?? input.companyId),
        customer_number: typeof row.customer_number === 'string' ? row.customer_number : null,
        email: typeof row.email === 'string' ? row.email : null,
        personal_number: typeof row.personal_number === 'string' ? row.personal_number : null,
        org_number: typeof row.org_number === 'string' ? row.org_number : null,
      })
    }
  }

  const baseSelect = 'id,company_id,customer_number,email,personal_number,org_number'
  const reads: Promise<void>[] = []

  if (input.customerNumber) {
    reads.push((async () => {
      const { data, error } = await supabaseService
        .from('customers')
        .select(baseSelect)
        .eq('company_id', input.companyId)
        .eq('customer_number', input.customerNumber)
        .limit(20)
      if (error) throw error
      addRows(data as Record<string, unknown>[])
    })())
  }

  if (input.email) {
    reads.push((async () => {
      const { data, error } = await supabaseService
        .from('customers')
        .select(baseSelect)
        .eq('company_id', input.companyId)
        .ilike('email', input.email)
        .limit(20)
      if (error) throw error
      addRows(data as Record<string, unknown>[])
    })())
  }

  if (input.identifier) {
    reads.push((async () => {
      const { data, error } = await supabaseService
        .from('customers')
        .select(baseSelect)
        .eq('company_id', input.companyId)
        .or(`personal_number.eq.${input.identifier},org_number.eq.${input.identifier},normalized_personal_number.eq.${input.identifier},normalized_org_number.eq.${input.identifier}`)
        .limit(20)
      if (error) throw error
      addRows(data as Record<string, unknown>[])
    })())
  }

  if (facilityMatches.size > 0) {
    reads.push((async () => {
      const { data, error } = await supabaseService
        .from('customers')
        .select(baseSelect)
        .eq('company_id', input.companyId)
        .in('id', Array.from(facilityMatches))
      if (error) throw error
      addRows(data as Record<string, unknown>[])
    })())
  }

  await Promise.all(reads)

  const normalizeEmail = (value: string | null) => value?.trim().toLowerCase() ?? ''
  const digits = (value: string | null) => value?.replace(/\D+/g, '') ?? ''
  return candidates.map((customer) => ({
    ...customer,
    flags: {
      emailMatched: Boolean(input.email && normalizeEmail(customer.email) === input.email),
      customerNumberMatched: Boolean(input.customerNumber && customer.customer_number === input.customerNumber),
      identifierMatched: Boolean(input.identifier && (
        digits(customer.personal_number) === input.identifier ||
        digits(customer.org_number) === input.identifier
      )),
      facilityMatched: Boolean(input.facilityId && facilityMatches.has(customer.id)),
    },
  })).sort((left, right) =>
    Object.values(right.flags).filter(Boolean).length - Object.values(left.flags).filter(Boolean).length,
  )
}

export async function resolvePortalCustomerCandidates(input: {
  companyId: string
  email: string
  customerNumber: string
  identifier: string
  facilityId: string
}): Promise<PortalCustomerCandidate[]> {
  const canonical = await resolveViaCanonicalRpc(input)
  if (canonical) return canonical
  return resolveViaCompatibilityQueries(input)
}
