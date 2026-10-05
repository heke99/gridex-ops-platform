// Unresolved-routing ediel_messages birth must carry the same reception
// selector as the resolved path, so a fresh mail is not classified as a
// protocol duplicate of an unbound row.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ inserts: [] as Array<{ table: string; row: Record<string, unknown> }> }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        io.inserts.push({ table, row })
        const q = { select: () => q, maybeSingle: async () => ({ data: { id: 'unresolved-1' }, error: null }) }
        return Object.assign(Promise.resolve({ data: null, error: null }), q)
      },
    }),
  },
}))
import { createUnresolvedInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import type { ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'

const mail = '00000000-0000-4000-8000-000000000010'
const parsed = {
  messageFamily: 'APERAK', senderEdielId: '54321', receiverEdielId: '99999', senderSubAddress: null, receiverSubAddress: null,
  interchangeReference: 'REF1', transactionReference: null, applicationReference: null, bgmReference: 'DOC1', rawPayload: 'SYNTHETIC',
} as unknown as ParsedEdifactEnvelope

beforeEach(() => { io.inserts.length = 0 })
describe('unresolved inbound reception selector', () => {
  it('binds mailbox_message_id to the inbound mail like the resolved path', async () => {
    await createUnresolvedInboundEdielMessage({ inboundEmailMessageId: mail, parsed, tenantStatus: 'unassigned', reasons: [], candidates: [] })
    const birth = io.inserts.find((i) => i.table === 'ediel_messages')?.row
    expect(birth).toMatchObject({ inbound_email_message_id: mail, mailbox_message_id: mail, company_id: null })
  })
})
