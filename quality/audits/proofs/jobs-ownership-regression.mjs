import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import vm from 'node:vm'

// Node24 fallback for the same scenarios used by Vitest. Source paths can point
// at an isolated baseline checkout for RED verification without editing HEAD.
function load(path, names, dependencies) {
  const source = stripTypeScriptTypes(readFileSync(path, 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '')
  const context = vm.createContext({ console, Date, Error, Buffer, process, ...dependencies })
  vm.runInContext(source + '\nglobalThis.loaded = {' + names.join(',') + '}', context, { filename: path })
  return context.loaded
}
const suite = load('__tests__/helpers/jobs-ownership-cases.ts', ['manualCases', 'analyticsCases'], { assert })
let failed = 0
for (const [kind, cases] of [['manual', suite.manualCases], ['analytics', suite.analyticsCases]]) {
  for (const testCase of cases) {
    try {
      await testCase.run((fixture) => {
        if (kind === 'analytics') return load(process.env.JOBS_ANALYTICS_SOURCE ?? 'lib/analytics/cron.ts', ['listAnalyticsCompanyIds'], {
          supabaseService: fixture.db, timingSafeEqual,
        }).listAnalyticsCompanyIds
        return load(process.env.JOBS_MANUAL_SOURCE ?? 'lib/email/manualEmailOutbox.ts', ['processManualEmailOutbox'], {
          randomUUID, supabaseService: fixture.db, assertPlatformSchemaReady: async () => {},
          getEmailProvider: () => ({ async sendEmail(input) { fixture.sends.push(input); return fixture.send(input) } }),
          isEdielReservedSender: () => fixture.reserved(),
          getTenantOperationDecision: (companyId) => { fixture.policies.push(companyId); return fixture.policy(fixture.policies.length) },
        }).processManualEmailOutbox
      })
      console.log('PASS', testCase.name)
    } catch (error) {
      failed++
      console.log('FAIL', testCase.name, String(error.message).slice(0, 220))
    }
  }
}
console.log(`${suite.manualCases.length + suite.analyticsCases.length} cases, ${failed} failures`)
process.exitCode = failed ? 1 : 0
