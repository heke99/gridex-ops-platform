import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, select, listPage, tombstones } = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), listPage: vi.fn(), tombstones: vi.fn() }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: () => ({ unscoped: () => ({ rpc }) }) }))
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: (...args: unknown[]) => select(...args) }))
vi.mock('@/lib/ediel/retention/customerRecordClasses', () => ({ readCustomerRecordTombstones: (...args: unknown[]) => tombstones(...args) }))
vi.mock('@/lib/customers/getCustomers', () => ({ listCustomersPageForCompany: (...args: unknown[]) => listPage(...args) }))

const A = '00000000-0000-4000-8000-0000000000a1'
const B = '00000000-0000-4000-8000-0000000000b1'
const ID = '00000000-0000-4000-8000-0000000000c1'
const row = { id: ID, company_id: A, customer_type: 'private', personal_number: '19121212-1212', org_number: null, email: 'old@example.test', full_name: 'Test Customer', updated_at: '2026-10-04T10:00:00Z', metadata: { secret: 'hidden' } }

beforeEach(() => {
  vi.clearAllMocks()
  tombstones.mockResolvedValue([])
  rpc.mockResolvedValue({ data: ID, error: null })
  select.mockImplementation((companyId: string, table: string) => {
    const q: Record<string, unknown> = {}
    for (const name of ['eq', 'order', 'limit']) q[name] = () => q
    q.maybeSingle = async () => ({ data: table === 'customers' && companyId === A ? row : null, error: null })
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return q
  })
})

describe('staff customer domain boundary', () => {
  it('resolves only an opaque company-bound reference, then repeats company scope on the customer read', async () => {
    const { publicReference } = await import('@/lib/integrations/publicReferences')
    const { findStaffCustomer } = await import('@/lib/staff-api/customers')
    const ref = publicReference('customer', A, ID)!
    expect((await findStaffCustomer(A, ref)).id).toBe(ID)
    expect(rpc).toHaveBeenCalledWith('gridex_staff_customer_id_for_reference_v1', { p_company_id: A, p_reference: ref })
    expect(select).toHaveBeenCalledWith(A, 'customers', expect.any(String))
    await expect(findStaffCustomer(B, ref)).rejects.toMatchObject({ code: 'customer_not_found', status: 404 })
    await expect(findStaffCustomer(A, ID)).rejects.toMatchObject({ code: 'customer_not_found', status: 404 })
  })

  it('rejects missing company scope before any lookup', async () => {
    const { getCustomerForCompany } = await import('@/lib/customers/getCustomerForCompany')
    await expect(getCustomerForCompany('', ID)).rejects.toThrow()
    expect(select).not.toHaveBeenCalled()
  })

  it('uses a closed DTO with masked identities and no internal company/customer IDs or metadata', async () => {
    const { staffCustomerSummary } = await import('@/lib/staff-api/customers')
    const value = staffCustomerSummary(A, row)
    expect(value).toMatchObject({ personal_number_masked: '••••1212', org_number_masked: null, display_name: 'Test Customer' })
    expect(JSON.stringify(value)).not.toContain('19121212')
    expect(value).not.toHaveProperty('id')
    expect(value).not.toHaveProperty('company_id')
    expect(value).not.toHaveProperty('metadata')
  })

  it('keeps contact fields omitted unless requested and validates normalizations', async () => {
    const { parseStaffContactPatch } = await import('@/lib/staff-api/customers')
    const input = parseStaffContactPatch({ expectedUpdatedAt: row.updated_at, phone: '+46 (70) 123 45 67' })
    expect(input).toEqual({ expectedUpdatedAt: row.updated_at, customerPatch: { phone: '+46 (70) 123 45 67' } })
    expect(parseStaffContactPatch({ expectedUpdatedAt: row.updated_at, email: 'NEW@EXAMPLE.TEST' }).customerPatch).toEqual({ email: 'new@example.test' })
    expect(parseStaffContactPatch({ expectedUpdatedAt: row.updated_at, email: null }).customerPatch).toEqual({ email: null })
  })

  it.each([
    [{ phone: '0701234567' }, 'expected_updated_at_required'],
    [{ expectedUpdatedAt: 'bogus', phone: '0701234567' }, 'invalid_expected_updated_at'],
    [{ expectedUpdatedAt: '2026-02-31T10:00:00Z', phone: '0701234567' }, 'invalid_expected_updated_at'],
    [{ expectedUpdatedAt: row.updated_at }, 'contact_patch_empty'],
    [{ expectedUpdatedAt: row.updated_at, personal_number: '19121212-1212' }, 'field_not_allowed'],
    [{ expectedUpdatedAt: row.updated_at, company_id: B, phone: '0701234567' }, 'field_not_allowed'],
    [{ expectedUpdatedAt: row.updated_at, phone: 123 }, 'invalid_field'],
    [{ expectedUpdatedAt: row.updated_at, phone: 'x' }, 'invalid_phone'],
    [{ expectedUpdatedAt: row.updated_at, email: 'x' }, 'invalid_email'],
  ])('fails closed for %o', async (body, code) => {
    const { parseStaffContactPatch } = await import('@/lib/staff-api/customers')
    expect(() => parseStaffContactPatch(body)).toThrow(expect.objectContaining({ code }))
  })
})

