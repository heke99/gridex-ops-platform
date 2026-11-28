#!/usr/bin/env node
const { createHash } = require('node:crypto')
const { readdirSync, readFileSync } = require('node:fs')
const { basename, join, resolve } = require('node:path')
const { collectMigrationSource, matchesMigrationSource } = require('./lib/supabase-migration-provenance.cjs')

const root = resolve(__dirname, '..')
const manifest = JSON.parse(
  readFileSync(join(root, 'scripts/supabase-types-manifest.json'), 'utf8'),
)
const generatedPath = join(root, manifest.generated_types)
const generated = readFileSync(generatedPath)
const actualHash = createHash('sha256').update(generated).digest('hex')
const migrationFiles = readdirSync(join(root, 'supabase/migrations'))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
const latestMigration = basename(migrationFiles.at(-1) ?? '')

const failures = []
const origin = manifest.active_generated_outputs_origin
const migrationSource = collectMigrationSource(root)
const hash = /^[0-9a-f]{64}$/
const gitHash = /^[0-9a-f]{40}$/
if (
  origin?.kind !== 'genuine_successful_ordinary_capture_RAW3_ONLY' ||
  origin.workflow_path !== '.github/workflows/staff-api-schema-capture.yml' ||
  !gitHash.test(origin.source_head) ||
  !gitHash.test(origin.source_tree) ||
  !Number.isSafeInteger(origin.workflow_run_id) || origin.workflow_run_id < 1 ||
  !Number.isSafeInteger(origin.workflow_job_id) || origin.workflow_job_id < 1 ||
  !Number.isSafeInteger(origin.attempt) || origin.attempt < 1 ||
  !hash.test(origin.capture_receipt_sha256) ||
  !origin.migration_source
) {
  failures.push('missing full migration-source provenance from the canonical schema capture')
} else {
  if (!matchesMigrationSource(migrationSource, origin.migration_source)) {
    failures.push('full migration source changed; capture types from the current canonical replay and adopt its receipt')
  }
  if (origin.raw_output_sha256?.['database.types.ts'] !== actualHash) {
    failures.push('generated types do not match the selected canonical capture artifact')
  }
}
if (actualHash !== manifest.sha256) {
  failures.push(
    `generated type hash differs: expected ${manifest.sha256}, got ${actualHash}`,
  )
}
if (latestMigration !== manifest.latest_migration) {
  failures.push(
    `migration tail changed (${latestMigration}); regenerate Supabase types and update the manifest`,
  )
}
if (!generated.toString('utf8').includes('export type Database')) {
  failures.push('generated types do not export Database')
}

const generatedText = generated.toString('utf8')
const resolverReturnsMatch = generatedText.match(
  /resolve_ediel_timeseries_product_511:\s*\{[\s\S]*?Returns:\s*\{([\s\S]*?)\}\[\]/,
)
const resolverReturns = resolverReturnsMatch?.[1] ?? ''
if (!/description:\s*string\s*\|\s*null/.test(resolverReturns)) {
  failures.push(
    'resolve_ediel_timeseries_product_511 Returns.description must be string | null (run scripts/apply-supabase-types-nullability-overrides.cjs after typegen)',
  )
}
if (!/valid_to:\s*string\s*\|\s*null/.test(resolverReturns)) {
  failures.push(
    'resolve_ediel_timeseries_product_511 Returns.valid_to must be string | null (run scripts/apply-supabase-types-nullability-overrides.cjs after typegen)',
  )
}

if (failures.length) {
  console.error('Supabase generated-types check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(
  `Supabase generated types verified (${generated.length} bytes; ${latestMigration}; ${actualHash}).`,
)
