// masterplan: SC-010, SC-071
// Component evidence only: actual HTTP/parser/projection consumers, with finite
// authentication and SQL RPC ports. This does not simulate a production export
// worker, database revocation, lease, PostgreSQL lock or delivery transaction.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { EdielProjectionPage } from '@/lib/ediel/services/types'

const ports = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: ports.auth }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc } }))

import { GET } from '@/app/api/ediel/beneficiary/series/[seriesId]/route'

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const companyId = uuid(1), actorUserId = uuid(2), grantId = uuid(3), seriesId = uuid(4)
const context = { params: Promise.resolve({ seriesId }) }
const query = (version = 2) => new URLSearchParams({
  grantId, grantVersion: String(version), purpose: 'billing', fields: 'quantity',
  start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z', limit: '1',
})
const request = (values = query()) => new NextRequest(`https://example.test/api/ediel/beneficiary/series/${seriesId}?${values}`)
function page(version = 2): EdielProjectionPage {
  return {
    grantId, grantVersion: version, seriesId, rows: [{ quantity: '0.1234567890123456789' }],
    next: { readingAt: '2026-09-15T00:00:00Z', valueId: uuid(8) }, consumerReceiptId: uuid(5),
    provenance: {
      version: 1, sourceMessageId: uuid(6), sourceRawHash: 'a'.repeat(64), sourceFamily: 'UTILTS', sourceCode: 'E66',
      sourceEnvironment: 'test', sourceRole: 'DGI', sourceApplicationReference: '30-DGI-UTILTS', sourceSenderEdielId: '54321',
      receiverActorId: uuid(7), receiverRole: 'energy_service_company', contractVersion: 2, contractHash: 'b'.repeat(64),
      purpose: 'billing', fields: ['quantity'], qualityOrigin: null,
    },
  }
}
async function denied(response: Response) {
  expect(response.status).toBe(403)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ error: 'Projekteringen kunde inte auktoriseras eller läsas.' })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  ports.auth.mockResolvedValue({ guard: { companyId, userId: actorUserId } })
  ports.rpc.mockResolvedValue({ data: page(), error: null })
})

