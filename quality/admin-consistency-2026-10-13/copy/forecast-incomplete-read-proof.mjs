import fs from 'node:fs'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

// Execute the actual source with deterministic adapters at its imports. No DB I/O.
const source = fs.readFileSync('lib/forecasting/meteringPointForecast.ts', 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/export /g, '')
const executable = stripTypeScriptTypes(source)

async function run(errorMessage) {
  const calls = { historicalReads: 0, resolutions: [], findings: [] }
  const context = {
    Date, Math,
    monthStart: value => `${value.slice(0, 7)}-01`,
    monthEndExclusive: () => '2026-11-01',
    asNumber: value => Number(value ?? 0),
    getMonthlyWeightPercent: async () => 10,
    resolveManagedDataQualityIssue: async input => { calls.resolutions.push(input) },
    upsertManagedDataQualityIssue: async input => { calls.findings.push(input) },
    supabaseService: {
      from(table) {
        const query = {
          select: () => query, eq: () => query, gte: () => query,
          maybeSingle: async () => ({ data: {
            id: 'point', estimated_annual_consumption_kwh: 1200,
            customer_sites: null, start_date: null, end_date: null,
            consumption_profile_id: null,
          }, error: null }),
          lt: async () => {
            calls.historicalReads += 1
            return { data: null, error: { message: errorMessage } }
          },
        }
        if (!['metering_points', 'metering_values'].includes(table)) throw new Error(`Unexpected table: ${table}`)
        return query
      },
    },
  }
  vm.createContext(context)
  vm.runInContext(executable, context)
  let result
  let error
  try {
    result = await context.calculateMeteringPointForecast({
      companyId: 'company', meteringPointId: 'point',
      periodStart: '2026-10-01', periodEnd: '2026-11-01',
    })
  } catch (caught) { error = caught.message }
  return {
    source: 'lib/forecasting/meteringPointForecast.ts',
    failedRead: errorMessage, result, error, calls,
    safe: error === errorMessage && calls.resolutions.length === 0 && calls.findings.length === 0,
  }
}

Promise.all([
  run("Could not find the 'value_kwh' column of 'metering_values' in the schema cache"),
  run('column metering_values.value_kwh does not exist'),
]).then(results => {
  process.stdout.write(JSON.stringify({ results, safe: results.every(result => result.safe) }, null, 2) + '\n')
  if (results.some(result => !result.safe)) process.exitCode = 1
})
