// masterplan: TR-03, AT-TR-03, TR-11, AT-TR-11, TEN-07, AT-TEN-07
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
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
const tombstoneMessage = 'ediel_original_bytes_retention_tombstoned'

function syntheticSupabase(fetch: typeof globalThis.fetch) {
  return createClient('https://supabase.example.invalid', 'synthetic', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  })
}

describe('authorized immutable transport copy download', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mock.auth.mockResolvedValue({ guard: { companyId, userId: actorUserId } })
    mock.rpc.mockImplementation(async(name:string)=>name==='ediel_require_source_bytes_available_v1'?{data:null,error:null}:response())
    mock.storage.mockReturnValue({ download: (...args: unknown[]) => ({ asStream: async () => {
      const { data, error } = await mock.download(...args)
      return { data: data?.stream() ?? null, error }
    } }) })
    mock.download.mockResolvedValue({ data: new Blob([payload]), error: null })
  })
  afterEach(() => vi.useRealTimers())
  it('reauthorizes the selected tenant, reads the private archive and returns exactly those bytes', async () => {
    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(200)
    expect(Buffer.from(await result.arrayBuffer())).toEqual(payload)
    expect(result.headers.get('content-type')).toBe('message/rfc822')
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(mock.rpc).toHaveBeenCalledWith('gridex_ediel_transport_copy_v1', { p_company_id: companyId, p_actor_user_id: actorUserId, p_message_id: messageId })
    expect(mock.storage).toHaveBeenCalledWith('ediel-files')
    expect(mock.download).toHaveBeenCalledWith(`transport/${companyId}/${messageId}/${mimeSha256}.eml`, {}, { signal: expect.any(AbortSignal) })
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
  it.each(['company', 'archive', 'duplicate', 'prepared', 'oversize'])('holds inconsistent source binding before storage I/O (%s)', async kind => {
    const item = copy()
    if (kind === 'company') item.companyId = actorUserId
    if (kind === 'archive') item.mimeArchiveRef = `storage://ediel-files/transport/${actorUserId}/${messageId}/${mimeSha256}.eml`
    if (kind === 'prepared') item.enteredAt = ''
    if (kind === 'oversize') item.mimeLength = 32 * 1024 * 1024 + 1
    mock.rpc.mockResolvedValue(response(kind === 'duplicate' ? [item, item] : [item]))
    expect((await GET(request(`?attemptId=${attemptId}`), context)).status).toBe(409)
    expect(mock.download).not.toHaveBeenCalled()
  })
  it.each(['hash', 'size', 'truncated', 'message-id', 'missing'])('returns no bytes when archive readback fails (%s)', async kind => {
    if (kind === 'hash') mock.download.mockResolvedValue({ data: new Blob([Buffer.from(payload.toString().replace('bytes', 'BYTES'))]), error: null })
    if (kind === 'size') mock.download.mockResolvedValue({ data: new Blob([Buffer.concat([payload, Buffer.from('x')])]), error: null })
    if (kind === 'truncated') mock.download.mockResolvedValue({ data: new Blob([payload.subarray(0, -1)]), error: null })
    if (kind === 'message-id') mock.rpc.mockResolvedValue(response([{ ...copy(), rfcMessageId: '<different@example.invalid>' }]))
    if (kind === 'missing') mock.download.mockResolvedValue({ data: null, error: { status: 404, message: 'private bucket diagnostic' } })
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
  it.each([
    [{ code: 'P0001', message: tombstoneMessage }, 400, 410, 'Transportkopian är spärrad enligt gallringsbeslutet.'],
    [{ code: 'PGRST000', message: 'synthetic connection unavailable' }, 503, 503, 'Transportkopian kan tillfälligt inte läsas.'],
    [{ code: 'PGRST000', message: tombstoneMessage }, 503, 503, 'Transportkopian kan tillfälligt inte läsas.'],
    [{ code: 'P0001', message: `${tombstoneMessage}_unconfirmed` }, 400, 503, 'Transportkopian kan tillfälligt inte läsas.'],
  ] as const)('classifies native availability response %o, keeping the journal readable', async (error, upstream, expected, message) => {
    const client = syntheticSupabase(async (input, init) => {
      expect(String(input)).toBe('https://supabase.example.invalid/rest/v1/rpc/ediel_require_source_bytes_available_v1')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ p_company_id: companyId, p_source_message_id: messageId })
      return Response.json({ ...error, details: 'synthetic private diagnostic', hint: null }, { status: upstream })
    })
    mock.rpc.mockImplementation((name: string, args: Record<string, unknown>) =>
      name === 'ediel_require_source_bytes_available_v1' ? client.rpc(name, args) : Promise.resolve(response()))

    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(expected)
    expect(await result.json()).toEqual({ error: message })
    expect(result.headers.get('content-disposition')).toBeNull()
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(mock.download).not.toHaveBeenCalled()
    const list = await GET(request(), context)
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({ copies: [{ attemptId, mimeSha256 }] })
  })

  it('rejects a thrown retention read before any archive I/O', async () => {
    mock.rpc.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('synthetic private transport diagnostic'))
    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ error: 'Transportkopian kan tillfälligt inte läsas.' })
    expect(result.headers.get('content-disposition')).toBeNull()
    expect(mock.download).not.toHaveBeenCalled()
  })

  it.each([
    [400, { statusCode: '404', code: 'NoSuchKey' }, 409],
    [503, { statusCode: '404', code: 'SlowDown' }, 503],
  ] as const)('distinguishes archive absence and a Storage HTTP %i failure', async (status, error, expected) => {
    const client = syntheticSupabase(async input => {
      expect(String(input)).toBe(`https://supabase.example.invalid/storage/v1/object/ediel-files/transport/${companyId}/${messageId}/${mimeSha256}.eml`)
      return Response.json({ ...error, message: 'synthetic private Storage diagnostic' }, { status })
    })
    mock.storage.mockImplementation(() => client.storage.from('ediel-files'))

    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(expected)
    expect(result.headers.get('content-disposition')).toBeNull()
    expect(await result.text()).not.toContain('synthetic private Storage diagnostic')
  })

  it('reports a failed archive body read as temporarily unavailable', async () => {
    const data = new Blob([payload])
    vi.spyOn(data, 'stream').mockReturnValue(new ReadableStream({
      pull: controller => controller.error(new Error('synthetic body read failed')),
    }))
    mock.download.mockResolvedValue({ data, error: null })

    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ error: 'Transportkopian kan tillfälligt inte läsas.' })
    expect(result.headers.get('content-disposition')).toBeNull()
  })

  it('reports invalid MIME headers with matching length and hash as an archive conflict', async () => {
    const changed = Buffer.from('Synthetic archive without MIME headers')
    const changedHash = createHash('sha256').update(changed).digest('hex')
    const item = { ...copy(), mimeLength: changed.length, mimeSha256: changedHash,
      mimeArchiveRef: `storage://ediel-files/transport/${companyId}/${messageId}/${changedHash}.eml` }
    mock.rpc.mockResolvedValueOnce(response([item]))
    mock.download.mockResolvedValue({ data: new Blob([changed]), error: null })

    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: 'Transportkopian saknar aktuell arkivverifiering.' })
    expect(result.headers.get('content-disposition')).toBeNull()
  })

  it('streams exact authorised MIME through the SDK with a deadline and no Blob read', async () => {
    const body = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload.subarray(0, 12))
        controller.enqueue(payload.subarray(12))
        controller.close()
      },
    }))
    const blob = vi.spyOn(body, 'blob')
    let signal: AbortSignal | null | undefined
    const client = syntheticSupabase(async (_input, init) => { signal = init?.signal; return body })
    mock.storage.mockImplementation(() => client.storage.from('ediel-files'))

    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(200)
    expect(Buffer.from(await result.arrayBuffer())).toEqual(payload)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(blob).not.toHaveBeenCalled()
  })

  it('stops the real SDK stream immediately beyond the frozen byte length', async () => {
    const cancel = vi.fn()
    let chunks = 0
    const body = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++
        controller.enqueue(chunks === 1 ? payload : new Uint8Array([0]))
      },
      cancel,
    }, { highWaterMark: 0 }))
    const client = syntheticSupabase(async () => body)
    mock.storage.mockImplementation(() => client.storage.from('ediel-files'))

    const result = await GET(request(`?attemptId=${attemptId}`), context)
    expect(result.status).toBe(409)
    expect(result.headers.get('content-disposition')).toBeNull()
    expect(chunks).toBe(2)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds the wait for Storage headers and aborts the SDK request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const abort = vi.fn()
    const client = syntheticSupabase(async (_input, init) => new Promise((_, reject) => {
      const signal = init?.signal
      signal?.addEventListener('abort', () => { abort(); reject(signal.reason) }, { once: true })
    }))
    mock.storage.mockImplementation(() => client.storage.from('ediel-files'))

    const read = GET(request(`?attemptId=${attemptId}`), context)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await read
    expect(result.status).toBe(503)
    expect(result.headers.get('content-disposition')).toBeNull()
    expect(abort).toHaveBeenCalledOnce()
  })

  it('cancels a Storage body that delivers all expected bytes without ending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const body = new Response(new ReadableStream<Uint8Array>({
      start: controller => controller.enqueue(payload),
      cancel,
    }))
    const client = syntheticSupabase(async () => body)
    mock.storage.mockImplementation(() => client.storage.from('ediel-files'))

    const read = GET(request(`?attemptId=${attemptId}`), context)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await read
    expect(result.status).toBe(503)
    expect(result.headers.get('content-disposition')).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
