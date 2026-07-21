/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const name = '20260720233000_contract_product_lifecycle_go_live_completion.sql'
const migrationPath = path.join(root, 'supabase', 'migrations', name)
const manifestPath = path.join(root, 'scripts', 'migration-history-manifest.json')

if (!fs.existsSync(migrationPath)) {
  console.error(`Migration does not exist: ${migrationPath}`)
  process.exit(1)
}
if (!fs.existsSync(manifestPath)) {
  console.error(`Migration manifest does not exist: ${manifestPath}`)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.files = manifest.files ?? {}
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex')
const previous = manifest.files[name] ?? null
manifest.files[name] = checksum
manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)))
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Updated ${name}: ${previous ?? '<missing>'} -> ${checksum}`)
