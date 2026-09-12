/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const migrationsDirectory = path.join(root, 'supabase', 'migrations')
const outputDirectory = path.join(root, 'artifacts')
// Use every checksum source accepted by migration integrity and retain the
// verified tail. Reject conflicts between any sources before merging them.
const checksumManifestNames = [
  'migration-history-manifest.json',
  'migration-history-manifest.additions.json',
  'migration-history-manifest.ediel.additions.json',
  'migration-history-manifest.runtime.additions.json',
  'migration-history-verified-tail.json',
]
const registeredChecksums = {}
const checksumSources = []
const checksumOwners = {}
for (const [index, name] of checksumManifestNames.entries()) {
  const manifestPath = path.join(root, 'scripts', name)
  if (index > 0 && !fs.existsSync(manifestPath)) continue
  const files = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files ?? {}
  if (index === 0 || Object.keys(files).length > 0) {
    checksumSources.push(path.relative(root, manifestPath))
  }
  for (const [filename, checksum] of Object.entries(files)) {
    if (Object.hasOwn(registeredChecksums, filename) && registeredChecksums[filename] !== checksum) {
      throw new Error(`Migration checksum sources conflict for ${filename}: ${checksumOwners[filename]} vs ${name}`)
    }
    registeredChecksums[filename] = checksum
    checksumOwners[filename] = name
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function expectedObjects(sql) {
  const patterns = [
    /\bcreate\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view|function|procedure|trigger|index|type|sequence)\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/gi,
    /\balter\s+table\s+(?:if\s+exists\s+)?([a-zA-Z0-9_."]+)/gi,
  ]
  const found = new Set()
  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) found.add(match[1].replaceAll('"', ''))
  }
  return [...found].sort()
}

const files = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const inventory = files.map((filename) => {
  const content = fs.readFileSync(path.join(migrationsDirectory, filename))
  const versionMatch = /^(\d{14})_(.+)\.sql$/.exec(filename)
  const checksum = sha256(content)
  return {
    version: versionMatch?.[1] ?? null,
    filename,
    checksum,
    checksum_registered: registeredChecksums[filename] === checksum,
    ledger_eligible: Boolean(versionMatch),
    expected_objects: expectedObjects(content.toString('utf8')),
    live_ledger_state: 'UNVERIFIED',
    live_schema_effect_state: 'UNVERIFIED',
  }
})

const versionCounts = new Map()
for (const item of inventory) {
  if (!item.version) continue
  versionCounts.set(item.version, (versionCounts.get(item.version) ?? 0) + 1)
}
const duplicateVersions = [...versionCounts]
  .filter(([, count]) => count > 1)
  .map(([version, count]) => ({ version, count }))

const result = {
  generated_at: new Date().toISOString(),
  source: 'repository/supabase/migrations',
  checksum_sources: checksumSources,
  verification_state: 'LOCAL_INVENTORY_ONLY',
  warning:
    'Do not populate the live canonical_migration_manifest from this file until a clean reconstruction and live schema-effect comparison have verified each version.',
  summary: {
    sql_file_count: inventory.length,
    ledger_eligible_count: inventory.filter((item) => item.ledger_eligible).length,
    unversioned_or_legacy_count: inventory.filter((item) => !item.ledger_eligible).length,
    checksum_registered_count: inventory.filter((item) => item.checksum_registered).length,
    duplicate_version_groups: duplicateVersions.length,
  },
  duplicate_versions: duplicateVersions,
  migrations: inventory,
}

fs.mkdirSync(outputDirectory, { recursive: true })
const jsonPath = path.join(outputDirectory, 'migration-inventory-2026-08-03.json')
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`)

const templatePath = path.join(
  outputDirectory,
  'canonical-migration-manifest-after-verification.sql',
)
const rows = inventory
  .filter((item) => item.ledger_eligible)
  .map(
    (item) =>
      `  ('${item.version}','${item.filename}','${item.checksum}',:'environment',now(),:'verification_source',:'release_identifier',:'schema_fingerprint')`,
  )
const template = `-- GENERATED TEMPLATE. DO NOT RUN BEFORE CLEAN RECONSTRUCTION AND LIVE EFFECT VERIFICATION.\n-- Required psql variables: environment, verification_source, release_identifier, schema_fingerprint.\n\ninsert into public.canonical_migration_manifest(\n  version,filename,checksum,applied_environment,verified_at,verification_source,release_identifier,schema_fingerprint\n)\nvalues\n${rows.join(',\n')}\non conflict(version,filename) do update set\n  checksum=excluded.checksum,\n  applied_environment=excluded.applied_environment,\n  verified_at=excluded.verified_at,\n  verification_source=excluded.verification_source,\n  release_identifier=excluded.release_identifier,\n  schema_fingerprint=excluded.schema_fingerprint;\n`
fs.writeFileSync(templatePath, template)

const unregistered = inventory.filter((item) => !item.checksum_registered)
if (unregistered.length > 0) {
  console.error(`Migration inventory generated, but ${unregistered.length} repository checksum(s) are not registered:`)
  for (const item of unregistered) {
    const expected = registeredChecksums[item.filename]
    console.error(`- ${item.filename}: expected=${expected ?? '<missing>'} current=${item.checksum}`)
  }
  console.error('Register only verified forward migrations in an approved additive checksum manifest. Never rewrite a historical baseline checksum to silence this gate.')
  process.exit(1)
}
console.log(
  `Migration inventory generated: ${inventory.length} SQL files, ${result.summary.ledger_eligible_count} ledger-eligible versions.`,
)
console.log(path.relative(root, jsonPath))
console.log(path.relative(root, templatePath))
