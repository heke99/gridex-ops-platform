#!/usr/bin/env node
// Regression: Tenant bolagskort / source-of-truth
// Verifies:
// 1. Bolagskort actor save is the source of truth (ediel_actor_settings).
// 2. Ediel ID / subaddresses / application references are written into the
//    ACTUAL schema columns (sender_sub_address, sender_subaddress,
//    sender_subaddress_prodat, sender_subaddress_utilts).
// 3. No code relies on a non-existing bare `subaddress` column on ediel_actor_settings.
// 4. Production profile uses production actor setting (env-scoped resolution).
// 5. Test profile uses test actor setting (env-scoped resolution).
// 6. Duplicate active actor settings are detected and surfaced.
// 7. Shared mailbox is transport only (company_id null + platform_shared scope),
//    never tenant identity.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`\u274c ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 ${message}`)
}

// ---- 1 + 2. Bolagskort writes per-family subaddresses to actual columns ----
const edielActions = read('app/admin/companies/[id]/ediel-actions.ts')
for (const column of [
  'sender_sub_address',
  'sender_subaddress',
  'sender_subaddress_prodat',
  'sender_subaddress_utilts',
  'application_reference',
  'ediel_id',
]) {
  assert(
    edielActions.includes(column),
    `ediel-actions.ts: bolagskort writes actual column ${column}`,
  )
}


const actorProfileMigration = read('supabase/migrations/20260802170000_canonical_security_convergence.sql')
assert(
  actorProfileMigration.includes("default_application_reference = nullif(upper(p_command->>(v_environment || '_application_reference')), '')") &&
    actorProfileMigration.includes("application_reference = nullif(upper(p_command->>(v_environment || '_application_reference')), '')"),
  'canonical actor-profile RPC mirrors application_reference to compatibility default_application_reference',
)

// ---- 3. No code writes a bare `subaddress` column to ediel_actor_settings ----
assert(
  !/from\(['"]ediel_actor_settings['"]\)[\s\S]{0,400}\bsubaddress:\s/.test(edielActions),
  'ediel-actions.ts: does NOT write a bare `subaddress` column to ediel_actor_settings',
)

// ---- 4 + 5. Production/test use environment-scoped actor settings ----
const senderResolver = read('lib/ediel/senderSettingsResolver.ts')
assert(
  senderResolver.includes('lower(row.environment) === environment'),
  'senderSettingsResolver.ts: filters actor settings by exact environment (no test/prod mix)',
)
assert(
  /status:\s*"environment_missing"/.test(senderResolver),
  'senderSettingsResolver.ts: fails closed with environment_missing instead of defaulting to test',
)
const routeEngine = read('lib/routes/routeDecisionEngine.ts')
assert(
  /findActorSettingByIdScoped/.test(routeEngine) &&
    /lowerText\(row\.environment\) !== lowerText\(params\.environment\)/.test(routeEngine),
  'routeDecisionEngine.ts: actor_setting_id link is scoped to the same environment',
)

// ---- 6. Duplicate active actor settings detected + surfaced on bolagskort ----
const actorConfig = read('lib/ediel/companyActorConfiguration.ts')
assert(
  /export function detectDuplicateActiveActorSettings/.test(actorConfig),
  'companyActorConfiguration.ts: exports detectDuplicateActiveActorSettings',
)
assert(
  /duplicateActiveActorSettings:\s*detectDuplicateActiveActorSettings/.test(actorConfig),
  'companyActorConfiguration.ts: configuration includes duplicateActiveActorSettings',
)
const companyPage = read('app/admin/companies/[id]/page.tsx')
assert(
  /config\.duplicateActiveActorSettings\.length > 0/.test(companyPage) &&
    /ambiguous_sender_settings/.test(companyPage),
  'companies/[id]/page.tsx: surfaces duplicate active actor settings as a route-blocking warning',
)

// ---- 7. Shared mailbox is transport only ----
assert(
  /\.is\('company_id', null\)/.test(actorConfig) && /platform_shared/.test(actorConfig),
  'companyActorConfiguration.ts: shared mailbox = company_id null + platform_shared scope (transport only)',
)
assert(
  /delad brevlåda är bara transport|Delad brevlåda|transport/i.test(companyPage),
  'companies/[id]/page.tsx: clarifies shared mailbox is transport, Ediel-profil is identity',
)

console.log('\n\u2713 Tenant source-of-truth regression passed.')
