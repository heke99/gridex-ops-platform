import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
const f = vi.hoisted(() => ({ effects: [] as string[], fail: false, rpc: vi.fn(), event: vi.fn(), status: vi.fn(), link: vi.fn(), sourceRead: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: f.rpc, from: (table: string) => {
  let mutation = false, selectedId: string | null = null
  const result = () => { if (mutation) f.effects.push(table); return { data: table === 'ediel_messages' ? (selectedId === ids.ack ? ack() : source()) : null, error: null } }
  const q = { select: () => q, eq: (column: string, value: unknown) => { if (column === 'id') selectedId = String(value); return q }, limit: () => q, is: () => q,
    update: () => { mutation = true; return q }, insert: () => { mutation = true; return q },
    single: async () => result(), maybeSingle: async () => result(), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
  return q
} } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: f.event, getEdielMessageById: f.sourceRead, updateEdielMessageStatus: f.status, linkEdielMessage: f.link }))
vi.mock('@/lib/cis/db', () => ({ getOutboundRequestById: async () => null, updateGridOwnerDataRequestStatus: vi.fn(), updateOutboundRequestStatus: vi.fn() }))
vi.mock('@/lib/operations/db', () => ({ createSupplierSwitchEvent: async () => { f.effects.push('supplier_switch_events') },
  updateSupplierSwitchRequestStatus: async () => { f.effects.push('supplier_switch_requests'); return { id: ids.switch } } }))
vi.mock('@/lib/customer-cases/db', () => ({ syncCustomerCaseCancellationAck: async () => null }))
vi.mock('@/lib/ediel/actorTestingEngine', () => ({ syncActorTestingForMessage: async () => false }))
import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
const ids = { company: 'fc900000-0000-4000-8000-000000000001', source: 'fc900000-0000-4000-8000-000000000002',
  ack: 'fc900000-0000-4000-8000-000000000003', switch: 'fc900000-0000-4000-8000-000000000004', actor: 'fc900000-0000-4000-8000-000000000005' }
function source() { return { id: ids.source, company_id: ids.company, direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03',
  switch_request_id: ids.switch, status: 'sent', message_sent_at: '2026-10-01T00:00:00Z', requires_contrl: true, requires_aperak: false } as EdielMessageRow }
function ack() { return { id: ids.ack, company_id: ids.company, direction: 'inbound', message_family: 'CONTRL', message_code: 'CONTRL',
  related_message_id: ids.source, switch_request_id: ids.switch, parsed_payload: { ackOutcome: 'negative' } } as unknown as EdielMessageRow }
beforeEach(() => {
  vi.clearAllMocks(); f.effects = []; f.fail = false
  f.sourceRead.mockResolvedValue(source())
  f.event.mockImplementation(async () => { f.effects.push('ediel_message_events') })
  f.status.mockImplementation(async () => { f.effects.push('ediel_message_status'); return ack() })
  f.link.mockImplementation(async () => { f.effects.push('ediel_message_links') })
  f.rpc.mockImplementation(async () => f.fail ? { data: null, error: new Error('synthetic_final_intent_fault') } : { data: {
    outcome: 'technical_rejection', tenantMessage: 'Rejected', reviewRequired: true, updated: ['supplier_switch_requests'], metadata: {},
    switchRequestId: ids.switch, supplyPeriodId: null, caseId: 'case', replayed: false, ackOutcome: 'negative', finalAckReached: false,
    sourceMessageId: ids.source, outboundRequestId: null }, error: null })
})
it('current switch ACK route calls atomic owner before any older parsed/link/source/switch writes', async () => {
  f.fail = true
  await expect(processInboundAckMessage({ actorUserId: ids.actor, message: ack() })).rejects.toThrow('synthetic_final_intent_fault')
  expect(f.effects).toEqual([])
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('gridex_apply_inbound_switch_lifecycle_v1', { p_source_message_id: ids.ack, p_actor_user_id: ids.actor })
})
it('successful switch ACK returns database-derived technical result without repeating old effect adapters', async () => {
  const result = await processInboundAckMessage({ actorUserId: ids.actor, message: ack() })
  expect(result).toMatchObject({ outcome: 'negative', switchRequestId: ids.switch, finalAckReached: false })
  expect(f.effects).toEqual([]); expect(f.rpc).toHaveBeenCalledTimes(1)
})
