import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { test, expect } from '@playwright/test'
const requested = process.env.GRIDEX_BILLING_REVISION_VIEWS_LOCAL_E2E === '1'
const enabled = requested && process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL && Boolean(process.env.GRIDEX_BILLING_REVISION_VIEWS_FIXTURE_PATH && process.env.GRIDEX_BILLING_RECIPIENT_PASSWORD)
if (requested && !enabled) throw new Error('billing_revision_views_browser_disposable_local_required')
const path = enabled ? resolve(process.env.GRIDEX_BILLING_REVISION_VIEWS_FIXTURE_PATH) : null
if (enabled && (!process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + sep))) throw new Error('billing_revision_views_fixture_must_stay_in_runner_temp')
const f = enabled ? JSON.parse(readFileSync(path, 'utf8')) : null
test.skip(!enabled, 'Requires the completed billing recipient browser fixture and actual native invoice preparation.')
test.describe.configure({ mode: 'serial', retries: 0 })
test.setTimeout(90_000)
async function login(page, email) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' ? route.continue() : route.abort()
  })
  await page.goto('/login'); await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_BILLING_RECIPIENT_PASSWORD)
  await page.getByRole('button', { name: 'Logga in' }).click(); await page.waitForURL(url => !url.pathname.startsWith('/login'))
}
test('actual writer and current reader see saved list/card revision and immutable prepared invoice recipients/revisions after navigation and reload', async ({ browser }) => {
  for (const [role, email] of [['writer', f.billing.writerEmail], ['reader', f.billing.readerEmail]]) {
    const context = await browser.newContext(), page = await context.newPage()
    try {
      await login(page, email)
      await page.goto(`/admin/customers?q=${encodeURIComponent(f.billing.context.customerId)}`)
      const row = page.locator('tbody tr').filter({ hasText: f.billing.context.customerId })
      await expect(row).toHaveCount(1); await expect(row).toContainText('Faktureringsrevision: 4')
      await row.screenshot({ path: `e2e-artifacts/billing-revision-list-${role}.png` })
      await page.goto(`/admin/customers/${f.billing.context.customerId}?tab=billing-metering`)
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Faktureringsstandard', exact: true }) }).last()
      await expect(card).toContainText('Profilrevision: 4')
      if (role === 'writer') await expect(card.locator('form').filter({ hasNot: page.locator('select[name="email__mode"]') }).locator('input[name="email"]')).toHaveValue('view-later-current@example.invalid')
      else await expect(card).toContainText('view-later-current@example.invalid')
      if (role === 'reader') await expect(card.locator('form')).toHaveCount(0)
      for (const invoice of f.invoices) {
        await page.goto(`/admin/billing/invoices/${invoice.itemId}`)
        const saved = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Fakturans sparade mottagare', exact: true }) })
        await expect(saved).toContainText('UI Later Saved Recipient'); await expect(saved).toContainText(invoice.email)
        await expect(saved.locator('div').filter({ has: page.locator('dt').filter({ hasText: /^Profilrevision$/ }) }).locator('dd')).toHaveText('3')
        await expect(saved.locator('div').filter({ has: page.locator('dt').filter({ hasText: /^Undantagsrevision$/ }) }).locator('dd')).toHaveText(String(invoice.overrideRevision))
        await expect(saved).toContainText('NO'); await expect(saved).not.toContainText('Äldre fakturagrund')
        await page.reload(); await expect(saved).toContainText(invoice.email)
        await saved.screenshot({ path: `e2e-artifacts/billing-revision-invoice-${role}-${invoice.overrideRevision}.png` })
      }
    } finally { await context.close() }
  }
  console.log('BILLING_REVISION_VIEWS_REAL_BROWSER_PASS writerReaderCurrentListCardRevision=4 invoicesStoredProfile3=true override1And2=true reload=true nativePostcheckRequired=true providerCalls=0')
})
