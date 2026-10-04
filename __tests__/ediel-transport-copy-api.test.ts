// masterplan: TR-03, AT-TR-03, TR-11, AT-TR-11, TEN-07, AT-TEN-07
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), download: vi.fn(), storage: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: mock.auth }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mock.rpc, storage: { from: mock.storage } } }))
import { GET } from '@/app/api/ediel/messages/[messageId]/transport-copy/route'

const companyId = '11111111-1111-4111-8111-111111111111', actorUserId = '22222222-2222-4222-8222-222222222222'
const messageId = '33333333-3333-4333-8333-333333333333', attemptId = '44444444-4444-4444-8444-444444444444'
const payload = Buffer.from('Message-ID: <copy@example.invalid>\r\nFrom: origin@example.invalid\r\nContent-Type: application/edifact\r\n\r\nOriginal bytes ?+', 'latin1')
const mimeSha256 = createHash('sha256').update(payload).digest('hex')
const copy = () => ({ attemptId, lane: 'generic_journal', companyId, messageId, environment: 'test',
  mimeArchiveRef: `storage://ediel-files/transport/${companyId}/${messageId}/${mimeSha256}.eml`, mimeSha256, mimeLength: payload.length,
  rfcMessageId: '<copy@example.invalid>', mimePayloadSnapshotId: actorUserId, enteredAt: '2026-09-30T12:00:00Z',
  observedAt: '2026-09-30T12:00:01Z', smtpClassification: 'accepted', archiveReadbackRequired: true })
const response = (copies = [copy()]) => ({ data: { status: 'available', companyId, messageId, environment: 'test', copies,
  blocker: null, authorizesResend: false, deliveryProven: false }, error: null })
const request = (query = '') => new NextRequest(`https://example.invalid/api/ediel/messages/${messageId}/transport-copy${query}`)
const context = { params: Promise.resolve({ messageId }) }

describe('authorized immutable transport copy download', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mock.auth.mockResolvedValue({ guard: { companyId, userId: actorUserId } })
    mock.rpc.mockImplementation(async(name:string)=>name==='ediel_require_source_bytes_available_v1'?{data:null,error:null}:response()); mock.storage.mockReturnValue({ download: mock.download })
    mock.download.mockResolvedValue({ data: new Blob([payload]), error: null })
  })
  it('reauthorizes the selected tenant, reads the private archive and returns exactly those bytes', async () => {
    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(200)
    expect(Buffer.from(await result.arrayBuffer())).toEqual(payload)
    expect(result.headers.get('content-type')).toBe('message/rfc822')
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(mock.rpc).toHaveBeenCalledWith('gridex_ediel_transport_copy_v1', { p_company_id: companyId, p_actor_user_id: actorUserId, p_message_id: messageId })
    expect(mock.storage).toHaveBeenCalledWith('ediel-files')
    expect(mock.download).toHaveBeenCalledWith(`transport/${companyId}/${messageId}/${mimeSha256}.eml`)
  })
  it('offers journal copies without reading bytes or asserting delivery/resend authority', async () => {
    const result = await GET(request(), context)
    const value = await result.json()
    expect(value).toMatchObject({ authorizesResend: false, deliveryProven: false, copies: [{ attemptId, mimeSha256 }] })
    expect(value.copies[0]).not.toHaveProperty('mimeArchiveRef')
    expect(mock.download).not.toHaveBeenCalled()
  })
  it.each([`?companyId=${companyId}`, `?attemptId=${attemptId}&attemptId=${attemptId}`, '?attemptId=invalid'])('rejects client scope overrides and ambiguous copy requests (%s)', async query => {
    expect((await GET(request(query), context)).status).toBe(400)
    expect(mock.rpc).not.toHaveBeenCalled()
  })
  it('requires selected tenant authentication before storage access', async () => {
    mock.auth.mockResolvedValueOnce({ response: NextResponse.json({}, { status: 401 }) }).mockResolvedValueOnce({ guard: { userId: actorUserId } })
    expect((await GET(request(), context)).status).toBe(401)
    expect((await GET(request(), context)).status).toBe(403)
    expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.download).not.toHaveBeenCalled()
  })
  it.each(['company', 'archive', 'duplicate', 'prepared'])('holds inconsistent source binding before storage I/O (%s)', async kind => {
    const item = copy()
    if (kind === 'company') item.companyId = actorUserId
    if (kind === 'archive') item.mimeArchiveRef = `storage://ediel-files/transport/${actorUserId}/${messageId}/${mimeSha256}.eml`
    if (kind === 'prepared') item.enteredAt = ''
    mock.rpc.mockResolvedValue(response(kind === 'duplicate' ? [item, item] : [item]))
    expect((await GET(request(`?attemptId=${attemptId}`), context)).status).toBe(409)
    expect(mock.download).not.toHaveBeenCalled()
  })
  it.each(['hash', 'size', 'message-id', 'missing'])('returns no bytes when archive readback fails (%s)', async kind => {
    if (kind === 'hash') mock.download.mockResolvedValue({ data: new Blob([Buffer.from(payload.toString().replace('bytes', 'BYTES'))]), error: null })
    if (kind === 'size') mock.download.mockResolvedValue({ data: new Blob([Buffer.concat([payload, Buffer.from('x')])]), error: null })
    if (kind === 'message-id') mock.rpc.mockResolvedValue(response([{ ...copy(), rfcMessageId: '<different@example.invalid>' }]))
    if (kind === 'missing') mock.download.mockResolvedValue({ data: null, error: new Error('private bucket diagnostic') })
    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(409)
    expect(await result.text()).not.toContain('private bucket')
  })
  it('does not leak owner diagnostics or grant access after a revoked current membership', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: new Error('secret owner record') })
    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(403); expect(await result.text()).not.toContain('secret')
    expect(mock.download).not.toHaveBeenCalled()
  })
  it('retains immutable journal history but returns no bytes after native retention tombstones the original',async()=>{
    mock.rpc.mockImplementation(async(name:string)=>name==='ediel_require_source_bytes_available_v1'?{data:null,error:Error('private retention receipt')}:response())
    const result=await GET(request(`?attemptId=${attemptId}`),context)
    expect(result.status).toBe(409);expect(await result.text()).not.toContain('private retention')
    expect(mock.download).not.toHaveBeenCalled()
  })
})
