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

check(
  typesManifest.latest_migration ===
    '20260813221500_ediel_utilts_field_511_l653q_description_trim.sql',
  `generated-types tip must be the L653Q trim migration, got ${typesManifest.latest_migration}`,
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

if (failures.length) {
  console.error('Post-#332 field-511 health residuals regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Post-#332 field-511 health residuals static regression passed.')
console.log(`Types tip: ${typesManifest.latest_migration}`)
console.log(`Types sha256: ${typesHash}`)
console.log(`Trim checksum: ${trimChecksum}`)
