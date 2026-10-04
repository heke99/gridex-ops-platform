import {beforeEach, describe, expect, it, vi} from 'vitest'
import {NextRequest, NextResponse} from 'next/server'

const io = vi.hoisted(() => ({access: vi.fn(), prepare: vi.fn()}))
vi.mock('@/lib/admin/apiGuards', () => ({requireAdminApiAccess: io.access}))
vi.mock('@/lib/ediel/flows/prodatRequestedChange', () => ({prepareAndQueueProdatRequestedChange: io.prepare}))
const eventId = '11111111-1111-4111-8111-111111111111'
const routeId = '22222222-2222-4222-8222-222222222222'
const request = (body: unknown) => new NextRequest('http://localhost/api/ediel/requested-changes', {method: 'POST', body: JSON.stringify(body)})
beforeEach(() => {
  vi.clearAllMocks()
  io.access.mockResolvedValue({guard: {companyId: 'own-company', userId: 'current-actor'}})
  io.prepare.mockResolvedValue({status: 'queued', message: {id: 'message', intent_id: 'intent', outbound_request_id: 'request',
    raw_payload: 'PRIVATE ORIGINAL', customer_id: 'private-customer', company_id: 'own-company'}})
})
describe('source-bound requested-change HTTP adapter', () => {
  it('uses only the authenticated current tenant/actor and immutable event selector, with a bounded queued projection', async () => {
    const {POST} = await import('@/app/api/ediel/requested-changes/route')
    const response = await POST(request({eventId, preferredRouteId: routeId}))
    expect(io.access).toHaveBeenCalledExactlyOnceWith(['communication.write'])
    expect(io.prepare).toHaveBeenCalledExactlyOnceWith({eventId, preferredRouteId: routeId, companyId: 'own-company', actorUserId: 'current-actor'})
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({status: 'queued', messageId: 'message', intentId: 'intent', outboundRequestId: 'request'})
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each([{eventId, companyId: 'foreign'}, {eventId, actorUserId: 'forged'}, {eventId, environment: 'production'},
    {eventId, verified: true}, {eventId: 'not-a-uuid'}, {eventId, preferredRouteId: 'not-a-uuid'}])('rejects caller authority and invalid selectors before the producer %j', async body => {
    const {POST} = await import('@/app/api/ediel/requested-changes/route')
    expect((await POST(request(body))).status).toBe(400)
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it('performs no producer work when selected company is missing or access is denied', async () => {
    const {POST} = await import('@/app/api/ediel/requested-changes/route')
    io.access.mockResolvedValue({guard: {companyId: null, userId: 'current-actor'}})
    expect((await POST(request({eventId}))).status).toBe(403)
    io.access.mockResolvedValue({response: NextResponse.json({error: 'Ej behörig'}, {status: 403})})
    const denied = await POST(request({eventId}))
    expect(denied.status).toBe(403)
    expect(denied.headers.get('cache-control')).toBe('private, no-store')
    expect(io.prepare).not.toHaveBeenCalled()
  })
  it('keeps a real source hold visible without claiming queued or sent', async () => {
    const {POST} = await import('@/app/api/ediel/requested-changes/route')
    io.prepare.mockResolvedValue({status: 'held', missing: ['requested_change_contract_source_required']})
    const response = await POST(request({eventId}))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({status: 'held', missing: ['requested_change_contract_source_required']})
  })
  it('sanitizes execution-time tenant/grant/source revocation failures', async () => {
    const {POST} = await import('@/app/api/ediel/requested-changes/route')
    io.prepare.mockRejectedValue(new Error('PRIVATE SQL customer secret'))
    const response = await POST(request({eventId}))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('PRIVATE')
  })
  it('returns a safe unavailable response when current authorization cannot be read', async () => {
    const {POST} = await import('@/app/api/ediel/requested-changes/route')
    io.access.mockRejectedValue(new Error('PRIVATE authentication failure'))
    const response = await POST(request({eventId}))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('PRIVATE')
    expect(io.prepare).not.toHaveBeenCalled()
  })
})
