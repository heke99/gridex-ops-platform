import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const source = (name: string) => readFileSync(resolve(root, name), 'utf8')
const catalog = source('scripts/sql/staff-native-role-catalog-fixture.sql')
const schema = source('supabase/schema.sql')
const require = createRequire(import.meta.url)
const { buildStaffIntegrationAuthFixture } = require('../scripts/lib/staff-api-integration-auth-fixture.cjs')
const producers = [
  'scripts/staff-user-commands-regression.sql',
  'scripts/staff-user-client-guard-regression.sql',
  'scripts/staff-user-actor-guard-regression.sql',
  'scripts/staff-user-concurrency-native.test.ts',
  'scripts/staff-user-client-concurrency-native.test.ts',
]
let db: PGlite

// Execute each real producer's seed through its role lookup/assignment, before
// its first client INSERT or domain command. No native command is stubbed.
function actualSeed(name: string): string {
  const text = source(name)
  if (name.endsWith('.sql')) {
    const tag = /\nDO (\$\w*\$)/.exec(text)?.[1]
    const end = text.indexOf('  INSERT INTO public.integration_api_clients')
    if (!tag || end < 0) throw new Error(`Missing actual SQL seed boundary: ${name}`)
    return text.slice(0, end).replace(/^\\set[^\n]*\n/m, '').replace('\\ir sql/staff-native-role-catalog-fixture.sql', catalog) + `END ${tag};`
  }
  const template = /await sql\(`(BEGIN;[\s\S]+?COMMIT;)`\)/.exec(text)?.[1]
  if (!template) throw new Error(`Missing actual native seed template: ${name}`)
  const f = Object.fromEntries(['company', 'actor', 'adminA', 'adminB', 'target', 'client'].map(key => [key, randomUUID()]))
  // This evaluates only the checked-in fixture template, with fresh synthetic
  // IDs and the real shared SQL. It does not execute the native test module.
  const seed = new Function('f', 'roleCatalogFixture', 'mode', 'command', `return \`${template}\``)(f, catalog, 'first_write', '') as string
  const end = seed.indexOf('        INSERT INTO public.integration_api_clients')
  if (end < 0) throw new Error(`Missing native role seed boundary: ${name}`)
  return seed.slice(0, end)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(buildStaffIntegrationAuthFixture(root))
  const auth = /create table if not exists auth\.users \([\s\S]+?\n\);/.exec(source('scripts/sql/gridex-supabase-compatible-bootstrap.sql'))?.[0]
  if (!auth) throw new Error('Missing source Auth table')
  const names = ['roles', 'user_profiles', 'company_memberships', 'user_roles', 'user_permissions']
  const tables = names.map(name => {
    const table = new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]+?\\n\\);`).exec(schema)?.[0]
    if (!table) throw new Error(`Missing source table: ${name}`)
    return table
  })
  const constraints = schema.split(/\n--\n-- Name:/).flatMap(block => {
    const match = /ALTER TABLE ONLY public\.([a-z0-9_]+)\s+ADD CONSTRAINT/.exec(block)
    return match && names.includes(match[1]) && !block.includes('FOREIGN KEY') ? [block.slice(match.index).trim()] : []
  })
  // The real account seed now verifies RLS and effective write privileges before
  // its role lookup. Retain that preflight by loading the captured table security.
  const roleSecurity = [
    /^ALTER TABLE public\.user_roles ENABLE ROW LEVEL SECURITY;$/m,
    /^GRANT [^\n;]+ ON TABLE public\.user_roles TO authenticated;$/m,
  ].map(pattern => {
    const statement = schema.match(pattern)?.[0]
    if (!statement) throw new Error(`Missing captured user_roles security: ${pattern}`)
    return statement
  })
  // The compatibility bootstrap has a minimal Auth shape; genuine Supabase
  // adds is_sso_user, exercised successfully before the CI role-seed failures.
  await db.exec(['CREATE SCHEMA auth;', auth, 'ALTER TABLE auth.users ADD COLUMN is_sso_user boolean NOT NULL DEFAULT false;', ...tables, ...constraints, ...roleSecurity].join('\n'))
}, 20_000)
afterAll(async () => { await db?.close() })

it.each(producers)('prepares actual %s role references on an empty native catalog', async name => {
  const seed = actualSeed(name)
  try {
    await expect(db.exec(seed.replace(catalog, ''))).rejects.toThrow(/role definitions missing|roles_missing|role_fixture_missing/)
  } finally { await db.exec('ROLLBACK;') }
  try {
    await db.exec(seed)
    expect((await db.query<{ key: string; scope: string; is_active: boolean }>('SELECT key,scope,is_active FROM roles ORDER BY key')).rows).toEqual([
      { key: 'company_admin', scope: 'company', is_active: true },
      { key: 'customer_service_agent', scope: 'company', is_active: true },
      { key: 'operations_agent', scope: 'company', is_active: true },
    ])
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.company_id IS NOT NULL AND ur.role=r.key')).rows[0].count).toBeGreaterThanOrEqual(2)
  } finally { await db.exec('ROLLBACK;') }
})

it('uses the real global unique key without updating existing roles or granting account authority', async () => {
  await db.exec('BEGIN;')
  try {
    const existing = randomUUID()
    await db.query("INSERT INTO roles(id,key,name,description,scope,is_active) VALUES($1,'company_admin','Existing role','Retained description','company',false)", [existing])
    await db.exec(catalog)
    await db.exec(catalog)
    expect((await db.query('SELECT id,name,description,scope,is_active FROM roles WHERE key=$1', ['company_admin'])).rows[0]).toEqual({ id: existing, name: 'Existing role', description: 'Retained description', scope: 'company', is_active: false })
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM roles')).rows[0].count).toBe(3)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM user_roles')).rows[0].count).toBe(0)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM user_permissions')).rows[0].count).toBe(0)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer count FROM auth.users')).rows[0].count).toBe(0)
    await expect(db.exec("INSERT INTO roles(key,name) VALUES('operations_agent','Duplicate')")).rejects.toMatchObject({ code: '23505', constraint: 'roles_key_key' })
  } finally { await db.exec('ROLLBACK;') }
})
