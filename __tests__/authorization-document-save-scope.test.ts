import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ actor: 'actual-staff', allowed: true, canWriteCompany:true, tables: {} as Record<string, Row[]>, writes: [] as Row[] }))

function client(role: string) {
  return {
    auth: { getUser: async () => ({ data: { user: io.actor ? { id: io.actor } : null }, error: null }) },
    rpc: async (name: string, args: Row) => name==='gridex_can_write_company'?({data:io.canWriteCompany,error:null}):({ data: null, error: name === 'gridex_assert_contract_permission' && args.p_actor_user_id === io.actor && args.p_permission === 'contracts.create' && io.allowed ? null : new Error('contract_permission_denied') }),
    from(table: string) {
      let inserted: Row | null = null
      const filters: Array<(row: Row) => boolean> = []
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
        maybeSingle: () => q, single: () => q,
        insert: (value: Row) => { inserted = value; return q },
        then(resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) {
          if (inserted) {
            const canonical = inserted.document_type === 'complete_agreement' && (inserted.metadata as Row)?.documentRole === 'signed_agreement'
            if (canonical && role !== 'service_role') return Promise.resolve({ data: null, error: new Error('customer_contract_event_service_role_required') }).then(resolve, reject)
            const row = { id: 'persisted-document', ...inserted, writer: role }
            io.writes.push(row)
            return Promise.resolve({ data: row, error: null }).then(resolve, reject)
          }
          const row = (io.tables[table] ?? []).find(row => filters.every(filter => filter(row)))
          return Promise.resolve({ data: row ?? null, error: null }).then(resolve, reject)
        },
      }
      return q
    },
  } as unknown as SupabaseClient
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: client('service_role') }))
import { saveCustomerAuthorizationDocument } from '@/lib/operations/db.part-1'

const original = { companyId: 'company-a', customer_id: 'customer-a', site_id: 'site-a', customer_contract_id: 'contract-a', document_type: 'complete_agreement' as const,
  status: 'active' as const, storage_bucket: 'customer-documents', file_path: 'customer-a/original.pdf', file_checksum: 'a'.repeat(64), mime_type: 'application/pdf',
  uploaded_at: '2026-10-28T08:00:00Z', metadata: { source: 'customer_intake', documentRole: 'signed_agreement', declaredSignedDate: '2026-10-20' } }

beforeEach(() => {
  io.actor = 'actual-staff'; io.allowed = true; io.canWriteCompany=true; io.writes = []
  io.tables = {
    customers: [{ id: 'customer-a', company_id: 'company-a' }],
    customer_sites: [{ id: 'site-a', company_id: 'company-a', customer_id: 'customer-a' }],
    customer_contracts: [{ id: 'contract-a', company_id: 'company-a', customer_id: 'customer-a',customer_site_id:'site-a',site_id:null,metering_point_id:'meter-a' }],
  }
})

describe('signed PDF persistence through the canonical authorized service boundary', () => {
  it('preserves the real authenticated actor and original PDF/date while the trigger executes as service', async () => {
    const result = await saveCustomerAuthorizationDocument(client('authenticated'), original)
    expect(result.id).toBe('persisted-document')
    expect(io.writes).toEqual([expect.objectContaining({ writer: 'service_role', created_by: 'actual-staff', updated_by: 'actual-staff', company_id: 'company-a', customer_id: 'customer-a',
      file_path: 'customer-a/original.pdf', file_checksum: 'a'.repeat(64), uploaded_at: '2026-10-28T08:00:00Z', metadata: original.metadata })])
  })

  it('never elevates a signed import without an actual authenticated actor', async () => {
    io.actor = ''
    await expect(saveCustomerAuthorizationDocument(client('authenticated'), original)).rejects.toThrow()
    expect(io.writes).toHaveLength(0)
  })

  it('keeps an authenticated reader without contract-create permission outside the service write path', async () => {
    io.allowed = false
    await expect(saveCustomerAuthorizationDocument(client('authenticated'), original)).rejects.toThrow(/contract_permission_denied/)
    expect(io.writes).toHaveLength(0)
  })

  it('cannot elevate read-only customer visibility into tenant write access',async()=>{
    io.canWriteCompany=false
    await expect(saveCustomerAuthorizationDocument(client('authenticated'),original)).rejects.toThrow(/skrivbehörighet/i)
    expect(io.writes).toHaveLength(0)
  })

  it.each([
    ['customer', { customer_id: 'other-customer' }],
    ['tenant', { companyId: 'other-company' }],
    ['site', { site_id: 'other-site' }],
    ['contract', { customer_contract_id: 'other-contract' }],
    ['metering point', { metering_point_id: 'other-point' }],
  ])('rejects a foreign or missing %s tuple before any document insert', async (_name, changes) => {
    await expect(saveCustomerAuthorizationDocument(client('authenticated'), { ...original, ...changes })).rejects.toThrow()
    expect(io.writes).toHaveLength(0)
  })

  it('rejects a different site of the same customer for a site-bound contract',async()=>{
    io.tables.customer_sites.push({id:'site-b',company_id:'company-a',customer_id:'customer-a'})
    await expect(saveCustomerAuthorizationDocument(client('authenticated'),{...original,site_id:'site-b'})).rejects.toThrow()
    expect(io.writes).toHaveLength(0)
  })
  it('rejects a different meter of the same site for a meter-bound contract',async()=>{
    io.tables.metering_points=[{id:'meter-b',company_id:'company-a',customer_id:'customer-a',site_id:'site-a'}]
    await expect(saveCustomerAuthorizationDocument(client('authenticated'),{...original,metering_point_id:'meter-b'})).rejects.toThrow()
    expect(io.writes).toHaveLength(0)
  })

  it('keeps generic archive-only documents on the caller client and does not turn them into signed contracts', async () => {
    await saveCustomerAuthorizationDocument(client('authenticated'), { ...original, metadata: {} })
    expect(io.writes).toEqual([expect.objectContaining({ writer: 'authenticated', metadata: {}, created_by: 'actual-staff' })])
  })

  it('also prevents a generic archive document from linking a site from another customer', async () => {
    io.tables.customer_sites[0].customer_id = 'other-customer'
    await expect(saveCustomerAuthorizationDocument(client('authenticated'), { ...original, metadata: {} })).rejects.toThrow()
    expect(io.writes).toHaveLength(0)
  })
})
