import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createEdielProjectionCursor, parseEdielProjectionRequest } from '@/lib/ediel/services/projectionRequest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), project: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: mocks.auth }))
vi.mock('@/lib/ediel/services/projection', () => ({ projectEdielSeriesToBeneficiary: mocks.project }))
import { GET } from '@/app/api/ediel/beneficiary/series/[seriesId]/route'
const companyId = '11111111-1111-4111-8111-111111111111', actorUserId = '22222222-2222-4222-8222-222222222222'
const seriesId = '33333333-3333-4333-8333-333333333333', grantId = '44444444-4444-4444-8444-444444444444'
const query = () => new URLSearchParams({ grantId, grantVersion: '3', purpose: 'billing', fields: 'reading_at,quantity', start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' })
const req = (params = query()) => new NextRequest(`https://example.test/api/ediel/beneficiary/series/${seriesId}?${params}`)
const ctx = { params: Promise.resolve({ seriesId }) }
describe('beneficiary series API', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.auth.mockResolvedValue({ guard: { companyId, userId: actorUserId } })
    mocks.project.mockResolvedValue({ grantId, grantVersion: 3, seriesId, rows: [{ quantity: '0.1234567890123456789' }], next: null })
  })
  it('uses the authenticated selected tenant and actor for the actual current-grant RPC', async () => {
    const response = await GET(req(), ctx)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.project).toHaveBeenCalledWith(expect.objectContaining({ beneficiaryCompanyId: companyId, actorUserId, expectedGrantVersion: 3 }))
    expect((await response.json()).rows[0].quantity).toBe('0.1234567890123456789')
  })
  it.each(['companyId', 'actorUserId', 'raw_payload', 'fields'])('rejects scope overrides, raw fields and duplicate query values (%s)', async key => {
    const values = query(); values.append(key, companyId)
    expect((await GET(req(values), ctx)).status).toBe(400)
    expect(mocks.project).not.toHaveBeenCalled()
  })
  it('preserves unauthorized response and prevents missing selected tenant reads', async () => {
    mocks.auth.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) }).mockResolvedValueOnce({ guard: { userId: actorUserId, companyId: null } })
    expect((await GET(req(), ctx)).status).toBe(401)
    expect((await GET(req(), ctx)).status).toBe(403)
    expect(mocks.project).not.toHaveBeenCalled()
  })
  it('never exposes owner diagnostics when a grant was revoked or version changed', async () => {
    mocks.project.mockRejectedValue(new Error('secret owner raw source'))
    const response = await GET(req(), ctx)
    expect(response.status).toBe(403)
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })
  it('binds cursor position to tenant, user, series, grant version, purpose, fields and window', () => {
    const input = parseEdielProjectionRequest({ query: query(), seriesId, companyId, actorUserId })
    const cursor = createEdielProjectionCursor(input, { readingAt: '2026-09-15T00:00:00Z', valueId: grantId })!
    const values = query(); values.set('cursor', cursor)
    expect(parseEdielProjectionRequest({ query: values, seriesId, companyId, actorUserId }).after?.valueId).toBe(grantId)
    for (const [key, value] of [['grantVersion', '4'], ['purpose', 'another'], ['fields', 'reading_at'], ['end', '2026-11-01T00:00:00Z']]) {
      const altered = new URLSearchParams(values); altered.set(key, value)
      expect(() => parseEdielProjectionRequest({ query: altered, seriesId, companyId, actorUserId })).toThrow()
    }
    expect(() => parseEdielProjectionRequest({ query: values, seriesId, companyId: actorUserId, actorUserId })).toThrow()
    expect(() => parseEdielProjectionRequest({ query: values, seriesId, companyId, actorUserId: companyId })).toThrow()
  })
})
