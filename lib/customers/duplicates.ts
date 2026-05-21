import { supabaseService } from '@/lib/supabase/service'

export type DuplicateCustomerCandidate = {
  id: string
  customer_number: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  email: string | null
  personal_number: string | null
  org_number: string | null
  created_at: string | null
}

export type DuplicateCustomerGroup = {
  groupKey: string
  reason: string
  candidates: DuplicateCustomerCandidate[]
}

function normalize(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9åäö@.]+/gi, '')
  return cleaned || null
}

function displayName(row: DuplicateCustomerCandidate): string {
  return row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.company_name || row.email || row.customer_number || 'Kund'
}

function pushGroup(
  groups: DuplicateCustomerGroup[],
  seen: Set<string>,
  key: string,
  reason: string,
  candidates: DuplicateCustomerCandidate[]
) {
  const unique = Array.from(new Map(candidates.map((row) => [row.id, row])).values())
  if (unique.length < 2) return
  const signature = `${reason}:${unique.map((row) => row.id).sort().join('|')}`
  if (seen.has(signature)) return
  seen.add(signature)
  groups.push({ groupKey: key, reason, candidates: unique })
}

export async function listDuplicateCustomerGroups(companyId: string | null): Promise<DuplicateCustomerGroup[]> {
  let query = supabaseService
    .from('customers')
    .select('id, customer_number, full_name, first_name, last_name, company_name, email, personal_number, org_number, created_at')
    .order('created_at', { ascending: false })
    .limit(1200)

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as DuplicateCustomerCandidate[]
  const byEmail = new Map<string, DuplicateCustomerCandidate[]>()
  const byPersonal = new Map<string, DuplicateCustomerCandidate[]>()
  const byOrg = new Map<string, DuplicateCustomerCandidate[]>()
  const byName = new Map<string, DuplicateCustomerCandidate[]>()

  for (const row of rows) {
    const email = normalize(row.email)
    const personal = normalize(row.personal_number)
    const org = normalize(row.org_number)
    const name = normalize(displayName(row))
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), row])
    if (personal) byPersonal.set(personal, [...(byPersonal.get(personal) ?? []), row])
    if (org) byOrg.set(org, [...(byOrg.get(org) ?? []), row])
    if (name && name.length > 6) byName.set(name, [...(byName.get(name) ?? []), row])
  }

  const groups: DuplicateCustomerGroup[] = []
  const seen = new Set<string>()
  for (const [key, candidates] of byEmail) pushGroup(groups, seen, key, 'Samma e-post', candidates)
  for (const [key, candidates] of byPersonal) pushGroup(groups, seen, key, 'Samma personnummer', candidates)
  for (const [key, candidates] of byOrg) pushGroup(groups, seen, key, 'Samma organisationsnummer', candidates)
  for (const [key, candidates] of byName) pushGroup(groups, seen, key, 'Samma namn', candidates)

  return groups.slice(0, 100)
}
