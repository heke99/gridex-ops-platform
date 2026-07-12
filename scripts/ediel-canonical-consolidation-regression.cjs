const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const failures = []
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
function exists(relative) { return fs.existsSync(path.join(root, relative)) }
function assert(condition, message) { if (!condition) failures.push(message) }
function walk(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(full))
    else result.push(full)
  }
  return result
}

const edielFiles = walk(path.join(root, 'lib/ediel')).filter((file) => file.endsWith('.ts'))
for (const file of edielFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (relative.includes('/testing/') || relative.endsWith('/core/edifactEnvelopeCodec.ts')) continue
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (/(?:return\s+|=\s*|\?\s*)[`'"]UN(?:B|H|T|Z)\+/.test(line)) {
      failures.push(`${relative}:${index + 1} writes an EDIFACT envelope segment outside EdifactEnvelopeCodec`)
    }
  })
}

for (const deleted of [
  'lib/ediel/ack/ack.ts',
  'lib/ediel/ack/ackDecisionEngine.ts',
  'lib/ediel/core/ackDecisionEngine.ts',
  'lib/ediel/prodat/builders/generic.ts',
]) assert(!exists(deleted), `${deleted} must stay deleted`)

const routes = read('lib/cis/db-routes.ts')
assert(routes.includes(".eq('company_id', companyId)"), 'production route selection must require exact company_id')
assert(!/findBestCommunicationRoute[\s\S]*company_id\.is\.null/.test(routes), 'production route selection must not use global company fallback')

const claim = read('lib/ediel/outbox/claimOutboxItems.ts')
assert(claim.includes("rpc('claim_ediel_outbox_item'"), 'single outbox claim must use the atomic RPC')
assert(!claim.includes("from('ediel_outbox').update"), 'claim module must not claim by direct update')
for (const file of ['lib/ediel/outbox/readinessGuard.ts', 'lib/ediel/outbox/legacyOutboundBridge.ts', 'lib/ediel/outbox/sendOutboxItem.ts']) {
  const source = read(file)
  assert(!/isMissingSchema|schemaCompatibilityError/.test(source), `${file} must fail closed on schema mismatches`)
}

const prodatProfiles = read('lib/ediel/prodat/profiles.ts')
assert(prodatProfiles.includes("key: 'prodat_26a_z08_h'"), 'Z08H profile is required')
assert(prodatProfiles.includes("subtype: 'C'"), 'Z04C profile is required')
const prodatBuilders = walk(path.join(root, 'lib/ediel/prodat/builders')).filter((file) => file.endsWith('.ts')).map((file) => fs.readFileSync(file, 'utf8')).join('\n')
for (const forbidden of ["?? 'Z22'", "?? 'E19'", "?? 'B71'", "?? 'B72'"]) {
  assert(!prodatBuilders.includes(forbidden), `PRODAT builders must not contain fabricated default ${forbidden}`)
}

const stateMachine = read('lib/ediel/stateMachines/prodatLifecycle.ts')
assert(/subtype === 'C'[\s\S]*createSupplyPeriod: false/.test(stateMachine), 'Z04C must never create a supply period')
assert(/code === 'Z08'[\s\S]*subtype === 'H'/.test(stateMachine), 'Z08H lifecycle decision is required')

const utilts = read('lib/ediel/rulebook/utiltsRulebook.ts')
for (const code of ['S01','S02','S03','S04','S05','S06','S07','E30','E31','E66','E72','E73','E74','ERR']) {
  assert(utilts.includes(`messageCode: '${code}'`), `UTILTS profile ${code} is missing`)
}
const utiltsKernel = read('lib/ediel/utiltsEngine.ts')
assert(!/TGT|AGT|portal fixture/i.test(utiltsKernel), 'production UTILTS kernel must not contain TGT/AGT fixture policy')

const billingMatcher = read('lib/billing/meterValueBillingMatcher.ts')
const underlay = read('lib/billing/underlayEngine.ts')
assert(billingMatcher.includes('evaluateBillingGate'), 'metering matcher must evaluate the canonical billing gate')
assert(underlay.includes("billing_gate_status', 'eligible'"), 'underlay query must require eligible billing gate')
assert(underlay.includes('source_normalized_metering_value_id'), 'underlay must retain normalized row lineage')

const migration = read('supabase/migrations/20260712110000_ediel_canonical_consolidation.sql')
for (const required of [
  'resolve_ediel_rule_pack_fields',
  'resolve_ediel_ack_matrix_rule',
  'claim_ediel_outbox_item',
  'gridex_billing_underlay_item_gate_guard',
  'gridex_scan_ediel_canonical_repairs',
  'production_ediel_route_company_id_required',
]) assert(migration.includes(required), `canonical migration missing ${required}`)

if (failures.length) {
  console.error(`Ediel canonical consolidation regression failed (${failures.length})`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log(`Ediel canonical consolidation regression passed (${edielFiles.length} TypeScript files inspected).`)
