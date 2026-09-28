import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

const enabled = process.env.GRIDEX_CONTACT_LOCAL_E2E === '1'
  && process.env.NEXT_PUBLIC_SUPABASE_URL === 'http://127.0.0.1:54321'
  && !process.env.GRIDEX_E2E_BROWSER_BASE_URL
  && Boolean(process.env.GRIDEX_CONTACT_FIXTURE_PATH && process.env.GRIDEX_CONTACT_TEST_PASSWORD)
test.skip(!enabled, 'Requires the disposable local Supabase replay and Auth fixture.')

const fixture = enabled ? JSON.parse(readFileSync(process.env.GRIDEX_CONTACT_FIXTURE_PATH, 'utf8')) : null
const card = (customerId) => `/admin/customers/${customerId}?tab=profile`
const contactForm = (page) => page.locator(`form:has(input[name="id"][value="${fixture.contactA}"])`)

async function login(page, email) {
  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(process.env.GRIDEX_CONTACT_TEST_PASSWORD)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

test('staff browser saves the primary phone while read-only and foreign tenant actors cannot write it', async ({ browser }) => {
  const writer = await browser.newPage()
  await login(writer, fixture.writerEmail)
  await writer.goto(card(fixture.customerA))
  const form = contactForm(writer)
  await expect(form).toHaveCount(1)
  await expect(form.locator('input[name="expected_revision"]')).toHaveValue('0')
  await expect(form.locator('input[name="email"]')).toHaveValue('before@example.invalid')
  const actionName = await form.evaluate((element) =>
    Array.from(new FormData(element).keys()).find((key) => key.startsWith('$ACTION_ID_')) ?? null)
  expect(actionName).toMatch(/^\$ACTION_ID_/)
  await writer.locator(`article:has(form input[name="id"][value="${fixture.contactA}"])`)
    .getByText('Redigera kontakt').click()
  await form.locator('input[name="phone"]').fill('+46111111111')
  await form.getByRole('button', { name: 'Spara kontakt' }).click()
  await expect(form.locator('input[name="expected_revision"]')).toHaveValue('1')
  await writer.reload()
  await expect(contactForm(writer).locator('input[name="phone"]')).toHaveValue('+46111111111')
  await expect(contactForm(writer).locator('input[name="email"]')).toHaveValue('before@example.invalid')
  await writer.locator(`article:has(form input[name="id"][value="${fixture.contactA}"])`)
    .getByText('Redigera kontakt').click()
  await writer.screenshot({ path: 'e2e-artifacts/customer-contact-saved.png' })
  await writer.close()

  for (const email of [fixture.readerEmail, fixture.foreignWriterEmail]) {
    const deniedPage = await browser.newPage()
    await login(deniedPage, email)
    await deniedPage.goto(card(fixture.customerA))
    await expect(contactForm(deniedPage)).toHaveCount(0)
    const deniedStatus = await deniedPage.evaluate(async ({ actionName, customerId, contactId }) => {
      const body = new FormData()
      body.append(actionName, '')
      body.append('customer_id', customerId)
      body.append('customer_type', 'private')
      body.append('id', contactId)
      body.append('type', 'primary')
      body.append('is_primary', 'on')
      body.append('expected_revision', '1')
      body.append('idempotency_key', 'p2-forged-browser-denied')
      body.append('name', 'Synthetic Primary')
      body.append('email', 'before@example.invalid')
      body.append('phone', '+46999999999')
      body.append('title', '')
      const response = await fetch(window.location.href, { method: 'POST', body, credentials: 'same-origin' })
      return response.status
    }, { actionName, customerId: fixture.customerA, contactId: fixture.contactA })
    expect(deniedStatus).toBeGreaterThanOrEqual(400)
    await deniedPage.close()
  }
})

test('delegated HTTP API uses the same revision, rejects forged identity and replays one result', async ({ request, browser }) => {
  const url = '/api/v1/customer/profile-update'
  const headers = {
    authorization: `Bearer ${fixture.apiKey}`,
    'x-gridex-customer-assertion': fixture.apiPostAssertion,
    'idempotency-key': 'p2-browser-api-contact',
  }
  const body = { profile: { phone: '+46222222222' }, expected_contact_revision: 1 }

  const missingProof = await request.post(url, {
    headers: { ...headers, 'x-gridex-customer-assertion': '' }, data: body,
  })
  expect(missingProof.status()).toBe(403)
  const wrongCustomer = await request.post(url, {
    headers: { ...headers, 'x-gridex-customer-assertion': fixture.wrongCustomerAssertion }, data: body,
  })
  expect(wrongCustomer.status()).toBe(403)
  const forgedCustomer = await request.post(url, {
    headers: { ...headers, 'x-gridex-customer-number': fixture.customerNumberB }, data: body,
  })
  expect(forgedCustomer.status()).toBe(403)

  const first = await request.post(url, { headers, data: body })
  expect(first.status()).toBe(200)
  const accepted = await first.json()
  expect(accepted.data).toMatchObject({ profile_updated: true, contact_revision: 2 })
  expect(accepted.data.completion_reference).toEqual(expect.any(String))
  const replay = await request.post(url, { headers, data: body })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).data.completion_reference).toBe(accepted.data.completion_reference)
  const changedPayload = await request.post(url, {
    headers, data: { profile: { phone: '+46333333333' }, expected_contact_revision: 1 },
  })
  expect(changedPayload.status()).toBe(409)
  const stale = await request.post(url, {
    headers: { ...headers, 'idempotency-key': 'p2-browser-api-stale' },
    data: { profile: { phone: '+46333333333' }, expected_contact_revision: 1 },
  })
  expect(stale.status()).toBe(409)

  const me = await request.get('/api/v1/customer/me', {
    headers: { authorization: `Bearer ${fixture.apiKey}`, 'x-gridex-customer-assertion': fixture.apiGetAssertion },
  })
  expect(me.status()).toBe(200)
  expect((await me.json()).data).toMatchObject({ contact_revision: 2, phone: '+46222222222', email: 'before@example.invalid' })

  const writer = await browser.newPage()
  await login(writer, fixture.writerEmail)
  await writer.goto(card(fixture.customerA))
  await writer.getByText('Lägg till ny kontakt').click()
  const secondary = writer.locator('details:has(summary:text-is("Lägg till ny kontakt")) form')
  await expect(secondary.locator('input[name="expected_revision"]')).toHaveValue('2')
  await secondary.locator('select[name="type"]').selectOption('billing')
  await secondary.locator('input[name="is_primary"]').uncheck()
  await secondary.locator('input[name="name"]').fill('Synthetic Billing')
  await secondary.locator('input[name="email"]').fill('billing@example.invalid')
  await secondary.getByRole('button', { name: 'Lägg till kontakt' }).click()
  await expect(writer.getByText('Sparad kontaktrevision: 3')).toBeVisible()
  await writer.reload()
  const savedSecondary = writer.locator('article:has-text("Synthetic Billing")')
  await expect(savedSecondary).toContainText('billing@example.invalid')
  await expect(savedSecondary).toContainText('Sekundär')
  await expect(writer.getByText('Sparad kontaktrevision: 3')).toBeVisible()
  await writer.close()
})
