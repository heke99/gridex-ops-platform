import { test, expect } from '@playwright/test'
import { localProofEnabled, localProofFixture, proofGet, proofHeaders, readAllPages, readGuardProof, revokeReadProof, refreshProofAssertions } from '../helpers/customer-api-proof.mjs'
const enabled = localProofEnabled('GRIDEX_METERING_READ_LOCAL_E2E', 'GRIDEX_METERING_READ_FIXTURE_PATH')
test.skip(!enabled, 'Requires the disposable local metering database and signed Auth fixture.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
const f = enabled ? localProofFixture('GRIDEX_METERING_READ_FIXTURE_PATH') : null
const path = '/api/v1/customer/metering-values'
const fields = ['metering_value_reference', 'metering_point_reference', 'period_start', 'period_end', 'resolution', 'quantity_kwh', 'quality_status', 'status', 'created_at']
test('actual metering HTTP binds filters and cursors to owned periods with inclusive microsecond boundaries', async ({ request }) => {
  test.setTimeout(120_000)
  await refreshProofAssertions(f, path)
  const a1 = f.customers[0]
  let firstCursor
  for (const c of f.customers) {
    const result = await readAllPages(request, expect, path, c, fields)
    expect(result.rows).toEqual(c.expected)
    expect(new Set(result.rows.map(row => row.metering_value_reference)).size).toBe(c.expected.length)
    for (const row of result.rows) {
      expect(row.metering_value_reference).toMatch(/^metering_value_[A-Za-z0-9_-]{32}$/)
      expect(row.metering_point_reference).toMatch(/^metering_point_[A-Za-z0-9_-]{32}$/)
      expect(row.quantity_kwh).toBeGreaterThan(0)
    }
    expect(JSON.stringify(result.rows)).not.toMatch(/must not project|raw_payload|company_id|customer_id|source_line_reference|billing_gate/)
    if (c.tag === 'A1') {
      expect(result.pages).toBe(4)
      expect(result.rows[1].period_start).toBe(result.rows[2].period_start)
      expect(result.rows[1].period_start).toContain('.123456')
      firstCursor = result.firstCursor
    }
  }
  const filtered = await readAllPages(request, expect, path, a1, fields, f.filterQuery)
  expect(filtered.rows).toEqual(f.filteredExpected)
  expect(filtered.pages).toBe(2)
  expect(filtered.rows[0].period_end).toContain('11:00:00.123456')
  for (const suffix of ['', f.filterQuery.replace('09%3A00%3A00Z', '09%3A00%3A01Z'), f.filterQuery.replace('11%3A00%3A00.123456Z', '11%3A00%3A00.123455Z'), f.filterQuery.replace(f.facilityId, '735999999999999999')]) {
    const changed = await proofGet(request, `${path}?${suffix ? `${suffix}&` : ''}cursor=${encodeURIComponent(filtered.firstCursor)}`, { headers: proofHeaders(a1) })
    expect(changed.status()).toBe(400)
    expect((await changed.json()).error.code).toBe('invalid_cursor')
  }
  const dateOnly = await proofGet(request, `${path}?from=2026-09-30&to=2026-10-01`, { headers: proofHeaders(a1) })
  expect(dateOnly.status()).toBe(200)
  expect((await dateOnly.json()).data).toEqual(a1.expected)
  const foreignFacility = await proofGet(request, `${path}?facility_id=735999999999999999`, { headers: proofHeaders(a1) })
  expect(foreignFacility.status()).toBe(200)
  expect((await foreignFacility.json()).data).toEqual([])
  for (const facility of f.facilities.filter(item => item.customerId !== a1.customerId)) {
    const foreign = await proofGet(request, `${path}?facility_id=${facility.facilityId}`, { headers: proofHeaders(a1) })
    expect(foreign.status()).toBe(200)
    expect((await foreign.json()).data).toEqual([])
  }
  const offsetBounds = await proofGet(request, `${path}?facility_id=${f.facilityId}&from=2026-09-30T11%3A00%3A00%2B02%3A00&to=2026-09-30T13%3A00%3A00.123456%2B02%3A00`, { headers: proofHeaders(a1) })
  expect(offsetBounds.status()).toBe(200)
  expect((await offsetBounds.json()).data).toEqual(f.filteredExpected)
  const exclusiveUpper = await proofGet(request, `${path}?${f.filterQuery.replace('11%3A00%3A00.123456Z', '11%3A00%3A00.123455Z')}`, { headers: proofHeaders(a1) })
  expect(exclusiveUpper.status()).toBe(200)
  expect((await exclusiveUpper.json()).data).toEqual(f.filteredExpected.slice(1))
  for (const [query, code] of [['from=2026-02-30', 'invalid_time_filter'], ['to=invalid', 'invalid_time_filter'], ['from=2026-09-30T25%3A00%3A00Z', 'invalid_time_filter'], ['facility_id=letters', 'invalid_facility_id']]) {
    const response = await proofGet(request, `${path}?${query}`, { headers: proofHeaders(a1) })
    expect(response.status()).toBe(400)
    expect((await response.json()).error.code).toBe(code)
  }
  await readGuardProof(request, expect, path, f, firstCursor)
  await revokeReadProof(request, expect, path, f)
  console.log('METERING_READ_HTTP_NATIVE_PASS customers=3 rows=6 owned_facilities=4 cursor_replay=true filter_binding=true inclusive_microseconds=true allowlist=true isolation=true revocation=true')
})
