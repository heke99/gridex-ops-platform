import { expect, it, vi } from 'vitest'
import { s02PlanningFixture, s02PlanningPair, s02PlanningSecondSequence, type S02PlanningDefect } from './helpers/utiltsS02PlanningFixture'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { qualifyReceivedUtiltsStructure } from '@/lib/ediel/utilts/qualifyReceivedStructure'
import { buildUtiltsTransactionPersistencePayload } from '@/lib/ediel/utilts/transactionPersistence'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { validateUtilts } from '@/lib/ediel/utilts/validateUtilts'

it.each([true, false])('clean S02 owns two distinct forecast points/quantities and no billing contract, own first=%s', async ownFirst => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair('clean', ownFirst) })
  const runtime = runUtiltsRuntimeForMessage(source), policy = resolveCanonicalMessagePolicy(source)!
  expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  const qualified = await qualifyReceivedUtiltsStructure({ message: source, runtime, canonicalPolicy: policy })
  expect(qualified.hasInternalReview).toBe(false)
  const payload = buildUtiltsTransactionPersistencePayload({ messageCode: 'S02', transactions: runtime.facts.transactions,
    dispositions: runtime.transactionDispositions, rawSegments: runtime.facts.rawSegments, matches: [] })
  expect(payload.find(row => row.transactionId === 'S02-OWN')).toMatchObject({ disposition: 'accepted', seriesKind: 'forecast',
    externalMeteringPointId: '735999260731000007', quantities: [{ qualifier: '135', value: 111 }] })
  expect(payload.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted', seriesKind: 'forecast',
    externalMeteringPointId: '735999888000001014', quantities: [{ qualifier: '135', value: 222 }] })
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime, policy, matches: [], dataRequest: null,
    fallback: { customerId: null, siteId: null, meteringPointId: null, gridOwnerId: null }, allowConsumption: false })
  expect(contracts).toHaveLength(2)
  expect(contracts).toMatchObject([{ observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } },
    { observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' } }])
})

const cases = (['missing-point', 'missing-quantity', 'missing-both'] as const).flatMap(defect => [true, false].map(ownFirst => ({ defect, ownFirst })))
it.each(cases)('S02 $defect is its own guide rejection beside a clean sibling, own first=$ownFirst', async ({ defect, ownFirst }) => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair(defect, ownFirst) })
  const runtime = runUtiltsRuntimeForMessage(source), policy = resolveCanonicalMessagePolicy(source)!
  const qualified = await qualifyReceivedUtiltsStructure({ message: source, runtime, canonicalPolicy: policy })
  expect(runtime.validation.syntaxOk).toBe(true)
  expect(qualified.hasInternalReview).toBe(false)
  expect(qualified.runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN'))
    .toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  expect(qualified.runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING'))
    .toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak' })
  const fields: Record<S02PlanningDefect, string[]> = { clean: [], 'missing-point': ['209'], 'missing-quantity': ['515'], 'missing-both': ['209', '515'] }
  for (const field of fields[defect]) expect(runtime.validation.issues).toContainEqual(expect.objectContaining({
    kind: 'application', aperakFieldCode: field, referenceNumber: 'S02-OWN', lineItemReference: 'S02-OWN' }))
})

it('a real zero forecast remains an own QTY135 value', () => {
  const transactions = s02PlanningPair('clean', true).map(row => row.reference === 'S02-OWN' ? { ...row, quantity: 0 } : row)
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions }), runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.facts.transactions.find(row => row.transactionId === 'S02-OWN')?.quantities).toMatchObject([{ qualifier: '135', value: 0 }])
})

it.each(['wrong-qualifier', 'before-sequence'] as const)('S02 %s quantity cannot fill its own required observation QTY135', defect => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair('clean', true) })
  source.raw_payload = source.raw_payload!.replace("SEQ++1'\nQTY+135:111'", defect === 'wrong-qualifier'
    ? "SEQ++1'\nQTY+136:111'" : "QTY+135:111'\nSEQ++1'")
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.validation.syntaxOk).toBe(true)
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN')).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak' })
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ aperakFieldCode: '515', referenceNumber: 'S02-OWN' }))
})

it('S02 agency89 guide syntax retains an internal hold when physical point authority is unavailable', async () => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: [s02PlanningPair('clean', true)[0]] })
  source.raw_payload = source.raw_payload!.replace('735999260731000007::9', '735999260731000007::89')
  const runtime = runUtiltsRuntimeForMessage(source), policy = resolveCanonicalMessagePolicy(source)!
  expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  const qualified = await qualifyReceivedUtiltsStructure({ message: source, runtime, canonicalPolicy: policy })
  expect(qualified.hasInternalReview).toBe(true)
  expect(qualified.runtime.transactionDispositions).toMatchObject([{ disposition: 'internal_review', responseType: 'none' }])
})

it.each([null, '23-DDQ-E66-S'])('clean physical S02 outranks absent/stale row application reference %s', applicationReference => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair('clean', true) })
  source.application_reference = applicationReference
  expect(runUtiltsRuntimeForMessage(source).validation.ok).toBe(true)
})

it.each(['E5SE9X', 'E5SE4A'])('clean physical S02 outranks stale row association %s at both guide boundaries', association => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair('clean', true) })
  source.message_version = association
  expect(runUtiltsRuntimeForMessage(source).validation.ok).toBe(true)
})

it('the actual raw UTILTS validator accepts clean S02 without row policy metadata', () => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair('clean', true) })
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T20:00:00Z'))
  try { expect(validateUtilts(source.raw_payload!).ok).toBe(true) } finally { vi.useRealTimers() }
})

it('missing canonical physical membership cannot erase existing mandatory guide refusals', () => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: [s02PlanningPair('missing-both', true)[0]] })
  source.raw_payload = source.raw_payload!.replace('UNH+1+UTILTS:', 'UNH+1+PRODAT:')
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.facts.utiltsObservedTransactions).toEqual([])
  expect(runtime.validation.ok).toBe(false)
  expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
})

it('unsupported physical association remains a structured guide refusal', () => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair('clean', true) })
  source.raw_payload = source.raw_payload!.replace('E5SE5A', 'E5SE9X')
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.validation.ok).toBe(false)
  expect(runtime.transactionDispositions.every(row => row.disposition === 'guide_rejected')).toBe(true)
})

it.each([null, 333])('own second monthly SEQ requires its own QTY135=%s, independent of first quantity and sibling', quantity => {
  const source = s02PlanningFixture({ company: 's02-synthetic', transactions: s02PlanningPair('clean', true) })
  source.raw_payload = s02PlanningSecondSequence(source.raw_payload!, quantity)
  const runtime = runUtiltsRuntimeForMessage(source)
  expect(runtime.validation.syntaxOk).toBe(true)
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN')).toMatchObject({
    disposition: quantity === null ? 'guide_rejected' : 'accepted', responseType: quantity === null ? 'negative_aperak' : 'positive_aperak' })
  expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')).toMatchObject({ disposition: 'accepted', responseType: 'positive_aperak' })
  if (quantity === null) expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ aperakFieldCode: '515', referenceNumber: 'S02-OWN' }))
  else expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
  expect(runtime.ackPlan.utiltsErrCodes).toEqual([])
})
