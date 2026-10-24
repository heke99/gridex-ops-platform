// The tenant's own billing admin chooses its invoice provider under Fakturering → Integrationer
// (/admin/billing/integrations, selectInvoiceProviderAction), as a supplier does before go-live (goLiveAlsSupplier).
// Without it the monthly billing cron refuses the tenant ("Ingen fakturaleverantör är vald för bolaget", FINDINGS T18),
// and go-live readiness refuses the transition to live production (FINDINGS F115, invoice_provider_missing).
// On the same page the admin then turns on billing automation ("Aktivera faktureringsautomation",
// setBillingAutomationEnabledAction): the monthly cron prepares underlays, pricing and draft invoices for review only
// when it is on (FINDINGS F117, owner decision 24 "Separera förberedelse och utskick"), and go-live readiness blocks
// without it (billing_automation_disabled). Dispatch ("Aktivera utskick") is NOT enabled: it needs a tested provider
// connection, and the scenarios only prepare and review invoices; invoice files are made by staff from approved
// invoices, never by the cron. The test provider environment: nothing is dispatched. Synthetic data only.
import { literal, sql } from '../live-chain-fixture'
import { operatorSession, submitServerAction } from './operatorConsole'
import { createTenantStaff } from './tenantStaff'

type Stored = { provider: string | null; environment: string | null; billingAutomation: boolean | null; dispatch: boolean | null }

function storedSelection(companyId: string) {
  return sql<Stored>(`SELECT jsonb_build_object('provider',invoice_export_target_system,'environment',billing_provider_environment,
    'billingAutomation',billing_automation_enabled,'dispatch',invoice_export_enabled) FROM public.companies WHERE id=${literal(companyId)}`)
}

export async function selectInvoiceProviderAsTenant(companyId: string, provider = 'nordfin', environment: 'test' | 'production' = 'test') {
  // The shared fixture (configureTenant) switches billing automation and dispatch on with SQL. Undo that stand-in for this
  // tenant so the product path below is what turns preparation on, and dispatch stays off as for a new supplier.
  sql(`UPDATE public.companies SET billing_automation_enabled=false,invoice_export_enabled=false WHERE id=${literal(companyId)}`)
  // A real company_admin (role-based; the fixture admin has no role authority, FINDINGS F52/F109).
  const staff = await createTenantStaff(companyId, 'E2E Fakturaansvarig')
  const context = await operatorSession(staff.email, staff.password)
  const page = await context.newPage()
  const response = await page.goto('/admin/billing/integrations')
  const form = page.locator('form:has(input[name="provider"])').first()
  await form.locator(`input[name="provider"][value="${provider}"]`).check()
  await form.locator('select[name="environment"]').selectOption(environment)
  const actionStatus = await submitServerAction(page, () => form.getByRole('button', { name: 'Spara leverantör' }).click(), 120_000)
  await page.waitForURL(url => url.searchParams.has('code') || url.searchParams.has('status') || url.searchParams.has('provider'), { timeout: 30_000 }).catch(() => undefined)
  const url = new URL(page.url())
  const code = url.searchParams.get('code') ?? url.searchParams.get('status') ?? url.searchParams.get('provider')
  // Billing automation (preparation for review), on the same page, by the same admin.
  await page.goto('/admin/billing/integrations')
  const automationStatus = await submitServerAction(page, () => page.getByRole('button', { name: 'Aktivera faktureringsautomation' }).click(), 120_000)
  await page.waitForURL(target => target.searchParams.has('provider'), { timeout: 30_000 }).catch(() => undefined)
  const automationCode = new URL(page.url()).searchParams.get('provider')
  await page.close()
  const stored = storedSelection(companyId)
  return { pageStatus: response?.status() ?? null, actionStatus, code, billingAutomation: { actionStatus: automationStatus, code: automationCode }, stored }
}
