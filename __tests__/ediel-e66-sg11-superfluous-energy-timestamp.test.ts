import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import {
  diagnoseE66ObservationTimestamp,
  E66_SG11_TIMESTAMP_REVIEW,
  ignoredUtiltsEnergyTimestampIndices,
} from '@/lib/ediel/utilts/e66ObservationTimestampDiagnostic'
import { compareUtiltsStructure } from '@/lib/ediel/utilts/structuralComparison'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage, observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { comparisonInput, utiltsStructureWire } from './helpers/structuralComparisonFixtures'
import { recountEdifactUnt as reframe } from './helpers/recountEdifactUnt'

const cleanFixture = () => energyHandoffMessage('2026-11-18', '184d2bcf-1756-440e-ab5e-f17c8cac66a9')
const printed = "DTM+597:202607010000:203'\n"
const registration = 'DTM+597:202607010020:203'
const e66Policy = {family:'UTILTS',code:'E66',direction:'inbound',guide:{guideRevision:'25-A-5'}} as const

function evaluate(raw: string) {
  const template = cleanFixture()
  const id = '184d2bcf-1756-440e-ab5e-f17c8cac66b0'
  const payloadHash = createHash('sha256').update(raw).digest('hex')
  const message = { ...template, id, raw_payload: raw, execution_context_snapshot: { receivedUtiltsContext: {
    version: 1, contextOrigin: 'database_insert', sourceMessageId: id, companyId: template.company_id,
    environment: 'test', messageCode: 'E66', sourceReceivedAt: template.message_received_at!,
    capturedAt: template.message_received_at!, payloadHash,
  } } }
  const policy = resolveCanonicalMessagePolicy(message)!
  expect(policy.guide.guideRevision).toBe('25-A-5')
  const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy, holdSg11FormatReview: true })
  expect(createHash('sha256').update(message.raw_payload!).digest('hex')).toBe(payloadHash)
  return runtime
}

const clean = () => reframe(cleanFixture().raw_payload!.replace(printed, ''))

it.each(['202607010000:203', '202602310099:203', '20260701:204'])(
  'ignores the extra SG11 energy timestamp %s and keeps the ordinary positive plan',
  timestamp => {
    const raw = reframe(clean().replace("QTY+136:500'", `QTY+136:500'\nDTM+597:${timestamp}'`))
    const observed = evaluate(raw)
    const expected = evaluate(clean())
    expect(observed.facts.rawSegments).toContain(`DTM+597:${timestamp}`)
    expect(observed.validation.issues).toEqual(expected.validation.issues)
    expect(observed.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
    expect(observed.ackPlan).toEqual(expected.ackPlan)
    expect(observed.facts.transactions[0]).toMatchObject({
      registrationTime:'2026-07-01T00:20:00',
      deliveryPeriodStart:expected.facts.transactions[0].deliveryPeriodStart,
      deliveryPeriodEnd:expected.facts.transactions[0].deliveryPeriodEnd,
      quantities:expected.facts.transactions[0].quantities,
    })
  },
)

it('does not turn descending unused timestamps into a negative APERAK', () => {
  const two = clean().replace('202607010015:719', '202607010030:719').replace(registration, 'DTM+597:202607010040:203')
    .replace("STS+7++21::260'", "STS+7++21::260'\nSEQ++2'\nQTY+136:750'\nSTS+7++21::260'")
  const withUnused = two.replace("QTY+136:500'", "QTY+136:500'\nDTM+597:202607010015:203'")
    .replace("QTY+136:750'", "QTY+136:750'\nDTM+597:202607010000:203'")
  const expected = evaluate(reframe(two))
  const observed = evaluate(reframe(withUnused))
  expect(expected.transactionDispositions).toMatchObject([{ disposition:'accepted',responseType:'positive_aperak' }])
  expect(observed.transactionDispositions).toEqual(expected.transactionDispositions)
  expect(observed.ackPlan).toEqual(expected.ackPlan)
})

it('preserves genuine SG5 registration validation when the ignored field is present', () => {
  const raw = reframe(clean().replace(registration, 'DTM+597:202606300020:203')
    .replace("QTY+136:500'", "QTY+136:500'\nDTM+597:202602310099:203'"))
  const result = evaluate(raw)
  expect(result.transactionDispositions).toMatchObject([{disposition:'processability_rejected',responseType:'utilts_err'}])
  expect(result.validation.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code:'UTILTS_E66_DELIVERY_END_AFTER_REGISTRATION',utiltsErrCode:'E50' }),
  ]))
})

