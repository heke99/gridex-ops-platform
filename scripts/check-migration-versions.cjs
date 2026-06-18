const fs = require('fs')
const path = require('path')

const directory = path.join(process.cwd(), 'supabase', 'migrations')
const legacyDuplicateVersions = new Set(['20260612193000', '20260616123000'])
const byVersion = new Map()
for (const name of fs.readdirSync(directory)) {
  const match = name.match(/^(\d{14})_.+\.sql$/)
  if (!match) continue
  const items = byVersion.get(match[1]) ?? []
  items.push(name)
  byVersion.set(match[1], items)
}
const unexpected = [...byVersion.entries()].filter(([version, files]) => files.length > 1 && !legacyDuplicateVersions.has(version))
if (unexpected.length) {
  console.error('Duplicate migration versions detected:')
  for (const [version, files] of unexpected) console.error(`- ${version}: ${files.join(', ')}`)
  process.exit(1)
}
console.log(`Migration version check passed (${byVersion.size} versions; legacy collisions explicitly quarantined).`)
