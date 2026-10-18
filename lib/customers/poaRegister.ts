import type { SupabaseClient } from '@supabase/supabase-js'
import type { GuardResult } from '@/lib/admin/guards'
import { tenantReadCompanyId } from '@/lib/tenant/adminScope'

type Row = Record<string, unknown>
export type PoaRegisterFilters = { company?: string; customer?: string; verification?: string; page?: string }
const quotedPattern = (value: string) => `"%${value.replace(/([\\%_])/g, '\\$1').replace(/"/g, '\\"')}%"`
const text = (value: unknown) => typeof value === 'string' ? value : ''

export async function readPoaRegister(client: Pick<SupabaseClient, 'from'>, admin: Pick<GuardResult, 'isPlatformAdmin' | 'companyId'>, filters: PoaRegisterFilters) {
  const ownCompany = tenantReadCompanyId(admin.isPlatformAdmin, admin.companyId)
  const companyId = ownCompany ?? (admin.isPlatformAdmin ? filters.company?.trim() || null : null)
  if (companyId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(companyId)) throw new Error('Välj ett giltigt bolag.')
  const page = Math.min(10000, Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1))
  let customerIds: string[] | null = null
  if (filters.customer?.trim()) {
    const pattern = quotedPattern(filters.customer.trim().slice(0, 120))
    let customers = client.from('customers').select('id').or(`full_name.ilike.${pattern},company_name.ilike.${pattern},customer_number.ilike.${pattern}`).limit(201)
    if (companyId) customers = customers.eq('company_id', companyId)
    const result = await customers
    if (result.error) throw result.error
    if ((result.data ?? []).length > 200) throw new Error('För många kunder matchar. Ange ett mer precist kundnamn eller kundnummer.')
    customerIds = (result.data ?? []).map((row) => String(row.id))
  }
  let query = client.from('powers_of_attorney').select('id,company_id,customer_id,status,reference,method,source,accepted_at,signed_at,created_at,valid_from,valid_to,valid_until,expires_at,revoked_at,evidence_payload,document_path')
  if (companyId) query = query.eq('company_id', companyId)
  if (customerIds) query = query.in('customer_id', customerIds)
  if (filters.verification?.trim()) query = query.ilike('evidence_payload->>verification_reference', `%${filters.verification.trim().slice(0, 120).replace(/([\\%_])/g, '\\$1')}%`)
  const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * 50, page * 50)
  if (result.error) throw result.error
  const hasMore = (result.data ?? []).length > 50
  const powers = ((result.data ?? []) as Row[]).slice(0, 50)
  const customerKeys = Array.from(new Set(powers.map((row) => text(row.customer_id)).filter(Boolean)))
  const companyKeys = Array.from(new Set(powers.map((row) => text(row.company_id)).filter(Boolean)))
  const [customers, companies, requests] = await Promise.all([
    customerKeys.length ? client.from('customers').select('id,company_id,customer_number,full_name,company_name').in('id', customerKeys).in('company_id', companyKeys) : { data: [], error: null },
    admin.isPlatformAdmin ? client.from('companies').select('id,name,legal_name,org_number').order('name').limit(500)
      : client.from('companies').select('id,name,legal_name,org_number').eq('id', companyId!),
    powers.length ? client.from('grid_owner_information_requests').select('id,company_id,customer_id,poa_id,last_error_message,metadata').in('company_id', companyKeys).in('poa_id', powers.map((row) => String(row.id))).eq('status', 'needs_review') : { data: [], error: null },
  ])
  for (const response of [customers, companies, requests]) if (response.error) throw response.error
  const customerRows = (customers.data ?? []) as Row[]
  return { powers: powers.map((row) => ({ ...row,
    customer: customerRows.find((customer) => customer.id === row.customer_id && customer.company_id === row.company_id) ?? null,
    company: ((companies.data ?? []) as Row[]).find((company) => company.id === row.company_id) ?? null,
    reviewRequests: ((requests.data ?? []) as Row[]).filter((request) => request.poa_id === row.id && request.company_id === row.company_id && request.customer_id === row.customer_id),
  })), companies: (companies.data ?? []) as Row[], companyId, page, hasMore }
}
