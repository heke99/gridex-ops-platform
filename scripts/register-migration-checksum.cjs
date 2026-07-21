/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const name = process.argv[2]
if (!name || !/^\d{14}_[a-z0-9_]+\.sql$/i.test(name)) {
  console.error('Usage: node scripts/register-migration-checksum.cjs <YYYYMMDDHHMMSS_name.sql>')
  process.exit(1)
}
const migrationPath = path.join(root, 'supabase', 'migrations', name)
const manifestPath = path.join(root, 'scripts', 'migration-history-manifest.json')
if (!fs.existsSync(migrationPath)) {
  console.error(`Migration does not exist: ${name}`)
  process.exit(1)
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.files = manifest.files ?? {}
const checksum = crypto.createHash('sha256').update(fs.readFileSync(migrationPath)).digest('hex')
if (manifest.files[name] && manifest.files[name] !== checksum) {
  console.error(`Refusing to replace an existing different checksum for ${name}`)
  process.exit(1)
}
manifest.files[name] = checksum
manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)))
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Registered ${name}: ${checksum}`)
