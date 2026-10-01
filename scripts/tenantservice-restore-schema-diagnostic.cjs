#!/usr/bin/env node
'use strict'

// Bounded diagnostics of the complete logical catalog. This never authorizes
// restoration or changes the strict equality gate. Identities and field values
// remain private; only fixed category/field names, counts and hashes are emitted.
const fs = require('node:fs')
const crypto = require('node:crypto')
const shapes = {
  schemas: { identity: [], fields: [] },
  relations: { identity: ['nspname', 'relname'], fields: ['nspname', 'relname', 'relkind', 'relrowsecurity', 'relforcerowsecurity', 'view_definition', 'partition_key'] },
  columns: { identity: ['nspname', 'relname', 'attname'], fields: ['nspname', 'relname', 'attnum', 'attname', 'data_type', 'udt_name', 'is_nullable', 'column_default', 'identity', 'generated'] },
  enums: { identity: ['nspname', 'typname', 'enumlabel'], fields: ['nspname', 'typname', 'enumlabel', 'enumsortorder'] },
  constraints: { identity: ['nspname', 'relname', 'conname'], fields: ['nspname', 'relname', 'conname', 'contype', 'definition', 'convalidated'] },
  indexes: { identity: ['nspname', 'relname', 'indexname'], fields: ['nspname', 'relname', 'indexname', 'definition', 'indisunique', 'indisprimary'] },
  functions: { identity: ['nspname', 'proname', 'identity_arguments'], fields: ['nspname', 'proname', 'identity_arguments', 'arguments', 'return_type', 'security_definer', 'volatility', 'kind', 'body_md5'] },
  triggers: { identity: ['nspname', 'relname', 'tgname'], fields: ['nspname', 'relname', 'tgname', 'definition', 'enabled'] },
  policies: { identity: ['nspname', 'relname', 'polname'], fields: ['nspname', 'relname', 'polname', 'command', 'permissive', 'using_expression', 'check_expression', 'roles'] },
  relation_grants: { identity: ['nspname', 'relname', 'grantee', 'privilege_type'], fields: ['nspname', 'relname', 'grantee', 'privilege_type'] },
  function_grants: { identity: ['nspname', 'proname', 'identity_arguments', 'grantee', 'privilege_type'], fields: ['nspname', 'proname', 'identity_arguments', 'grantee', 'privilege_type'] },
  schema_grants: { identity: ['nspname', 'grantee', 'privilege_type'], fields: ['nspname', 'grantee', 'privilege_type'] },
  extensions: { identity: ['extname'], fields: ['extname', 'extversion', 'nspname'] },
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex')
function rows(document, category) {
  const shape = shapes[category]
  if (!Array.isArray(document[category])) throw new Error('private_catalog_shape_invalid')
  const result = new Map()
  for (const row of document[category]) {
    // The original gate excludes only cluster-owned pg_cron, identically here.
    if (category === 'extensions' && row?.extname === 'pg_cron') continue
    if (category === 'schemas') {
      if (typeof row !== 'string') throw new Error('private_catalog_shape_invalid')
    } else if (!row || typeof row !== 'object' || Array.isArray(row) || shape.identity.some(key => typeof row[key] !== 'string')) {
      throw new Error('private_catalog_shape_invalid')
    }
    const identity = category === 'schemas' ? [row] : shape.identity.map(key => row[key])
    const key = JSON.stringify(identity)
    if (result.has(key)) throw new Error('private_catalog_duplicate_identity')
    result.set(key, { identity, row })
  }
  return result
}
function compare(before, after) {
  for (const document of [before, after]) {
    if (!document || typeof document !== 'object' || Array.isArray(document) ||
        Object.keys(document).some(key => !Object.hasOwn(shapes, key))) throw new Error('private_catalog_shape_invalid')
  }
  const changes = []
  for (const category of Object.keys(shapes)) {
    const left = rows(before, category), right = rows(after, category)
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const old = left.get(key), current = right.get(key)
      if (digest(old?.row) === digest(current?.row)) continue
      const changedFields = []
      if (old && current && category !== 'schemas') {
        for (const field of shapes[category].fields) if (digest(old.row[field]) !== digest(current.row[field])) {
          changedFields.push({ field, beforeSha256: digest(old.row[field]), afterSha256: digest(current.row[field]) })
        }
        const extras = row => Object.fromEntries(Object.entries(row).filter(([field]) => !shapes[category].fields.includes(field)))
        if (digest(extras(old.row)) !== digest(extras(current.row))) changedFields.push({ field: '[extra-fields]', beforeSha256: digest(extras(old.row)), afterSha256: digest(extras(current.row)) })
      }
      changes.push({ category, objectIdentitySha256: digest((old || current).identity),
        change: !old ? 'added' : !current ? 'removed' : 'changed',
        beforeSha256: digest(old?.row), afterSha256: digest(current?.row), changedFields })
    }
  }
  return changes
}
function output(changes) {
  const summary = Object.fromEntries(Object.keys(shapes).map(category => [category, changes.filter(change => change.category === category).length]))
  const lines = [`TENANTSERVICE_RESTORE_SCHEMA_DIFFERENCES count=${changes.length} shown=${Math.min(changes.length, 80)} categories=${JSON.stringify(summary)}`]
  for (const change of changes.slice(0, 80)) lines.push(`TENANTSERVICE_RESTORE_SCHEMA_OBJECT ${JSON.stringify(change)}`)
  return lines.join('\n') + '\n'
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('two_private_catalog_files_required')
    const documents = process.argv.slice(2).map(path => {
      if (fs.statSync(path).size > 64 * 1024 * 1024) throw new Error('private_catalog_size_invalid')
      return JSON.parse(fs.readFileSync(path, 'utf8'))
    })
    process.stdout.write(output(compare(...documents)))
  } catch {
    console.error('TENANTSERVICE_RESTORE_SCHEMA_DIAGNOSTIC_UNAVAILABLE')
    process.exitCode = 1
  }
}
module.exports = { compare, output }
