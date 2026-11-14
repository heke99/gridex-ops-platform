#!/usr/bin/env node
// Actual Auth/RLS probes on isolated fictional data. Never lifecycle/status SQL.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { syntheticSwedishOrganizationNumber } from '../../e2e/production/helpers/swedish-organization-number.mjs'
const root = '/workspace/elklart-runtime'
const receiptPath = `${root}/ops/isolation-scenario.json`
const origin = 'https://localhost:3000'
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const roles = { handler: 'operations_agent', portfolio: 'operations_manager', support: 'customer_service_agent', administrator: 'company_admin' }
const controlEmail = 'isolation.control@elklart.example.invalid'
function demand(condition, message) { if (!condition) throw new Error(message) }
export function validateIsolationTarget(status, tenant) {
  demand(['http://localhost:54321', 'http://127.0.0.1:54321'].includes(status?.API_URL)
    && tenant?.fictional === true && uuid.test(tenant.companyId ?? '') && uuid.test(tenant.actorUserId ?? ''), 'Dedicated fictional local OPS target required')
}
export function isolationCompanyCommand(tenant) {
  demand(uuid.test(tenant?.actorUserId ?? ''), 'Canonical provisioning actor required')
  return { name: 'Elklart Demo Isolation (fiktivt kontrollbolag)', slug: 'elklart-demo-isolation',
    organization_number: syntheticSwedishOrganizationNumber('elklart-local-demo-isolation'), customer_number_prefix: 'ELI',
    primary_contact_email: 'isolation@elklart.example.invalid', primary_contact_name: 'Fiktiv isoleringskontroll',
    industry: 'electricity_supplier', actor_user_id: tenant.actorUserId, idempotency_key: 'elklart-local-demo:isolation:tenant:v1',
    metadata: { demo: true, fictional: true, runtime_project: 'elklart-ops-demo', purpose: 'actual_rls_control_tenant' } }
}
export function isRlsDenial(result) {
  return result?.error?.code === '42501' || !result?.error && Array.isArray(result?.data) && result.data.length === 0
}
export function evaluateRoleProbe(role, scope, probe) {
  demand(Object.hasOwn(roles, role), 'Unknown role probe')
  const permissions = new Set(Array.isArray(probe.context?.permissions) ? probe.context.permissions : [])
  const support = role === 'support'
  const expected = { 'customers.read': true, 'customers.write': !support, 'cases.write': support || role === 'administrator', 'users.write': role === 'administrator' }
  const checks = {
    actualScopedIdentity: probe.context?.authorized === true && probe.context.user_id === probe.userId
      && probe.context.selected_company_id === scope.companyId && probe.context.is_platform_admin === false,
    ownCustomerReadable: Array.isArray(probe.ownRows) && probe.ownRows.length === 1 && probe.ownRows[0].id === scope.customerId && probe.ownRows[0].company_id === scope.companyId,
    foreignCustomerHidden: Array.isArray(probe.foreignRows) && probe.foreignRows.length === 0,
    ownWritePositiveControl: support || Array.isArray(probe.ownWriteRows) && probe.ownWriteRows.length === 1
      && probe.ownWriteRows[0].id === scope.customerId && probe.ownWriteRows[0].company_id === scope.companyId,
    foreignWriteDenied: Array.isArray(probe.foreignWriteRows) && probe.foreignWriteRows.length === 0,
    foreignContextRefused: Boolean(probe.foreignContext && probe.foreignContext.user_id === probe.userId
      && probe.foreignContext.selected_company_id !== scope.foreignCompanyId
      && (probe.foreignContext.authorized === false
        || probe.foreignContext.authorized === true && probe.foreignContext.selected_company_id === scope.companyId
        || probe.foreignContext.authorized === true && probe.foreignContext.selected_company_id === null && probe.foreignContext.access_invariant_ok === false)),
    writePolicyMatchesMembership: probe.canWriteOwn === !support && probe.canWriteForeign === false,
    rolePermissionsMatch: Object.entries(expected).every(([permission, allowed]) => permissions.has(permission) === allowed),
    supportOwnCustomerWriteDenied: !support || Array.isArray(probe.supportWriteRows) && probe.supportWriteRows.length === 0,
  }
  return { pass: Object.values(checks).every(Boolean), checks,
    permissionFlags: Object.fromEntries(Object.keys(expected).map(key => [key, permissions.has(key)])) }
}
function privatePath(file, missing = false) {
  demand(file === root || file.startsWith(`${root}/`), 'Private runtime path required')
  for (let current = file; current !== path.dirname(current); current = path.dirname(current)) {
    try { demand(!fs.lstatSync(current).isSymbolicLink(), 'Runtime symlink refused') } catch (error) { if (!(missing && error.code === 'ENOENT')) throw error }
  }
  try { const info = fs.statSync(file); demand(info.uid === process.getuid() && !(info.mode & 0o7077), 'Private owned runtime file required') }
  catch (error) { if (!(missing && error.code === 'ENOENT')) throw error }
  return file
}
function read(file) { return JSON.parse(fs.readFileSync(privatePath(file), 'utf8')) }
function save(value) {
  privatePath(`${root}/ops`); privatePath(receiptPath, true)
  const temporary = `${receiptPath}.${randomUUID()}.tmp`
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, receiptPath) }
  finally { try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error } }
}
async function assertRuntime() {
  const { assertOpsContainer, opsContainer } = await import('./elklart-ops-bootstrap.mjs')
  const docker = args => execFileSync('docker', ['--host', 'unix:///var/run/docker.sock', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  assertOpsContainer(JSON.parse(docker(['inspect', opsContainer]))[0])
  const marker = docker(['exec', opsContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT current_setting('elklart.runtime_project',true)"]).trim()
  demand(marker === 'elklart-ops-demo', 'Dedicated database marker required')
  const { parsePrivateEnvironment } = await import('./elklart-ops-app.mjs')
  const env = parsePrivateEnvironment(fs.readFileSync(privatePath(`${root}/ops/app.env`), 'utf8'))
  demand(env.NODE_ENV === 'development' && env.ELKLART_DEMO_ENABLED === 'true'
    && ['http://localhost:54321', 'http://127.0.0.1:54321'].includes(env.SUPABASE_URL)
    && ['http://localhost:54321', 'http://127.0.0.1:54321'].includes(env.NEXT_PUBLIC_SUPABASE_URL)
    && env.NEXT_PUBLIC_APP_URL === origin && !env.VERCEL_ENV, 'Isolated OPS app configuration required')
}
function clientFor(status, key) { return createClient(status.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) }
async function requireResult(result, context) { if (result.error) throw new Error(`${context}: ${result.error.code ?? 'request_failed'}`); return result.data }
async function customerByEmail(service, companyId) {
  const rows = await requireResult(await service.from('customers').select('id,company_id,email').eq('company_id', companyId).eq('email', controlEmail), 'isolation_customer_lookup')
  demand(rows.length <= 1, 'Ambiguous isolation control customer')
  return rows[0] ?? null
}
async function createControlCustomer(service, accounts, receipt, expectScopeRefusal = false) {
  const prior = await customerByEmail(service, receipt.foreignCompanyId)
  if (prior && !expectScopeRefusal) { demand(!receipt.foreignCustomerId || receipt.foreignCustomerId === prior.id, 'Saved control customer mismatch'); receipt.foreignCustomerId = prior.id; save(receipt); return }
  demand(!receipt.foreignCustomerId, 'Saved control customer absent; reconcile before retry')
  demand(accounts.platform?.userId === receipt.provisioningActorId && /^[a-z.]+@elklart\.example\.invalid$/.test(accounts.platform.email), 'Original fictional platform actor required')
  const certificate = new X509Certificate(fs.readFileSync(privatePath(`${root}/tls/server.pem`)))
  demand(Boolean(certificate.checkHost('localhost')), 'Runtime TLS identity required')
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${pin}`] })
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: false })
    await context.route('**/*', route => [origin, 'http://localhost:54321', 'http://127.0.0.1:54321'].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort('blockedbyclient'))
    const page = await context.newPage(); page.setDefaultTimeout(30_000)
    await page.goto(`${origin}/login?next=%2Fadmin`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    const login = page.locator('form').filter({ has: page.locator('[name="password"]') })
    await login.locator('[name="email"]').fill(accounts.platform.email); await login.locator('[name="password"]').fill(accounts.platform.password)
    await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 60_000 }), login.locator('button[type="submit"],button:not([type])').first().click()])
    // This is the product's selected-company preference, not an authorization claim.
    // The ordinary server action validates the actual authenticated platform actor.
    await context.addCookies([{ name: 'gridex_admin_selected_company_id', value: receipt.foreignCompanyId, url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }])
    await page.goto(`${origin}/admin/companies/${receipt.foreignCompanyId}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.getByText('Elklart Demo Isolation (fiktivt kontrollbolag)', { exact: true }).first().waitFor({ timeout: 60_000 })
    await page.goto(`${origin}/admin/customers/intake?mode=manual`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    const form = page.locator('form').filter({ has: page.locator('[name="firstName"]') })
    demand(await form.locator('input[name="expected_company_id"]').inputValue() === receipt.foreignCompanyId, 'Rendered intake company binding mismatch')
    await form.locator('[name="firstName"]').fill('Isolation'); await form.locator('[name="lastName"]').fill('Kontroll'); await form.locator('[name="email"]').fill(controlEmail)
    const action = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/admin/customers/intake', { timeout: 90_000 })
    const [response] = await Promise.all([action, form.getByRole('button', { name: 'Skapa kund', exact: true }).click()])
    demand(response.status() < 400, 'Ordinary control customer intake failed')
    if (expectScopeRefusal) {
      await page.getByText('Aktivt operativt bolag skiljer sig från kundintagets bolag. Välj rätt bolag och ladda om sidan innan du sparar.', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      demand(!(await customerByEmail(service, receipt.foreignCompanyId)), 'Scope refusal created a control customer unexpectedly')
      receipt.actualIntakeScopeRefusal = 'PASS'; save(receipt)
      return
    }
    const link = page.getByRole('status').getByRole('link', { name: 'Öppna kundkort', exact: true })
    await link.waitFor({ state: 'visible', timeout: 60_000 })
    const id = /^\/admin\/customers\/([a-f0-9-]{36})$/.exec(await link.getAttribute('href') ?? '')?.[1]
    const saved = await customerByEmail(service, receipt.foreignCompanyId)
    demand(saved && saved.id === id && saved.company_id === receipt.foreignCompanyId, 'Control customer canonical readback mismatch')
    receipt.foreignCustomerId = id; receipt.controlCustomerSource = 'ordinary_admin_intake_browser'; save(receipt)
  } finally { await browser.close() }
}
async function readOrDenied(query, context) {
  const result = await query
  if (result.error) { demand(isRlsDenial(result), `${context}: unexpected database error`); return [] }
  demand(Array.isArray(result.data), `${context}: invalid result`)
  return result.data
}
export async function runRoleIsolation() {
  demand(process.env.ELKLART_ROLE_ISOLATION_ACK === 'local-role-isolation-only', 'Explicit local role-isolation acknowledgement required')
  privatePath(root); privatePath(`${root}/ops`)
  const status = read(`${root}/ops/status.json`), tenant = read(`${root}/ops/tenant.json`), accounts = read(`${root}/ops/accounts.json`), support = read(`${root}/ops/support-scenario.json`)
  validateIsolationTarget(status, tenant)
  demand(status.SERVICE_ROLE_KEY && status.ANON_KEY && status.SERVICE_ROLE_KEY !== status.ANON_KEY, 'Distinct private local service and anon credentials required')
  demand(support.companyId === tenant.companyId && uuid.test(support.customerId ?? '') && support.staffUi === 'PASS', 'Actual Karin fixture required')
  await assertRuntime()
  let receipt
  try { receipt = read(receiptPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  receipt ??= { version: 1, companyId: tenant.companyId, customerId: support.customerId, provisioningActorId: tenant.actorUserId, fictional: true, source: 'actual_auth_and_rls', portalApiIsolation: 'BLOCKED_ORGANIZATION_ONBOARDING' }
  demand(receipt.version === 1 && receipt.companyId === tenant.companyId && receipt.customerId === support.customerId && receipt.fictional === true, 'Isolation receipt scope mismatch')
  const service = clientFor(status, status.SERVICE_ROLE_KEY)
  try {
    receipt.status = 'RUNNING'; receipt.step = 'canonical_control_tenant'; save(receipt)
    const provisioned = await requireResult(await service.rpc('canonical_provision_company', { p_command: isolationCompanyCommand(tenant) }), 'isolation_company_provision')
    demand(uuid.test(provisioned?.company_id ?? '') && provisioned.company_id !== tenant.companyId
      && (!receipt.foreignCompanyId || receipt.foreignCompanyId === provisioned.company_id), 'Canonical control tenant mismatch')
    receipt.foreignCompanyId = provisioned.company_id; save(receipt)
    const company = await requireResult(await service.from('companies').select('id,status,slug').eq('id', receipt.foreignCompanyId).single(), 'isolation_company_readback')
    demand(company.slug === 'elklart-demo-isolation' && company.status === 'onboarding', 'Control tenant must remain fictional onboarding')
    receipt.controlTenantLifecycle = company.status
    if (!receipt.controlMembershipConfigured) {
      receipt.step = 'actual_intake_scope_refusal'; save(receipt)
      await createControlCustomer(service, accounts, receipt, true)
      receipt.step = 'canonical_control_membership'; save(receipt)
      const membership = await requireResult(await service.rpc('canonical_change_tenant_user_access', { p_command: {
        company_id: receipt.foreignCompanyId, actor_user_id: tenant.actorUserId, user_id: tenant.actorUserId,
        action: 'upsert', role_key: 'company_admin', membership_role: 'company_admin',
        idempotency_key: 'elklart-local-demo:isolation:control-membership:v1',
      } }), 'isolation_control_membership')
      demand(membership?.ok !== false, 'Canonical control membership refused')
      const member = await requireResult(await service.from('company_memberships').select('company_id,user_id,membership_role,status,is_active').eq('company_id', receipt.foreignCompanyId).eq('user_id', tenant.actorUserId).single(), 'control_membership_readback')
      demand(member.company_id === receipt.foreignCompanyId && member.user_id === tenant.actorUserId && member.membership_role === 'company_admin' && member.status === 'active' && member.is_active !== false, 'Canonical control membership not confirmed')
      receipt.controlMembershipConfigured = 'canonical_company_admin'; save(receipt)
    }
    receipt.step = 'ordinary_control_customer'; save(receipt)
    await createControlCustomer(service, accounts, receipt)
    const own = await requireResult(await service.from('customers').select('id,company_id,email').eq('id', receipt.customerId).eq('company_id', tenant.companyId).single(), 'karin_control_read')
    const foreign = await customerByEmail(service, receipt.foreignCompanyId)
    demand(own.email === 'karin.holm@elklart.example.invalid' && foreign?.id === receipt.foreignCustomerId, 'Exact fictional customer graph required')
    const scope = { companyId: receipt.companyId, customerId: receipt.customerId, foreignCompanyId: receipt.foreignCompanyId, foreignCustomerId: receipt.foreignCustomerId }
    receipt.roles = {}; receipt.step = 'actual_role_rls'; save(receipt)
    for (const [key, expectedRole] of Object.entries(roles)) {
      const account = accounts[key]
      demand(account?.role === expectedRole && uuid.test(account.userId ?? '') && /^[a-z.]+@elklart\.example\.invalid$/.test(account.email), 'Exact scoped fictional role account required')
      receipt.activeRole = key; save(receipt)
      const client = clientFor(status, status.ANON_KEY)
      try {
        const auth = await client.auth.signInWithPassword({ email: account.email, password: account.password })
        demand(!auth.error && auth.data.user?.id === account.userId, 'Actual role authentication failed')
        const context = await requireResult(await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: tenant.companyId }), 'actual_role_context')
        const ownRows = await requireResult(await client.from('customers').select('id,company_id').eq('id', own.id), 'actual_role_own_read')
        const ownWriteRows = key === 'support' ? [] : await requireResult(await client.from('customers').update({ email: own.email }).eq('id', own.id).select('id,company_id,email'), 'same_session_own_write_positive_control')
        if (key !== 'support') demand(ownWriteRows.length === 1 && ownWriteRows[0].id === own.id && ownWriteRows[0].company_id === own.company_id && ownWriteRows[0].email === own.email, 'Direct own-customer write control failed; foreign write isolation is not qualified')
        const foreignRows = await readOrDenied(client.from('customers').select('id,company_id').eq('id', foreign.id), 'foreign_customer_read')
        // Same-value probes cannot corrupt customer data even if an unexpected
        // authorization regression is discovered. Any returned row still FAILS.
        const foreignWriteRows = await readOrDenied(client.from('customers').update({ email: foreign.email }).eq('id', foreign.id).select('id'), 'foreign_customer_write')
        const supportWriteRows = key === 'support' ? await readOrDenied(client.from('customers').update({ email: own.email }).eq('id', own.id).select('id'), 'support_own_customer_write') : []
        const canWriteOwn = await requireResult(await client.rpc('gridex_can_write_company', { p_company_id: tenant.companyId }), 'own_company_write_policy')
        const canWriteForeign = await requireResult(await client.rpc('gridex_can_write_company', { p_company_id: foreign.company_id }), 'foreign_company_write_policy')
        const foreignContext = await requireResult(await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: foreign.company_id }), 'foreign_selected_context')
        receipt.roles[key] = evaluateRoleProbe(key, scope, { context, ownRows, ownWriteRows, foreignRows, foreignWriteRows, supportWriteRows, canWriteOwn, canWriteForeign, foreignContext, userId: account.userId })
        save(receipt)
        demand(receipt.roles[key].pass, 'Actual role/tenant isolation invariant failed')
      } finally { await client.auth.signOut({ scope: 'local' }).catch(() => {}) }
    }
    const anonymous = clientFor(status, status.ANON_KEY)
    receipt.anonymousReadDenied = isRlsDenial(await anonymous.from('customers').select('id').eq('id', own.id))
    demand(receipt.anonymousReadDenied, 'Anonymous customer read unexpectedly allowed')
    const ownAfter = await requireResult(await service.from('customers').select('email').eq('id', own.id).single(), 'own_integrity_readback')
    const foreignAfter = await customerByEmail(service, foreign.company_id)
    demand(ownAfter.email === own.email && foreignAfter?.email === foreign.email, 'Negative probe changed fictional customer content')
    receipt.status = 'PASS'; receipt.step = 'complete'; receipt.completedAt = new Date().toISOString(); save(receipt)
    console.log('Actual local Auth/RLS role matrix passed for four scoped roles and two fictional tenants. Portal API isolation remains blocked by onboarding.')
    return receipt
  } catch (error) { receipt.status = 'BLOCKED'; receipt.failureStep = receipt.step; save(receipt); throw error }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runRoleIsolation().catch(() => { console.error('Local isolation scenario blocked; private stage receipt retained, no portal isolation claim.'); process.exitCode = 1 })
}
