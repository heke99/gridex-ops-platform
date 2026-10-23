// The tenant's own billing admin chooses its invoice provider under Fakturering → Integrationer
// (/admin/billing/integrations, selectInvoiceProviderAction), as a supplier does before go-live (goLiveAlsSupplier).
// Without it the monthly billing cron refuses the tenant ("Ingen fakturaleverantör är vald för bolaget", FINDINGS T18),
// and go-live readiness refuses the transition to live production (FINDINGS F115, invoice_provider_missing).
// The test provider environment: the run prepares and reviews invoices, nothing is dispatched. Synthetic data only.
import { literal, sql } from '../live-chain-fixture'
import { operatorSession, submitServerAction } from './operatorConsole'
import { createTenantStaff } from './tenantStaff'

export async function selectInvoiceProviderAsTenant(companyId: string, provider = 'nordfin', environment: 'test' | 'production' = 'test') {
  // A real company_admin (role-based; the fixture admin has no role authority, FINDINGS F52/F109).
  const staff = await createTenantStaff(companyId, 'E2E Fakturaansvarig')
  const context = await operatorSession(staff.email, staff.password)
  const page = await context.newPage()
  const response = await page.goto('/admin/billing/integrations')
  const form = page.locator('form:has(input[name="provider"])').first()
  await form.locator(`input[name="provider"][value="${provider}"]`).check()
  await form.locator('select[name="environment"]').selectOption(environment)
  const actionStatus = await submitServerAction(page, () => form.getByRole('button', { name: 'Spara leverantör' }).click(), 120_000)
  await page.waitForURL(url => url.searchParams.has('code') || url.searchParams.has('status'), { timeout: 30_000 }).catch(() => undefined)
  const url = new URL(page.url())
  await page.close()
  const stored = sql<{ provider: string | null; environment: string | null }>(`SELECT jsonb_build_object('provider',invoice_export_target_system,
    'environment',billing_provider_environment) FROM public.companies WHERE id=${literal(companyId)}`)
  return { pageStatus: response?.status() ?? null, actionStatus, code: url.searchParams.get('code') ?? url.searchParams.get('status'), stored }
}
