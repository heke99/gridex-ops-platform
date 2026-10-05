// Public unresolved caller retains the mail/parse/source link through protected
// admission. RPC custody is a finite port here; real birth selectors are covered
// by the existing SC014 SQL/native admission tests, not a fabricated raw insert.
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  rpc: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    rpc: io.rpc,
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
const parseId = '00000000-0000-4000-8000-000000000011'
const sourceId = '00000000-0000-4000-8000-000000000012'
const actorId = '00000000-0000-4000-8000-000000000013'
const parsed = {
  messageFamily: 'PRODAT', senderEdielId: '54321', receiverEdielId: '99999', senderSubAddress: null, receiverSubAddress: null,
  interchangeReference: 'REF1', transactionReference: null, applicationReference: null, bgmReference: 'DOC1', rawPayload: 'SYNTHETIC',
} as unknown as ParsedEdifactEnvelope

beforeEach(() => {
  io.inserts.length = 0
  io.rpc.mockReset().mockResolvedValue({ data: {
    kind: 'unattributed_technical_intake', version: 1,
    disposition: 'technical_only_unattributed', sourceMessageId: sourceId,
    inboundEmailMessageId: mail, parseResultId: parseId,
    companyId: null, resolvedCompanyId: null,
    technicalCompanyId: '00000000-0000-4000-8000-000000000014',
    environment: 'production', executionActorUserId: actorId,
    sourcePayloadHash: createHash('sha256').update(parsed.rawPayload).digest('hex'),
    receivedAt: '2026-10-05T00:00:00Z', authorizesBusinessEffect: false,
  }, error: null })
})
describe('unresolved inbound reception selector', () => {
  it('retains the admitted mail, parse and source linkage without raw original insertion', async () => {
    const result = await createUnresolvedInboundEdielMessage({
      actorUserId: actorId, inboundEmailMessageId: mail, parseResultId: parseId,
      environment: 'production', parsed, tenantStatus: 'unassigned', reasons: [], candidates: [],
    })
    expect(result).toBe(sourceId)
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_admit_unattributed_technical_source_v1', {
      p_inbound_email_message_id: mail, p_parse_result_id: parseId,
      p_actor_user_id: actorId, p_expected_environment: 'production',
      p_expected_payload_hash: createHash('sha256').update(parsed.rawPayload).digest('hex'),
    })
    expect(io.inserts.map(i => i.table)).toEqual(['ediel_unresolved_items', 'ediel_message_events'])
    expect(io.inserts[0].row).toMatchObject({
      source_message_id: sourceId, company_id: null,
      extracted_identifiers: { inboundEmailMessageId: mail, parseResultId: parseId },
    })
    expect(io.inserts[1].row).toMatchObject({ ediel_message_id: sourceId, company_id: null })
  })
  it('holds a raw-only unresolved APERAK before custody or database writes', async () => {
    const result = await createUnresolvedInboundEdielMessage({
      inboundEmailMessageId: mail, parsed: { ...parsed, messageFamily: 'APERAK' },
      tenantStatus: 'unassigned', reasons: [], candidates: [],
    })
    expect(result).toBeNull()
    expect(io.rpc).not.toHaveBeenCalled()
    expect(io.inserts).toEqual([])
  })
})