it('preserves genuine negative application validation', () => {
  const raw = reframe(clean().replace("QTY+136:500'", "QTY+136:oops'\nDTM+597:202602310099:203'"))
  const result = evaluate(raw)
  expect(result.transactionDispositions).toMatchObject([{disposition:'guide_rejected',responseType:'negative_aperak'}])
  expect(result.ackPlan).toMatchObject({shouldSendAperak:true,aperakOutcome:'negative'})
})

it('preserves genuine framing validation on the original wire', () => {
  const raw = clean().replace("QTY+136:500'", "QTY+136:500'\nDTM+597:202602310099:203'")
  expect(evaluate(raw).ackPlan).toMatchObject({contrlOutcome:'negative',shouldSendAperak:false,shouldSendUtiltsErr:false})
})

it('preserves the separate diagnostic for another quantity and allows 530a and 530b', () => {
  const raw = reframe(clean().replace("QTY+136:500'", "QTY+136:500'\nQTY+135:3'\nDTM+597:202607010000:203'"))
  expect(diagnoseE66ObservationTimestamp(raw, e66Policy)).toMatchObject([{code:E66_SG11_TIMESTAMP_REVIEW,quantity:'135'}])
  for (const quantity of ['220','42']) {
    expect(diagnoseE66ObservationTimestamp(raw.replace('QTY+135', `QTY+${quantity}`), e66Policy)).toEqual([])
  }
})

it('does not borrow an unusable future 136 timestamp for a preceding 530a in the same SEQ', () => {
  const original = observationHandoffMessage('2026-11-18').raw_payload!
  const contiguous = original.replace('QTY+220:11000', 'QTY+220:10500').replace("SEQ++3'\nQTY+136:500'", "QTY+136:500'")
  const expected = evaluate(reframe(contiguous))
  const actual = evaluate(reframe(contiguous.replace("QTY+136:500'", "QTY+136:500'\nDTM+597:202608020000:203'")))
  expect(expected.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  expect(actual.transactionDispositions).toEqual(expected.transactionDispositions)
  expect(actual.ackPlan).toEqual(expected.ackPlan)
})

it('compares the real 530a even when a sibling QTY136 has a stray timestamp in the same SEQ', () => {
  const clean = utiltsStructureWire().replace("SEQ++5'\nQTY+136:10'", "QTY+136:10'")
  const wire = reframe(clean.replace("QTY+136:10'", "QTY+136:10'\nDTM+597:202602310099:203'"))
  const ignored = ignoredUtiltsEnergyTimestampIndices(wire, e66Policy)
  expect(ignored?.size).toBe(1)
  expect(compareUtiltsStructure(comparisonInput(reframe(clean)))).toMatchObject({status:'matched'})
  expect(compareUtiltsStructure({...comparisonInput(wire),ignoredEnergyTimestamps:ignored})).toMatchObject({status:'matched'})
  const noReadingDate = reframe(wire.replace(/(QTY\+220:110'\n)DTM\+597:202611010000:203'\nQTY\+136/, "$1QTY+136"))
  expect(compareUtiltsStructure({
    ...comparisonInput(noReadingDate),
    ignoredEnergyTimestamps:ignoredUtiltsEnergyTimestampIndices(noReadingDate, e66Policy),
  })).toMatchObject({status:'unavailable',reason:'structural_reading_time_unknown'})
})
