import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gridOwnerInputSchema } from '@/lib/masterdata/validators'
const scope = vi.hoisted(() => ({ company: vi.fn() }))
vi.mock('@/lib/tenant/scope', () => ({ requireOperationalCompanyId: scope.company }))
import { saveGridOwner } from '@/lib/masterdata/db'

function client(existing: Record<string, unknown> | null = null) {
  const filters: Array<[string, unknown]> = []
  const mutations: Array<{ kind: string; payload: Record<string, unknown> }> = []
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return query }),
    maybeSingle: vi.fn(async () => ({ data: existing && filters.every(([key, value]) => existing[key] === value) ? existing : null, error: null })),
    single: vi.fn(async () => ({ data: { id: 'new-owner', ...mutations.at(-1)?.payload }, error: null })),
    insert: vi.fn((payload: Record<string, unknown>) => { mutations.push({ kind: 'insert', payload }); return query }),
    update: vi.fn((payload: Record<string, unknown>) => { mutations.push({ kind: 'update', payload }); return query }),
  }
  const supabase = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'staff' } } })) }, from: vi.fn(() => query) }
  return { supabase, filters, mutations }
}
const input = gridOwnerInputSchema.parse({ name: 'Fictional Demo DSO', owner_code: 'DEMO', environment: 'test', lifecycle_status: 'draft' })

describe('grid-owner authenticated tenant writes', () => {
  beforeEach(() => { scope.company.mockReset().mockResolvedValue('own-company') })
  it('propagates authenticated operational company, ignoring unrecognized caller company data', async () => {
    const io = client()
    await saveGridOwner(io.supabase as never, { ...input, company_id: 'foreign-company' } as typeof input)
    expect(scope.company).toHaveBeenCalledWith('staff')
    expect(io.mutations).toEqual([{ kind: 'insert', payload: expect.objectContaining({ company_id: 'own-company', created_by: 'staff', updated_by: 'staff' }) }])
  })
  it('fails before writes if no operational tenant exists', async () => {
    const io = client()
    scope.company.mockRejectedValue(new Error('tenant_company_required'))
    await expect(saveGridOwner(io.supabase as never, input)).rejects.toThrow('tenant_company_required')
    expect(io.mutations).toEqual([])
  })
  it('denies updates to a foreign-company or shared global directory record', async () => {
    for (const company_id of ['foreign-company', null]) {
      const io = client({ id: 'd7bba737-deee-40ad-bd11-50bb77af3a4f', company_id })
      await expect(saveGridOwner(io.supabase as never, { ...input, id: 'd7bba737-deee-40ad-bd11-50bb77af3a4f' })).rejects.toThrow(/aktuell organisation/)
      expect(io.mutations).toEqual([])
    }
  })
  it('keeps both ID and own-company filters on the actual update', async () => {
    const id = 'd7bba737-deee-40ad-bd11-50bb77af3a4f'
    const io = client({ id, company_id: 'own-company' })
    await saveGridOwner(io.supabase as never, { ...input, id })
    expect(io.mutations).toEqual([{ kind: 'update', payload: expect.objectContaining({ company_id: 'own-company' }) }])
    expect(io.filters.filter(([key]) => key === 'company_id')).toEqual([['company_id', 'own-company'], ['company_id', 'own-company']])
  })
})
