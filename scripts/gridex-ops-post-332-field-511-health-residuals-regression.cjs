#!/usr/bin/env node
/**
 * Post-#332 / field-511 tip residuals.
 * Locks generated-types tip alignment, resolver grant boundary, and L653Q
 * description trim after the authoritative Tidsserieprodukter import.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const failures = []

const check = (condition, message) => {
  if (!condition) failures.push(message)
}

const read = (relativePath) => {
  const absolute = path.join(root, relativePath)
  check(fs.existsSync(absolute), `missing required file: ${relativePath}`)
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : ''
}

const field511Migration =
  'supabase/migrations/20260813210500_ediel_utilts_field_511_products_25_a_3.sql'
const trimMigration =
  'supabase/migrations/20260813221500_ediel_utilts_field_511_l653q_description_trim.sql'
const typesPath = 'supabase/database.types.ts'
const typesManifestPath = 'scripts/supabase-types-manifest.json'
const additionsPath = 'scripts/migration-history-manifest.additions.json'

const field511Sql = read(field511Migration)
const trimSql = read(trimMigration)
const types = read(typesPath)
const typesManifest = JSON.parse(read(typesManifestPath) || '{}')
const additions = JSON.parse(read(additionsPath) || '{"files":{}}')

check(
  field511Sql.includes('create or replace function public.resolve_ediel_timeseries_product_511'),
  'field-511 migration must define resolve_ediel_timeseries_product_511',
)
check(
  field511Sql.includes(
    'revoke all on function public.resolve_ediel_timeseries_product_511(text,text,text,text,text,date) from public,anon,authenticated',
  ),
  'field-511 resolver must revoke public/anon/authenticated execute',
)
check(
  field511Sql.includes(
    'grant execute on function public.resolve_ediel_timeseries_product_511(text,text,text,text,text,date) to service_role',
  ),
  'field-511 resolver must grant execute only to service_role',
)
check(
  field511Sql.includes("field511TupleSourceStatus','authoritative_loaded'"),
  'field-511 migration must mark rule-pack metadata authoritative_loaded',
)
check(
  /L653Q','\\tEnergilager/.test(field511Sql) || field511Sql.includes("L653Q','\tEnergilager"),
  'field-511 source row L653Q still carries the workbook leading tab (immutable import provenance)',
)

check(
  trimSql.includes("code = 'L653Q'"),
  'forward trim migration must target L653Q',
)
check(
  trimSql.includes('ltrim(description, E\'\\t \')') ||
    trimSql.includes("ltrim(description, E'\\t ')"),
  'forward trim migration must strip leading tab/space from L653Q description',
)
check(
  trimSql.includes(
    "description is distinct from 'Energilager förbrukning per NA, BR och SU, 15 min'",
  ),
  'forward trim migration must assert the cleaned L653Q description',
)

const requiredTypeMarkers = [
  'product_characteristic:',
  'product_type:',
  'identity_type:',
  'level_of_details:',
  'business_activity_phase:',
  'source_row_numbers:',
  'is_current:',
  'source_metadata:',
  'resolve_ediel_timeseries_product_511:',
  'p_business_activity_phase',
  'p_product_characteristic',
]

for (const marker of requiredTypeMarkers) {
  check(types.includes(marker), `generated types missing field-511 marker: ${marker}`)
}

const resolverReturnsMatch = types.match(
  /resolve_ediel_timeseries_product_511:\s*\{[\s\S]*?Returns:\s*\{([\s\S]*?)\}\[\]/,
)
const resolverReturns = resolverReturnsMatch?.[1] ?? ''
check(
  Boolean(resolverReturnsMatch),
  'generated types must include resolve_ediel_timeseries_product_511 Returns block',
)
check(
  /valid_to:\s*string\s*\|\s*null/.test(resolverReturns),
  'resolver Returns.valid_to must remain nullable (SQL valid_to date can be null)',
)
check(
  /description:\s*string\s*\|\s*null/.test(resolverReturns),
  'resolver Returns.description must remain nullable (SQL description text can be null)',
)

const timestampedMigrations = fs
  .readdirSync(path.join(root, 'supabase/migrations'))
  .filter((fileName) => /^\d{14}_.+\.sql$/.test(fileName))
  .sort()
const latestTimestampedMigration = timestampedMigrations.at(-1)

check(
  typesManifest.latest_migration === latestTimestampedMigration,
  `generated-types tip must match the latest timestamped migration (${latestTimestampedMigration}), got ${typesManifest.latest_migration}`,
)
check(
  timestampedMigrations.includes(path.basename(trimMigration)),
  'L653Q trim migration must remain in timestamped migration history',
)

const typesAbsolute = path.join(root, typesPath)
const typesHash = fs.existsSync(typesAbsolute)
  ? crypto.createHash('sha256').update(fs.readFileSync(typesAbsolute)).digest('hex')
  : ''
check(
  Boolean(typesHash) && typesManifest.sha256 === typesHash,
  'generated-types manifest sha256 drifted from supabase/database.types.ts',
)

const trimName = '20260813221500_ediel_utilts_field_511_l653q_description_trim.sql'
const trimAbsolute = path.join(root, trimMigration)
const trimChecksum = fs.existsSync(trimAbsolute)
  ? crypto.createHash('sha256').update(fs.readFileSync(trimAbsolute)).digest('hex')
  : ''
check(
  Boolean(trimChecksum) && additions.files?.[trimName] === trimChecksum,
  'L653Q trim migration checksum missing or mismatched in additions manifest',
)

// Keep #119 tip residuals present on this branch.
const utiltsEngine = read('lib/ediel/utiltsEngine.ts')
const persistence = read('lib/ediel/utilts/transactionPersistence.ts')
const loginError = read('lib/auth/loginError.ts')
check(
  utiltsEngine.includes("classification === 'functional_rejected'") &&
    utiltsEngine.includes('aperakErrorsFromIssues(params.validation.issues)'),
  'mixed-disposition APERAK detail retention must remain on tip',
)
check(
  persistence.includes('transaction-${index + 1}') ||
    persistence.includes('`transaction-${index + 1}`'),
  'null UTILTS transaction id synthesis must remain on tip',
)
check(
  loginError.includes('sanitizeLoginErrorFlash') &&
    loginError.includes('sanitizeLoginSuccessFlash'),
  'login flash allowlists must remain on tip',
)

// Post-f596dc55 tip packaging: keep the authoritative JSON package coherent and
// reject the orphaned root-level checksum snippet that duplicate-check scripts
// never consume (canonical path is supabase/migrations/...snippet.json +
// scripts/migration-history-manifest.additions.json).
const rootOrphanSnippet = path.join(root, 'migration-history-manifest.additions.snippet.json')
check(
  !fs.existsSync(rootOrphanSnippet),
  'root migration-history-manifest.additions.snippet.json must not exist (orphaned duplicate)',
)

const field511JsonPath = 'field-511-products-25-a-3.json'
const field511JsonAbsolute = path.join(root, field511JsonPath)
check(fs.existsSync(field511JsonAbsolute), `missing required file: ${field511JsonPath}`)
if (fs.existsSync(field511JsonAbsolute)) {
  const packageJson = JSON.parse(fs.readFileSync(field511JsonAbsolute, 'utf8'))
  const products = Array.isArray(packageJson.products) ? packageJson.products : []
  const current = products.filter((product) => product?.current_for_25_A_3 === true)
  const retired = new Set(packageJson.retired_source_rows_excluded_from_resolution || [])
  const tuples = new Set()
  for (const product of products) {
    const field = product?.field_511 || {}
    tuples.add(['PC', 'PT', 'OT', 'LOD', 'BAP'].map((key) => field[key]).join('|'))
  }
  const l653q = products.find((product) => product?.code === 'L653Q')

  check(products.length === 91, `field-511 JSON must list 91 products, got ${products.length}`)
  check(current.length === 88, `field-511 JSON must mark 88 current products, got ${current.length}`)
  check(tuples.size === products.length, 'field-511 JSON must keep unique PC/PT/OT/LOD/BAP tuples')
  check(
    packageJson.source_tuple_count === 91 && packageJson.current_tuple_count === 88,
    'field-511 JSON header counts must match 91/88',
  )
  check(
    ['L336Q', 'S195', 'S196'].every((code) => retired.has(code)),
    'field-511 JSON must exclude L336Q/S195/S196 from current resolution',
  )
  check(
    Boolean(l653q) && String(l653q.description || '').startsWith('\t'),
    'field-511 JSON must preserve L653Q workbook leading-tab provenance',
  )
  check(
    packageJson.source_sha256 ===
      '2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98',
    'field-511 JSON source hash must match the authoritative workbook',
  )
}

const verification = read('VERIFICATION.md')
check(
  verification.includes('# Verifiering och produktionsgrind'),
  'VERIFICATION.md must remain the production-gate document',
)
check(
  fs.existsSync(path.join(root, 'quality/ediel-field-511-25-a-3-verification.md')),
  'field-511 verification notes must live under quality/, not overwrite VERIFICATION.md',
)

// Post-#123 tip residuals: keep nullability overrides durable against typegen
// regen, keep public/portal flash allowlists, and keep disabled-session reason
// mapping on the login page.
const nullabilityOverride = read(
  'scripts/apply-supabase-types-nullability-overrides.cjs',
)
const opsHardening = read('.github/workflows/ops-hardening.yml')
const loginPage = read('app/login/page.tsx')
const tecknaPage = read('app/teckna-avtal/page.tsx')
const tecknaActions = read('app/teckna-avtal/actions.ts')
const portalPage = read('app/portal/komplettera/page.tsx')
const utiltsDataRequest = read('lib/ediel/flows/utiltsDataRequest.ts')
check(
  nullabilityOverride.includes('resolve_ediel_timeseries_product_511') &&
    nullabilityOverride.includes('string | null'),
  'durable supabase types nullability override script must exist',
)
check(
  opsHardening.includes('gridex:post-332-field-511-health-residuals-regression'),
  'ops-hardening must gate the post-332 field-511 residuals regression',
)
check(
  opsHardening.includes(
    'apply-supabase-types-nullability-overrides.cjs rem002-database.types.ts',
  ),
  'clean-migration-replay must apply nullability overrides after typegen',
)
check(
  loginPage.includes('loginReasonErrorFlash') && loginPage.includes('reason?:'),
  'login page must consume allowlisted disabled-session reason flashes',
)
check(
  tecknaPage.includes('sanitizeExternalContractFlash') &&
    tecknaActions.includes('externalContractErrorFlash') &&
    !/error instanceof Error \? error\.message/.test(tecknaActions),
  'public teckna-avtal flashes must stay allowlisted without raw Error.message',
)
check(
  portalPage.includes('sanitizePortalCompletionBlockedFlash'),
  'portal completion blocked flashes must stay allowlisted',
)
check(
  /async function matchUtiltsTransactionsForTenant[\s\S]*resolveUtiltsTransactionId\(\s*transaction\.transactionId,\s*transactionIndex,\s*\)/.test(
    utiltsDataRequest,
  ),
  'UTILTS tenant match builder must synthesize null IDE+24 ids before persistence join',
)

if (failures.length) {
  console.error('Post-#332 field-511 health residuals regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Post-#332 field-511 health residuals static regression passed.')
console.log(`Types tip: ${typesManifest.latest_migration}`)
console.log(`Types sha256: ${typesHash}`)
console.log(`Trim checksum: ${trimChecksum}`)
