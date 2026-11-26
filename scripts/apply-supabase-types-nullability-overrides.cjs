#!/usr/bin/env node
/**
 * Supabase typegen currently emits non-null Returns for
 * resolve_ediel_timeseries_product_511.description / valid_to even though the
 * SQL returns-table columns are nullable. It also emits non-null UUID inputs
 * for the signature command's initial and replay paths.
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

if (
  returnsBlock === match[2] &&
  !(
    /description:\s*string\s*\|\s*null/.test(match[2]) &&
    /valid_to:\s*string\s*\|\s*null/.test(match[2])
  )
) {
  console.error('Nullability overrides did not change the Returns block')
  process.exit(1)
}

let overridden = original.replace(resolverPattern, `$1${returnsBlock}$3`)
const signatureCommandName = /^\s*gridex_queue_customer_contract_signature_command_v1\s*:/m
const signatureCommandArgs =
  /(gridex_queue_customer_contract_signature_command_v1:\s*\{\s*Args:\s*\{)([\s\S]*?)(\n\s*\}\s*\n\s*Returns:)/

// Historical schema captures can precede the signature command migration.
if (signatureCommandName.test(original)) {
  const signatureMatch = original.match(signatureCommandArgs)
  if (!signatureMatch || !/\bp_command_id:\s*string\b/.test(signatureMatch[2]) ||
    !/\bp_expected_request_id:\s*string\b/.test(signatureMatch[2])) {
    console.error('Could not locate signature command UUID inputs for nullability overrides')
    process.exit(1)
  }

  overridden = overridden.replace(signatureCommandArgs, (_, start, args, end) => {
    const nullableArgs = args
      .replace(/(\bp_command_id:\s*)string(\s*\|\s*null)?/, '$1string | null')
      .replace(/(\bp_expected_request_id:\s*)string(\s*\|\s*null)?/, '$1string | null')
    return `${start}${nullableArgs}${end}`
  })
}

const next = overridden.replace(/\s+$/u, '\n')
if (next === original) {
  console.log(
    `Supabase types nullability overrides already present: ${path.relative(process.cwd(), targetPath)}`,
  )
  process.exit(0)
}

fs.writeFileSync(targetPath, next)
console.log(
  `Applied Supabase types nullability overrides: ${path.relative(process.cwd(), targetPath)}`,
)
