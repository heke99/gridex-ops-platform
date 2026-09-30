import { beforeEach, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'
import { applyUtiltsTestAckPlanOverride } from '@/lib/ediel/testing/utiltsAckOverrides'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'
import { decideUtiltsResponse } from '@/lib/ediel/decisionEngine'
import { buildAckDraftForSource } from '@/lib/ediel/ack'

const probe = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/lib/ediel/utilts/resolution', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ediel/utilts/resolution')>()
  return {
    ...original,
    expectedObservationCountForResolution: (...args: Parameters<typeof original.expectedObservationCountForResolution>) => {
      probe.count += 1
      return original.expectedObservationCountForResolution(...args)
    },
  }
})

beforeEach(() => { probe.count = 0 })

function runtime(agency: string) {
  const message = energyHandoffMessage('2026-10-01')
  message.raw_payload = message.raw_payload!.replace('LOC+172+735999260731000007::9', `LOC+175+735999260731000007::${agency}`)
  const canonicalPolicy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
    referenceDate: '2026-10-01', applicationReference: message.application_reference, mode: 'parse' })
  return runUtiltsRuntimeForMessage(message, { canonicalPolicy })
}

it('does not execute the functional interval-count check for a guide-rejected E66 IDE', () => {
  const rejected = runtime('260')
  expect(rejected.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(rejected.ackPlan.utiltsErrCodes).toEqual([])
  expect(probe.count).toBe(0)
  const accepted = runtime('9')
  expect(accepted.transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
  expect(probe.count).toBeGreaterThan(0)
})

it('runs functional checks only for the valid sibling in a mixed E66 message', () => {
  runtime('9')
  const singleEligibleCount = probe.count
  probe.count = 0

  const message = energyHandoffMessage('2026-10-01')
  const lines = message.raw_payload!.split('\n')
  const start = lines.findIndex(line => line.startsWith('IDE+24+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const first = lines.slice(start, end).map(line => line.replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000007::260'))
  const second = lines.slice(start, end).map(line => line.replace('GRIDEX2607E66001', 'GRIDEX2607E66002'))
  lines.splice(start, end - start, ...first, ...second)
  const unt = lines.findIndex(line => line.startsWith('UNT+'))
  const unh = lines.findIndex(line => line.startsWith('UNH+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  message.raw_payload = lines.join('\n')
  const policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
    referenceDate: '2026-10-01', applicationReference: message.application_reference, mode: 'parse' })
  const result = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy })
  expect(probe.count).toBe(singleEligibleCount)
  expect(result.transactionDispositions).toMatchObject([
    { transactionId: 'GRIDEX2607E66001', disposition: 'guide_rejected', responseType: 'negative_aperak' },
    { transactionId: 'GRIDEX2607E66002', disposition: 'accepted', responseType: 'positive_aperak' },
  ])
  expect(result.ackPlan.aperakApplicationErrors).toEqual(expect.arrayContaining([
    expect.objectContaining({ fieldCode: '533', referenceNumber: 'GRIDEX2607E66001' }),
  ]))
  const persisted = buildUtiltsTransactionPersistencePayload({ messageCode: 'E66', transactions: result.facts.transactions,
    dispositions: result.transactionDispositions, matches: [] })
  expect(persisted.map(item => item.disposition)).toEqual(['guide_rejected', 'accepted'])
  expect(result.ackPlan.utiltsErrCodes).toEqual([])
})

