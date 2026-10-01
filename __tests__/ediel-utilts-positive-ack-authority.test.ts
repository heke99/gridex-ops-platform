import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertUtiltsPositiveAckAuthorityForSend } from '@/lib/ediel/utilts/positiveAckAuthority'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { utiltsErrGatewayFixture } from './helpers/utiltsErrGatewayFixture'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {escapeEdifactValue} from '@/lib/ediel/core/edifactSerializer'

const state = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: state.rpc } }))
vi.mock('@/lib/ediel/core/kernelLegacy', () => ({
  resolveCanonicalOutboundContext: async () => ({ route: { id: 'route' }, routeRuntime: { route_profile_id: 'profile' } }),
}))
vi.mock('@/lib/ediel/rulebook/validator', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/ediel/rulebook/validator')>(),
  validateRulebookMessageWithRegistry: async () => ({ issues: [], fieldRuleSource: 'registry', rulePackSnapshot: {
    profileKey: 'source', profileVersionId: 'version', version: 'E5SE5A-r3', checksum: 'a'.repeat(64),
  } }),
}))
vi.mock('@/lib/ediel/core/dedupe', () => ({ hasCanonicalAckDuplicate: async () => null }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessage: state.create, findSequencedAckForSource: async () => null,
  createCanonicalAckConflictEvent: async () => undefined }))

function fixture() {
  const source = { ...utiltsErrGatewayFixture({ company: randomUUID(), transactions: [{ reference: 'OWN-IDE', outcome: 'accepted' }] }),
    id: randomUUID(), canonical_rule_pack_id: randomUUID(), rule_profile_key: 'source',
    rule_profile_version_id: 'version', rule_profile_version: 'E5SE5A-r3', rule_pack_checksum: 'a'.repeat(64),
  } as EdielMessageRow
  const draft = buildAperakDraft({ sourceMessage: source, outcome: 'positive', ackScope: 'transaction', relatedTransactionReference: 'OWN-IDE' })
  return { source, draft, create: () => createCanonicalAckMessage({ sourceMessage: source, ackFamily: 'APERAK', outcome: 'positive', draft }) }
}
beforeEach(() => { state.rpc.mockReset(); state.create.mockReset(); state.create.mockResolvedValue({ id: 'created' }) })

describe('positive UTILTS ACK durable authority gateway', () => {
  it('refuses a syntactically accepted manual positive ACK when no committed storage authority exists', async () => {
    const f = fixture()
    state.rpc.mockResolvedValue({ data: null, error: { message: 'utilts_positive_ack_storage_unavailable' } })
    await expect(f.create()).rejects.toThrow('utilts_positive_ack_storage_unavailable')
    expect(state.create).not.toHaveBeenCalled()
  })
})

