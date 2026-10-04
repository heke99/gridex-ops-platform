/* eslint-disable @typescript-eslint/no-require-imports -- Native SQL fixture builder. */
// Focused synthetic fixture from committed schema and actual credential-core migrations.
// It does not replace full Supabase replay, RLS qualification or deployment checks.
const fs = require('node:fs')
const path = require('node:path')

function buildStaffIntegrationAuthFixture(root) {
  const source = name => fs.readFileSync(path.join(root, name), 'utf8')
  const schema = source('supabase/schema.sql')
  const tables = ['companies', 'integration_api_clients', 'integration_api_rate_limit_buckets', 'company_capabilities', 'tenant_website_installation_receipts']
  const functions = new Map()
  for (const block of schema.split(/\n--\n-- Name:/)) {
    const match = /CREATE FUNCTION public\.([a-z0-9_]+)\(/.exec(block)
    if (match) functions.set(match[1], block.slice(match.index).trim())
  }
  const tableDefinitions = tables.map(name => {
    const match = new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]+?\\n\\);`).exec(schema)
    if (!match) throw new Error(`Missing native fixture table: ${name}`)
    return match[0]
  })
  const required = new Set(['integration_api_scope_present_v1', 'integration_api_rate_limit_check', 'authenticate_integration_request_v1_credential_core', 'authenticate_integration_request_v1'])
  for (const table of tableDefinitions) for (const match of table.matchAll(/public\.([a-z0-9_]+)\(/g)) required.add(match[1])
  for (const name of required) {
    if (!functions.has(name)) throw new Error(`Missing native fixture function: ${name}`)
    for (const match of functions.get(name).matchAll(/public\.([a-z0-9_]+)\(/g)) if (functions.has(match[1])) required.add(match[1])
  }
  const exact = (text, pattern) => {
    const matches = [...text.matchAll(pattern)]
    if (matches.length !== 1) throw new Error(`Expected one native declaration: ${pattern}`)
    return matches[0][0]
  }
  const credentialSource = source('supabase/migrations/20260809191057_authenticate_integration_request_route_cost.sql')
  const canonicalSource = source('supabase/migrations/20260810185155_gridex_canonical_architecture_p0.sql')
  const privateSource = source('supabase/migrations/20260810224500_canonical_review_remediation_v1.sql')
  // Keep the regression's before-state tied to the immutable native migration,
  // even after the canonical schema artifact has been regenerated at a new tip.
  functions.set('authenticate_integration_request_v1', exact(
    source('supabase/migrations/20260814170000_tenant_website_receipt_ready_binding.sql'),
    /create or replace function public\.authenticate_integration_request_v1\([\s\S]+?\n\$function\$;/g,
  ))
  const nativeCredential = [
    exact(credentialSource, /create or replace function public\.authenticate_integration_request_v1\([\s\S]+?\n\$\$;/g),
    exact(canonicalSource, /alter function public\.authenticate_integration_request_v1\([\s\S]+?\) rename to authenticate_integration_request_v1_credential_core;/g),
    exact(privateSource, /alter function public\.authenticate_integration_request_v1_credential_core\([\s\S]+?\) set schema private;/g),
    exact(privateSource, /alter function private\.authenticate_integration_request_v1_credential_core\([\s\S]+?\) rename to authenticate_integration_request_v1_secret_internal;/g),
    exact(privateSource, /revoke all on function private\.authenticate_integration_request_v1_secret_internal\([\s\S]+?\) from public, anon, authenticated, service_role;/g),
  ]
  const constraints = schema.split(/\n--\n-- Name:/).flatMap(block => {
    const match = /ALTER TABLE ONLY public\.([a-z0-9_]+)\s+ADD CONSTRAINT/.exec(block)
    return match && tables.includes(match[1]) && !block.includes('FOREIGN KEY') ? [block.slice(match.index).trim()] : []
  })
  const acl = ['authenticate_integration_request_v1', 'authenticate_integration_request_v1_credential_core'].flatMap(name => [
    exact(privateSource, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]+?\\) from public, anon, authenticated;`, 'g')),
    exact(privateSource, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]+?\\) to service_role;`, 'g')),
  ])
  return [
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
    'CREATE SCHEMA private; REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;',
    'SET check_function_bodies=off;', ...nativeCredential,
    ...[...required].map(name => functions.get(name)), ...tableDefinitions, ...constraints, ...acl,
    'SET check_function_bodies=on;',
  ].join('\n')
}

module.exports = { buildStaffIntegrationAuthFixture }
if (require.main === module) process.stdout.write(buildStaffIntegrationAuthFixture(path.resolve(__dirname, '../..')))
