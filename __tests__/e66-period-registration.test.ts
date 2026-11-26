import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'

const current = '2026-11-18'
const prior = '2026-09-30'
const defaultRegistration = 'DTM+597:202607010020:203'
const earlyRegistration = 'DTM+597:202606300020:203'
const equalRegistration = 'DTM+597:202607010015:203'
const invalidFormat = 'DTM+597:202606300020:102'
const scopedIssue = 'UTILTS_E66_DELIVERY_END_AFTER_REGISTRATION'

function source(date = current, rewrite: (raw: string) => string = raw => raw) {
  const company = '11111111-1111-4111-8111-111111111111'
  const id = '22222222-2222-4222-8222-222222222222'
  const base = energyHandoffMessage(date, company)
  const raw = rewrite(base.raw_payload!)
  return {
    ...base,
    id,
    raw_payload: raw,
    execution_context_snapshot: { receivedUtiltsContext: {
      version: 1,
      contextOrigin: 'database_insert',
      sourceMessageId: id,
      companyId: company,
      environment: 'test',
      messageCode: 'E66',
      sourceReceivedAt: base.message_received_at!,
      capturedAt: base.message_received_at!,
      payloadHash: createHash('sha256').update(raw).digest('hex'),
    } },
  }
}

function evaluate(rewrite: (raw: string) => string, date = current) {
  const message = source(date, rewrite)
  const policy = resolveCanonicalMessagePolicy(message)!
  expect(policy.guide.guideRevision).toBe(date === current ? '25-A-5' : '25-A-3')
  return runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy })
}

it('rejects an E66 energy quarter whose period ends after the header registration', () => {
  const registrationBeforePeriod = evaluate(raw => raw.replace(defaultRegistration, earlyRegistration))
  expect(registrationBeforePeriod.transactionDispositions).toMatchObject([
    { disposition: 'processability_rejected', responseType: 'utilts_err' },
  ])
  expect(registrationBeforePeriod.validation.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: scopedIssue, utiltsErrCode: 'E50', referenceQualifier: 'TN', referenceNumber: 'GRIDEX2607E66001' }),
  ]))
})

it.each([defaultRegistration, equalRegistration])('allows header registration %s at or after the period end', registration => {
  expect(evaluate(raw => raw.replace(defaultRegistration, registration)).transactionDispositions)
    .toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
})

it('does not apply the current-source policy to an earlier guide', () => {
  const earlierGuide = evaluate(raw => raw.replace(defaultRegistration, earlyRegistration), prior)
  expect(earlierGuide.validation.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: scopedIssue })]))
  expect(earlierGuide.transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
})

it('keeps the distinct SG11 timestamp out of the transaction registration check', () => {
  const observed = evaluate(raw => raw.replace('DTM+597:202607010000:203', 'DTM+597:202607010100:203'))
  expect(observed.facts.transactions[0]?.registrationTime).toBe('2026-07-01T00:20:00')
  expect(observed.transactionDispositions).toMatchObject([{ disposition: 'accepted' }])
})

it('does not use an unsupported physical registration format for E50', () => {
  const invalid = evaluate(raw => raw.replace(defaultRegistration, invalidFormat))
  expect(invalid.validation.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: scopedIssue })]))
})

it('retains the valid sibling when only one transaction has an early registration', () => {
  const mixed = evaluate(raw => {
    const start = raw.indexOf('IDE+')
    const end = raw.indexOf('UNT+')
    const first = raw.slice(start, end)
    const sibling = first
      .replaceAll('GRIDEX2607E66001', 'GRIDEX2607E66002')
      .replaceAll('735999260731000007', '735999260731000014')
    const wire = raw.slice(0, start) + first.replace(defaultRegistration, earlyRegistration) + sibling + raw.slice(end)
    return wire.replace(/UNT\+(\d+)\+1'/, (_, count) => `UNT+${Number(count) + (sibling.match(/'/g) ?? []).length}+1'`)
  })
  expect(mixed.transactionDispositions).toMatchObject([
    { disposition: 'processability_rejected', responseType: 'utilts_err' },
    { disposition: 'accepted', responseType: 'positive_aperak' },
  ])
})
