import { describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import * as utiltsRuntime from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'

const mocks = vi.hoisted(() => ({ getMessage: vi.fn(), processActual: vi.fn() }))
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
