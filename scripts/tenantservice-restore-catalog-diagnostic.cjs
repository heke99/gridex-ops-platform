#!/usr/bin/env node
'use strict'

// Compare only the private catalog payload, never application/Auth rows.
// Names identify schema objects; role names, ACL entries and raw SQL stay private.
const fs = require('node:fs')
const crypto = require('node:crypto')
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
function safe(value) {
  return String(value).replace(/\b(?:sb_(?:secret|publishable)_\S+|[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[redacted]')
    .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+|[^\s]+@[^\s]+/g, '[redacted]')
    .replace(/[^\x20-\x7e]/g, '?').slice(0, 160)
}
function groups(document, category) {
  if (!Array.isArray(document[category])) throw new Error('catalog_shape_invalid')
  const result = new Map()
  for (const row of document[category]) {
    if (!row || typeof row !== 'object' || typeof row.schema_name !== 'string') throw new Error('catalog_shape_invalid')
    const identity = category === 'defaultAcl'
      ? [row.creator, row.schema_name, row.object_type]
      : [row.kind, row.schema_name, row.object_name, row.arguments, row.column_name || '']
    const key = JSON.stringify(identity)
    const entry = result.get(key) || { identity, rows: [] }
    entry.rows.push(row)
    result.set(key, entry)
  }
  for (const entry of result.values()) entry.rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return result
}
function compare(before, after) {
  const changes = []
  for (const category of ['owners', 'acl', 'defaultAcl']) {
    const oldGroups = groups(before, category), newGroups = groups(after, category)
    for (const key of [...new Set([...oldGroups.keys(), ...newGroups.keys()])].sort()) {
      const oldEntry = oldGroups.get(key), newEntry = newGroups.get(key)
      const oldRows = oldEntry?.rows || [], newRows = newEntry?.rows || []
      if (digest(oldRows) === digest(newRows)) continue
      const identity = (oldEntry || newEntry).identity
      changes.push({ category, objectIdentitySha256: digest(identity),
        kind: safe(category === 'defaultAcl' ? identity[2] : identity[0]), schema: safe(identity[1]),
        object: category === 'defaultAcl' ? '[creator-private]' : safe(identity[2]),
        argumentsSha256: category === 'defaultAcl' ? null : digest(identity[3]),
        column: category === 'defaultAcl' ? null : safe(identity[4]),
        beforeCount: oldRows.length, afterCount: newRows.length,
        beforeSha256: digest(oldRows), afterSha256: digest(newRows) })
    }
  }
  return changes
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('catalog_diagnostic_requires_two_private_files')
    const documents = process.argv.slice(2).map(path => JSON.parse(fs.readFileSync(path, 'utf8')))
    const changes = compare(...documents)
    console.log(`TENANTSERVICE_RESTORE_CATALOG_DIFFERENCES count=${changes.length} shown=${Math.min(changes.length, 80)}`)
    for (const change of changes.slice(0, 80)) console.log(`TENANTSERVICE_RESTORE_CATALOG_OBJECT ${JSON.stringify(change)}`)
  } catch {
    console.error('TENANTSERVICE_RESTORE_CATALOG_DIAGNOSTIC_UNAVAILABLE')
    process.exitCode = 1
  }
}
module.exports = { compare }
