// masterplan: GOV-03, AT-GOV-03
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ rpc: vi.fn(), rulePack: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: io.rulePack }))
import { readSourceBoundOutboundAckRulePackEvidence } from '@/lib/ediel/core/ackSourceRulePackEvidence'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { selectRulebookVersion } from '@/lib/ediel/rulebook/versionSelector'

const company = '10000000-0000-4000-8000-000000000001', sourceId = '20000000-0000-4000-8000-000000000001'
const ackBody = ['BGM+312+ACKDOC+9', 'DTM+137:202609301200:203', 'DTM+735:?+0100:406', 'DOC+E66::260+ORIGINALDOC', 'NAD+MS+12345:SVK:260', 'NAD+MR+54321:SVK:260', 'ERC+100::260', 'FTX+AAO+++OK', 'RFF+DM:ACKT', 'RFF+ACW:ORIGINALT']
const ack = (token: string) => EdifactEnvelopeCodec.encode({ sender: '90002', receiver: '90001', interchangeReference: 'ACKI', applicationReference: '23-DDQ-E66-T', environment: 'test', acknowledgementRequest: true,
  messages: [{ messageReference: 'ACKM', messageTypeToken: token, businessSegments: ackBody }] })
const utiltsOriginal = () => EdifactEnvelopeCodec.encode({ sender: '90001', receiver: '90002', interchangeReference: 'ORIGINALI', applicationReference: '23-DDQ-E66-T', environment: 'test', acknowledgementRequest: true,
  messages: [{ messageReference: 'ORIGINALM', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments: ['BGM+E66+ORIGINALDOC+9', 'NAD+MS+54321:SVK:260', 'NAD+MR+12345:SVK:260', 'IDE+24+ORIGINALT'] }] })
const source = () => ({ id: sourceId, company_id: company, environment: 'test', direction: 'inbound', message_standard: 'edifact', message_family: 'UTILTS', message_code: 'E66', raw_payload: utiltsOriginal(), parsed_payload: {} }) as unknown as EdielMessageRow
const evidence = () => ({ rulePackId: '40000000-0000-4000-8000-000000000001', messageProfileId: '50000000-0000-4000-8000-000000000001', profileKey: 'DB:ACTUAL:SOURCE', version: 'original-opaque-version', sourceHash: 'a'.repeat(64), snapshot: { profileKey: 'DB:ACTUAL:SOURCE', profileVersionId: '50000000-0000-4000-8000-000000000001', version: 'original-opaque-version', checksum: 'a'.repeat(64), rulePack: { id: '40000000-0000-4000-8000-000000000001', source_hash: 'a'.repeat(64), family: 'UTILTS', guide_version: '25-A-3', guide_revision: '3' }, messageProfile: { id: '50000000-0000-4000-8000-000000000001', rule_pack_id: '40000000-0000-4000-8000-000000000001' }, guideSources: [] } })
const input = (raw: string) => ({ family: 'APERAK', code: 'APERAK', direction: 'outbound' as const, environment: 'test' as const, companyId: company, rawPayload: raw, mode: 'send' as const })
const qualification = () => readSourceBoundOutboundAckRulePackEvidence({ companyId: company, environment: 'test', sourceMessageId: sourceId })

beforeEach(() => { io.rpc.mockReset(); io.rulePack.mockReset(); io.rpc.mockResolvedValue({ data: { version: 1, sourceMessage: source(), sourceRulePackEvidence: evidence() }, error: null }) })