it('does not run functional interval checks when the message header fails its guide', () => {
  const message = energyHandoffMessage('2026-10-01')
  message.raw_payload = message.raw_payload!.replace('GRIDEX2607E66MSG001+9+AB', 'GRIDEX2607E66MSG001+9+XX')
  const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(result.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(result.ackPlan.utiltsErrCodes).toEqual([])
  expect(probe.count).toBe(0)
})

it.each([
  ['UNT count', (raw: string) => raw.replace(/UNT\+\d+\+/, 'UNT+999+')],
  ['UNH/UNT reference', (raw: string) => raw.replace(/(UNT\+\d+\+)1'/, "$1OTHER'")],
] as const)('rejects physical %s before guide or functional checks', (_name, corrupt) => {
  const message = energyHandoffMessage('2026-10-01')
  message.raw_payload = corrupt(message.raw_payload!)
  const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(result.validation.classification).toBe('syntax_rejected')
  expect(result.validation.issues.every(issue => issue.kind === 'syntax')).toBe(true)
  expect(result.transactionDispositions).toMatchObject([{ disposition: 'syntax_rejected', responseType: 'negative_contrl' }])
  expect(result.ackPlan).toMatchObject({ contrlOutcome: 'negative', shouldSendAperak: false, shouldSendUtiltsErr: false })
  expect(probe.count).toBe(0)
})

it('re-evaluates a valid wire despite cached failed status', () => {
  const message = energyHandoffMessage('2026-10-01')
  message.status = 'failed'
  message.syntax_check_status = 'failed'
  const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(result.validation.syntaxOk).toBe(true)
  expect(result.transactionDispositions[0].disposition).toBe('accepted')
})

it.each(['UE1', 'UE2', 'U3.1.1', 'U3.1.2', 'U3.2.1', 'U3.2.2'])('keeps syntax and physical header gates ahead of %s test overrides', testCaseCode => {
  for (const defect of ['syntax', 'header'] as const) {
    const message = energyHandoffMessage('2026-10-01')
    message.raw_payload = defect === 'syntax'
      ? message.raw_payload!.replace(/UNT\+\d+\+/, 'UNT+999+')
      : recountEdifactUnt(message.raw_payload!.replace("DTM+735:?+0200:406'", ''))
    const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
    expect(applyUtiltsTestAckPlanOverride({ runtime, testCaseCode })).toEqual(runtime.ackPlan)
  }
})

it('preserves qualified header provenance through later IDE guide rebuilds', () => {
  const message = energyHandoffMessage('2026-10-01')
  message.raw_payload = recountEdifactUnt(message.raw_payload!.replace("DTM+735:?+0200:406'", '')
    .replace('IDE+24+', 'IDE+25+'))
  const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(result.ackPlan.utiltsHeaderRejection?.applicationErrors).toMatchObject([{ fieldCode: '206', ercCode: '41' }])
  expect(result.ackPlan.aperakApplicationErrors.some(error => error.fieldCode === '505')).toBe(true)
  expect(probe.count).toBe(0)
})

it('rejects malformed inbound ERR syntax instead of applying its positive ACK special case', () => {
  const message = energyHandoffMessage('2026-10-01')
  message.message_code = 'ERR'
  message.raw_payload = message.raw_payload!.replace('BGM+E66::260', 'BGM+ERR::260').replace(/UNT\+\d+\+/, 'UNT+999+')
  expect(runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' }).ackPlan)
    .toMatchObject({ contrlOutcome: 'negative', shouldSendAperak: false, shouldSendUtiltsErr: false })
  expect(probe.count).toBe(0)
})

it('projects canonical syntax and header decisions through the generic decision/draft path', () => {
  for (const defect of ['syntax', 'header'] as const) {
    const message = energyHandoffMessage('2026-10-01')
    message.sender_ediel_id = '91100'; message.receiver_ediel_id = '21660'
    message.raw_payload = defect === 'syntax' ? message.raw_payload!.replace(/UNT\+\d+\+/, 'UNT+999+')
      : recountEdifactUnt(message.raw_payload!.replace("DTM+735:?+0200:406'", ''))
    const decision = decideUtiltsResponse({ message, testCaseCode: 'UE1' })
    expect(decision).toMatchObject({ kind: 'ack', ackFamily: defect === 'syntax' ? 'CONTRL' : 'APERAK', outcome: 'negative' })
    if (defect === 'header') {
      expect(decision.utiltsHeaderRejected).toBe(true)
      expect(decision.applicationErrors).toMatchObject([{ fieldCode: '206', ercCode: '41' }])
      const draft = buildAckDraftForSource({ sourceMessage: message, ackFamily: 'APERAK', outcome: 'negative',
        applicationErrors: decision.applicationErrors, utiltsHeaderRejected: decision.utiltsHeaderRejected })
      expect(draft.rawPayload).not.toContain('RFF+ACW:')
    }
  }
})

it('does not borrow a misplaced transaction timezone as the message header', () => {
  const message = energyHandoffMessage('2026-10-01')
  message.raw_payload = message.raw_payload!.replace("DTM+735:?+0200:406'\n", '')
    .replace("IDE+24+GRIDEX2607E66001'", "IDE+24+GRIDEX2607E66001'\nDTM+735:?+0200:406'")
  const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(result.ackPlan.utiltsHeaderRejection?.applicationErrors).toMatchObject([{ fieldCode: '206', ercCode: '41' }])
  expect(probe.count).toBe(0)
})
