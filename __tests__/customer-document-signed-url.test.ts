import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAdminApiAccess: vi.fn(),
  assertCompanyAccessForGuard: vi.fn(),
  maybeSingle: vi.fn(),
  createSignedUrl: vi.fn(),
  tableFrom: vi.fn(),
  storageFrom: vi.fn(),
}))

vi.mock('@/lib/admin/apiGuards', () => ({
  requireAdminApiAccess: mocks.requireAdminApiAccess,
  jsonError: (message: string, status: number) =>
    Response.json({ error: message }, { status }),
  apiErrorResponse: (_error: unknown, status: number) =>
    Response.json({ error: 'forbidden' }, { status }),
}))

vi.mock('@/lib/tenant/entityGuards', () => ({
  assertCompanyAccessForGuard: mocks.assertCompanyAccessForGuard,
}))

vi.mock('@/lib/http/apiError', () => ({
  internalApiError: ({ message, status = 500 }: { message: string; status?: number }) =>
    Response.json({ error: message }, { status }),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: mocks.tableFrom,
    storage: {
      from: mocks.storageFrom,
    },
  },
}))

import { GET } from '@/app/api/admin/customer-documents/[documentId]/route'

const companyA = 'a0000000-0000-4000-8000-000000000001'
const customerA = 'c0000000-0000-4000-8000-000000000001'
const siteA = 'd0000000-0000-4000-8000-000000000001'
const documentId = '10000000-0000-4000-8000-000000000001'
const canonicalPath =
  `companies/${companyA}/customers/${customerA}/site-${siteA}/power_of_attorney/document.pdf`

function request(query = '') {
  return new NextRequest(
    `http://localhost/api/admin/customer-documents/${documentId}${query}`,
  )
}

function context() {
  return { params: Promise.resolve({ documentId }) }
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: documentId,
    customer_id: customerA,
    company_id: companyA,
    site_id: siteA,
    storage_bucket: 'customer-documents',
    file_path: canonicalPath,
    file_name: 'document.pdf',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminApiAccess.mockResolvedValue({
    response: null,
    guard: { userId: 'e0000000-0000-4000-8000-000000000001' },
  })
  mocks.assertCompanyAccessForGuard.mockResolvedValue(undefined)
  mocks.maybeSingle.mockResolvedValue({ data: documentRow(), error: null })
  mocks.tableFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: mocks.maybeSingle,
      }),
    }),
  })
  mocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://storage.example.invalid/signed-document' },
    error: null,
  })
  mocks.storageFrom.mockReturnValue({ createSignedUrl: mocks.createSignedUrl })
})

describe('customer document signed URL route', () => {
  it('creates a signed URL only after canonical ownership validation', async () => {
    const response = await GET(request(), context())

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://storage.example.invalid/signed-document',
    )
    expect(mocks.assertCompanyAccessForGuard).toHaveBeenCalledWith(
      companyA,
      expect.anything(),
    )
    expect(mocks.storageFrom).toHaveBeenCalledWith('customer-documents')
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(canonicalPath, 60, {
      download: undefined,
    })
  })

  it('passes the canonical file name in download mode', async () => {
    const response = await GET(request('?mode=download'), context())

    expect(response.status).toBe(307)
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(canonicalPath, 60, {
      download: 'document.pdf',
    })
  })

  it('fails closed when path company/customer/site do not match the database row', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: documentRow({
        file_path:
          `companies/${companyA}/customers/c0000000-0000-4000-8000-000000000002/` +
          `site-${siteA}/power_of_attorney/document.pdf`,
      }),
      error: null,
    })

    const response = await GET(request(), context())

    expect(response.status).toBe(422)
    expect(mocks.storageFrom).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('does not call the service-role storage client when tenant access fails', async () => {
    mocks.assertCompanyAccessForGuard.mockRejectedValue(new Error('tenant denied'))

    const response = await GET(request(), context())

    expect(response.status).toBe(403)
    expect(mocks.storageFrom).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('returns a controlled error when Storage cannot create the signed URL', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: new Error('storage unavailable'),
    })

    const response = await GET(request(), context())

    expect(response.status).toBe(404)
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1)
  })
})