describe('GOV-03: APERAK profile follows the correlated original family', () => {
  it('on_pass: a UTILTS original selects the U-family APERAK (D:04A E5SE5A)', async () => {
    const result = await validateRulebookMessageWithRegistry({ ...input(ack('APERAK:D:04A:UN:E5SE5A')), ackSourceQualification: await qualification() })
    expect(result.ok).toBe(true)
  })
  it('on_failure: a P-family APERAK (E2SE6A) for a UTILTS original is a mixed wire version and stops', async () => {
    const result = await validateRulebookMessageWithRegistry({ ...input(ack('APERAK:D:96A:UN:E2SE6A')), ackSourceQualification: await qualification() })
    expect(result.ok).toBe(false)
    expect(result.issues.some(issue => issue.code === 'ACK_APERAK_PROFILE_INVALID')).toBe(true)
  })
  it('prohibited: no generic APERAK 16.B profile is accepted for EL', async () => {
    for (const token of ['APERAK:D:96A:UN:16B', 'APERAK:D:96A:UN:E2SE16B', 'APERAK:D:04A:UN:16B']) {
      const result = await validateRulebookMessageWithRegistry({ ...input(ack(token)), ackSourceQualification: await qualification() })
      expect(result.ok, token).toBe(false)
      expect(result.issues.some(issue => issue.code === 'CANONICAL_POLICY_VALIDATION_FAILED'), token).toBe(true)
    }
  })
  it('prohibited: a caller-declared source family cannot override the correlated original', async () => {
    const result = await validateRulebookMessageWithRegistry({ ...input(ack('APERAK:D:96A:UN:E2SE6A')), parsedPayload: { canonicalSourceMessageFamily: 'PRODAT' }, ackSourceQualification: await qualification() })
    expect(result.ok).toBe(false)
    expect(result.issues.some(issue => issue.code === 'ACK_APERAK_PROFILE_INVALID')).toBe(true)
  })
  it('on_pass: a PRODAT original selects the P-family APERAK profile; a U-family APERAK for it is rejected', async () => {
    const prodatOriginal = EdifactEnvelopeCodec.encode({ sender: '90001', receiver: '90002', interchangeReference: 'ORIGINALI', applicationReference: '23-DDQ-PRODAT', environment: 'test', acknowledgementRequest: true,
      messages: [{ messageReference: 'ORIGINALM', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: ['BGM+Z03+ORIGINALDOC+9+NA', 'NAD+MS+54321:SVK:260', 'NAD+MR+12345:SVK:260', 'IDE+24+ORIGINALT'] }] })
    const ev = evidence()
    const prodatEvidence = { ...ev, snapshot: { ...ev.snapshot, rulePack: { ...ev.snapshot.rulePack, family: 'PRODAT', guide_version: '26.A', guide_revision: '3' } } }
    io.rpc.mockResolvedValue({ data: { version: 1, sourceMessage: { ...source(), message_family: 'PRODAT', message_code: 'Z03', raw_payload: prodatOriginal }, sourceRulePackEvidence: prodatEvidence }, error: null })
    const prodatAck = (token: string) => EdifactEnvelopeCodec.encode({ sender: '90002', receiver: '90001', interchangeReference: 'ACKI', applicationReference: '23-DDQ-PRODAT', environment: 'test', acknowledgementRequest: true, messages: [{ messageReference: 'ACKM', messageTypeToken: token, businessSegments: ackBody }] })
    const pFamily = await validateRulebookMessageWithRegistry({ ...input(prodatAck('APERAK:D:96A:UN:E2SE6A')), ackSourceQualification: await qualification() })
    // The P-family profile is selected (remaining issues are this synthetic body's PRODAT field rules).
    expect(pFamily.issues.some(issue => issue.code === 'ACK_APERAK_PROFILE_INVALID')).toBe(false)
    expect(pFamily.issues.some(issue => issue.code.startsWith('ACK_PRODAT_'))).toBe(true)
    const uFamily = await validateRulebookMessageWithRegistry({ ...input(prodatAck('APERAK:D:04A:UN:E5SE5A')), ackSourceQualification: await qualification() })
    expect(uFamily.ok).toBe(false)
    expect(uFamily.issues.some(issue => issue.code === 'ACK_APERAK_PROFILE_INVALID')).toBe(true)
  })
  it('on_failure: an outbound APERAK without a correlated original fails closed instead of inferring its family', async () => {
    const result = await validateRulebookMessageWithRegistry(input(ack('APERAK:D:04A:UN:E5SE5A')))
    expect(result.ok).toBe(false)
  })
  it('guide selection: the APERAK profile is chosen from the source family, never a generic or 16.B revision', () => {
    const p = selectRulebookVersion({ family: 'APERAK', referenceDate: '2026-10-04', sourceMessageFamily: 'PRODAT' })
    const u = selectRulebookVersion({ family: 'APERAK', referenceDate: '2026-10-04', sourceMessageFamily: 'UTILTS' })
    expect(p.messageTypeToken).toBe('APERAK:D:96A:UN:E2SE6A')
    expect(u.messageTypeToken).toBe('APERAK:D:04A:UN:E5SE5A')
    for (const selection of [p, u]) expect(selection.acceptedVersions.join(',')).not.toMatch(/16-?B/i)
    expect(() => selectRulebookVersion({ family: 'APERAK', referenceDate: '2026-10-04' })).toThrow('ediel_aperak_source_family_required')
    expect(() => selectRulebookVersion({ family: 'APERAK', referenceDate: '2026-10-04', sourceMessageFamily: 'GAS' })).toThrow('ediel_aperak_source_family_required')
  })
})
