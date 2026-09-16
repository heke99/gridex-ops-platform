import { describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import * as utiltsRuntime from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalRuntimeDecision, resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'

const mocks = vi.hoisted(() => ({ getMessage: vi.fn(), processActual: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: mocks.getMessage }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-1', () => ({ resolveUtiltsRuntimeTestCaseCode: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/ediel/flows/utiltsDataRequest.part-2', () => ({ processInboundUtiltsMessage: mocks.processActual }))

const VALID_MONTHLY_E66 = [
  "UNA:+.? '",
  "UNB+UNOC:3+91100:ZZ+21660:ZZ+260831:1811+260831181101++23-DDQ-E66-S++1'",
  "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
  "BGM+E66::260+GRIDEX2607E66MSG001+9+AB'",
  "DTM+137:202608311811:203'",
  "DTM+735:?+0200:406'",
  "MKS+23+E02::260'",
  "NAD+MS+91100:SVK:260'",
  "NAD+MR+21660:SVK:260'",
  "NAD+DDQ'",
  "IDE+24+GRIDEX2607E66001'",
  "LOC+172+735999260731000007::9'",
  "LOC+239+TES:SVK:260'",
  "LIN+++8716867000030:::9'",
  "DTM+324:202607010000202608010000:719'",
  "DTM+597:202608010000:203'",
  "DTM+354:1:802'",
  "STS+7++E88::260'",
  "MEA+AAZ++KWH'",
  "CCI+++E12::260'",
  "CAV+E17::260'",
  "SEQ++1'",
  "RFF+AES:101'",
  "RFF+MG:M-GRIDEX-2607-01'",
  "QTY+220:10000'",
  "DTM+597:202607010000:203'",
  "CCI+++E22::260'",
  "CAV+E27::260'",
  "SEQ++2'",
  "RFF+AES:101'",
  "QTY+220:11000'",
  "DTM+597:202608010000:203'",
  "CCI+++E22::260'",
  "CAV+E27::260'",
  "SEQ++3'",
  "QTY+136:1000'",
  "UNT+35+1'",
  "UNZ+1+260831181101'",
].join('\n')

function message(documentDate: string, receivedDate: string): EdielMessageRow {
  return {
    id: 'retained-utilts-decision', company_id: 'tenant-a',
    message_family: 'UTILTS', message_code: 'E66', message_standard: 'edifact',
    direction: 'inbound', environment: 'test', message_version: 'E5SE5A',
    application_reference: '23-DDQ-E66-S',
    raw_payload: VALID_MONTHLY_E66.replace('202608311811:203', `${documentDate.replaceAll('-', '')}1811:203`).replace('QTY+136:1000', 'QTY+136:500'),
    message_received_at: `${receivedDate}T12:00:00Z`, created_at: `${receivedDate}T12:00:00Z`,
    metering_point_id: 'meter-a', business_match_status: 'matched',
    validation_report: null,
  } as unknown as EdielMessageRow
}

describe('UTILTS decision reuse across document and receipt dates', () => {
  it.each([
    ['2026-09-30', '2026-10-01', true],
    ['2026-10-01', '2026-09-30', false],
  ])('keeps policy date %s when receipt date is %s', (documentDate, receivedDate, expectsE19) => {
    const decision = resolveCanonicalRuntimeDecision(message(documentDate, receivedDate))
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.policy?.referenceDate).toBe(documentDate)
    expect(decision.issues.some(issue => issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH')).toBe(expectsE19)
  })

  it.each([
    ['2026-09-30', '2026-10-01', true],
    ['2026-10-01', '2026-09-30', false],
  ])('uses the canonical date for direct runtime calls: document %s, receipt %s', (documentDate, receivedDate, expectsE19) => {
    const runtime = utiltsRuntime.runUtiltsRuntimeForMessage(message(documentDate, receivedDate))
    expect(runtime.validation.issues.some(issue => issue.code === 'UTILTS_E66_METER_READING_ENERGY_MISMATCH')).toBe(expectsE19)
  })

  it('rejects an incomplete retained decision instead of selecting a new processability profile', () => {
    const source = message('2026-09-30', '2026-10-01')
    const policy = resolveCanonicalRuntimeDecision(source).policy!
    expect(() => utiltsRuntime.runUtiltsRuntimeForMessage(source, { canonicalPolicy: { ...policy, utiltsProcessability: null } })).toThrow('utilts_runtime_policy_context_mismatch')
  })

  it('passes the already selected policy to actual metering processing', async () => {
    const source = message('2026-09-30', '2026-10-01')
    const decision = resolveCanonicalRuntimeDecision(source)
    mocks.getMessage.mockResolvedValue(source)
    mocks.processActual.mockResolvedValue({ message: source })
    await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: 'operator', edielMessageId: source.id, canonicalPolicy: decision.policy! })
    expect(mocks.processActual.mock.lastCall?.[0].canonicalPolicy).toBe(decision.policy)
  })

  it('derives a direct call from the same document-date authority', async () => {
    const source = message('2026-09-30', '2026-10-01')
    mocks.getMessage.mockResolvedValue(source)
    await processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: 'operator', edielMessageId: source.id })
    expect(mocks.processActual.mock.lastCall?.[0].canonicalPolicy.referenceDate).toBe('2026-09-30')
  })

  it('retains the selected policy on the non-billing branch', async () => {
    const source = { ...message('2026-09-30', '2026-10-01'), message_code: 'S02', metering_point_id: null }
    const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'S02', direction: 'inbound', referenceDate: '2026-09-30', applicationReference: '23-DDQ-S02-S', mode: 'parse' })
    mocks.getMessage.mockResolvedValue(source)
    const runtimeSpy = vi.spyOn(utiltsRuntime, 'runUtiltsRuntimeForMessage').mockImplementationOnce(() => { throw new Error('test-stop-before-non-billing-persistence') })
    try {
      await expect(processInboundUtiltsMessageByCanonicalPolicy({ actorUserId: 'operator', edielMessageId: source.id, canonicalPolicy: policy })).rejects.toThrow('test-stop-before-non-billing-persistence')
      expect(runtimeSpy.mock.lastCall?.[1]?.canonicalPolicy).toBe(policy)
    } finally {
      runtimeSpy.mockRestore()
    }
  })
})

