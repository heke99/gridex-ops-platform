import { test, expect } from '@playwright/test'
import {
  fingerprint,
  productionRunId,
  requireEnv,
  safeUrlOrigin,
  writeEvidence,
} from './helpers/evidence.mjs'

const tenantWebsiteUrl = requireEnv('GRIDEX_E2E_TENANT_WEBSITE_URL').replace(/\/$/, '')
const address = requireEnv('GRIDEX_E2E_CUSTOMER_ADDRESS').trim()
const postalCode = requireEnv('GRIDEX_E2E_CUSTOMER_POSTAL_CODE').replace(/\s+/g, '').trim()
const city = requireEnv('GRIDEX_E2E_CUSTOMER_CITY').trim()
const annualKwhRaw = requireEnv('GRIDEX_E2E_CUSTOMER_ANNUAL_KWH').trim()
const runId = productionRunId()

function validatedAnnualKwh(value) {
  const number = Number(value.replace(',', '.'))
  if (!Number.isFinite(number) || number < 100 || number > 2_400_000) {
    throw new Error('GRIDEX_E2E_CUSTOMER_ANNUAL_KWH must be a number between 100 and 2400000.')
  }
  return Math.round(number)
}

function validatePostalCode(value) {
  if (!/^\d{5}$/.test(value)) {
    throw new Error('GRIDEX_E2E_CUSTOMER_POSTAL_CODE must contain exactly five digits.')
  }
  return value
}

test('authorized real customer address can resolve a canonical Gridex quote without submitting a contract', async ({ page }) => {
  const startedAt = new Date().toISOString()
  const annualKwh = validatedAnnualKwh(annualKwhRaw)
  const normalizedPostalCode = validatePostalCode(postalCode)
  const checks = []
  const observedResponses = []

  page.on('response', (response) => {
    const url = response.url()
    if (!url.startsWith(tenantWebsiteUrl)) return
    const pathname = new URL(url).pathname
    if (
      pathname.includes('/api/public/') ||
      pathname.includes('/api/checkout/context')
    ) {
      observedResponses.push({ pathname, status: response.status() })
    }
  })

  try {
    const response = await page.goto(`${tenantWebsiteUrl}/teckna-avtal`)
    expect(response).not.toBeNull()
    expect(response.status()).toBeLessThan(500)
    await expect(page.getByRole('heading', { name: /Teckna elavtal/i }).first()).toBeVisible()
    checks.push({ name: 'real_signup_surface', status: 'passed' })

    await page.getByLabel('Postnummer').fill(normalizedPostalCode)
    await page.getByLabel('Ort').fill(city)
    await page.getByLabel('Adress').fill(address)
    await page.getByText('Jag känner till årsförbrukningen', { exact: true }).click()
    await page.getByLabel(/Årsförbrukning.*kWh\/år/i).fill(String(annualKwh))

    const contractSelect = page.getByLabel('Elavtal')
    await expect(contractSelect).toBeVisible()
    const selectedValue = await contractSelect.inputValue()
    expect(selectedValue, 'At least one published Gridex contract must be selectable').not.toBe('')
    checks.push({ name: 'published_contract_available', status: 'passed' })

    await page.getByRole('button', { name: 'Hämta pris' }).click()

    await expect(page.getByText(/Elområde:\s*SE[1-4]/).first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText('Beräknad månadskostnad inkl. moms')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('button', { name: 'Välj detta avtal' })).toBeVisible()
    await expect(page.locator('#calculator-status')).not.toContainText(/kunde inte|fel|försök igen/i)
    checks.push({ name: 'canonical_quote_returned', status: 'passed' })

    await page.getByRole('button', { name: 'Välj detta avtal' }).click()
    await expect(page.getByRole('heading', { name: 'Slutför teckningen' })).toBeVisible()
    checks.push({ name: 'quote_continues_to_customer_details', status: 'passed' })

    const failedPublicCalls = observedResponses.filter((item) => item.status >= 400)
    expect(failedPublicCalls, 'Gridex quote preflight must not contain failed public/checkout API responses').toEqual([])
    checks.push({
      name: 'quote_api_chain',
      status: 'passed',
      detail: {
        observed_calls: observedResponses.map((item) => ({ pathname: item.pathname, status: item.status })),
      },
    })

    // Intentionally stop here. Customer authentication, identity fields, legal
    // acceptance and the final application submit form a real business transaction
    // and require a stronger, separate live-customer confirmation gate.
    writeEvidence('gridex-production-live-customer-preflight.json', {
      run_id: runId,
      mode: 'live-customer-preflight',
      status: 'passed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      target: { tenant_website_origin: safeUrlOrigin(tenantWebsiteUrl) },
      fixture: {
        address_fingerprint: fingerprint(`${address}|${normalizedPostalCode}|${city}`),
        annual_kwh: annualKwh,
      },
      checks,
      contract_submission_attempted: false,
      customer_account_created: false,
      market_outbound_attempted: false,
      pii_written_to_artifact: false,
    })
  } catch (error) {
    writeEvidence('gridex-production-live-customer-preflight.json', {
      run_id: runId,
      mode: 'live-customer-preflight',
      status: 'failed',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      checks,
      contract_submission_attempted: false,
      customer_account_created: false,
      market_outbound_attempted: false,
      pii_written_to_artifact: false,
    })
    throw error
  }
})
