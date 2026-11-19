/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const directory = path.join(root, 'supabase', 'migrations')
const manifestPath = path.join(root, 'scripts', 'migration-history-manifest.json')
const manifestPaths = [
  manifestPath,
  path.join(root, 'scripts', 'migration-history-manifest.additions.json'),
  path.join(root, 'scripts', 'migration-history-manifest.ediel.additions.json'),
  path.join(root, 'scripts', 'migration-history-manifest.runtime.additions.json'),
]
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const allowedLegacyCollisions = manifest.allowedLegacyCollisions ?? {}
const allowedUnversionedFiles = new Set(manifest.allowedUnversionedFiles ?? [])
const failures = []
const registrations = new Map()

for (const sourcePath of manifestPaths) {
  if (sourcePath !== manifestPath && !fs.existsSync(sourcePath)) continue
  const source = sourcePath === manifestPath ? manifest : JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  for (const [name, checksum] of Object.entries(source.files ?? {})) {
    const sources = registrations.get(name) ?? []
    sources.push({ sourcePath, checksum })
    registrations.set(name, sources)
  }
}

const actualNames = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
const conflictingAdditions = new Set()
for (const [name, sources] of registrations) {
  const first = sources[0]
  if (sources.every(({ checksum }) => checksum === first.checksum)) continue

  const canonical = first.sourcePath === manifestPath
  if (!canonical) conflictingAdditions.add(name)
  const issue = canonical ? 'Additive manifest conflicts with canonical checksum' : 'Additive manifests conflict on checksum'
  const origins = sources.map(({ sourcePath, checksum }) => `${path.basename(sourcePath)}=${checksum}`).join(', ')
  failures.push(`${issue}: ${name} (${origins})`)
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function checksumDiagnostics(value) {
  const text = String(value ?? '')
  return `len=${Buffer.byteLength(text, 'utf8')},hex=${Buffer.from(text, 'utf8').toString('hex')}`
}

const byVersion = new Map()
for (const name of actualNames) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8')
  if (/^\s*do\s+\$\s*$/im.test(source) || /^\s*\$;\s*$/m.test(source)) {
    failures.push(
      `Migration contains an invalid single-dollar anonymous block delimiter: ${name}`,
    )
  }

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
  // An additive-only disagreement leaves the byte checksum unverified.
  if (conflictingAdditions.has(name)) continue
  const actual = sha256(path.join(directory, name))
  const expected = registrations.get(name)?.[0].checksum
  if (!expected) {
    failures.push(`Migration is missing from checksum manifest: ${name} (sha256=${actual})`)
    continue
  }
  if (actual !== expected) {
    failures.push(
      `Migration checksum changed: ${name} (expected=${expected}, actual=${actual}; expected_${checksumDiagnostics(expected)}; actual_${checksumDiagnostics(actual)})`,
    )
  }
}

for (const name of registrations.keys()) {
  if (!actualNames.includes(name)) failures.push(`Manifest references a missing migration: ${name}`)
}

if (failures.length > 0) {
  console.error(`Migration integrity check failed (${failures.length} issue(s)):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Migration integrity check passed (${actualNames.length} files; ${byVersion.size} version groups; checksums verified).`)
