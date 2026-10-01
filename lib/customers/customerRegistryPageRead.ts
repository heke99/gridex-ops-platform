import 'server-only'
import { supabaseService } from '@/lib/supabase/service'
import type { LatestContractBucketFilter } from '@/lib/customer-contracts/db'
import type { CustomerFlagFilter, CustomerListPageResult, CustomerListRow, CustomerStatusFilter, CustomerTypeFilter } from './getCustomers'

type RegistryInput = {
  companyId: string | null
  query: string
  status: CustomerStatusFilter
  contractFilter: LatestContractBucketFilter
  customerType: CustomerTypeFilter
  flag: CustomerFlagFilter
  excludeTestData: boolean
  page: number
  pageSize: number
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const statusKeys = ['all','draft','pending_verification','active','inactive','moved','terminated','blocked','archived'] as const
const textKeys = ['intake_status','first_name','last_name','full_name','company_name','email','phone','personal_number',
  'org_number','customer_number','apartment_number','source'] as const
const factCounts = ['site_count','active_site_count','metering_point_count','active_metering_point_count','contract_count'] as const

function invalid(): never { throw new Error('Customer registry returned an invalid snapshot') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}
function nullableText(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') return invalid()
  return value as string | null
}
function parseRow(value: unknown, companyId: string | null): CustomerListRow {
  const row = record(value)
  if (typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.company_id !== 'string' || !uuid.test(row.company_id)
    || (companyId !== null && row.company_id !== companyId)) return invalid()
  if (!['private','business','association'].includes(String(row.customer_type))
    || !statusKeys.slice(1).includes(row.status as Exclude<typeof statusKeys[number], 'all'>)
    || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) return invalid()
  for (const key of ['possible_duplicate','duplicate_review_status','consolidated_invoice','billing_level']) {
    if (row[key] !== null) return invalid()
  }
  if (typeof row.has_missing_grid_owner !== 'boolean' || typeof row.has_signed_power_of_attorney !== 'boolean'
    || (row.is_test_data !== null && typeof row.is_test_data !== 'boolean')) return invalid()
  if (!Array.isArray(row.intake_missing_fields) || !row.intake_missing_fields.every(value => typeof value === 'string')) return invalid()
  const counts = Object.fromEntries(factCounts.map(key => [key, integer(row[key])])) as Pick<CustomerListRow, typeof factCounts[number]>
  if (counts.active_site_count > counts.site_count || counts.active_metering_point_count > counts.metering_point_count) return invalid()
  return {
    id: row.id,
    customer_type: row.customer_type as string,
    status: row.status as string,
    ...Object.fromEntries(textKeys.map(key => [key, nullableText(row[key])])) as Pick<CustomerListRow, typeof textKeys[number]>,
    possible_duplicate: null, duplicate_review_status: null, consolidated_invoice: null, billing_level: null,
    billing_profile_revision: integer(row.billing_profile_revision),
    intake_missing_fields: row.intake_missing_fields,
    has_missing_grid_owner: row.has_missing_grid_owner,
    has_signed_power_of_attorney: row.has_signed_power_of_attorney,
    created_at: row.created_at,
    is_test_data: row.is_test_data,
    ...counts,
  }
}

export async function readCustomerRegistryPage(input: RegistryInput): Promise<CustomerListPageResult> {
  // This typed boundary is temporary until root regenerates the genuine schema
  // types. It adds no client caller or role grant and retains the service owner.
  const rpc = supabaseService as unknown as {
    rpc: (name: 'gridex_customer_registry_page_v1', args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
  }
  const { data, error } = await rpc.rpc('gridex_customer_registry_page_v1', {
    p_company_id: input.companyId, p_query: input.query, p_status: input.status,
    p_contract_filter: input.contractFilter, p_customer_type: input.customerType, p_flag: input.flag,
    p_exclude_test_data: input.excludeTestData, p_page: input.page, p_page_size: input.pageSize,
  })
  if (error) throw error
  const reply = record(data)
  const total = integer(reply.total)
  const page = integer(reply.page)
  const pageSize = integer(reply.pageSize)
  const totalPages = integer(reply.totalPages)
  if (page !== input.page || pageSize !== input.pageSize || page < 1 || pageSize < 1 || pageSize > 100
    || totalPages !== Math.max(1, Math.ceil(total / pageSize)) || !Array.isArray(reply.rows)) return invalid()
  const from = (page - 1) * pageSize
  if (!Number.isSafeInteger(from) || reply.rows.length !== Math.min(pageSize, Math.max(0, total - from))) return invalid()
  const rows = reply.rows.map(value => parseRow(value, input.companyId))
  if (new Set(rows.map(row => row.id)).size !== rows.length) return invalid()
  const rawCounts = record(reply.counts)
  const counts = Object.fromEntries(statusKeys.map(key => [key, integer(rawCounts[key])])) as CustomerListPageResult['counts']
  if (counts.all < total || statusKeys.slice(1).some(key => counts[key] > counts.all)
    || statusKeys.slice(1).reduce((sum, key) => sum + counts[key], 0) !== counts.all) return invalid()
  return { rows, total, page, pageSize, totalPages, counts }
}
