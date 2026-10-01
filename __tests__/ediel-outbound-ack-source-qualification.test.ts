import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn(), rulePack: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: io.rulePack }))
import { readSourceBoundOutboundAckRulePackEvidence } from '@/lib/ediel/core/ackSourceRulePackEvidence'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { EdielMessageRow } from '@/lib/ediel/types'
const company = '10000000-0000-4000-8000-000000000001', sourceId = '20000000-0000-4000-8000-000000000001', ackId = '30000000-0000-4000-8000-000000000001'
const wire = (ack: boolean) => EdifactEnvelopeCodec.encode({ sender: ack ? '90002' : '90001', receiver: ack ? '90001' : '90002', interchangeReference: ack ? 'ACKI' : 'ORIGINALI', applicationReference: '23-DDQ-E66-T', environment: 'test', acknowledgementRequest: true,
  messages: [{ messageReference: ack ? 'ACKM' : 'ORIGINALM', messageTypeToken: ack ? 'APERAK:D:04A:UN:E5SE5A' : 'UTILTS:D:02B:UN:E5SE5A', businessSegments: ack ? [
    'BGM+312+ACKDOC+9', 'DTM+137:202609301200:203', 'DTM+735:?+0100:406', 'DOC+E66::260+ORIGINALDOC', 'NAD+MS+12345:SVK:260', 'NAD+MR+54321:SVK:260', 'ERC+100::260', 'FTX+AAO+++OK', 'RFF+DM:ACKT', 'RFF+ACW:ORIGINALT',
  ] : ['BGM+E66+ORIGINALDOC+9', 'NAD+MS+54321:SVK:260', 'NAD+MR+12345:SVK:260', 'IDE+24+ORIGINALT'] }] })
const source = () => ({ id: sourceId, company_id: company, environment: 'test', direction: 'inbound', message_standard: 'edifact', message_family: 'UTILTS', message_code: 'E66', raw_payload: wire(false), parsed_payload: {} }) as unknown as EdielMessageRow
const evidence = () => ({ rulePackId: '40000000-0000-4000-8000-000000000001', messageProfileId: '50000000-0000-4000-8000-000000000001', profileKey: 'DB:ACTUAL:SOURCE', version: 'original-opaque-version', sourceHash: 'a'.repeat(64), snapshot: { profileKey: 'DB:ACTUAL:SOURCE', profileVersionId: '50000000-0000-4000-8000-000000000001', version: 'original-opaque-version', checksum: 'a'.repeat(64), rulePack: { id: '40000000-0000-4000-8000-000000000001', source_hash:'a'.repeat(64), family: 'UTILTS', guide_version: '25-A-3', guide_revision: '3' }, messageProfile: { id:'50000000-0000-4000-8000-000000000001', rule_pack_id:'40000000-0000-4000-8000-000000000001' }, guideSources:[] } })
const input = () => ({ family: 'APERAK', code: 'APERAK', direction: 'outbound' as const, environment: 'test' as const, companyId: company, rawPayload: wire(true), mode: 'send' as const })
beforeEach(() => { io.rpc.mockReset(); io.rulePack.mockReset(); io.rpc.mockResolvedValue({ data: { version: 1, sourceMessage: source(), sourceRulePackEvidence: evidence() }, error: null }) })
describe('outbound ACK original evidence is an opaque protected port', () => {
  it('rejects a caller JSON snapshot without consulting a fresh rule pack', async () => {
    const result = await validateRulebookMessageWithRegistry({ ...input(), parsedPayload: { canonicalSourceRulePackSnapshot: { ...evidence().snapshot, inheritedFromSourceMessage: true, sourceMessageId: sourceId } } })
    expect(result.ok).toBe(false); expect(result.issues.some(issue => issue.code === 'CANONICAL_ACK_SOURCE_RULE_PACK_EVIDENCE_REQUIRED')).toBe(true)
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.rulePack).not.toHaveBeenCalled()
  })
  it('accepts only the actual returned token and exact actual-original wire', async () => {
    const qualification = await readSourceBoundOutboundAckRulePackEvidence({ companyId: company, environment: 'test', sourceMessageId: sourceId })
    expect(Object.isFrozen(qualification.evidence.snapshot.rulePack)).toBe(true)
    const result = await validateRulebookMessageWithRegistry({ ...input(), ackSourceQualification: qualification })
    expect(result).toMatchObject({ ok: true, fieldRuleSource: 'registry', rulePackSnapshot: { profileKey: evidence().profileKey, checksum: evidence().sourceHash } })
    expect(io.rulePack).not.toHaveBeenCalled()
    expect((await validateRulebookMessageWithRegistry({ ...input(), ackSourceQualification: { ...qualification } })).ok).toBe(false)
  })
  it('rejects another tenant, original reference or technical route despite a real token', async () => {
    const qualification = await readSourceBoundOutboundAckRulePackEvidence({ companyId: company, environment: 'test', sourceMessageId: sourceId })
    for (const change of [{ companyId: '60000000-0000-4000-8000-000000000001' }, { rawPayload: wire(true).replace('RFF+ACW:ORIGINALT', 'RFF+ACW:OTHER') }, { rawPayload: wire(true).replace('90002:ZZ+90001:ZZ', '90002:ZZ+99999:ZZ') }]) {
      expect((await validateRulebookMessageWithRegistry({ ...input(), ...change, ackSourceQualification: qualification })).ok).toBe(false)
    }
  })
  it('reads the original pointer from the actual persisted outbound ACK', async () => {
    const ack = { ...source(), id: ackId, direction: 'outbound', message_family: 'APERAK', message_code: 'APERAK', raw_payload: wire(true), related_message_id: 'caller-forged-pointer' } as EdielMessageRow
    io.rpc.mockResolvedValue({ data: { version: 1, ackMessage: { ...ack, related_message_id: sourceId }, sourceMessage: source(), sourceRulePackEvidence: evidence() }, error: null })
    const result = await validateRulebookMessageWithRegistry({ ...input(), messageRow: ack })
    expect(result.ok).toBe(true)
    expect(io.rpc).toHaveBeenCalledWith('ediel_read_outbound_ack_source_rule_pack_basis_v1', { p_company_id: company, p_environment: 'test', p_ack_message_id: ackId })
  })
  it('holds absent historical basis and an altered actual ACK without read-time capture', async () => {
    io.rpc.mockResolvedValue({ data: null, error: new Error('ediel_historical_rule_pack_basis_unavailable') })
    await expect(readSourceBoundOutboundAckRulePackEvidence({ companyId: company, environment: 'test', sourceMessageId: sourceId })).rejects.toThrow('historical_rule_pack')
    const ack = { ...source(), id: ackId, direction: 'outbound', message_family: 'APERAK', raw_payload: wire(true) } as EdielMessageRow
    io.rpc.mockResolvedValue({ data: { version: 1, ackMessage: { ...ack, raw_payload: 'altered-actual-wire' }, sourceMessage: source(), sourceRulePackEvidence: evidence() }, error: null })
    expect((await validateRulebookMessageWithRegistry({ ...input(), messageRow: ack })).ok).toBe(false)
    expect(io.rpc.mock.calls.every(([name]) => String(name).includes('read'))).toBe(true)
  })
})
