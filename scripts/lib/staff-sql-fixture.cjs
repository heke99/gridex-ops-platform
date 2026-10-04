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
  'integration_api_rate_limit_buckets', 'tenant_website_installation_receipts',
  'company_capabilities',
])

function buildStaffFixture(root, { wasm = false, postgresMajor } = {}) {
  if (postgresMajor !== undefined && ![16, 17].includes(postgresMajor)) throw new Error('Expected an observed PostgreSQL 16/17 major version')
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
    'authenticate_integration_request_v1', 'authenticate_integration_request_v1_credential_core',
    'integration_api_scope_present_v1', 'integration_api_rate_limit_check',
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
  // The public schema dump intentionally omits private credential functions.
  // Recover the real native body and its exact historical rename/ACL statements
  // from committed migrations; no substitute authentication implementation.
  const authSource = fs.readFileSync(path.join(root, 'supabase/migrations/20260809191057_authenticate_integration_request_route_cost.sql'), 'utf8')
  const canonicalSource = fs.readFileSync(path.join(root, 'supabase/migrations/20260810185155_gridex_canonical_architecture_p0.sql'), 'utf8')
  const privateSource = fs.readFileSync(path.join(root, 'supabase/migrations/20260810224500_canonical_review_remediation_v1.sql'), 'utf8')
  const exact = (source, pattern, label) => {
    const matches = [...source.matchAll(pattern)]
    if (matches.length !== 1) throw new Error(`Expected one source-defined ${label}, found ${matches.length}`)
    return matches[0][0]
  }
  const nativeCredential = [
    exact(authSource, /create or replace function public\.authenticate_integration_request_v1\([\s\S]+?\n\$\$;/g, 'native credential core'),
    exact(canonicalSource, /alter function public\.authenticate_integration_request_v1\([\s\S]+?\) rename to authenticate_integration_request_v1_credential_core;/g, 'canonical core rename'),
    exact(privateSource, /create schema if not exists private;/g, 'private credential schema'),
    exact(privateSource, /revoke all on schema private[^;]+;/g, 'private schema ACL'),
    exact(privateSource, /alter function public\.authenticate_integration_request_v1_credential_core\([\s\S]+?\) set schema private;/g, 'private credential move'),
    exact(privateSource, /alter function private\.authenticate_integration_request_v1_credential_core\([\s\S]+?\) rename to authenticate_integration_request_v1_secret_internal;/g, 'private credential rename'),
    exact(privateSource, /revoke all on function private\.authenticate_integration_request_v1_secret_internal\([\s\S]+?\) from public, anon, authenticated, service_role;/g, 'private credential ACL'),
  ]
  const nativeAuthPrivileges = ['authenticate_integration_request_v1', 'authenticate_integration_request_v1_credential_core'].flatMap(name => [
    exact(privateSource, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]+?\\) from public, anon, authenticated;`, 'g'), `${name} revoke`),
    exact(privateSource, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]+?\\) to service_role;`, 'g'), `${name} grant`),
  ])
  // MAINTAIN was introduced in PostgreSQL 17. A source dump from 17 cannot
  // replay that privilege on 16, where it does not exist. Remove only that
  // table-ACL token in the explicitly observed native-16 fixture. This grants
  // no replacement privilege and never alters function/schema/Auth ACLs.
  // Native 17, unspecified versions and the WASM diagnostic keep source ACLs.
  const tablePrivileges = postgresMajor === 16 && !wasm ? privileges.flatMap(statement => {
    const match = /^(GRANT|REVOKE)\s+(.+?)(\s+ON TABLE\s+[\s\S]+)$/i.exec(statement)
    if (!match) throw new Error('Expected a source-defined table privilege statement')
    const list = match[2].split(',')
    const supported = list.filter(privilege => privilege.trim().toUpperCase() !== 'MAINTAIN')
    if (supported.length === list.length) return [statement]
    return supported.length ? [`${match[1]} ${supported.join(',')}${match[3]}`] : []
  }) : privileges
  return [bootstrap, factorSurface, 'SET check_function_bodies=off;',
    ...nativeCredential, ...[...needed].flatMap(name => functions.get(name)), ...definitions,
    ...constraints.filter(body => !body.includes('FOREIGN KEY')), ...uniqueIndexes,
    ...constraints.filter(body => body.includes('FOREIGN KEY')), ...triggers, ...tablePrivileges, ...nativeAuthPrivileges,
    'SET check_function_bodies=on;'].join('\n')
}

module.exports = { buildStaffFixture }

if (require.main === module) {
  if (process.env.GRIDEX_STAFF_API_NATIVE_TEST !== '1') throw new Error('Explicit native fixture mode is required')
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && !/^--postgres-major=(16|17)$/.test(args[0]))) throw new Error('Expected only an observed --postgres-major=16 or 17')
  const postgresMajor = args.length ? Number(args[0].split('=')[1]) : undefined
  process.stdout.write(buildStaffFixture(path.resolve(__dirname, '../..'), { postgresMajor }))
}