describe('customer detail ownership for staff', () => {
  it('bounds initial customer children explicitly and reports overflow instead of Data API truncation', async () => {
    select.mockImplementation((_companyId: string, table: string) => {
      const q: Record<string, unknown> = {}
      for (const name of ['eq', 'order', 'limit']) q[name] = () => q
      q.maybeSingle = async () => ({ data: row, error: null })
      q.then = (resolve: (value: unknown) => unknown) => resolve({ data: Array.from({ length: 101 }, (_, i) => ({ id: `${table}-${i}` })), error: null })
      return q
    })
    const { getCustomerForCompany } = await import('@/lib/customers/getCustomerForCompany')
    const { staffCustomerDetail } = await import('@/lib/staff-api/customers')
    const detail = await getCustomerForCompany(A, ID)
    const dto = staffCustomerDetail(A, detail)
    expect(dto.contacts).toHaveLength(100)
    expect(dto.addresses).toHaveLength(100)
    expect(dto.sites).toHaveLength(100)
    for (const page of [dto.contacts_page, dto.addresses_page, dto.sites_page]) {
      expect(page).toEqual({ limit: 100, returned: 100, has_more: true })
    }
  })

  it('filters every child by company and customer and respects address-history erasure', async () => {
    const tables: Record<string, Record<string, unknown>[]> = {
      customers: [row],
      customer_contacts: [
        { id: 'owned-contact', company_id: A, customer_id: ID, name: 'Own' },
        { id: 'foreign-contact', company_id: B, customer_id: ID, name: 'Foreign' },
        { id: 'other-customer-contact', company_id: A, customer_id: 'other', name: 'Other' },
      ],
      customer_addresses: [
        { id: 'erased', company_id: A, customer_id: ID },
        { id: 'visible', company_id: A, customer_id: ID },
        { id: 'foreign-address', company_id: B, customer_id: ID },
      ],
      customer_sites: [
        { id: 'owned-site', company_id: A, customer_id: ID },
        { id: 'foreign-site', company_id: B, customer_id: ID },
      ],
    }
    select.mockImplementation((companyId: string, table: string) => {
      const filters: Array<[string, unknown]> = [['company_id', companyId]]
      const rows = () => tables[table].filter(r => filters.every(([key, value]) => r[key] === value))
      const q: Record<string, unknown> = {
        eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      }
      return q
    })
    tombstones.mockResolvedValue([{ retentionClass: 'customer_address_history', targetId: 'erased' }])
    const { getCustomerForCompany } = await import('@/lib/customers/getCustomerForCompany')
    const result = await getCustomerForCompany(A, ID)
    expect(result.contacts.map(r => r.id)).toEqual(['owned-contact'])
    expect(result.addresses.map(r => r.id)).toEqual(['visible'])
    expect(result.sites.map(r => r.id)).toEqual(['owned-site'])
    expect(tombstones).toHaveBeenCalledWith({ companyId: A, customerId: ID })
    await expect(getCustomerForCompany(B, ID)).rejects.toMatchObject({ code: 'customer_not_found', status: 404 })
  })
})