// Database activation evidence is synthetic; protocol/policy/validator code is real.
function activationEvidence(revision: '3' | '4') {
  const version = `25-A-${revision}`
  return {
    rule_pack_id: '11111111-1111-4111-8111-111111111111',
    message_profile_id: '22222222-2222-4222-8222-222222222222',
    market: 'electricity', family: 'UTILTS', guide_version: version, guide_revision: revision,
    unh_association_code: 'E5SE5A', valid_from: revision === '3' ? '2025-06-01' : '2026-10-01',
    valid_to: revision === '3' ? '2026-09-30' : null,
    source_document: `UTILTS ${version}`, source_hash: 'a'.repeat(64),
    field_matrix_version: version, profile_key: `UTILTS:E66:E5SE5A:${revision}`,
    business_process: 'metering_values', phase: null,
    profile: { family: 'UTILTS', messageCode: 'E66', guideVersion: version, guideRevision: revision },
    parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
  }
}

describe('UTILTS selected reference survives registry verification', () => {
  it.each([
    ['2026-09-30', '2026-10-01', '3'],
    ['2026-10-01', '2026-09-30', '4'],
  ] as const)('runtime preserves document date %s and selected reference when receipt is %s', async (date, received, revision) => {
    mocks.rpc.mockReset().mockResolvedValue({ data: [activationEvidence(revision)], error: null })
    const source = message(date, received)
    const result = await resolveCanonicalRuntimeDecisionWithRegistry(source)
    expect(result.syntaxDecision).toBe('accepted')
    expect(result.policy?.referenceDate).toBe(date)
    expect(result.policy?.applicationReference).toBe('23-DDQ-E66-S')
    expect(result.issues.some(issue => issue.code === 'CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE')).toBe(false)
    expect(result.validationReport).toHaveProperty('rulePackEvidence.rulePackId', activationEvidence(revision).rule_pack_id)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_canonical_ediel_rule_pack', expect.objectContaining({ p_business_date: date, p_family: 'UTILTS' }))
  })

  it.each([['2026-09-30', '3'], ['2026-10-01', '4']] as const)('public validator retains E66 reference on %s', async (date, revision) => {
    mocks.rpc.mockReset().mockResolvedValue({ data: [activationEvidence(revision)], error: null })
    const source = message(date, date)
    const result = await validateRulebookMessageWithRegistry({
      family: 'UTILTS', code: 'E66', direction: 'inbound', mode: 'parse',
      businessDate: date, applicationReference: source.application_reference,
      rawPayload: source.raw_payload?.replace('QTY+136:500', 'QTY+136:1000'), version: 'E5SE5A',
    })
    expect(result.blocking).toBe(false)
    expect(result.fieldRuleSource).toBe('registry')
    expect(result.rulePackSnapshot?.profileVersionId).toBe(activationEvidence(revision).message_profile_id)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
})