function authority(f: ReturnType<typeof fixture>, ack?: EdielMessageRow) {
  return { data: { authorityVersion: 1, companyId: f.source.company_id, environment: f.source.environment,
    sourceMessageId: f.source.id, transactionId: 'OWN-IDE', sourceRawHash: createHash('sha256').update(f.source.raw_payload!).digest('hex'),
    ackMessageId: ack?.id ?? null, ackRawHash: ack ? createHash('sha256').update(ack.raw_payload!).digest('hex') : null }, error: null }
}
function outbound(f: ReturnType<typeof fixture>): EdielMessageRow {
  return { id: randomUUID(), direction: 'outbound', message_family: 'APERAK', message_code: '312',
    environment: f.source.environment, company_id: f.source.company_id, related_message_id: f.source.id,
    raw_payload: f.draft.rawPayload } as EdielMessageRow
}
it('creates from committed storage while ACK finalization is still pending', async () => {
  const f = fixture(); state.rpc.mockResolvedValue(authority(f))
  await expect(f.create()).resolves.toEqual({ id: 'created' })
  expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_source_message_id: f.source.id, p_transaction_id: 'OWN-IDE', p_ack_message_id: null })
})
it('holds transmission when accepted storage has no final binding to this ACK', async () => {
  const f = fixture(), ack = outbound(f)
  state.rpc.mockResolvedValue({ data: null, error: { message: 'utilts_positive_ack_storage_unavailable' } })
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
})
it('requires the saved exact ACK, source and wire scope on transmission', async () => {
  const f = fixture(), ack = outbound(f); state.rpc.mockResolvedValue(authority(f, ack))
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
  expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_company_id: f.source.company_id, p_source_message_id: f.source.id,
    p_transaction_id: 'OWN-IDE', p_ack_message_id: ack.id, p_ack_raw_payload: ack.raw_payload })
})
it('passes exact leading/embedded ACW bytes to the same durable authority without merging a trimmed sibling',async()=>{
  const f=fixture(),ack=outbound(f),reference=' OWN A+B:C?D'
  ack.raw_payload=ack.raw_payload!.replace('ACW:OWN-IDE',`ACW:${escapeEdifactValue(reference)}`)
  state.rpc.mockImplementation(async (_name,args)=>{
    const result=authority(f,ack);result.data.transactionId=args.p_transaction_id;return result
  })
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
  expect(state.rpc.mock.calls[0][1].p_transaction_id).toBe(reference)
  ack.raw_payload=ack.raw_payload.replace(escapeEdifactValue(reference),`${escapeEdifactValue(reference)} `)
  state.rpc.mockClear()
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  expect(state.rpc).not.toHaveBeenCalled()
})
it('refuses a stale caller source or forged authority projection', async () => {
  const f = fixture(); const result = authority(f); result.data.sourceRawHash = '0'.repeat(64); state.rpc.mockResolvedValue(result)
  await expect(f.create()).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  expect(state.create).not.toHaveBeenCalled()
})
it('refuses a forged cross-tenant ACK draft before any persistence query', async () => {
  const f = fixture(); f.draft.companyId = randomUUID()
  await expect(f.create()).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled()
})
it('refuses missing or duplicate positive ACW rather than substituting BGM identity', async () => {
  const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace("RFF+ACW:OWN-IDE'", '')
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  ack.raw_payload = f.draft.rawPayload!.replace("RFF+ACW:OWN-IDE'", "RFF+ACW:OWN-IDE'RFF+ACW:OWN-IDE'")
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  expect(state.rpc).not.toHaveBeenCalled()
})
it('preserves negative UTILTS APERAK and technical ACK routes without a positive storage grant', async () => {
  const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace('BGM+312+', 'BGM+313+')
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
  await expect(assertUtiltsPositiveAckAuthorityForSend({ ...ack, message_family: 'CONTRL', raw_payload: "UNH+1+CONTRL:D:96A:UN'E" } as EdielMessageRow)).resolves.toBeUndefined()
  expect(state.rpc).not.toHaveBeenCalled()
})

it.each(['APERAK:D:96A:UN:E5SE5A', 'APERAK:D:04A:UN:E2SE6A', 'APERAK:D:04A:UN', 'PRODAT:D:04A:UN:E5SE5A'])(
  'holds a physical positive BGM312 with malformed/mismatched profile %s', async profile => {
    const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace('APERAK:D:04A:UN:E5SE5A', profile)
    await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
    expect(state.rpc).not.toHaveBeenCalled()
  })
it('checks every physical ACW in a multi-group positive ACK before allowing transmission', async () => {
  const f = fixture(), ack = outbound(f); ack.raw_payload = ack.raw_payload!.replace("RFF+ACW:OWN-IDE'", "RFF+ACW:OWN-IDE'RFF+DM:DOCUMENT'RFF+ACW:OTHER-IDE'")
  state.rpc.mockImplementation(async (_name, args) => {
    const result = authority(f, ack); result.data.transactionId = args.p_transaction_id; return result
  })
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined()
  expect(state.rpc.mock.calls.map(call => call[1].p_transaction_id)).toEqual(['OWN-IDE', 'OTHER-IDE'])
  state.rpc.mockReset(); state.rpc.mockImplementation(async (_name, args) => args.p_transaction_id === 'OWN-IDE'
    ? authority(f, ack) : { data: null, error: { message: 'utilts_positive_ack_storage_unavailable' } })
  await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
})
