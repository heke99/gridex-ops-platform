import fs from 'node:fs'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

function loadSource(path, context) {
  const source = fs.readFileSync(path, 'utf8').replace(/^import .*$/gm, '').replace(/export /g, '')
  vm.createContext(context)
  vm.runInContext(stripTypeScriptTypes(source), context)
  return context
}

// Both years contain the same canonical amount. The legacy copy is stale.
const evidence = [{ value_kwh: 120, quantity_kwh: 1 }]
const point = {
  id: 'point', customer_id: 'customer', site_id: 'site', grid_owner_id: 'owner',
  bidding_zone_code: 'SE3', estimated_annual_consumption_kwh: 1200,
  customer_sites: null, start_date: null, end_date: null, consumption_profile_id: null,
}
const input = { companyId: 'company', forecastRunId: 'run', meteringPointId: 'point', periodStart: '2026-10-01', periodEnd: '2026-11-01' }
const dependencies = {
  Date, Math,
  monthStart: value => `${value.slice(0, 7)}-01`,
  monthEndExclusive: () => '2026-11-01',
  asNumber: value => Number(value ?? 0),
}

const calculator = loadSource('lib/forecasting/meteringPointForecast.ts', {
  ...dependencies,
  getMonthlyWeightPercent: async () => 10,
  resolveManagedDataQualityIssue: async () => undefined,
  upsertManagedDataQualityIssue: async () => undefined,
  supabaseService: {
    from(table) {
      const query = {
        select: () => query, eq: () => query, gte: () => query,
        maybeSingle: async () => ({ data: point, error: null }),
        lt: async () => ({ data: evidence, error: null }),
      }
      if (!['metering_points', 'metering_values'].includes(table)) throw new Error(`Unexpected calculator table: ${table}`)
      return query
    },
  },
})

const items = []
const generator = loadSource('lib/forecasting/forecastRuns.ts', {
  ...dependencies,
  calculateMeteringPointForecast: calculator.calculateMeteringPointForecast,
  buildCompanyMonthlyMetrics: async () => undefined,
  supabaseService: {
    from(table) {
      const query = {
        select: () => query, eq: () => query, gte: () => query, lt: () => query,
        in: () => query, limit: () => query,
        insert: payload => { items.push(payload); return query },
        update: () => query,
        then: resolve => Promise.resolve({
          data: table === 'metering_points' ? [point] : table === 'metering_values' ? evidence : null,
          error: null,
        }).then(resolve),
      }
      return query
    },
  },
})

await generator.generateForecastRunItems(input)
const item = items[0]
const safe = item.forecast_kwh === 120 && item.actual_kwh === 120 && item.diff_percent === 0
process.stdout.write(JSON.stringify({
  sources: ['lib/forecasting/meteringPointForecast.ts', 'lib/forecasting/forecastRuns.ts'],
  previousYearAndCurrentCanonicalKwh: 120, previousYearAndCurrentLegacyQuantityKwh: 1,
  item, safe,
}, null, 2) + '\n')
if (!safe) process.exitCode = 1
