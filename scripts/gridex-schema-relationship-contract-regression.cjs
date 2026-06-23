#!/usr/bin/env node
// Regression: Schema relationship contract
// Verifies that no code assumes non-existing DB columns or wrong column names.
// Key contracts:
//   - grid_owner_data_requests: NO outbound_request_id, NO ediel_message_id
//   - ediel_messages: NO message_type, NO bare sent_at (use message_sent_at)
//   - outbound_requests: ediel_route_profile_id (NOT standalone route_profile_id)
//   - grid_owner_data_requests -> outbound_requests: via source_type/source_id
//   - ediel_messages.grid_owner_data_request_id is the GODR link in ediel_messages

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

// ---- 1. GridOwnerDataRequestRow type does NOT have outbound_request_id ----
const cisTypes = read('lib/cis/types.ts')
const godrTypeBlock = cisTypes.match(/GridOwnerDataRequestRow\s*=\s*\{[\s\S]*?\}/)?.[0] ?? ''
assert(
  !godrTypeBlock.includes('outbound_request_id'),
  'lib/cis/types.ts: GridOwnerDataRequestRow does NOT declare outbound_request_id'
)
assert(
  !godrTypeBlock.includes('ediel_message_id'),
  'lib/cis/types.ts: GridOwnerDataRequestRow does NOT declare ediel_message_id'
)

// ---- 2. EdielMessageRow type does NOT have message_type or bare sent_at ----
const edielTypes = read('lib/ediel/types.ts')
const edielTypeBlock = edielTypes.match(/EdielMessageRow\s*=\s*\{[\s\S]*?\}/)?.[0] ?? ''
assert(
  !/\bmessage_type\b/.test(edielTypeBlock),
  'lib/ediel/types.ts: EdielMessageRow does NOT have message_type (use message_family/message_code)'
)
assert(
  /message_sent_at/.test(edielTypeBlock),
  'lib/ediel/types.ts: EdielMessageRow has message_sent_at'
)
assert(
  !/\bsent_at\b/.test(edielTypeBlock.replace(/message_sent_at/g, '')),
  'lib/ediel/types.ts: EdielMessageRow does NOT have bare sent_at'
)

// ---- 3. OutboundRequestRow type uses ediel_route_profile_id ----
const outboundTypeBlock = cisTypes.match(/OutboundRequestRow\s*=\s*\{[\s\S]*?\}/)?.[0] ?? ''
assert(
  /ediel_route_profile_id/.test(outboundTypeBlock),
  'lib/cis/types.ts: OutboundRequestRow uses ediel_route_profile_id'
)

// ---- 4. db-outbound.ts inserts ediel_route_profile_id (not route_profile_id) ----
const dbOutbound = read('lib/cis/db-outbound.ts')
assert(
  /ediel_route_profile_id/.test(dbOutbound),
  'lib/cis/db-outbound.ts: uses ediel_route_profile_id in insert/update'
)

// ---- 5. Relationship via source_type/source_id ----
const sharedFlow = read('lib/ediel/flows/shared.ts')
assert(
  /sourceType.*grid_owner_data_request|'grid_owner_data_request'/.test(sharedFlow),
  'lib/ediel/flows/shared.ts: uses sourceType=grid_owner_data_request'
)
assert(
  /sourceId.*dataRequest\.id|source_id.*dataRequest\.id/.test(sharedFlow),
  'lib/ediel/flows/shared.ts: uses source_id/sourceId = dataRequest.id'
)