describe('SC010/071 actual beneficiary consumer revalidation component', () => {
  it('evaluates identical reads twice through the real adapter and retains the exact tenant, actor and grant scope', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await GET(request(), context)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect((await response.json()).rows).toEqual(page().rows)
    }
    expect(ports.auth).toHaveBeenCalledTimes(2)
    expect(ports.rpc).toHaveBeenCalledTimes(2)
    for (const call of ports.rpc.mock.calls) expect(call).toEqual(['ediel_beneficiary_series_page_v1', {
      p_beneficiary_company_id: companyId, p_actor_user_id: actorUserId,
      p_grant_id: grantId, p_expected_grant_version: 2, p_purpose: 'billing', p_series_id: seriesId,
      p_fields: ['quantity'], p_start: '2026-09-01T00:00:00.000Z', p_end: '2026-10-01T00:00:00.000Z',
      p_limit: 1, p_after_at: null, p_after_id: null,
    }])
  })

  it.each(['ediel_grant_not_current', 'ediel_beneficiary_forbidden'])('propagates current %s and refuses both earlier data and data returned alongside an RPC error', async reason => {
    const first = await GET(request(), context)
    expect(first.status).toBe(200)
    expect((await first.json()).consumerReceiptId).toBe(uuid(5))
    ports.rpc.mockResolvedValueOnce({ data: page(), error: new Error(`${reason}: private owner original`) })
    await denied(await GET(request(), context))
    expect(ports.rpc).toHaveBeenCalledTimes(2)
    expect(ports.auth).toHaveBeenCalledTimes(2)
  })

  it('treats an earlier successful cursor as a position and re-evaluates the same captured grant version for the next page', async () => {
    const first = await GET(request(), context)
    expect(first.status).toBe(200)
    const cursor = (await first.json()).next as string
    const values = query(); values.set('cursor', cursor)
    ports.rpc.mockResolvedValueOnce({ data: null, error: new Error('ediel_grant_not_current') })
    await denied(await GET(request(values), context))
    expect(ports.rpc).toHaveBeenLastCalledWith('ediel_beneficiary_series_page_v1', expect.objectContaining({
      p_beneficiary_company_id: companyId, p_actor_user_id: actorUserId,
      p_grant_id: grantId, p_expected_grant_version: 2,
      p_after_at: '2026-09-15T00:00:00.000Z', p_after_id: uuid(8),
    }))
    expect(ports.rpc).toHaveBeenCalledTimes(2)
  })

  it('refuses to upgrade a captured request silently when the RPC returns a different grant version', async () => {
    ports.rpc.mockResolvedValueOnce({ data: page(3), error: null })
    await denied(await GET(request(), context))
    expect(ports.rpc).toHaveBeenCalledTimes(1)
    expect(ports.rpc).toHaveBeenLastCalledWith('ediel_beneficiary_series_page_v1', expect.objectContaining({ p_expected_grant_version: 2 }))
  })

  it('reads the RPC outcome after asynchronous route parameters resolve rather than reusing a prior response', async () => {
    expect((await GET(request(), context)).status).toBe(200)
    const params = deferred<{ seriesId: string }>(), entered = deferred<void>()
    ports.auth.mockImplementationOnce(() => { entered.resolve(); return Promise.resolve({ guard: { companyId, userId: actorUserId } }) })
    const pending = GET(request(), { params: params.promise })
    await entered.promise
    expect(ports.rpc).toHaveBeenCalledTimes(1)
    ports.rpc.mockResolvedValueOnce({ data: null, error: new Error('ediel_grant_not_current') })
    params.resolve({ seriesId })
    await denied(await pending)
    expect(ports.rpc).toHaveBeenCalledTimes(2)
  })

  it('holds an in-flight RPC denial without returning a previous page or issuing an implicit retry', async () => {
    expect((await GET(request(), context)).status).toBe(200)
    const entered = deferred<void>(), outcome = deferred<{ data: EdielProjectionPage | null; error: Error | null }>()
    ports.rpc.mockImplementationOnce(() => { entered.resolve(); return outcome.promise })
    const pending = GET(request(), context)
    await entered.promise
    expect(ports.rpc).toHaveBeenCalledTimes(2)
    outcome.resolve({ data: page(), error: new Error('ediel_grant_not_current') })
    await denied(await pending)
    expect(ports.rpc).toHaveBeenCalledTimes(2)
  })

  it('re-evaluates a different selected tenant and actor without returning an earlier beneficiary page', async () => {
    expect((await GET(request(), context)).status).toBe(200)
    ports.auth.mockResolvedValueOnce({ guard: { companyId: uuid(20), userId: uuid(21) } })
    ports.rpc.mockResolvedValueOnce({ data: null, error: new Error('ediel_beneficiary_forbidden') })
    await denied(await GET(request(), context))
    expect(ports.rpc).toHaveBeenLastCalledWith('ediel_beneficiary_series_page_v1', expect.objectContaining({
      p_beneficiary_company_id: uuid(20), p_actor_user_id: uuid(21), p_grant_id: grantId, p_expected_grant_version: 2,
    }))
  })

  it('evaluates a later explicit request after denial without reusing the denied or the earlier successful result', async () => {
    ports.rpc.mockResolvedValueOnce({ data: null, error: new Error('ediel_grant_not_current') })
    await denied(await GET(request(), context))
    ports.rpc.mockResolvedValueOnce({ data: page(3), error: null })
    const later = await GET(request(query(3)), context)
    expect(later.status).toBe(200)
    expect((await later.json()).grantVersion).toBe(3)
    expect(ports.rpc).toHaveBeenCalledTimes(2)
    expect(ports.rpc).toHaveBeenLastCalledWith('ediel_beneficiary_series_page_v1', expect.objectContaining({ p_expected_grant_version: 3 }))
  })

  it('refuses to carry a cursor from the old grant version into a new version before reading another source page', async () => {
    const first = await GET(request(), context)
    expect(first.status).toBe(200)
    const values = query(3); values.set('cursor', (await first.json()).next as string)
    const deniedCursor = await GET(request(values), context)
    expect(deniedCursor.status).toBe(400)
    expect(await deniedCursor.json()).toEqual({ error: 'Ogiltig projekteringsförfrågan.' })
    expect(ports.rpc).toHaveBeenCalledTimes(1)
  })
})
