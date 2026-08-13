#!/usr/bin/env node
/**
 * Supabase typegen currently emits non-null Returns for
 * resolve_ediel_timeseries_product_511.description / valid_to even though the
 * SQL returns-table columns are nullable. Apply durable overrides after gen so
 * clean-replay and committed types stay aligned with SQL nullability.
 */
const fs = require('node:fs')
const path = require('node:path')

const targetArg = process.argv[2]
const targetPath = path.resolve(
  process.cwd(),
  targetArg || 'supabase/database.types.ts',
)

if (!fs.existsSync(targetPath)) {
  console.error(`Missing types file: ${targetPath}`)
  process.exit(1)
}

const original = fs.readFileSync(targetPath, 'utf8')
const resolverPattern =
  /(resolve_ediel_timeseries_product_511:\s*\{[\s\S]*?Returns:\s*\{)([\s\S]*?)(\}\[\])/

const match = original.match(resolverPattern)
if (!match) {
  console.error(
    'Could not locate resolve_ediel_timeseries_product_511 Returns block for nullability overrides',
  )
  process.exit(1)
}

let returnsBlock = match[2]
returnsBlock = returnsBlock
  .replace(/(\bdescription:\s*)string(\s*\|\s*null)?/, '$1string | null')
  .replace(/(\bvalid_to:\s*)string(\s*\|\s*null)?/, '$1string | null')

const next = original.replace(resolverPattern, `$1${returnsBlock}$3`)
if (next === original) {
  // Already overridden or unexpected shape — still rewrite to keep idempotent.
  if (
    /description:\s*string\s*\|\s*null/.test(match[2]) &&
    /valid_to:\s*string\s*\|\s*null/.test(match[2])
  ) {
    console.log(
      `Supabase types nullability overrides already present: ${path.relative(process.cwd(), targetPath)}`,
    )
    process.exit(0)
  }
  console.error('Nullability overrides did not change the Returns block')
  process.exit(1)
}

fs.writeFileSync(targetPath, next)
console.log(
  `Applied Supabase types nullability overrides: ${path.relative(process.cwd(), targetPath)}`,
)
