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

// Batch 1 canonical-authority guard.
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

const config = read('lib/ediel/config.ts')
assert(config.includes('canonical_application_reference_message_context_required'), 'generic config appref helper must fail closed for canonical EDIFACT families')
assert(!config.includes("if (process === 'PRODAT') return `23-${sub}-PRODAT`"), 'config must not fabricate PRODAT Application Reference')
assert(!config.includes("if (process === 'UTILTS' || process === 'UTILTS_ERR') return `23-${sub}-UTILTS`"), 'config must not fabricate UTILTS Application Reference')
assert(!config.includes("key: 'default_message_version_missing'"), 'route readiness must not require a route-level protocol version override')
assert(!config.includes("key: 'application_reference_missing'"), 'route readiness must not require a route-level Application Reference override')

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

// Batch 2 runtime-profile consolidation guard.
const subtypeRegistry = read('lib/ediel/rulebook/prodatSubtypeRegistry.ts')
assert(subtypeRegistry.includes('canonicalProdatSubtypeAlias'), 'canonical subtype alias resolver is required')
assert(subtypeRegistry.includes('canonicalProdatTransactionReason'), 'canonical transaction-reason resolver is required')

const legacyProdatProfiles = read('lib/ediel/prodat/profiles.ts')
assert(!legacyProdatProfiles.includes('const PROFILES'), 'legacy prodat/profiles.ts must not own a profile matrix')
assert(!legacyProdatProfiles.includes('Z22:'), 'legacy prodat/profiles.ts must not own transaction reason aliases')
assert(legacyProdatProfiles.includes('resolveCanonicalProdatRuntimeProfile'), 'legacy prodat/profiles.ts must delegate runtime profile resolution canonically')

const runtimeProfiles = read('lib/ediel/rulebook/prodatRuntimeProfileRegistry.ts')
assert(runtimeProfiles.includes('PRODAT_CANONICAL_PROFILES.flatMap'), 'runtime profile list must derive message codes from canonical catalog')
assert(runtimeProfiles.includes('resolveProdatSubtype'), 'runtime profiles must resolve subtype from canonical registry')

const prodatRegistry = read('lib/ediel/prodat/registry.ts')
assert(prodatRegistry.includes('PRODAT_CANONICAL_PROFILES.map'), 'PRODAT engine code support must derive from canonical profiles')
assert(prodatRegistry.includes('canonicalAckRequirements'), 'PRODAT ACK expectation must derive from canonical ACK engine')
assert(!prodatRegistry.includes("code === 'Z01'"), 'PRODAT registry must not own the Z01 ACK exception')
assert(!/ACTIVE_PRODAT_ENGINE_CODES[^=]*=\s*\[/.test(prodatRegistry), 'PRODAT registry must not own a message-code array')

const legacyRulebook = read('lib/ediel/rulebook/rulebook.ts')
assert(legacyRulebook.includes('PRODAT_CANONICAL_PROFILES.map'), 'legacy rulebook must project PRODAT from canonical profiles')
assert(!legacyRulebook.includes("{ family: 'PRODAT', code: 'Z01'"), 'legacy rulebook must not contain hand-written PRODAT rule rows')
assert(!legacyRulebook.includes("if (processGroup === 'metering_access') return '23-DGI-PRODAT'"), 'legacy rulebook must not own appref literals')

const validator = read('lib/ediel/rulebook/validator.ts')
assert(!validator.includes('PRODAT_TRANSACTION_TO_SUBTYPE'), 'validator must not own a transaction subtype map')
assert(validator.includes('canonicalProdatSubtypeAlias'), 'validator must normalize subtype canonically')
assert(validator.includes('getCanonicalProdatProfile'), 'validator must resolve the canonical PRODAT profile')

const canonicalPack = read('lib/ediel/rulebook/canonicalRulePackRegistry.ts')
assert(canonicalPack.includes('const source = resolveSourceCanonical(params)'), 'rule-pack resolver must resolve source semantics before DB evidence')
assert(canonicalPack.indexOf('const source = resolveSourceCanonical(params)') < canonicalPack.indexOf("supabaseService.rpc('resolve_canonical_ediel_rule_pack'"), 'source resolution must happen before DB evidence lookup')
assert(canonicalPack.includes('assertDbEvidenceMatchesSource'), 'DB rule-pack evidence must be checked against source decision')
assert(canonicalPack.includes('DB profile JSON can never redefine'), 'DB profile JSON must be documented as non-authoritative')

const codeRules = read('lib/ediel/rulebook/codeRules.ts')
assert(codeRules.includes('PRODAT_CANONICAL_PROFILES.map'), 'PRODAT message code list must derive from canonical profiles')
assert(codeRules.includes('PRODAT_SUBTYPE_RULES'), 'PRODAT subtype code lists must derive from canonical subtype registry')
assert(!codeRules.includes("values: ['Z01', 'Z02'"), 'codeRules must not own a PRODAT message-code matrix')

const profileRenderer = read('lib/ediel/prodat/builders/profileRenderer.ts')
assert(profileRenderer.includes('canonicalProdatTransactionReason'), 'profile renderer must resolve field-223 reason canonically')
assert(!profileRenderer.includes("normalized === 'LK'"), 'profile renderer must not maintain local subtype/reason aliases')
assert(!profileRenderer.includes("normalized === 'F'"), 'profile renderer must not maintain local masterdata reason aliases')

const stateMachine = read('lib/ediel/stateMachines/prodatLifecycle.ts')
assert(!stateMachine.includes('const SUBTYPE_ALIASES'), 'lifecycle must not own Ediel subtype aliases')
assert(stateMachine.includes('canonicalProdatSubtypeAlias'), 'lifecycle subtype parsing must delegate canonically')
assert(stateMachine.includes('PRODAT_TRANSACTION_REASON_CODES'), 'lifecycle raw parsing must use canonical reason-code inventory')
assert(/subtype === 'C'[\s\S]*createSupplyPeriod: false/.test(stateMachine), 'Z04C must never create a supply period')

const messageCatalog = read('lib/ediel/profiles/messageProfileCatalog.ts')
assert(messageCatalog.includes('canonicalProdat26AFieldRules'), 'message catalog fields must project from canonical 26.A field matrix')
assert(messageCatalog.includes('canonicalAckRequirements'), 'message catalog ACK policy must project from canonical ACK engine')
assert(!messageCatalog.includes('switch (code)'), 'message catalog must not own a per-PRODAT-code field matrix')
assert(messageCatalog.includes('does not define a global 312/313 rule'), 'message catalog must not assert global APERAK 312/313 semantics')

const prodatEngine = read('lib/ediel/prodat/engine.ts')
assert(prodatEngine.includes('canonicalizeEngineInput'), 'PRODAT engine must canonicalize subtype/reason before renderer dispatch')
assert(!prodatEngine.includes("messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A'"), 'legacy render adapter must not hardcode PRODAT UNH token')

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

const prodatBuilders = walk(path.join(root, 'lib/ediel/prodat/builders')).filter((file) => file.endsWith('.ts')).map((file) => fs.readFileSync(file, 'utf8')).join('\n')
for (const forbidden of ["?? 'Z22'", "?? 'E19'", "?? 'B71'", "?? 'B72'"]) {
  assert(!prodatBuilders.includes(forbidden), `PRODAT builders must not contain fabricated default ${forbidden}`)
}

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
