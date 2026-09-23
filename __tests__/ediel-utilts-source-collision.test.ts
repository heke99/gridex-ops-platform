import { beforeEach, expect, it, vi } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
const io = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from } }))
let row: Record<string, unknown>; let writes: unknown[]; let race = false; let searches = 0
const raw = energyHandoffMessage().raw_payload!
beforeEach(() => {
  writes = []; race = false; searches = 0
  row = { id: 'source', company_id: 'company', environment: 'test', direction: 'inbound', message_family: 'UTILTS', message_code: 'E66', raw_payload: raw }
  io.from.mockImplementation((table: string) => {
    let write = false; let inserted = false
    const result = () => table !== 'ediel_messages' ? { data: {}, error: null } : write
      ? { data: race && inserted ? null : { id: 'source' }, error: race && inserted ? { code: '23505' } : null }
      : { data: race && ++searches <= 2 ? null : row, error: null }
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      update: (p: unknown) => { write = true; writes.push(p); return q }, insert: (p: unknown) => { write = true; inserted = true; writes.push(p); return q },
      maybeSingle: async () => result(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve) }
    return q
  })
})
const save = (wire = raw) => createInboundEdielMessage({ companyId: 'company', environment: 'test', inboundEmailMessageId: 'email', parsed: parseInboundEmailContent({ attachmentText: wire })! })
it('same natural identity and changed QTY cannot overwrite original raw', async () => {
  await expect(save(raw.replace('QTY+136:500', 'QTY+136:999'))).rejects.toThrow('INBOUND_UTILTS_SOURCE_CONFLICT')
  expect(writes).toEqual([])
})
it('same bytes in another environment cannot reuse the original source', async () => {
  row.environment = 'production'
  await expect(save()).rejects.toThrow('INBOUND_UTILTS_SOURCE_CONFLICT')
  expect(writes).toEqual([])
})
it('identical bytes and scope preserve normal reuse', async () => {
  await expect(save()).resolves.toBe('source')
  expect(writes).toHaveLength(2)
})
it('unique-conflict recovery cannot return changed original as successful reuse', async () => {
  race = true
  await expect(save(raw.replace('QTY+136:500', 'QTY+136:999'))).rejects.toThrow('INBOUND_UTILTS_SOURCE_CONFLICT')
  expect(writes).toHaveLength(1)
})
