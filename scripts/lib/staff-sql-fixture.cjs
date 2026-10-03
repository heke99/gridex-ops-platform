// Diagnostic fixture only. Definitions come from the committed schema; this
// does not replace the full Supabase clean replay or provider/Storage tests.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture shared by native and optional diagnostic runners. */
const fs = require('node:fs')
const path = require('node:path')

const tables = new Set([
  'admin_users', 'companies', 'company_memberships', 'integration_api_clients', 'user_profiles',
  'user_roles', 'user_permissions', 'roles', 'permissions', 'role_permissions',
  'customers', 'customer_sites', 'customer_contacts', 'customer_addresses',
  'customer_cases', 'customer_case_events', 'customer_case_attachments', 'audit_logs',
  'platform_table_classification',
])

function buildStaffFixture(root, { wasm = false } = {}) {
  const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
  const blocks = schema.split(/\n--\n-- Name:/)
  const functions = new Map()
  const definitions = []
  const constraints = []
  const uniqueIndexes = []
  const triggers = []
  const privileges = []
  const needed = new Set([
    'canonical_actor_is_platform_admin', 'gridex_get_user_permissions_in_company',
    'gridex_is_current_session_allowed', 'canonical_authenticated_tenant_context',
    'canonical_authenticated_tenant_context_v1_scoped',
    'gridex_actor_has_company_permission', 'gridex_update_customer_case_status',
  ])
  for (const block of blocks) {
    const aclTable = /GRANT [^;]* ON TABLE public\.([a-z0-9_]+) TO service_role;/.exec(block)
    if (aclTable && tables.has(aclTable[1])) {
      privileges.push(...block.match(/(?:GRANT|REVOKE) [^;]* ON TABLE public\.[a-z0-9_]+[^;]*;/g) || [])
      continue
    }
    const fn = /CREATE FUNCTION public\.([a-z0-9_]+)\(/.exec(block)
    if (fn) {
      const body = block.slice(fn.index).trim()
      functions.set(fn[1], [...(functions.get(fn[1]) || []), body])
      continue
    }
    const table = /CREATE TABLE public\.([a-z0-9_]+)\s*\(/.exec(block)
    if (table && tables.has(table[1])) {
      const body = block.slice(table.index).trim()
      definitions.push(body)
      for (const match of body.matchAll(/public\.([a-z0-9_]+)\(/g)) needed.add(match[1])
      continue
    }
    const alter = /ALTER TABLE ONLY public\.([a-z0-9_]+)\s+ADD CONSTRAINT/.exec(block)
    if (alter && tables.has(alter[1])) {
      const refs = [...block.matchAll(/REFERENCES public\.([a-z0-9_]+)/g)]
      if (refs.every(match => tables.has(match[1]))) constraints.push(block.slice(alter.index).trim())
    }
    const index = /CREATE UNIQUE INDEX [a-z0-9_]+ ON public\.([a-z0-9_]+)/.exec(block)
    if (index && tables.has(index[1])) uniqueIndexes.push(block.slice(index.index).trim())
    const trigger = /CREATE TRIGGER audit_logs_normalize_context_v1[\s\S]*?EXECUTE FUNCTION public\.([a-z0-9_]+)\(/.exec(block)
    if (trigger) { triggers.push(block.slice(trigger.index).trim()); needed.add(trigger[1]) }
  }
  for (const name of needed) {
    const bodies = functions.get(name)
    if (!bodies) throw new Error(`Missing source-defined fixture function: ${name}`)
    for (const body of bodies) for (const match of body.matchAll(/public\.([a-z0-9_]+)\(/g)) {
      if (functions.has(match[1])) needed.add(match[1])
    }
  }
  const missing = [...tables].filter(name => !definitions.some(body => body.startsWith(`CREATE TABLE public.${name} (`)))
  if (missing.length) throw new Error(`Missing source-defined fixture tables: ${missing.join(', ')}`)
  let bootstrap = fs.readFileSync(path.join(root, 'scripts/sql/gridex-supabase-compatible-bootstrap.sql'), 'utf8')
  // These extensions are unavailable in the optional WASM diagnostic. Core
  // PostgreSQL SHA-256 gives the same digest for the reference derivation.
  if (wasm) bootstrap = bootstrap.replace(/^create extension.*;$/gm, '').replace('create schema if not exists extensions;', () => `
create schema if not exists extensions;
CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to($1,'UTF8')) $$;
CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT sha256($1) $$;
CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql VOLATILE AS $$ SELECT pg_catalog.gen_random_uuid() $$;
`)
  const factorSurface = `
ALTER TABLE auth.sessions ADD COLUMN IF NOT EXISTS aal text;
CREATE TABLE IF NOT EXISTS auth.mfa_factors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 factor_type text NOT NULL, status text NOT NULL, friendly_name text
);
`
  const policies = `
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS temporary_password_set_at timestamptz;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz;
-- This optional live Auth-adjacent column is absent from the committed dump,
-- but verified through information_schema on OPS before this fixture was built.
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS expires_at timestamptz;
`
  return [bootstrap, factorSurface, 'SET check_function_bodies=off;',
    ...[...needed].flatMap(name => functions.get(name)), ...definitions,
    ...constraints.filter(body => !body.includes('FOREIGN KEY')), ...uniqueIndexes,
    ...constraints.filter(body => body.includes('FOREIGN KEY')), policies, ...triggers, ...privileges,
    'SET check_function_bodies=on;'].join('\n')
}

module.exports = { buildStaffFixture }

if (require.main === module) {
  if (process.env.GRIDEX_STAFF_API_NATIVE_TEST !== '1') throw new Error('Explicit native fixture mode is required')
  process.stdout.write(buildStaffFixture(path.resolve(__dirname, '../..')))
}
