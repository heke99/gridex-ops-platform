import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateFixture, assertOutcome, main } from './elklart-ediel-scenarios.mjs'
const id = '11111111-1111-4111-a111-111111111111', messageId = '22222222-2222-4222-a222-222222222222'
const raw = Buffer.from("UNB+FICTIONAL'UNZ+1+LOCAL'")
const fixture = { scenario: 'anna-start', companyId: id, actorUserId: id, customerId: id, siteId: id, meteringPointId: id, switchRequestId: id, mode: 'internal_test', rawSha256: createHash('sha256').update(raw).digest('hex'), mailboxMessageId: 'local-anna-start-1', senderEmail: 'network-owner@elklart.example.invalid', receiverEmail: 'ediel@elklart.example.invalid', expectedMarketStartAt: '2026-11-10T23:00:00Z' }

test('guarded fixtures refuse altered bytes, foreign endpoints and certification modes', () => {
  assert.equal(validateFixture(fixture, raw), fixture)
  for (const change of [{ rawSha256: '0'.repeat(64) }, { mode: 'tgt' }, { mode: 'agt' }, { senderEmail: 'dso@real.example' }, { actorUserId: 'not-a-uuid' }, { switchRequestId: undefined }]) assert.throws(() => validateFixture({ ...fixture, ...change }, raw))
  assert.throws(() => validateFixture({ ...fixture, scenario: 'meter-correction', expectedReadings: [{ periodStart: '2026-11-10T23:00:00Z', periodEnd: '2026-11-10T23:15:00Z', kwh: 1 }] }, raw), /Previous/)
})
test('a status projection alone cannot establish activation or confirmed end', () => {
  assert.throws(() => assertOutcome(fixture, messageId, { periods: [{ status: 'active', market_start_at: fixture.expectedMarketStartAt }] }), /source-bound start/)
  assertOutcome(fixture, messageId, { periods: [{ source_message_id: messageId, source_switch_request_id: id, market_start_at: fixture.expectedMarketStartAt }], readings: [] })
  const end = { scenario: 'jonas-end', supplyPeriodId: id, expectedMarketEndAt: '2026-11-11T23:00:00Z' }
  assert.throws(() => assertOutcome(end, messageId, { periods: [{ id, market_end_at: end.expectedMarketEndAt }], readings: [] }), /source-bound end/)
  assertOutcome(end, messageId, { periods: [{ id, source_end_message_id: messageId, market_end_at: end.expectedMarketEndAt }], readings: [] })
})
test('correction must supply exact current intervals and preserve superseded source', () => {
  const interval = { periodStart: '2026-11-10T23:00:00Z', periodEnd: '2026-11-10T23:15:00Z', kwh: 3 }
  const correction = { scenario: 'meter-correction', previousMessageId: id, expectedReadings: [interval] }
  const current = { period_start: interval.periodStart, period_end: interval.periodEnd, value_kwh: 3, is_current: true, source_ediel_message_id: messageId }
  assert.throws(() => assertOutcome(correction, messageId, { readings: [current] }), /history/)
  assertOutcome(correction, messageId, { readings: [current, { source_ediel_message_id: id, is_current: false }] })
  assert.throws(() => assertOutcome(correction, messageId, { readings: [{ ...current, value_kwh: 4 }] }), /reading missing/)
})
test('CLI defaults to explicit fixture and refuses nonlocal services before client creation', async () => {
  await assert.rejects(main([]), /fixture/)
  const previous = process.env.SUPABASE_URL
  process.env.SUPABASE_URL = 'https://example.invalid'
  const previousPublic = process.env.NEXT_PUBLIC_SUPABASE_URL
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    await assert.rejects(main(['--fixture=/workspace/elklart-runtime/missing.json']), /localhost/)
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    await assert.rejects(main(['--fixture=/workspace/elklart-runtime/missing.json']), /localhost/)
    process.env.SUPABASE_URL = 'http://localhost:54321'
    await assert.rejects(main(['--fixture=/workspace/elklart-runtime/missing.json']), /mismatch/)
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'local-test-key'
    // Accepted origin reaches local fixture custody; no HTTP request is made.
    await assert.rejects(main(['--fixture=/workspace/elklart-runtime/elklart-test-missing-fixture.json']), /ENOENT/)
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous
    if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublic
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey
  }
})
