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

// Batch 1 canonical-authority guard. Application Reference, version and route
// semantics must not grow independent runtime matrices again.
const prodatAppRefAuthority = read('lib/ediel/rulebook/prodatApplicationReference.ts')
assert(prodatAppRefAuthority.includes('canonicalProdatApplicationReferenceForProcessGroup'), 'canonical PRODAT Application Reference authority is required')

const appRefResolver = read('lib/ediel/core/applicationReferenceResolver.ts')
assert(!appRefResolver.includes('PRODAT_DDQ_CODES'), 'applicationReferenceResolver must not own a DDQ code matrix')
assert(!appRefResolver.includes('PRODAT_DGI_CODES'), 'applicationReferenceResolver must not own a DGI code matrix')
assert(appRefResolver.includes('getCanonicalProdatProfile'), 'applicationReferenceResolver must delegate PRODAT to canonical profiles')

const prodatRulebook = read('lib/ediel/rulebook/prodatRulebook.ts')
assert(!prodatRulebook.includes("applicationReference: '23-DDQ-PRODAT'"), 'PRODAT profiles must not repeat DDQ literals per message')
assert(!prodatRulebook.includes("applicationReference: '23-DGI-PRODAT'"), 'PRODAT profiles must not repeat DGI literals per message')
assert(prodatRulebook.includes('canonicalProdatApplicationReferenceForProcessGroup'), 'PRODAT profiles must derive Application Reference canonically')

const canonicalRules = read('lib/ediel/rulebook/canonicalRules.ts')
assert(!canonicalRules.includes('const permissionCodes = new Set'), 'canonicalRules must not maintain a second permission-code appref matrix')
assert(!canonicalRules.includes('const supplierCodes = new Set'), 'canonicalRules must not maintain a second supplier-code appref matrix')
assert(canonicalRules.includes('validateProdatApplicationReference'), 'canonicalRules must delegate PRODAT appref validation')

const appRefPolicy = read('lib/ediel/intent/applicationReferencePolicy.ts')
assert(!appRefPolicy.includes("return '23-DGI-PRODAT'"), 'intent appref policy must not manufacture DGI')
assert(!appRefPolicy.includes("return '23-DDQ-PRODAT'"), 'intent appref policy must not manufacture DDQ')
assert(appRefPolicy.includes('resolveProdatApplicationReferenceForProcess'), 'intent appref compatibility must delegate to canonical authority')

const versionSelector = read('lib/ediel/rulebook/versionSelector.ts')
assert(versionSelector.includes('resolveAuthoritativeEdielGuide'), 'runtime version selector must use the effective-dated guide registry')
assert(!versionSelector.includes('getRulebookRule'), 'runtime version selector must not use legacy rulebook as version authority')
assert(!versionSelector.includes('messageVersionForFamily'), 'runtime version selector must not use generic family version fallbacks')

const versionRegistry = read('lib/ediel/core/versionRegistry.ts')
assert(versionRegistry.includes('return canonicalVersionWindow({ family: input.family'), 'canonical outbound version path must return source-controlled guide selection')
assert(versionRegistry.includes('fallback and routeDefaultMessageVersion are compatibility inputs only'), 'route/draft version inputs must be documented as non-authoritative')
assert(!/function canonicalVersionWindow[\s\S]*supabaseService/.test(versionRegistry.split('// Evidence-only accessors.')[0]), 'canonical version selection must not query Supabase')

const routeMatrix = read('lib/ediel/routeMatrix.ts')
for (const forbidden of ['23-DDQ-PRODAT', '23-DGI-PRODAT', '23-DDQ-UTILTS', '23-DDQ-UTILTS-UNDERLAG']) {
  assert(!routeMatrix.includes(forbidden), `routeMatrix must not own normative Application Reference literal ${forbidden}`)
}
assert(!/Unknown PRODAT code.*safe default/i.test(routeMatrix), 'unknown PRODAT route projection must fail closed')
assert(routeMatrix.includes('getCanonicalProdatProfile'), 'routeMatrix must project from canonical PRODAT profiles')

const routeReadiness = read('lib/routes/routeReadiness.ts')
assert(!routeReadiness.includes('23-DGI-PRODAT'), 'routeReadiness must not own DGI literal')
assert(!routeReadiness.includes('23-DDQ-PRODAT'), 'routeReadiness must not own DDQ literal')
assert(routeReadiness.includes('resolveProdatApplicationReferenceForProcess'), 'routeReadiness compatibility appref must delegate canonically')

const routeDecisionContext = read('lib/ediel/flows/routeDecisionContext.ts')
assert(routeDecisionContext.includes('resolveApplicationReference'), 'route-to-builder gateway must re-resolve canonical Application Reference')
assert(routeDecisionContext.includes('resolveCanonicalOutboundVersion'), 'route-to-builder gateway must re-resolve canonical version')
assert(routeDecisionContext.includes('canonical_application_reference_mismatch'), 'route-to-builder gateway must block appref mismatch')
assert(!routeDecisionContext.includes('defaultMessageVersion: decision.messageVersion ??'), 'route decision version must not override canonical builder context')

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
assert(underlay.includes("billing_gate_status', 'eligible'") || underlay.includes('billing_gate_status", "eligible"'), 'underlay query must require eligible billing gate')
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
