import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
import { listBusinessAckMessagesForSource } from '@/lib/ediel/inbound/businessAckMessages'
const input = { companyId: 'company', sourceMessageId: 'source', actorUserId: 'operator', environment: 'test', ackFamily: 'APERAK' as const }
const saved = { id: 'own-ack', company_id: 'company', environment: 'test', direction: 'outbound', message_family: 'APERAK', related_message_id: 'source', status: 'failed', ack_outcome: 'negative' } as unknown as EdielMessageRow
beforeEach(() => { io.rpc.mockReset(); io.rpc.mockResolvedValue({ data: { version: 1, companyId: 'company', sourceMessageId: 'source', environment: 'test', ackFamily: 'APERAK', messages: [saved] }, error: null }) })
describe('normal business ACK list is an actual current native owner port', () => {
  it('passes exact current actor/company/environment/source and retains failed originals', async () => {
    expect(await listBusinessAckMessagesForSource(input)).toEqual([saved])
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_list_business_acks_for_source_v1', { p_company_id: 'company', p_source_message_id: 'source', p_actor_user_id: 'operator', p_environment: 'test', p_ack_family: 'APERAK' })
  })
  it.each([{ company_id: 'foreign' }, { environment: 'production' }, { related_message_id: 'foreign' }, { related_message_id: null }, { direction: 'inbound' }, { message_family: 'CONTRL' }, { ack_outcome: null }])('rejects malformed owner scope %j', async patch => {
    io.rpc.mockResolvedValue({ data: { version: 1, companyId: 'company', sourceMessageId: 'source', environment: 'test', ackFamily: 'APERAK', messages: [{ ...saved, ...patch }] }, error: null })
    await expect(listBusinessAckMessagesForSource(input)).rejects.toThrow('native_scope_mismatch')
  })
  it('uses the native source/outcome projection despite conflicting public parsed caches', async () => {
    const original = { ...saved, ack_outcome: 'positive', parsed_payload: { ackOutcome: 'negative', relatedMessageId: 'foreign' }, functional_check_status: 'failed' }
    io.rpc.mockResolvedValue({ data: { version: 1, companyId: 'company', sourceMessageId: 'source', environment: 'test', ackFamily: 'APERAK', messages: [original] }, error: null })
    expect((await listBusinessAckMessagesForSource(input))[0].ack_outcome).toBe('positive')
    expect(io.rpc).toHaveBeenCalledOnce()
  })
  it('does not fall back to a global public-row list after native current denial', async () => {
    io.rpc.mockResolvedValue({ data: null, error: Error('current_actor_denied') })
    await expect(listBusinessAckMessagesForSource(input)).rejects.toThrow('current_actor_denied')
    expect(io.rpc).toHaveBeenCalledOnce()
  })
  it('lets the native owner derive environment and retain all ACK families when unspecified', async () => {
    io.rpc.mockResolvedValue({ data: { version: 1, companyId: 'company', sourceMessageId: 'source', environment: 'test', ackFamily: null, messages: [saved] }, error: null })
    expect(await listBusinessAckMessagesForSource({ companyId: 'company', sourceMessageId: 'source', actorUserId: 'operator' })).toEqual([saved])
    expect(io.rpc).toHaveBeenCalledWith('ediel_list_business_acks_for_source_v1', expect.objectContaining({ p_environment: null, p_ack_family: null }))
  })
  it('holds absent tenant rather than widening company scope', async () => {
    await expect(listBusinessAckMessagesForSource({ ...input, companyId: null })).rejects.toThrow('scope_required')
    expect(io.rpc).not.toHaveBeenCalled()
  })
})
