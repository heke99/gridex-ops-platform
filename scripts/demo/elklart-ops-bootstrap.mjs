#!/usr/bin/env node
// Initial fictional platform identity and catalogue, then ordinary tenant RPC.
// Run with Node22 --experimental-strip-types. Never against a hosted project.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { syntheticSwedishOrganizationNumber } from '../../e2e/production/helpers/swedish-organization-number.mjs'
import { ROLE_CATALOG } from '../../lib/rbac/catalog.ts'
import { ROLE_PERMISSION_PROFILES } from '../../lib/admin/accessModel.ts'

export const runtimeRoot = '/workspace/elklart-runtime'
export const opsContainer = 'supabase_db_elklart-ops-demo'
export function assertOpsContainer(container) {
  const labels = container.Config?.Labels ?? {}
  const configured = container.HostConfig?.PortBindings?.['5432/tcp'] ?? []
  const bindings = container.NetworkSettings?.Ports?.['5432/tcp'] ?? []
  if (container.Name !== `/${opsContainer}` || labels['com.supabase.cli.project'] !== 'elklart-ops-demo'
    || !configured.length || configured.some(b => b.HostPort !== '54322' || !['', '127.0.0.1', '::1'].includes(b.HostIp))
    || !bindings.length || bindings.some(b => b.HostPort !== '54322' || !['127.0.0.1', '::1'].includes(b.HostIp))) throw new Error('Dedicated loopback OPS database required')
}
export function assertPrivatePath(file, root = runtimeRoot) {
  if (!path.isAbsolute(file) || file.split(path.sep).includes('..') || (file !== root && !file.startsWith(`${root}/`))) throw new Error('Path outside private runtime')
  let current = file
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlinked runtime ancestor refused')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return file
}
function docker(args, options = {}) {
  return execFileSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options })
}
function sql(text) {
  return docker(['exec', '-i', opsContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], { input: text })
}
function literal(value) { return `'${String(value).replaceAll("'", "''")}'` }
function writePrivate(file, value) {
  assertPrivatePath(file)
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
export function catalogueSql(roles = ROLE_CATALOG, profiles = ROLE_PERMISSION_PROFILES) {
  const permissions = [...new Set(Object.values(profiles).flatMap(p => p.permissions))]
  return `begin;\n${permissions.map(key => `insert into public.permissions(key,name) values(${literal(key)},${literal(key)}) on conflict do nothing;`).join('\n')}\n${roles.map(role => `insert into public.roles(key,name,description,scope,is_system_role) values(${literal(role.key)},${literal(role.label)},${literal(role.description)},${literal(role.key === 'super_admin' ? 'platform' : 'company')},true) on conflict do nothing;`).join('\n')}\n${Object.entries(profiles).flatMap(([role, profile]) => profile.permissions.map(permission => `insert into public.role_permissions(role_id,role_key,permission_id,permission_key,effect) select r.id,r.key,p.id,p.key,'allow' from public.roles r cross join public.permissions p where r.key=${literal(role)} and p.key=${literal(permission)} and not exists(select 1 from public.role_permissions x where x.role_id=r.id and x.permission_id=p.id);`)).join('\n')}\ncommit;`
}
async function prepareStaff(client, tenant, credentials, credentialsPath) {
  const recipes = [
    ['platform', 'Demopresentatör', 'company_admin', 'company_admin'],
    ['handler', 'Handläggare', 'operations_agent', 'operations'],
    ['support', 'Kundservice', 'customer_service_agent', 'support'],
    ['portfolio', 'Portföljansvarig', 'operations_manager', 'operations'],
    ['administrator', 'Bolagsadministratör', 'company_admin', 'company_admin'],
    ['automation', 'Systemautomation', 'operations_manager', 'operations'],
  ]
  for (const [key, name, roleKey, membershipRole] of recipes) {
    const account = credentials[key] ??= { email: `${key}@elklart.example.invalid`, password: crypto.randomBytes(24).toString('base64url') }
    writePrivate(credentialsPath, credentials)
    if (!account.userId) {
      const result = await client.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true })
      if (result.error) throw new Error(`Local staff Auth provisioning failed: ${result.error.code ?? result.error.status}`)
      account.userId = result.data.user.id
      writePrivate(credentialsPath, credentials)
    }
    sql(`insert into public.user_profiles(id,email,full_name,user_status) values(${literal(account.userId)},${literal(account.email)},${literal(name)},'active') on conflict(id) do nothing;`)
    const command = { company_id: tenant.companyId, actor_user_id: tenant.actorUserId, user_id: account.userId,
      action: 'upsert', role_key: roleKey, membership_role: membershipRole,
      idempotency_key: `elklart-local-demo:staff:${key}:v1` }
    const { error } = await client.rpc('canonical_change_tenant_user_access', { p_command: command })
    if (error) {
      writePrivate(path.join(runtimeRoot, 'ops/staff-bootstrap-error.json'), { role: key, code: error.code, message: error.message })
      throw new Error(`Canonical staff setup failed for ${key}; private diagnostic retained`)
    }
    account.role = roleKey
    writePrivate(credentialsPath, credentials)
  }
}
async function main() {
  const root = fs.statSync(runtimeRoot)
  if (root.uid !== process.getuid() || (root.mode & 0o777) !== 0o700 || fs.lstatSync(runtimeRoot).isSymbolicLink()) throw new Error('Private owned runtime required')
  assertOpsContainer(JSON.parse(docker(['inspect', opsContainer]))[0])
  if (sql("select current_setting('elklart.runtime_project',true)").trim() !== 'elklart-ops-demo') throw new Error('OPS database marker missing')
  const status = JSON.parse(fs.readFileSync(assertPrivatePath(path.join(runtimeRoot, 'ops', 'status.json')), 'utf8'))
  if (status.API_URL !== 'http://127.0.0.1:54321' && status.API_URL !== 'http://localhost:54321') throw new Error('Local API required')
  const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  sql(catalogueSql())
  const credentialsPath = assertPrivatePath(path.join(runtimeRoot, 'ops', 'accounts.json'))
  const credentials = fs.existsSync(credentialsPath) ? JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) : {
    platform: { email: 'presentator@elklart.example.invalid', password: crypto.randomBytes(24).toString('base64url') },
  }
  writePrivate(credentialsPath, credentials)
  const actor = credentials.platform
  if (!actor.userId) {
    const { data, error } = await client.auth.admin.createUser({ email: actor.email, password: actor.password, email_confirm: true })
    if (error) throw new Error(`Local Auth provisioning failed: ${error.code ?? error.status}`)
    actor.userId = data.user.id
    writePrivate(credentialsPath, credentials)
  }
  const id = literal(actor.userId)
  sql(`begin;
insert into public.user_profiles(id,email,full_name,user_status) values(${id},${literal(actor.email)},'Elklart demopresentatör','active') on conflict(id) do nothing;
insert into public.user_roles(user_id,role,role_id,status,is_active) select ${id},'super_admin',id,'active',true from public.roles where key='super_admin' and not exists(select 1 from public.user_roles where user_id=${id} and company_id is null and role='super_admin');
insert into public.admin_users(user_id,role,is_active,metadata) select ${id},'super_admin',true,'{"demo_runtime":"elklart-ops-demo"}'::jsonb where not exists(select 1 from public.admin_users where user_id=${id});
commit;`)
  const { data, error } = await client.rpc('canonical_provision_company', { p_command: {
    name: 'Elklart Demo', slug: 'elklart-demo', organization_number: syntheticSwedishOrganizationNumber('elklart-local-demo'), customer_number_prefix: 'ELD',
    primary_contact_email: 'kontakt@elklart.example.invalid', primary_contact_name: 'Elklart demoteam',
    industry: 'electricity_supplier', actor_user_id: actor.userId, idempotency_key: 'elklart-local-demo:tenant:v1',
    metadata: { demo: true, runtime_project: 'elklart-ops-demo', fictional: true },
  } })
  if (error || !data?.company_id) {
    writePrivate(path.join(runtimeRoot, 'ops', 'bootstrap-error.json'), { code: error?.code, message: error?.message, hint: error?.hint, details: error?.details })
    throw new Error(`Canonical local tenant provisioning failed: ${error?.code ?? 'missing_company'}; private bootstrap-error.json retained`)
  }
  writePrivate(path.join(runtimeRoot, 'ops', 'tenant.json'), { companyId: data.company_id, actorUserId: actor.userId, source: 'canonical_provision_company', fictional: true })
  await prepareStaff(client, { companyId: data.company_id, actorUserId: actor.userId }, credentials, credentialsPath)
  console.log('Local fictional platform account, canonical Elklart tenant and scoped demo staff provisioned. Credentials are private in the runtime directory.')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
