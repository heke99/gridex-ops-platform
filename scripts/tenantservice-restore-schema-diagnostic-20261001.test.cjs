'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { compare, output } = require('./tenantservice-restore-schema-diagnostic.cjs')
const categories = ['schemas', 'relations', 'columns', 'enums', 'constraints', 'indexes', 'functions', 'triggers', 'policies', 'relation_grants', 'function_grants', 'schema_grants', 'extensions']
const empty = () => Object.fromEntries(categories.map(category => [category, []]))
const clone = value => JSON.parse(JSON.stringify(value))
const canary = 'PRIVATE sb_secret_CATALOG_CANARY https://private.invalid user@private.invalid';
function fixture() {
  const value = empty()
  value.columns = [{ nspname: 'private', relname: canary, attname: 'binding', attnum: 4, data_type: 'uuid', column_default: canary }]
  value.policies = [{ nspname: 'private', relname: canary, polname: canary, using_expression: canary, check_expression: '', roles: [canary] }]
  return value
}
test('column position and policy expression differences retain exact categories/field hashes without private values', () => {
  const before = fixture(), after = clone(before)
  after.columns[0].attnum = 3; after.policies[0].using_expression += ' changed'
  const changes = compare(before, after)
  assert.deepEqual(changes.map(change => [change.category, change.changedFields.map(field => field.field)]), [['columns', ['attnum']], ['policies', ['using_expression']]])
  assert.ok(changes.every(change => /^[a-f0-9]{64}$/.test(change.objectIdentitySha256)))
  const text = output(changes)
  assert.doesNotMatch(text, /PRIVATE|sb_secret|private\.invalid|user@|binding/)
  assert.match(text, /count=2 shown=2/)
})
test('all thirteen categories remain visible, including real ACL, RLS and function changes', () => {
  const before = empty(), after = empty()
  const keys = { relations: ['nspname', 'relname'], columns: ['nspname', 'relname', 'attname'], enums: ['nspname', 'typname', 'enumlabel'], constraints: ['nspname', 'relname', 'conname'], indexes: ['nspname', 'relname', 'indexname'], functions: ['nspname', 'proname', 'identity_arguments'], triggers: ['nspname', 'relname', 'tgname'], policies: ['nspname', 'relname', 'polname'], relation_grants: ['nspname', 'relname', 'grantee', 'privilege_type'], function_grants: ['nspname', 'proname', 'identity_arguments', 'grantee', 'privilege_type'], schema_grants: ['nspname', 'grantee', 'privilege_type'], extensions: ['extname'] }
  after.schemas = ['private']
  for (const [category, fields] of Object.entries(keys)) after[category] = [Object.fromEntries(fields.map(field => [field, canary]))]
  assert.deepEqual(compare(before, after).map(change => change.category), categories)
  assert.doesNotMatch(output(compare(before, after)), /PRIVATE|sb_secret|private\.invalid/)
})
test('only pg_cron matches the original exclusion and unchanged object field ordering is immaterial', () => {
  const before = fixture(), after = clone(before)
  before.extensions = [{ extname: 'pg_cron', extversion: '1', nspname: 'cron' }]
  after.columns = after.columns.map(row => Object.fromEntries(Object.entries(row).reverse()))
  assert.deepEqual(compare(before, after), [])
  after.extensions.push({ extname: 'pgcrypto', extversion: '2', nspname: 'extensions' })
  assert.equal(compare(before, after)[0].category, 'extensions')
})
test('unknown fields are hashed under a fixed field name, unknown categories and duplicate identities refuse safely', () => {
  const before = fixture(), after = clone(before)
  after.columns[0][canary] = canary
  assert.equal(compare(before, after)[0].changedFields[0].field, '[extra-fields]')
  assert.doesNotMatch(output(compare(before, after)), /PRIVATE|sb_secret|private\.invalid/)
  assert.throws(() => compare(before, { ...after, [canary]: [] }), /shape_invalid/)
  after.columns.push(clone(after.columns[0]))
  assert.throws(() => compare(before, after), /duplicate_identity/)
})
test('large changes are counted completely but at most eighty object records are emitted', () => {
  const before = empty(), after = empty()
  after.columns = Array.from({ length: 111 }, (_, i) => ({ nspname: 'private', relname: canary, attname: String(i) }))
  const text = output(compare(before, after))
  assert.match(text, /count=111 shown=80/)
  assert.equal(text.split('\n').filter(line => line.startsWith('TENANTSERVICE_RESTORE_SCHEMA_OBJECT ')).length, 80)
  assert.doesNotMatch(text, /PRIVATE|sb_secret|private\.invalid/)
})
test('actual CLI emits bounded hashes; malformed private JSON emits only the constant failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tenantservice-schema-diagnostic.'))
  try {
    const before = join(directory, 'before.json'), after = join(directory, 'after.json')
    writeFileSync(before, JSON.stringify(fixture()), { mode: 0o600 })
    const changed = fixture(); changed.policies[0].roles = [canary + ' changed']
    writeFileSync(after, JSON.stringify(changed), { mode: 0o600 })
    let result = spawnSync(process.execPath, ['--no-warnings', join(__dirname, 'tenantservice-restore-schema-diagnostic.cjs'), before, after], { encoding: 'utf8' })
    assert.equal(result.status, 0); assert.match(result.stdout, /"field":"roles"/)
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE|sb_secret|private\.invalid/)
    writeFileSync(after, canary)
    result = spawnSync(process.execPath, ['--no-warnings', join(__dirname, 'tenantservice-restore-schema-diagnostic.cjs'), before, after], { encoding: 'utf8' })
    assert.equal(result.status, 1); assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'TENANTSERVICE_RESTORE_SCHEMA_DIAGNOSTIC_UNAVAILABLE\n')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
