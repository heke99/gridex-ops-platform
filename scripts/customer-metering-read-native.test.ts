import { createHash, randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { assertLowRoleReadDenied, proofReference, proofSql, quote, readFixture, saveFixture, seedReadActors, type ReadProofFixture } from './customer-read-proof-native'

const env = 'GRIDEX_METERING_READ_FIXTURE_PATH'
const table = 'normalized_metering_values'
function meteringSourceSnapshot(companies: string[]) {
  const filter = companies.map(quote).join(',')
  const tables = ['normalized_metering_values', 'metering_points', 'customer_sites', 'billing_underlays', 'metering_value_sources']
  return createHash('sha256').update(JSON.stringify(proofSql(`SELECT jsonb_build_object(${tables.map(name =>
    `${quote(name)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.${name} t WHERE company_id IN (${filter}))`).join(',')});`))).digest('hex')
}
it('seeds valid customer/site/point periods and postchecks real HTTP source immutability', async () => {
  if (process.env.GRIDEX_METERING_READ_VERIFY_AFTER_HTTP === '1') {
    const f = readFixture<ReadProofFixture>(env)
    expect(meteringSourceSnapshot(f.companies)).toBe(f.sourceHash)
    for (const c of f.customers) expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.integration_api_requests
      WHERE company_id=${quote(c.companyId)} AND api_client_id=${quote(c.clientId)} AND route='/api/v1/customer/metering-values'
      AND status_code=200 AND metadata->>'customer_id'=${quote(c.customerId)};`)).toBeGreaterThan(0)
    console.log('METERING_READ_HTTP_POST_NATIVE_PASS source_rows_unchanged=true metering_trigger_effects_unchanged=true customers=3')
    return
  }
  const f = await seedReadActors('metering-read', '/api/v1/customer/metering-values', ['customer_metering.read'])
  const filterFixture: { facilityId: string; filterQuery: string; filteredExpected: Array<Record<string, unknown>> } = { facilityId: '', filterQuery: '', filteredExpected: [] }
  const facilities: Array<{ companyId: string; customerId: string; facilityId: string }> = []
  for (const [customerIndex, c] of f.customers.entries()) {
    const points: Array<{ site: string; point: string; facilityId: string }> = []
    for (let siteIndex = 0; siteIndex < (c.tag === 'A1' ? 2 : 1); siteIndex++) {
      const site = randomUUID(), point = randomUUID(), facilityBase = `7359990000000${customerIndex + 1}00${siteIndex + 1}`
      const sum = [...facilityBase].reverse().reduce((total, digit, offset) => total + Number(digit) * (offset % 2 === 0 ? 3 : 1), 0)
      const facilityId = `${facilityBase}${(10 - sum % 10) % 10}`
      proofSql(`INSERT INTO public.customer_sites(id,company_id,customer_id,facility_id,site_name,status,is_test_data)
        VALUES(${quote(site)},${quote(c.companyId)},${quote(c.customerId)},${quote(facilityId)},'Synthetic meter read site','draft',true);
        INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,site_facility_id,status,is_test_data)
        VALUES(${quote(point)},${quote(c.companyId)},${quote(c.customerId)},${quote(site)},${quote(site)},${quote(facilityId)},${quote(facilityId)},'draft',true);
        SELECT to_jsonb(count(*)) FROM public.metering_points WHERE id=${quote(point)};`)
      points.push({ site, point, facilityId })
      facilities.push({ companyId: c.companyId, customerId: c.customerId, facilityId })
    }
    const count = c.tag === 'A1' ? 4 : 1
    for (let index = 0; index < count; index++) {
      const p = points[index === 2 ? 1 : 0], id = randomUUID()
      const start = index === 0 ? '2026-09-30 12:00:00+00' : index < 3 ? '2026-09-30 10:00:00.123456+00' : '2026-09-30 09:00:00+00'
      proofSql(`INSERT INTO public.normalized_metering_values(id,company_id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,
        period_start,period_end,resolution,quantity_kwh,quality_status,source_type,source_line_reference,raw_payload,status,created_at)
        VALUES(${quote(id)},${quote(c.companyId)},${quote(c.customerId)},${quote(p.site)},${quote(p.site)},${quote(p.point)},${quote(p.facilityId)},'SE3',
          ${quote(start)},${quote(start)}::timestamptz+interval '1 hour','hourly',${index + 1}.25,'validated','native_http_proof',${quote(id)},
          '{"private":"must not project"}','stored',${quote(start)}); SELECT to_jsonb(count(*)) FROM public.normalized_metering_values WHERE id=${quote(id)};`)
    }
    const rows = proofSql<Array<Record<string, unknown>>>(`SELECT jsonb_agg(to_jsonb(t) ORDER BY period_start DESC,id DESC)
      FROM public.normalized_metering_values t WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)};`)
    expect(rows).toHaveLength(count)
    c.expected = rows.map(row => ({ metering_value_reference: proofReference('metering_value', c.companyId, String(row.id)),
      metering_point_reference: proofReference('metering_point', c.companyId, String(row.metering_point_id)), period_start: row.period_start,
      period_end: row.period_end, resolution: 'hourly', quantity_kwh: row.quantity_kwh, quality_status: row.quality_status,
      status: row.status, created_at: row.created_at }))
    assertLowRoleReadDenied(table, c)
    if (c.tag === 'A1') {
      filterFixture.facilityId = points[0].facilityId
      filterFixture.filterQuery = `from=2026-09-30T09%3A00%3A00Z&to=2026-09-30T11%3A00%3A00.123456Z&facility_id=${points[0].facilityId}`
      filterFixture.filteredExpected = c.expected.filter(row => row.metering_point_reference === proofReference('metering_point', c.companyId, points[0].point)
        && Number(row.quantity_kwh) !== 1.25)
      expect(filterFixture.filteredExpected).toHaveLength(2)
    }
  }
  expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.normalized_metering_values n
    JOIN public.metering_points p ON p.id=n.metering_point_id JOIN public.customer_sites s ON s.id=n.customer_site_id
    WHERE n.company_id IN (${f.companies.map(quote).join(',')}) AND (n.company_id<>p.company_id OR n.customer_id<>p.customer_id
      OR n.company_id<>s.company_id OR n.customer_id<>s.customer_id OR n.period_end<=n.period_start OR n.quantity_kwh IS NULL);`)).toBe(0)
  f.sourceHash = meteringSourceSnapshot(f.companies)
  saveFixture(env, { ...f, ...filterFixture, facilities })
  console.log('METERING_READ_HTTP_SEED_NATIVE_PASS customers=3 owned_facilities=4 valid_periods=true microseconds=true direct_low_roles_denied=true')
})