// ---- 6. Key production files do NOT read .outbound_request_id on GODR rows ----
const filesToCheck = [
  'lib/ediel/flows/prodatCustomerMasterdata.ts',
  'lib/customer-operations/automation.ts',
  'lib/onboarding/infoRequests.ts',
  'lib/customer-operations/z01Finalizer.ts',
]
for (const file of filesToCheck) {
  const content = read(file)
  // Allow legitimate outbound_request_id references (on ediel_messages / customer_info_requests)
  // Flag only if a variable named for a GODR has .outbound_request_id
  const suspiciousLines = content.split('\n').filter((line) => {
    if (/^\s*\/\//.test(line)) return false
    return /dataRequest\.outbound_request_id|godr?\b.*\.outbound_request_id/.test(line)
  })
  assert(
    suspiciousLines.length === 0,
    `${file}: does NOT read .outbound_request_id on GODR-typed row (found: ${suspiciousLines.join(' | ')})`
  )
}

// ---- 7. Scan key files for message_type usage on ediel_messages ----
const edielMessageFiles = [
  'lib/ediel/flows/prodatCustomerMasterdata.ts',
  'lib/ediel/flows/shared.ts',
  'lib/onboarding/infoRequests.ts',
]
for (const file of edielMessageFiles) {
  const content = read(file)
  const badLines = content.split('\n').filter((line) => {
    if (/^\s*\/\//.test(line)) return false
    if (/certificate|Certificate/.test(line)) return false
    return /\.message_type\b/.test(line)
  })
  assert(
    badLines.length === 0,
    `${file}: does NOT read .message_type from ediel_messages rows (found: ${badLines.join(' | ')})`
  )
}

// ---- 8. CustomerInfoRequestRow type HAS outbound_request_id ----
const infoRequests = read('lib/onboarding/infoRequests.ts')
const cirTypeBlock = infoRequests.match(/CustomerInfoRequestRow\s*=\s*\{[\s\S]*?\}/)?.[0] ?? ''
assert(
  /outbound_request_id/.test(cirTypeBlock),
  'infoRequests.ts: CustomerInfoRequestRow has outbound_request_id'
)
assert(
  /ediel_message_id/.test(cirTypeBlock),
  'infoRequests.ts: CustomerInfoRequestRow has ediel_message_id'
)
assert(
  /grid_owner_data_request_id/.test(cirTypeBlock),
  'infoRequests.ts: CustomerInfoRequestRow has grid_owner_data_request_id'
)

// ---- 9. ediel_messages has grid_owner_data_request_id link ----
assert(
  /grid_owner_data_request_id/.test(edielTypeBlock),
  'lib/ediel/types.ts: EdielMessageRow has grid_owner_data_request_id'
)

// ---- 10. Messages pages use correct column names ----
const messagesPage = read('app/admin/messages/page.tsx')
assert(
  !/\bsent_at\b/.test(messagesPage.replace(/message_sent_at/g, '').replace(/message_received_at/g, '')),
  'app/admin/messages/page.tsx: does NOT use bare sent_at (uses message_sent_at)'
)
assert(
  !/message_type/.test(messagesPage),
  'app/admin/messages/page.tsx: does NOT use message_type (uses message_family/message_code)'
)

// ---- 11. outbound_requests.source_type/source_id links to grid_owner_data_requests ----
// This is the canonical join path used by the finalizer and shared flow
const migrationDir = require('path').join(root, 'supabase/migrations')
const allMigrations = require('fs').readdirSync(migrationDir)
  .map((f) => { try { return require('fs').readFileSync(require('path').join(migrationDir, f), 'utf8') } catch { return '' } })
  .join('\n')
assert(
  /source_type.*outbound_requests|outbound_requests.*source_type/s.test(allMigrations),
  'supabase/migrations: outbound_requests has source_type column'
)
assert(
  /source_id.*outbound_requests|outbound_requests.*source_id/s.test(allMigrations),
  'supabase/migrations: outbound_requests has source_id column'
)

// ---- 12. ediel_message_id on outbound_requests (so messages page can filter null) ----
assert(
  /ediel_message_id.*outbound_requests|outbound_requests.*ediel_message_id/s.test(allMigrations),
  'supabase/migrations: outbound_requests has ediel_message_id column (for messages page filter)'
)

// ---- 13. Route profile relation: ediel_route_profiles.communication_route_id ----
const routeEngineSrc = read('lib/routes/routeDecisionEngine.ts')
assert(
  /\.eq\("communication_route_id", routeId\)/.test(routeEngineSrc),
  'routeDecisionEngine.ts: resolves route profile via ediel_route_profiles.communication_route_id'
)
// No code may assume a communication_routes.ediel_route_profile_id column.
for (const file of [
  'lib/routes/routeDecisionEngine.ts',
  'lib/ediel/core/routeRegistry.ts',
  'lib/ediel/flows/prodatCustomerMasterdata.ts',
]) {
  assert(
    !/communication_routes[\s\S]{0,120}ediel_route_profile_id/.test(read(file)),
    `${file}: does NOT assume communication_routes.ediel_route_profile_id`
  )
}

console.log('\n✓ Schema relationship contract regression passed.')
