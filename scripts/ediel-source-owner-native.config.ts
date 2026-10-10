import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {defineConfig} from 'vitest/config'

// A separate, mandatory native suite. It cannot fall back to unit placeholders
// or a hosted project. The CLI status file stays in RUNNER_TEMP, never artifacts.
const statusPath = process.env.GRIDEX_NATIVE_STATUS
if (!statusPath) throw new Error('owned_native_status_required')
const status = JSON.parse(readFileSync(statusPath,'utf8')) as Record<string,string>
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.SERVICE_ROLE_KEY || !status.ANON_KEY) {
  throw new Error('owned_local_supabase_required')
}
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
export default defineConfig({
  // Native owners run server code. Resolve 'server-only' exactly as Next's
  // server build does (its compiled empty marker); client misuse stays guarded
  // by the Next build itself.
  resolve:{alias:[{find:'@',replacement:resolve(__dirname,'..')},{find:/^server-only$/,replacement:resolve(__dirname,'../node_modules/next/dist/compiled/server-only/empty.js')}]},
  test:{environment:'node',include:[
    'scripts/staff-case-write-native.test.ts',
    'scripts/staff-case-create-native.test.ts',
    'scripts/staff-customer-write-native.test.ts',
    'scripts/staff-identity-provider-native.test.ts',
    'scripts/staff-user-concurrency-native.test.ts',
    'scripts/staff-user-client-concurrency-native.test.ts',
    'scripts/ediel-source-owner-native.test.ts',
    'scripts/ediel-canonical-signature-billing-projection-native.test.ts',
    'scripts/ediel-test-original-outcome-native.test.ts',
    'scripts/ediel-closure-wire-native.test.ts',
    'scripts/ediel-utilts-consumption-native.test.ts',
    'scripts/ediel-correction-context-native.test.ts',
    'scripts/ediel-correction-process-native.test.ts',
    'scripts/ediel-document-reference-native.test.ts',
    'scripts/ediel-document-reference-dispatch-native.test.ts',
    'scripts/ediel-z04-ack-native.test.ts',
    'scripts/ediel-utilts-err-gateway-native.test.ts',
    'scripts/ediel-utilts-s02-required-native.test.ts',
    'scripts/ediel-outbound-ack-replay-native.test.ts',
    'scripts/ediel-prodat-mixed-native.test.ts',
    'scripts/ediel-transport-data-query-plan-native.test.ts',
    'scripts/ediel-requested-change-native.test.ts',
    'scripts/ediel-registry-import-native.test.ts',
    'scripts/ediel-artifact-retention-native.test.ts',
    'scripts/ediel-customer-retention-native.test.ts',
    'scripts/ediel-transport-exception-native.test.ts',
    'scripts/ediel-service-evidence-native.test.ts',
    'scripts/ediel-sc-003-005-service-native.test.ts',
    'scripts/ediel-at-z15c-z18v-esco-native.test.ts',
    'scripts/ediel-at-z14n-esco-native.test.ts',
    'scripts/ediel-esco-10-11-projection-native.test.ts',
    'scripts/ediel-sc-010-beneficiary-export-native.test.ts',
    'scripts/ediel-sc-071-projection-revocation-native.test.ts',
    'scripts/ediel-sc014-technical-intake-native.test.ts',
    'scripts/ediel-dsn-source-native.test.ts',
    'scripts/ediel-tr-05-recovery-native.test.ts',
    'scripts/ediel-tr-10-reconciliation-native.test.ts',
    'scripts/ediel-ack-first-reception-native.test.ts',
    'scripts/ediel-regulated-supply-ground-native.test.ts',
    'scripts/ediel-blob-retention-native.test.ts',
    'scripts/ediel-confirmed-customer-bilateral-native.test.ts',
    'scripts/ediel-prodat-ack-raw-scope-native.test.ts',
    'scripts/ediel-bilateral-prodat-profile-native.test.ts',
    'scripts/ediel-ai-purpose-source-native.test.ts',
    'scripts/ediel-customer-record-retention-native.test.ts',
    'scripts/ediel-ai-network-original-native.test.ts',
    'scripts/ediel-network-registry-source-native.test.ts',
    'scripts/ediel-fresh-business-incident-native.test.ts',
    'scripts/ediel-bilateral-prodat-h-original-native.test.ts',
    'scripts/ediel-process-journal-retention-native.test.ts',
    'scripts/ediel-registry-route-certificate-native.test.ts',
    'scripts/ediel-finance-copy-retention-native.test.ts',
    'scripts/ediel-z06f-reading-followup-native.test.ts',
    'scripts/ediel-decision-original-retention-native.test.ts',
    'scripts/ediel-inbound-reception-actual-columns-native.test.ts',
    'scripts/ediel-retention-grant-native-clock-native.test.ts',
    'scripts/ediel-prodat-object-batch-current-source-native.test.ts',
    'scripts/ediel-original-source-intake-native.test.ts',
    'scripts/ediel-db02-profile-periods-native.test.ts',
  ],setupFiles:['scripts/helpers/ediel-native-permission-catalog.setup.ts'],testTimeout:120000,hookTimeout:120000,fileParallelism:false},
})
