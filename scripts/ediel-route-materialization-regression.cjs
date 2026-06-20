#!/usr/bin/env node
const fs = require('node:fs')
function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) { console.error(`✗ ${message}`); process.exitCode = 1 } else { console.log(`✓ ${message}`) }
}
const resolver = read('lib/ediel/senderSettingsResolver.ts')
const materializer = read('lib/ediel/routeMaterializer.ts')
const decision = read('lib/routes/routeDecisionEngine.ts')
const migration = read('supabase/migrations/20260620103000_customer_info_full_readiness_hardening.sql')
assert(/ambiguous_sender_settings/.test(resolver), 'sender settings resolver can block ambiguous settings')
assert(/environment_mismatch/.test(resolver), 'sender settings resolver can block environment mismatch')
assert(/messageFamily/.test(resolver) && /messageCode/.test(resolver), 'sender settings resolver considers family and code')
assert(/resolveSenderSettings/.test(materializer), 'route materializer uses shared sender settings resolver')
assert(/senderSettingProductionLockStatus/.test(materializer), 'route materializer records production lock status')
assert(/resolveCompanySenderSettings/.test(decision), 'route decision engine uses shared sender settings resolver')
assert(/gridex_route_materialization_readiness_v/.test(migration), 'route readiness view is hardened in migration')
assert(/message_code/.test(migration) && /environment/.test(migration), 'company route materialization is environment/message-code aware')
if (process.exitCode) process.exit(process.exitCode)
