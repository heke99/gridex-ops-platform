/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const directory = path.join(root, 'supabase', 'migrations')
const manifestPath = path.join(root, 'scripts', 'migration-history-manifest.json')
const additionsPath = path.join(root, 'scripts', 'migration-history-manifest.additions.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const additions = fs.existsSync(additionsPath)
  ? JSON.parse(fs.readFileSync(additionsPath, 'utf8'))
  : { files: {} }
const allowedLegacyCollisions = manifest.allowedLegacyCollisions ?? {}
const allowedUnversionedFiles = new Set(manifest.allowedUnversionedFiles ?? [])
const baseFiles = manifest.files ?? {}
const additionFiles = additions.files ?? {}
const expectedFiles = { ...baseFiles, ...additionFiles }
const actualNames = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
const failures = []

for (const [name, checksum] of Object.entries(additionFiles)) {
  if (baseFiles[name] && baseFiles[name] !== checksum) {
    failures.push(`Additive manifest conflicts with canonical checksum: ${name}`)
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

const byVersion = new Map()
for (const name of actualNames) {
  const recognized = /^(\d{2}|\d{8}|\d{14})_.+\.sql$/.exec(name)
  if (!recognized) {
    if (!allowedUnversionedFiles.has(name)) failures.push(`Unversioned migration is not allowlisted: ${name}`)
    continue
  }
  const match = /^(\d{14})_.+\.sql$/.exec(name)
  if (!match) continue
  const items = byVersion.get(match[1]) ?? []
  items.push(name)
  byVersion.set(match[1], items)
}

for (const [version, files] of byVersion.entries()) {
  if (files.length <= 1) continue
  const allowed = [...(allowedLegacyCollisions[version] ?? [])].sort()
  const actual = [...files].sort()
  if (JSON.stringify(allowed) !== JSON.stringify(actual)) {
    failures.push(`Unexpected migration collision ${version}: ${actual.join(', ')}`)
  }
}

for (const name of actualNames) {
  const expected = expectedFiles[name]
  if (!expected) {
    failures.push(`Migration is missing from checksum manifest: ${name}`)
    continue
  }
  const actual = sha256(path.join(directory, name))
  if (actual !== expected) failures.push(`Migration checksum changed: ${name}`)
}

for (const name of Object.keys(expectedFiles)) {
  if (!actualNames.includes(name)) failures.push(`Manifest references a missing migration: ${name}`)
}

if (failures.length > 0) {
  console.error(`Migration integrity check failed (${failures.length} issue(s)):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Migration integrity check passed (${actualNames.length} files; ${byVersion.size} version groups; checksums verified).`)
