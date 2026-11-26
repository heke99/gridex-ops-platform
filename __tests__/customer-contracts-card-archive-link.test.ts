import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { minimalPdf } from './helpers/minimalPdf'
import type { CustomerContractDocumentRow } from '@/lib/customer-contracts/documents'

const ids = {
  company: '95050000-0000-4000-8000-000000000001',
  customer: '95050000-0000-4000-8000-000000000002',
  site: '95050000-0000-4000-8000-000000000003',
  meter: '95050000-0000-4000-8000-000000000004',
  contract: '95050000-0000-4000-8000-000000000005',
  original: '95050000-0000-4000-8000-000000000006',
  bound: '95050000-0000-4000-8000-000000000007',
}
const signedAt = '2026-11-09T12:00:00Z'
const marketStart = '2026-12-01T00:00:00+01:00'
const originalPdf = minimalPdf('Earlier archive')
const signedPdf = minimalPdf('Exact signed archive')
const digest = (pdf: Buffer) => createHash('sha256').update(pdf).digest('hex')
const documentPath = (hash: string) => `${ids.company}/${ids.contract}/signed-contract-${hash}.pdf`
const href = (documentId: string) => `/api/admin/customer-contract-documents/${documentId}`
let documents: CustomerContractDocumentRow[]
let signedHash: string | null
const MAX_POSTGREST_ROWS = 1000
const documentPageSizes: number[] = []
const download = vi.fn(async (path: string) => {
  const bytes = path === documentPath(digest(signedPdf)) ? signedPdf : originalPdf
  expect(path).toBe(documentPath(digest(bytes)))
  return { data: new Blob([new Uint8Array(bytes)]), error: null }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }))
vi.mock('@/lib/cis/db', () => ({ listOutboundRequestsByCustomerId: async () => [] }))
vi.mock('@/lib/customer-contracts/db', () => ({
  listContractOffers: async () => [],
  listCustomerContractEventsByCustomerId: async () => [],
  listCustomerContractsByCustomerId: async (customerId: string, scope: { companyId: string }) => {
    expect([scope.companyId, customerId]).toEqual([ids.company, ids.customer])
    return [{
      id: ids.contract, company_id: ids.company, customer_id: ids.customer,
      site_id: ids.site, metering_point_id: ids.meter, status: 'signed',
      contract_name: 'Syntetiskt avtal', signed_at: signedAt, starts_at: marketStart,
      document_sha256: signedHash,
    }]
  },
}))
vi.mock('@/lib/masterdata/db', () => ({
  listCustomerSitesByCustomerId: async () => [{ id: ids.site, site_name: 'Syntetisk anläggning' }],
  listMeteringPointsBySiteIds: async () => [{ id: ids.meter, site_id: ids.site, meter_point_id: 'Syntetisk mätpunkt' }],
}))
vi.mock('@/lib/operations/db', () => ({ listSupplierSwitchRequestsByCustomerId: async () => [] }))
vi.mock('@/components/admin/customers/CustomerContractCreatePanel', () => ({ default: () => null }))
vi.mock('@/components/admin/customers/contracts/ContractForms', () => ({
  CreateFromOfferForm: () => null, CreateManualContractForm: () => null, EditContractForm: () => null,
}))
vi.mock('@/lib/admin/apiGuards', async (load) => ({
  ...await load<typeof import('@/lib/admin/apiGuards')>(),
  requireAdminApiAccess: async (permissions: string[]) => {
    expect(permissions).toEqual(['documents.read', 'customers.read'])
    return { guard: { companyId: ids.company } }
  },
}))
vi.mock('@/lib/tenant/entityGuards', () => ({
  assertCompanyAccessForGuard: async (companyId: string, actor: { companyId: string }) => {
    expect([companyId, actor.companyId]).toEqual([ids.company, ids.company])
  },
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      expect(table).toBe('customer_contract_documents')
      let rows = documents
      let limit = MAX_POSTGREST_ROWS
      const orderColumns: ('generated_at' | 'id')[] = []
      const query = {
        select: () => query,
        in: (column: 'customer_contract_id', values: string[]) => {
          expect([column, values]).toEqual(['customer_contract_id', [ids.contract]])
          return query
        },
        order: (column: 'generated_at' | 'id', options: { ascending: boolean }) => {
          expect(options.ascending).toBe(false)
          orderColumns.push(column)
          return query
        },
        limit: (value: number) => {
          limit = Math.min(value, MAX_POSTGREST_ROWS)
          return query
        },
        or: (filter: string) => {
          const match = /^generated_at\.lt\.([^,]+),and\(generated_at\.eq\.\1,id\.lt\.([0-9a-f-]{36})\)$/.exec(filter)
          if (!match) throw new Error('Unexpected document cursor')
          const [, generatedAt, id] = match
          rows = rows.filter((row) => row.generated_at < generatedAt || (row.generated_at === generatedAt && row.id < id))
          return query
        },
        eq: (column: 'company_id' | 'id', value: string) => {
          rows = rows.filter((row) => row[column] === value)
          return query
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (result: { data: CustomerContractDocumentRow[]; error: null }) => void) => {
          expect(orderColumns[0]).toBe('generated_at')
          const page = [...rows].sort((a, b) => {
            for (const column of orderColumns) {
              const result = b[column].localeCompare(a[column])
              if (result) return result
            }
            return 0
          }).slice(0, limit)
          documentPageSizes.push(page.length)
          resolve({ data: page, error: null })
        },
      }
      return query
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('ediel_require_customer_record_available_v1')
      expect(args).toEqual({
        p_company_id: ids.company, p_retention_class: 'contract_signed_pdf_bytes', p_target_id: expect.any(String),
      })
      return { data: {
        status: 'not_tombstoned', companyId: ids.company, customerId: ids.customer,
        retentionClass: args.p_retention_class, targetId: args.p_target_id, authorizesProviderEntry: false,
      }, error: null }
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe('customer-contract-documents')
        return { download }
      },
    },
  },
}))

