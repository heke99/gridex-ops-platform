import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
import { readBusinessAckStatus, readBusinessAckStatusForDisplay, businessAckStatusPresentation } from '@/lib/ediel/inbound/businessAckReadModel'
const input = { sourceMessageId: 'source', actorUserId: 'reader', companyId: 'company', environment: 'test' }
const original = { id: 'ack', company_id: 'company', environment: 'test', related_message_id: 'source', direction: 'outbound', message_family: 'APERAK', status: 'failed' } as unknown as EdielMessageRow
const result = { version: 1, sourceMessageId: 'source', companyId: 'company', environment: 'test', ackFamily: null,
  sourceDirection: 'inbound', sourceSnapshot: null, sourceReceipt: null, messages: [original], heldOriginalIds: ['legacy-held'] }
const expected = { messages: result.messages, heldOriginalIds: result.heldOriginalIds, sourceDirection: 'inbound', sourceSnapshot: null, sourceReceipt: null }
beforeEach(() => { io.rpc.mockReset(); io.rpc.mockResolvedValue({ data: result, error: null }) })
describe('business ACK status uses current native read policy and private originals', () => {
  it('passes the actual reader and scope and keeps held originals separate from qualified status', async () => {
    expect(await readBusinessAckStatus(input)).toEqual(expected)
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_business_ack_status_v1', {
      p_source_message_id: 'source', p_actor_user_id: 'reader', p_company_id: 'company', p_environment: 'test', p_ack_family: null,
    })
  })
  it('lets native original ownership derive company for authenticated platform status readers', async () => {
    expect(await readBusinessAckStatus({ sourceMessageId: 'source', actorUserId: 'reader' })).toEqual(expected)
    expect(io.rpc).toHaveBeenCalledWith('ediel_read_business_ack_status_v1', expect.objectContaining({ p_company_id: null }))
  })
  it.each([{ companyId: 'foreign' }, { sourceMessageId: 'foreign' }, { environment: 'production' }, { version: 2 }, { heldOriginalIds: [false] }])('holds malformed native scope %j', async patch => {
    io.rpc.mockResolvedValue({ data: { ...result, ...patch }, error: null })
    await expect(readBusinessAckStatus(input)).rejects.toThrow('native_scope_mismatch')
  })
  it.each([{ company_id: 'foreign' }, { related_message_id: 'foreign' }, { environment: 'production' }, { direction: 'inbound' }])('rejects foreign original %j', async patch => {
    io.rpc.mockResolvedValue({ data: { ...result, messages: [{ ...original, ...patch }] }, error: null })
    await expect(readBusinessAckStatus(input)).rejects.toThrow('native_scope_mismatch')
  })
  it('propagates current read denial without public-row or send fallback', async () => {
    io.rpc.mockResolvedValue({ data: null, error: Error('reader_required') })
    await expect(readBusinessAckStatus(input)).rejects.toThrow('reader_required')
    expect(io.rpc).toHaveBeenCalledOnce()
  })
  it('holds actorless attempts before the RPC', async () => {
    await expect(readBusinessAckStatus({ ...input, actorUserId: '' })).rejects.toThrow('scope_required')
    expect(io.rpc).not.toHaveBeenCalled()
  })
  it('holds unavailable display rows independently while command readers propagate the same denial', async () => {
    io.rpc.mockResolvedValueOnce({ data: null, error: Error('tenant_required') })
    const held = await readBusinessAckStatusForDisplay(input)
    expect(held).toEqual({ messages: [], heldOriginalIds: [], holdReason: 'unavailable' })
    expect(businessAckStatusPresentation(held).state).toBe('ack_status_held')
    expect((await readBusinessAckStatusForDisplay(input)).messages).toEqual([original])
  })
  it('keeps a completed partial rejection distinct from the immutable received family status', async () => {
    const snapshot = { id: 'source', direction: 'outbound', company_id: 'company', environment: 'test', aperak_status: 'received' } as EdielMessageRow
    io.rpc.mockResolvedValue({ data: { ...result, sourceDirection: 'outbound', sourceSnapshot: snapshot,
      sourceReceipt: { sourceAccepted: false, finalAckReached: true, wholeSourceRejected: false },
      heldOriginalIds: [], messages: [{ ...original, direction: 'inbound' }] }, error: null })
    const status = await readBusinessAckStatus(input)
    expect(businessAckStatusPresentation(status)).toMatchObject({ state: 'ack_completed_with_rejections', aperak: 'received' })
  })
  it('never derives positive status when an older receipt is held', async () => {
    expect(businessAckStatusPresentation(await readBusinessAckStatus(input))).toMatchObject({ state: 'ack_status_held', aperak: 'ack_status_held' })
  })
  it('rejects a snapshot with a foreign tenant or absent immutable acceptance flags', async () => {
    io.rpc.mockResolvedValue({ data: { ...result, sourceDirection: 'outbound', sourceSnapshot: { id: 'source', company_id: 'foreign', environment: 'test', direction: 'outbound' } }, error: null })
    await expect(readBusinessAckStatus(input)).rejects.toThrow('native_scope_mismatch')
  })
})
