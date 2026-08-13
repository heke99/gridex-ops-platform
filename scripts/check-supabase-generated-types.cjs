#!/usr/bin/env node
const { createHash } = require('node:crypto')
const { readdirSync, readFileSync } = require('node:fs')
const { basename, join, resolve } = require('node:path')

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
