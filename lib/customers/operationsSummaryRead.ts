import { InvalidReadModelResponseError, readResult, type ReadResult } from '@/lib/read-models/readResult'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { OutboundRequestRow } from '@/lib/cis/types'

type SelectedCustomer = { id: string; company_id?: string | null }
type Source = 'sites' | 'requests' | 'outbound'
type QueryResult = { data: unknown; error: unknown; count?: number | null }
export type OperationsSummaryReadKind = ReadResult<unknown>['kind']

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const nullableText = (value: unknown) => value === null || text(value)

/** Certifies only this selected customer's operational projection, after the page guard. */
export async function readCustomerOperationsRows<T>(
  query: () => PromiseLike<QueryResult>,
  parents: SelectedCustomer[],
  source: Source,
): Promise<ReadResult<T[]>> {
  const result = await readResult(async () => {
    const { data, error, count } = await query()
    if (error) throw error
    if (!Array.isArray(data) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < data.length || count < 0) {
      throw new InvalidReadModelResponseError()
    }
    const seen = new Set<string>()
    for (const value of data) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidReadModelResponseError()
      const row = value as Record<string, unknown>
      const parent = parents.find(item => item.id === row.customer_id)
      if (!text(row.id) || seen.has(row.id) || !text(row.company_id) || !text(row.customer_id)
        || !parent || parent.company_id !== row.company_id || !text(row.created_at) || !Number.isFinite(Date.parse(row.created_at))) {
        throw new InvalidReadModelResponseError()
      }
      seen.add(row.id)
      if (source !== 'sites' && (!text(row.status) || !nullableText(row.site_id))) throw new InvalidReadModelResponseError()
      if (source === 'requests') {
        for (const field of ['inbound_z04_message_id', 'confirmed_start_date', 'requested_start_date', 'submitted_at', 'completed_at', 'failed_at']) {
          if (!nullableText(row[field])) throw new InvalidReadModelResponseError()
        }
      }
      if (source === 'outbound') {
        if (row.request_type !== 'supplier_switch' || row.source_type !== 'supplier_switch_request' || !text(row.source_id)) {
          throw new InvalidReadModelResponseError()
        }
        for (const field of ['acknowledged_at', 'failed_at', 'sent_at', 'prepared_at', 'queued_at']) {
          if (!nullableText(row[field])) throw new InvalidReadModelResponseError()
        }
      }
    }
    return { rows: data as T[], count }
  }, { definitionVersion: 'customer_operations_summary_v1', errorCode: 'CUSTOMER_OPERATIONS_UNAVAILABLE' })
  if (result.kind === 'unavailable') return result
  if (result.data.count > result.data.rows.length) {
    return { kind: 'partial', coverage: 'partial', data: result.data.rows, reasonCodes: ['CUSTOMER_OPERATIONS_SOURCE_CAPPED'], meta: result.meta }
  }
  return { kind: 'ready', coverage: 'complete', data: result.data.rows, meta: result.meta }
}

/** Even complete row reads cannot prove a missing chain from an orphaned legacy correlation. */
export function customerOperationsReadKind(input: {
  customerId: string
  companyId?: string | null
  sites: ReadResult<CustomerSiteRow[]>
  requests: ReadResult<SupplierSwitchRequestRow[]>
  outbound: ReadResult<OutboundRequestRow[]>
}): OperationsSummaryReadKind {
  if (!text(input.companyId) || [input.sites, input.requests, input.outbound].some(read => read.kind === 'unavailable')) return 'unavailable'
  if (input.sites.kind !== 'ready' || input.requests.kind !== 'ready' || input.outbound.kind !== 'ready') return 'partial'
  const sites = input.sites.data.filter(site => site.company_id === input.companyId && site.customer_id === input.customerId)
  const requests = input.requests.data.filter(request => request.company_id === input.companyId && request.customer_id === input.customerId)
  if (requests.some(request => !request.site_id || !sites.some(site => site.id === request.site_id))) return 'partial'
  const outbound = input.outbound.data.filter(row => row.company_id === input.companyId && row.customer_id === input.customerId)
  if (outbound.some(row => !requests.some(request => row.source_id === request.id && row.site_id === request.site_id
    && row.company_id === request.company_id && row.customer_id === request.customer_id
    && row.request_type === 'supplier_switch' && row.source_type === 'supplier_switch_request'))) return 'partial'
  return 'ready'
}