import CustomerContractsCard from '@/components/admin/customers/contracts/CustomerContractsCard'
import { GET } from '@/app/api/admin/customer-contract-documents/[documentId]/route'

function archive(documentId: string, bytes: Buffer, generatedAt: string): CustomerContractDocumentRow {
  const hash = digest(bytes)
  return {
    id: documentId, company_id: ids.company, customer_contract_id: ids.contract,
    document_type: 'signed_contract_pdf', storage_bucket: 'customer-contract-documents',
    storage_path: documentPath(hash), mime_type: 'application/pdf', document_sha256: hash,
    generated_at: generatedAt, archived_at: generatedAt, verified_at: generatedAt,
    created_at: generatedAt, generation_snapshot: {},
  }
}

async function card() {
  const html = renderToStaticMarkup(await CustomerContractsCard({ companyId: ids.company, customerId: ids.customer }))
  expect(html).toContain('Syntetisk anläggning')
  expect(html).toContain('Syntetiskt avtal')
  return html
}

function archiveLinks(html: string) {
  return Array.from(html.matchAll(/href="(\/api\/admin\/customer-contract-documents\/[^"]+)"/g), (match) => match[1])
}

beforeEach(() => {
  signedHash = digest(signedPdf)
  documents = [archive(ids.original, originalPdf, '2026-11-01T13:00:00Z'), archive(ids.bound, signedPdf, signedAt)]
  download.mockClear()
  documentPageSizes.length = 0
})

describe('signed contract PDF in Staff customer history', () => {
  it('follows the contract-bound archive from the customer card to the exact private PDF', async () => {
    const links = archiveLinks(await card())
    expect(links).toHaveLength(1)
    const url = new URL(links[0], 'http://127.0.0.1:1')
    const documentId = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
    const response = await GET(new Request(url), { params: Promise.resolve({ documentId }) })
    expect(response.status).toBe(200)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect({
      documentId,
      bytesMatch: bytes.equals(signedPdf),
      hash: response.headers.get('x-gridex-document-sha256'),
      privateCache: response.headers.get('cache-control'),
    }).toEqual({ documentId: ids.bound, bytesMatch: true, hash: signedHash, privateCache: 'private, no-store, max-age=0' })
    expect(download).toHaveBeenCalledExactlyOnceWith(documentPath(digest(signedPdf)))
  })

  it('does not substitute a different archive when the bound signed PDF is absent', async () => {
    documents = documents.filter((document) => document.id !== ids.bound)
    const html = await card()
    expect(archiveLinks(html)).toEqual([])
    expect(html).toContain('Arkiverad avtals-PDF saknas')
  })

  it('requires the signed PDF type as well as the exact bound digest', async () => {
    documents = documents.map((document) => document.id === ids.bound ? { ...document, document_type: 'other' } : document)
    expect(archiveLinks(await card())).toEqual([])
  })

  it('refuses an explicitly set invalid digest without falling back to an older archive', async () => {
    signedHash = 'invalid'
    expect(archiveLinks(await card())).toEqual([])
  })

  function archiveHistory(size: number) {
    const newerArchiveTimestamp = '2026-11-10T12:00:00.000000Z'
    return Array.from({ length: size }, (_, index) => archive(
      `95050000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
      Buffer.from(`Synthetic stored archive ${index}`),
      newerArchiveTimestamp,
    ))
  }

  it('finds the exact bound archive behind the configured PostgREST cap', async () => {
    documents = [documents[1], ...archiveHistory(MAX_POSTGREST_ROWS)]
    expect(archiveLinks(await card())).toEqual([href(ids.bound)])
    expect(documentPageSizes).toEqual([500, 500, 1])
  })

  it('finishes the archive scan on an empty page after the cap with no bound archive', async () => {
    documents = archiveHistory(MAX_POSTGREST_ROWS)
    const html = await card()
    expect(archiveLinks(html)).toEqual([])
    expect(html).toContain('Arkiverad avtals-PDF saknas')
    expect(documentPageSizes).toEqual([500, 500, 0])
  })

  it('retains the previous archive presentation for a legacy contract without a bound digest', async () => {
    signedHash = null
    expect(await card()).toContain(`href="${href(ids.original)}"`)
  })
})
