// masterplan: U-03, AT-U-03
import { beforeEach, expect, it, vi } from 'vitest'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'
import { applyUtiltsTestAckPlanOverride } from '@/lib/ediel/testing/utiltsAckOverrides'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'
import { decideUtiltsResponse } from '@/lib/ediel/decisionEngine'
import { buildAckDraftForSource } from '@/lib/ediel/ack'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'

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
    .replace("DTM+324:202607010000202607010015:719'", "DTM+735:?+0200:406'\nDTM+324:202607010000202607010015:719'")
  const result = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(result.ackPlan.utiltsHeaderRejection?.applicationErrors).toMatchObject([{ fieldCode: '206', ercCode: '41' }])
  expect(probe.count).toBe(0)
})

function messageWithHeaderOffsets(offsets: readonly string[]) {
  const message = energyHandoffMessage('2026-10-01')
  message.sender_ediel_id = '91100'
  message.receiver_ediel_id = '21660'
  const declarations = offsets.map(offset => `DTM+735:${offset}'`).join('\n')
  message.raw_payload = recountEdifactUnt(message.raw_payload!.replace("DTM+735:?+0200:406'", declarations))
  return message
}

const matchedScope = { customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner' }
const billingContext = {
  fallback: matchedScope, allowConsumption: true,
  dataRequest: { id: 'billing-request', request_scope: 'billing_underlay' } as GridOwnerDataRequestRow,
  matches: [{ ...matchedScope, transactionReference: 'GRIDEX2607E66001',
    externalMeteringPointId: '735999260731000007', externalGridAreaId: 'TES', matchStatus: 'matched' as const }],
}

it.each([
  { offsets: ['?+0100:406', '?+0200:406'], invalidValue: '+0200' },
  { offsets: ['?+0200:406', '?+0100:406'], invalidValue: '+0100' },
  { offsets: ['?+0100:406', '?+0100:405'], invalidValue: '405' },
  { offsets: ['?+0100:406', '?+0200:406', '?+0100:405'], invalidValue: '+0200' },
])('rejects the first invalid field 206 occurrence in $offsets before any consumption', async ({ offsets, invalidValue }) => {
  const message = messageWithHeaderOffsets(offsets)
  // DTM+137 at 18:11 falls on opposite sides of receipt under the two offsets.
  // A rejected offset must not also create an order-dependent field 205 error.
  message.message_received_at = '2026-10-01T16:40:00Z'
  const canonicalPolicy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
    referenceDate: '2026-10-01', applicationReference: message.application_reference, mode: 'parse' })!
  const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy })
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
  expect(runtime.validation.issues.map(issue => issue.aperakFieldCode)).toEqual(['206'])
  expect(runtime.ackPlan.utiltsHeaderRejection?.applicationErrors).toMatchObject([
    { fieldCode: '206', ercCode: '42', text: `INCORRECT DATA ${invalidValue}` },
  ])
  expect(runtime.ackPlan).toMatchObject({ shouldSendAperak: true, aperakOutcome: 'negative', shouldSendUtiltsErr: false })
  expect(probe.count).toBe(0)

  const contracts = await prepareUtiltsConsumptionContracts({ message, runtime, policy: canonicalPolicy, ...billingContext })
  expect(contracts).toMatchObject([{ observations: [], metering: { capability: 'skip' },
    billing: { capability: 'skip' }, billingContributionOrdinals: [] }])
  const decision = decideUtiltsResponse({ message, testCaseCode: 'UE1' })
  expect(decision).toMatchObject({ kind: 'ack', ackFamily: 'APERAK', outcome: 'negative', utiltsHeaderRejected: true })
  const draft = buildAckDraftForSource({ sourceMessage: message, ackFamily: 'APERAK', outcome: 'negative',
    applicationErrors: decision.applicationErrors, utiltsHeaderRejected: decision.utiltsHeaderRejected })
  expect(draft.rawPayload).toContain('206')
  expect(draft.rawPayload).not.toContain('RFF+ACW:')
})

it.each([
  { offsets: ['?+0100:406'], start: '2026-06-30T23:00:00.000Z' },
  { offsets: ['?+0200:406'], start: '2026-06-30T22:00:00.000Z' },
  { offsets: ['?+0100:406', '?+0100:406'], start: '2026-06-30T23:00:00.000Z' },
])('keeps the unambiguous physical basis of $offsets', async ({ offsets, start }) => {
  const message = messageWithHeaderOffsets(offsets)
  const canonicalPolicy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
    referenceDate: '2026-10-01', applicationReference: message.application_reference, mode: 'parse' })!
  const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy })
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
  expect(runtime.normalizedPayload.periodStart).toBe(start)
  expect(runtime.validation.issues).toEqual([])
  const contracts = await prepareUtiltsConsumptionContracts({ message, runtime, policy: canonicalPolicy, ...billingContext })
  expect(contracts).toMatchObject([{ observations: [{ periodStart: start }], metering: { capability: 'write' },
    billing: { capability: 'write' }, billingContributionOrdinals: [0] }])
})

it('keeps physical syntax rejection first when header offsets disagree', () => {
  const message = messageWithHeaderOffsets(['?+0100:406', '?+0200:406'])
  message.raw_payload = message.raw_payload!.replace(/UNT\+\d+\+/, 'UNT+999+')
  const runtime = runUtiltsRuntimeForMessage(message, { referenceDate: '2026-10-01' })
  expect(runtime.validation.classification).toBe('syntax_rejected')
  expect(runtime.validation.issues.every(issue => issue.kind === 'syntax')).toBe(true)
  expect(runtime.ackPlan).toMatchObject({ contrlOutcome: 'negative', shouldSendAperak: false, shouldSendUtiltsErr: false })
})
