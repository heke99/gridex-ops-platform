import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { redirect } from 'next/navigation'

const f = vi.hoisted(() => ({ guard: vi.fn(), user: vi.fn(), read: vi.fn(), sign: vi.fn(), tables: [] as string[], filters: [] as Array<[string, unknown]>, buckets: [] as string[] }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess: f.guard }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: f.user } }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    f.tables.push(table)
    const query = { select: () => query, eq: (key: string, value: unknown) => { f.filters.push([key, value]); return query }, maybeSingle: f.read }
    return query
  },
  storage: { from: (bucket: string) => { f.buckets.push(bucket); return { createSignedUrl: f.sign } } },
} }))
import { GET } from '@/app/admin/agreements/grid-owners/documents/route'

const actor = '00000000-0000-4000-8000-000000000001'
const agreementId = '00000000-0000-4000-8000-000000000002'
const storagePath = 'company/owner/agreement.pdf'
const documentPath = `grid-owner-agreements:${storagePath}`
function request(path: string | null = documentPath) {
  const url = new URL('http://localhost/admin/agreements/grid-owners/documents')
  if (path !== null) url.searchParams.set('path', path)
  return new NextRequest(url)
}
function noSign() { expect(f.sign).not.toHaveBeenCalled(); expect(f.buckets).toEqual([]) }

describe('actual agreement document route keeps the agreement resource boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); f.tables = []; f.filters = []; f.buckets = []
    f.guard.mockResolvedValue({ userId: actor })
    f.user.mockResolvedValue({ data: { user: { id: actor } }, error: null })
    f.read.mockResolvedValue({ data: { id: agreementId, document_path: documentPath }, error: null })
    // Controlled provider boundary: this test never creates a real Storage release link.
    f.sign.mockResolvedValue({ data: { signedUrl: 'http://localhost/controlled-agreement-receipt' }, error: null })
  })

  it.each(['customer-support-quarantine', 'customer-contract-documents', 'unrelated-private-bucket'])('denies %s before any Storage signer', async bucket => {
    const response = await GET(request(`${bucket}:owned-fixture/object.pdf`))
    expect(response.status).toBe(403); expect(response.headers.get('location')).toBeNull(); noSign()
  })

  it('denies an unbound reference in the legitimate bucket', async () => {
    f.read.mockResolvedValue({ data: null, error: null })
    const response = await GET(request('grid-owner-agreements:other-company/owner/unbound.pdf'))
    expect(response.status).toBe(404); noSign()
  })

  it('allows the actual current agreement row and keeps global platform company scope', async () => {
    const response = await GET(request())
    expect(response.status).toBe(307)
    expect(f.tables).toEqual(['grid_owner_access_agreements'])
    expect(f.filters).toEqual([['document_path', documentPath]])
    expect(f.buckets).toEqual(['grid-owner-agreements']); expect(f.sign).toHaveBeenCalledWith(storagePath, 60)
  })

  it('keeps the configured legitimate bucket and legacy unprefixed stored paths', async () => {
    vi.stubEnv('GRID_OWNER_AGREEMENTS_BUCKET', 'configured-grid-agreements')
    f.read.mockResolvedValue({ data: { id: agreementId, document_path: storagePath }, error: null })
    expect((await GET(request(storagePath))).status).toBe(307)
    expect(f.filters).toEqual([['document_path', storagePath]])
    expect(f.buckets).toEqual(['configured-grid-agreements'])
  })

  it.each([null, { id: agreementId, document_path: 'grid-owner-agreements:changed.pdf' }, { id: '', document_path: documentPath }])('denies absent or inconsistent current resource receipts', async data => {
    f.read.mockResolvedValue({ data, error: null })
    expect((await GET(request())).status).toBe(404); noSign()
  })

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'another-current-user' } }, error: null },
    { data: { user: { id: actor } }, error: { message: 'PRIVATE_AUTH_DETAILS' } },
  ])('denies absent, mismatched or failed current Auth before the database', async auth => {
    f.user.mockResolvedValue(auth)
    expect((await GET(request())).status).toBe(401)
    expect(f.tables).toEqual([]); noSign()
  })

  it('preserves actual Next platform-guard redirect before Auth or database access', async () => {
    let signal: unknown
    try { redirect('/login') } catch (error) { signal = error }
    f.guard.mockRejectedValue(signal)
    await expect(GET(request())).rejects.toBe(signal)
    expect(f.user).not.toHaveBeenCalled(); expect(f.tables).toEqual([]); noSign()
  })

  it.each([{ code: '42P01', message: 'PRIVATE_SCHEMA_DETAILS' }, { code: 'PGRST116', message: 'PRIVATE_MULTIPLE_ROWS' }])('fails closed with a safe unavailable response for an absent or ambiguous authoritative table', async error => {
    f.read.mockResolvedValue({ data: null, error })
    const response = await GET(request())
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE_'); noSign()
  })

  it('cannot configure the reserved quarantine bucket as an agreement release bucket', async () => {
    vi.stubEnv('GRID_OWNER_AGREEMENTS_BUCKET', 'customer-support-quarantine')
    expect((await GET(request('customer-support-quarantine:owned-fixture/object.pdf'))).status).toBe(503)
    expect(f.tables).toEqual([]); noSign()
  })

  it.each([null, 'grid-owner-agreements:'])('rejects missing or empty paths without a signer', async path => {
    expect((await GET(request(path))).status).toBe(400); noSign()
  })

  it('does not disclose returned Storage errors', async () => {
    f.sign.mockResolvedValue({ data: null, error: { message: 'PRIVATE_STORAGE_ERROR' } })
    const response = await GET(request())
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE_STORAGE_ERROR')
    expect(response.headers.get('location')).toBeNull()
  })

  it('does not disclose thrown provider or database errors', async () => {
    f.read.mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'))
    const response = await GET(request())
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE_DATABASE_DETAILS'); noSign()
  })

  it.each([
    '../other-object.pdf', 'folder/./agreement.pdf', 'folder\\agreement.pdf',
    'folder/agreement.pdf?query', 'folder/agreement.pdf#fragment', 'folder//agreement.pdf',
    '/folder/agreement.pdf', 'folder/agreement.pdf/', 'folder/%2e%2e/agreement.pdf',
    'folder/%2f/agreement.pdf', 'folder/agreement.pdf ', ':agreement.pdf',
  ])('rejects noncanonical stored object key %s before data access', async path => {
    const stored = `grid-owner-agreements:${path}`
    f.read.mockResolvedValue({ data: { id: agreementId, document_path: stored }, error: null })
    expect((await GET(request(stored))).status).toBe(400)
    expect(f.tables).toEqual([]); noSign()
  })
})
