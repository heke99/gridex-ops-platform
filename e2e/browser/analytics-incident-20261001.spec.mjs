import { test, expect } from '@playwright/test'
import { localProofEnabled, localProofFixture, localProofSql, proofQuote, proofGet, proofPost } from '../helpers/customer-api-proof.mjs'

const fixtureEnv = 'GRIDEX_ANALYTICS_INCIDENT_FIXTURE_PATH'
const enabled = localProofEnabled('GRIDEX_ANALYTICS_INCIDENT_LOCAL_E2E', fixtureEnv)
test.skip(!enabled, 'Requires the disposable actual migrated incident fixture and current GoTrue operator.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.use({ trace: 'off', video: 'off', screenshot: 'off' })
const f = enabled ? localProofFixture(fixtureEnv) : null
if (enabled && ['RESEND_API_KEY', 'EDIEL_SMTP_PASS', 'EDIEL_SMTP_PASSWORD'].some(key => Boolean(process.env[key]?.trim()))) throw new Error('analytics_incident_provider_credentials_forbidden')
const origin = 'http://127.0.0.1:3000', healthPath = '/api/internal/system/health'
const row = () => localProofSql(`SELECT to_jsonb(q) FROM public.tenant_email_outbox q WHERE id=${proofQuote(f.outboxA)};`)
const client = () => localProofSql(`SELECT jsonb_build_object('status',status,'launch_ready',launch_ready) FROM public.integration_api_clients WHERE id=${proofQuote(f.clientA)};`)
function quietCompany() {
  const tables = ['companies', 'dashboard_alerts', 'data_quality_issues', 'tenant_email_outbox', 'integration_api_clients', 'company_capabilities',
    'customers', 'customer_contracts', 'customer_invoices', 'ediel_messages', 'ediel_outbox', 'customer_operation_jobs']
  return localProofSql(`SELECT jsonb_build_object(${tables.map(table => `${proofQuote(table)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')
    FROM public.${table} t WHERE ${table === 'companies' ? 'id' : 'company_id'}=${proofQuote(f.companyB)})`).join(',')});`)
}
async function health(request) {
  const response = await proofGet(request, healthPath, { headers: { 'x-ops-health-secret': f.secret } })
  expect([200, 503]).toContain(response.status())
  const data = await response.json()
  expect(data.schema_ready).toBe(true); expect(Array.isArray(data.checks)).toBe(true)
  const blocking = data.checks.filter(check => check.status === 'blocking').length
  expect(data.blocking_count).toBe(blocking); expect(response.status()).toBe(blocking ? 503 : 200)
  const uncertain = data.checks.find(check => check.check_key === 'queue:email_delivery_uncertain')
  expect(uncertain).toBeTruthy()
  return uncertain.issue_count
}
async function deniedApi(request, code) {
  const response = await proofGet(request, '/api/v1/contracts', { headers: { authorization: `Bearer ${f.key}` } })
  expect(response.status()).toBe(403); expect((await response.json()).error.code).toBe(code)
}

test('current secret controls actual health and current operator reviews delivery before scoped recovery', async ({ page, request }) => {
  test.setTimeout(240_000)
  const external = []
  await page.context().route('**/*', async route => {
    const host = new URL(route.request().url()).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') { external.push(host); await route.abort('blockedbyclient') }
    else await route.continue()
  })
  const initial = row(), quiet = quietCompany()
  expect(initial.status).toBe('delivery_uncertain'); expect(quiet).toEqual(f.quiet)
  for (const headers of [{}, { 'x-ops-health-secret': 'synthetic-wrong-current-secret' }]) {
    const denied = await proofGet(request, healthPath, { headers })
    expect(denied.status()).toBe(401); expect((await denied.json()).checks).toBeUndefined()
  }
  const beforeHealth = await health(request)
  expect(beforeHealth).toBeGreaterThanOrEqual(1)
  await deniedApi(request, 'api_client_not_launch_ready')
  await page.goto('/login?next=%2Fadmin%2Fplatform%2Fapi-clients')
  await page.getByLabel('E-post').fill(f.admin.email); await page.getByLabel('Lösenord').fill(f.admin.password)
  await page.getByRole('button', { name: 'Logga in', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto('/admin/platform/api-clients')
  const pause = page.locator(`form:has(input[name="clientId"][value="${f.clientA}"]):has(input[name="status"][value="paused"])`)
  await expect(pause).toHaveCount(1)
  await pause.getByRole('button', { name: 'Pausa', exact: true }).click()
  await expect.poll(() => client().status).toBe('paused')
  await deniedApi(request, 'api_client_inactive')
  expect(row()).toEqual(initial); expect(quietCompany()).toEqual(quiet)
  await page.goto('/admin/system-health')
  const recovery = page.locator(`form:has(input[name="outbox_id"][value="${f.outboxA}"])`)
  await expect(recovery).toHaveCount(1)
  const fields = await recovery.locator('input[type="hidden"]').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [input.name, input.value])))
  expect(Object.keys(fields).some(key => key.startsWith('$ACTION_'))).toBe(true)
  // Actual Next handler/action: unsigned caller, then current operator with a
  // forged foreign company. Neither is allowed to recover this tenant row.
  const anonymous = await proofPost(request, '/admin/system-health', { headers: { origin }, multipart: fields, maxRedirects: 0 })
  expect(anonymous.status()).toBeGreaterThanOrEqual(400)
  expect(row()).toEqual(initial)
  const foreign = await proofPost(page.context().request, '/admin/system-health', {
    headers: { origin }, multipart: { ...fields, company_id: f.companyB }, maxRedirects: 0,
  })
  expect(foreign.status()).toBeGreaterThanOrEqual(400)
  expect(row()).toEqual(initial); expect(quietCompany()).toEqual(quiet)
  await recovery.getByRole('button', { name: 'Köa om efter granskning', exact: true }).click()
  await expect.poll(() => row().status).toBe('queued')
  expect(row()).toMatchObject({ attempts: 1, provider_message_id: null, provider_idempotency_key: f.providerKey })
  await expect.poll(() => localProofSql(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE company_id=${proofQuote(f.companyA)}
    AND actor_user_id=${proofQuote(f.admin.userId)} AND entity_id=${proofQuote(f.outboxA)} AND action='email_delivery_uncertain_requeued';`)).toBe(1)
  expect(await health(request)).toBe(beforeHealth - 1)
  await page.goto('/admin/platform/api-clients')
  const resume = page.locator(`form:has(input[name="clientId"][value="${f.clientA}"]):has(input[name="status"][value="active"])`)
  await expect(resume).toHaveCount(1)
  await resume.getByRole('button', { name: 'Aktivera', exact: true }).click()
  await expect.poll(() => client().status).toBe('active')
  expect(client().launch_ready).toBe(false)
  await deniedApi(request, 'api_client_not_launch_ready')
  expect(quietCompany()).toEqual(quiet); expect(external).toEqual([])
  console.log('ANALYTICS_INCIDENT_HTTP_PASS actual_current_secret=true anonymous_health_denied=true actual_operator_login_action=true pause_denies_api=true anonymous_foreign_recovery_denied=true reviewed_requeue_audit_company_actor=true stable_provider_key=true health_uncertain_decrement=1 quiet_tenant_unchanged=true unqualified_resume_still_denied=true full_api_resume=false')
})
