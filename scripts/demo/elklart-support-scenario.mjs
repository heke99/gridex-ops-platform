#!/usr/bin/env node
// Ordinary authenticated browser actions only. Never SQL/status patching.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const root = '/workspace/elklart-runtime'
const origin = 'https://localhost:3000'
const receiptPath = `${root}/ops/support-scenario.json`
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
function requireValue(condition, message) { if (!condition) throw new Error(message) }
export function validateSupportTarget(target, tenant, account) {
  requireValue(target === origin && tenant?.fictional === true && uuid.test(tenant.companyId ?? ''), 'Dedicated fictional local tenant required')
  requireValue(['company_admin', 'customer_service_agent'].includes(account?.role)
    && typeof account.password === 'string' && account.password.length > 0
    && /^[a-z.]+@elklart\.example\.invalid$/.test(account.email ?? ''), 'Scoped fictional support account required')
}
export function validateSupportReceipt(receipt, companyId) {
  requireValue(receipt?.version === 1 && receipt.companyId === companyId
    && /^[a-z0-9-]{1,60}$/.test(receipt.runId ?? '')
    && (!receipt.customerId || uuid.test(receipt.customerId))
    && (!receipt.caseId || uuid.test(receipt.caseId)), 'Support receipt scope or identity mismatch')
}
/**
 * @param {Array<{ value: string, label: string }>} options
 * @param {string | null} [expectedId=null]
 * @returns {string | null}
 */
export function matchKarinCustomer(options, expectedId = null) {
  const matches = options.filter(row => /^Karin Holm(?: ·|$)/.test(row.label))
  requireValue(matches.length <= 1, 'Ambiguous Karin customer; reconcile the dedicated fixture first')
  const id = matches[0]?.value ?? null
  requireValue(!id || uuid.test(id), 'Invalid customer option identity')
  requireValue(!expectedId || id === expectedId, 'Existing support customer mismatch')
  return id
}
export function supportMessages(runId) {
  requireValue(/^[a-z0-9-]{1,60}$/.test(runId), 'Invalid support run ID')
  return {
    title: `E2E-Elklart Karin Holm fakturafråga ${runId}`,
    phone: `INTERNT DEMOSAMTAL ${runId}: Karin frågar hur mätvärden ligger till grund för fakturan. Ej identifierad, endast begränsat intag; inga kontouppgifter lämnas ut.`,
    internal: `INTERNT DEMO ${runId}: Kontrollera fakturaunderlag och mätperiod innan fakturaspecifika uppgifter lämnas. Denna anteckning får inte visas för kunden.`,
    reply: `DEMO KUNDSVAR ${runId}: Tack för din fråga. Ditt ärende är registrerat. Vi kontrollerar mätperioden och återkommer med ett svar på Mina sidor.`,
  }
}
function privatePath(file, allowMissing = false) {
  requireValue(file === root || file.startsWith(`${root}/`), 'Path outside private demo runtime')
  for (let current = file; current !== path.dirname(current); current = path.dirname(current)) {
    try { requireValue(!fs.lstatSync(current).isSymbolicLink(), 'Runtime symlink refused') }
    catch (error) { if (!(allowMissing && error.code === 'ENOENT')) throw error }
  }
  try {
    const info = fs.statSync(file)
    requireValue(info.uid === process.getuid() && !(info.mode & 0o7077), 'Private owned runtime path required')
  } catch (error) { if (!(allowMissing && error.code === 'ENOENT')) throw error }
  return file
}
function readPrivate(file) { return JSON.parse(fs.readFileSync(privatePath(file), 'utf8')) }
async function privateScreenshot(page, file) {
  privatePath(file, true)
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.fchmodSync(descriptor, 0o600) } finally { fs.closeSync(descriptor) }
  await page.screenshot({ path: file, fullPage: true, timeout: 15_000 })
}
function save(receipt) {
  privatePath(`${root}/ops`); privatePath(receiptPath, true)
  const temporary = `${receiptPath}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, receiptPath)
  } finally { try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error } }
}
async function submitAction(page, button, reload = true) {
  const current = new URL(page.url())
  const response = page.waitForResponse(result => {
    const url = new URL(result.url())
    return result.request().method() === 'POST' && url.origin === origin && url.pathname === current.pathname
  }, { timeout: 90_000 })
  const [result] = await Promise.all([response, button.click()])
  requireValue(result.status() < 400, 'Ordinary support action failed')
  if (reload) await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 })
}
async function assertCompany(page, companyId) {
  const values = await page.locator('input[name="expected_company_id"]').evaluateAll(nodes => nodes.map(node => node.value))
  requireValue(values.length > 0 && values.every(value => value === companyId), 'Active browser company mismatch or support write form unavailable')
}
async function options(page) {
  return page.locator('select[name="customer_id"] option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent ?? '' })))
}
export async function runSupportScenario() {
  requireValue(process.env.ELKLART_SUPPORT_SCENARIO_ACK === 'ordinary-local-support-only', 'Explicit local browser scenario acknowledgement required')
  privatePath(root); privatePath(`${root}/ops`)
  const tenant = readPrivate(`${root}/ops/tenant.json`)
  const accounts = readPrivate(`${root}/ops/accounts.json`)
  const status = readPrivate(`${root}/ops/status.json`)
  requireValue(status.API_URL === 'http://127.0.0.1:54321' || status.API_URL === 'http://localhost:54321', 'Dedicated local OPS data API required')
  validateSupportTarget(origin, tenant, accounts.administrator)
  validateSupportTarget(origin, tenant, accounts.support)
  requireValue(accounts.support.role === 'customer_service_agent', 'Dedicated customer-service actor required')
  let receipt
  try { receipt = readPrivate(receiptPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  receipt ??= { version: 1, companyId: tenant.companyId, runId: randomUUID(), fictional: true, source: 'ordinary_authenticated_browser', portalVisibility: 'NOT_RUN', invoiceQuestion: 'generic_support_only_no_invoice_yet' }
  validateSupportReceipt(receipt, tenant.companyId)
  const messages = supportMessages(receipt.runId)
  save(receipt)
  // Trust only this runtime's exact public-key pin. No global TLS bypass.
  privatePath(`${root}/tls/server.pem`)
  const certificate = new X509Certificate(fs.readFileSync(`${root}/tls/server.pem`))
  requireValue(Boolean(certificate.checkHost('localhost')), 'Runtime certificate must cover localhost')
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${pin}`] })
  let page
  async function session(account) {
    const context = await browser.newContext({ ignoreHTTPSErrors: false })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      return [origin, 'http://127.0.0.1:54321', 'http://localhost:54321'].includes(url.origin) ? route.continue() : route.abort('blockedbyclient')
    })
    page = await context.newPage()
    page.setDefaultTimeout(30_000)
    await page.goto(`${origin}/login?next=${encodeURIComponent('/admin/customer-cases')}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    const form = page.locator('form').filter({ has: page.locator('input[name="password"]') })
    await form.locator('[name="email"]').fill(account.email)
    await form.locator('[name="password"]').fill(account.password)
    await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 90_000 }), form.locator('button[type="submit"],button:not([type])').first().click()])
    await page.goto(`${origin}/admin/customer-cases`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await assertCompany(page, tenant.companyId)
    return context
  }
  try {
    receipt.step = 'customer_preparation'; save(receipt)
    const preparation = await session(accounts.administrator)
    let customerId = matchKarinCustomer(await options(page), receipt.customerId)
    if (!customerId) {
      await page.goto(`${origin}/admin/customers/intake?mode=manual`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      const form = page.locator('form').filter({ has: page.locator('input[name="firstName"]') })
      await form.locator('[name="firstName"]').fill('Karin')
      await form.locator('[name="lastName"]').fill('Holm')
      const email = form.locator('[name="email"]')
      await email.fill('karin.holm@elklart.example.invalid')
      await submitAction(page, form.getByRole('button', { name: 'Skapa kund', exact: true }), false)
      const created = page.getByRole('status').getByRole('link', { name: 'Öppna kundkort', exact: true })
      await created.waitFor({ state: 'visible', timeout: 30_000 })
      const href = await created.getAttribute('href')
      customerId = /^\/admin\/customers\/([a-f0-9-]{36})$/.exec(href ?? '')?.[1]
      requireValue(uuid.test(customerId ?? ''), 'Ordinary customer intake returned no customer ID')
      receipt.customerId = customerId; receipt.customerCreatedThrough = 'admin_customer_intake'; save(receipt)
    }
    receipt.customerId = customerId; save(receipt)
    await preparation.close()
    await session(accounts.support)
    receipt.step = 'support_case'; receipt.staffRole = accounts.support.role; receipt.staffUserId = accounts.support.userId; save(receipt)
    await page.goto(`${origin}/admin/customer-cases?customer=${customerId}&channel=phone`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await assertCompany(page, tenant.companyId)
    matchKarinCustomer(await options(page), customerId)
    let caseLink = page.getByRole('link', { name: messages.title, exact: true })
    requireValue(await caseLink.count() <= 1, 'Ambiguous support scenario case')
    if (await caseLink.count() === 0) {
      requireValue(!receipt.caseId, 'Previously created case absent from ordinary support queue; reconcile before retry')
      const form = page.locator('form').filter({ has: page.locator('select[name="customer_id"]') })
      await form.locator('[name="customer_id"]').selectOption(customerId)
      await form.locator('[name="title"]').fill(messages.title)
      await form.locator('[name="channel"]').selectOption('phone')
      await form.locator('[name="category"]').fill('invoice_question_demo')
      await form.locator('[name="description"]').fill('Fiktivt demonstrationsärende. Allmän fakturafråga; ingen verklig faktura eller betalning.')
      await submitAction(page, form.getByRole('button', { name: 'Skapa supportärende', exact: true }))
      caseLink = page.getByRole('link', { name: messages.title, exact: true })
    }
    const href = await caseLink.getAttribute('href')
    const caseId = /^\/admin\/customer-cases\/([a-f0-9-]{36})$/.exec(href ?? '')?.[1]
    requireValue(uuid.test(caseId ?? '') && (!receipt.caseId || receipt.caseId === caseId), 'Support case identity mismatch')
    receipt.caseId = caseId; save(receipt)
    await caseLink.click()
    await page.getByRole('heading', { name: 'Historik', exact: true }).waitFor()
    await assertCompany(page, tenant.companyId)
    for (const [mode, message, button] of [['phone', messages.phone, 'Spara samtal'], ['internal', messages.internal, 'Spara intern anteckning'], ['reply', messages.reply, 'Skicka svar till kunden']]) {
      receipt.step = mode; save(receipt)
      if (await page.locator('ol').getByText(message, { exact: true }).count() === 0) {
        await page.locator('label').filter({ has: page.locator(`input[name="composer-mode"][value="${mode}"]`) }).click()
        const form = page.locator('form').filter({ has: page.locator('input[name="case_id"]') }).filter({ has: mode === 'phone' ? page.locator('textarea[name="summary"]') : page.locator('textarea[name="message"]') })
        if (mode === 'phone') {
          await form.locator('[name="verification_method"]').selectOption('unverified')
          await form.locator('[name="summary"]').fill(message)
        } else await form.locator('[name="message"]').fill(message)
        await assertCompany(page, tenant.companyId)
        await submitAction(page, form.getByRole('button', { name: button, exact: true }))
      }
      const entry = page.locator('ol li').filter({ has: page.getByText(message, { exact: true }) })
      await entry.waitFor({ state: 'visible', timeout: 30_000 })
      requireValue((await entry.innerText()).includes(mode === 'reply' ? 'Synlig för kunden' : 'Endast internt'), 'Support message visibility mismatch')
      receipt[`${mode}PersistedInStaffUi`] = true; save(receipt)
    }
    receipt.step = 'staff_complete'; receipt.staffUi = 'PASS'; receipt.portalVisibility ??= 'NOT_RUN'; receipt.invoiceQuestion = 'generic_support_only_no_invoice_yet'; receipt.completedAt = new Date().toISOString(); save(receipt)
    await privateScreenshot(page, `${root}/ops/support-scenario.png`)
    console.log('Ordinary local Karin intake and support actions verified in staff UI. Customer portal visibility and actual invoice linkage remain NOT_RUN. Private receipt saved.')
    return receipt
  } catch (error) {
    receipt.staffUi = 'BLOCKED'; receipt.failureStep = receipt.step; receipt.failure = 'Ordinary browser boundary failed; no automatic duplicate mutation retry'; save(receipt)
    if (page && !page.url().includes('/login')) {
      const screenshot = privatePath(`${root}/ops/support-scenario-blocked.png`, true)
      await privateScreenshot(page, screenshot).catch(() => {})
    }
    throw error
  } finally { await browser.close() }
}
export async function runKarinPortalBoundary() {
  requireValue(process.env.ELKLART_SUPPORT_SCENARIO_ACK === 'ordinary-local-support-only', 'Explicit local browser scenario acknowledgement required')
  const tenant = readPrivate(`${root}/ops/tenant.json`)
  const receipt = readPrivate(receiptPath)
  validateSupportReceipt(receipt, tenant.companyId)
  requireValue(tenant.fictional && receipt.customerId && receipt.caseId && receipt.staffUi === 'PASS', 'Complete ordinary support journey required before portal verification')
  const accounts = readPrivate(`${root}/ops/accounts.json`)
  validateSupportTarget(origin, tenant, accounts.support)
  const portalOrigin = 'https://localhost:3001'
  const portalStatus = readPrivate(`${root}/portal/status.json`)
  requireValue(['http://127.0.0.1:55321', 'http://localhost:55321'].includes(portalStatus.API_URL), 'Dedicated local portal data API required')
  const accountPath = `${root}/portal/karin-support-account.json`
  privatePath(`${root}/portal`); privatePath(accountPath, true)
  let account
  try { account = readPrivate(accountPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  account ??= { email: 'karin.holm@elklart.example.invalid', password: `Elklart!${randomBytes(24).toString('base64url')}9`, companyId: tenant.companyId, customerId: receipt.customerId, fictional: true }
  requireValue(account.fictional && account.email === 'karin.holm@elklart.example.invalid' && account.companyId === tenant.companyId && account.customerId === receipt.customerId, 'Karin portal account scope mismatch')
  const saveAccount = () => { privatePath(accountPath, true); const fd = fs.openSync(accountPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600); try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, JSON.stringify(account, null, 2)) } finally { fs.closeSync(fd) } }
  saveAccount()
  const certificate = new X509Certificate(fs.readFileSync(privatePath(`${root}/tls/server.pem`)))
  requireValue(Boolean(certificate.checkHost('localhost')), 'Runtime certificate must cover localhost')
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${pin}`] })
  let page
  async function contextFor(allowed) {
    const context = await browser.newContext({ ignoreHTTPSErrors: false })
    await context.route('**/*', route => allowed.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort('blockedbyclient'))
    page = await context.newPage(); page.setDefaultTimeout(30_000)
    return context
  }
  async function login(base, actor, next) {
    await page.goto(`${base}/login?next=${encodeURIComponent(next)}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    const form = page.locator('form').filter({ has: page.locator('input[name="password"]') })
    await form.locator('[name="email"]').fill(actor.email)
    await form.locator('[name="password"]').fill(actor.password)
    await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 60_000 }), form.locator('button[type="submit"],button:not([type])').first().click()])
  }
  try {
    receipt.portalVisibility = 'RUNNING'; receipt.portalStep = 'read_customer_number'; save(receipt)
    const opsContext = await contextFor([origin, 'http://localhost:54321', 'http://127.0.0.1:54321'])
    await login(origin, accounts.support, '/admin/customer-cases')
    await page.goto(`${origin}/admin/customer-cases`, { waitUntil: 'domcontentloaded' }); await assertCompany(page, tenant.companyId)
    await page.goto(`${origin}/admin/customers/${receipt.customerId}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.getByText(/^Kundnummer:/).first().waitFor({ state: 'visible', timeout: 60_000 })
    const customerNumber = /Kundnummer:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,99})/.exec(await page.locator('body').innerText())?.[1]
    requireValue(Boolean(customerNumber), 'Actual OPS customer number unavailable')
    receipt.customerNumber = customerNumber; save(receipt)
    await opsContext.close()
    const allowed = [portalOrigin, 'http://127.0.0.1:55321', 'http://localhost:55321']
    if (!account.registrationAttempted) {
      const registration = await contextFor(allowed)
      receipt.portalStep = 'ordinary_registration'; save(receipt)
      await page.goto(`${portalOrigin}/register`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await page.locator('input[type="email"]').fill(account.email)
      await page.locator('input[type="password"]').nth(0).fill(account.password)
      await page.locator('input[type="password"]').nth(1).fill(account.password)
      await page.locator('input[type="checkbox"]').check()
      account.registrationAttempted = true; saveAccount()
      await page.getByRole('button', { name: 'Skapa konto', exact: true }).click()
      await page.getByText('Kontot är nästan klart', { exact: true }).waitFor({ timeout: 60_000 })
      account.registrationUi = 'PASS'; saveAccount()
      await registration.close()
    }
    await contextFor(allowed)
    receipt.portalStep = 'ordinary_login_and_link'; save(receipt)
    await login(portalOrigin, account, '/mina-sidor')
    await page.goto(`${portalOrigin}/aktivera-kundkonto`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    const numberInput = page.locator('input[name="customer_number"]')
    if (await numberInput.getAttribute('readonly') !== null) {
      requireValue(await numberInput.inputValue() === customerNumber, 'Existing portal customer number mismatch')
      await page.getByRole('link', { name: 'Till Mina sidor', exact: true }).click()
    } else {
      await numberInput.fill(customerNumber)
      await Promise.all([page.waitForURL(url => url.pathname === '/mina-sidor', { timeout: 90_000 }), page.getByRole('button', { name: 'Koppla kundkonto', exact: true }).click()])
    }
    await page.getByText(customerNumber, { exact: false }).first().waitFor({ state: 'visible', timeout: 60_000 })
    requireValue((await page.locator('body').innerText()).includes(customerNumber), 'Portal linked-customer readback missing')
    receipt.portalStep = 'public_support_visibility'; save(receipt)
    await page.goto(`${portalOrigin}/dashboard/support`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    const messages = supportMessages(receipt.runId)
    await page.getByRole('heading', { name: messages.title, exact: true }).waitFor({ timeout: 60_000 })
    const ticket = page.locator('section').filter({ has: page.getByRole('heading', { name: messages.title, exact: true }) })
    const text = await ticket.innerText()
    requireValue(text.includes(messages.reply) && !text.includes(messages.internal) && !text.includes(messages.phone), 'Portal support visibility failed')
    requireValue(!(await page.locator('body').innerText()).includes('senast lokalt sparade'), 'Portal is showing unavailable OPS fallback')
    receipt.portalVisibility = 'PASS'; receipt.portalStep = 'complete'; receipt.portalCompletedAt = new Date().toISOString(); receipt.portalAccountSource = 'normal_registration_and_existing_customer_link'; save(receipt)
    await privateScreenshot(page, `${root}/ops/support-scenario-portal.png`)
    console.log('Karin normal portal registration/link and customer reply visibility verified; internal phone/note excluded. Actual invoice linkage remains outside this support receipt.')
    return receipt
  } catch (error) {
    receipt.portalVisibility = 'BLOCKED'; receipt.portalFailureStep = receipt.portalStep; save(receipt)
    if (page && !page.url().includes('/login') && !page.url().includes('/register')) await privateScreenshot(page, `${root}/ops/support-scenario-portal-blocked.png`).catch(() => {})
    throw error
  } finally { await browser.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  (process.argv.includes('--portal') ? runKarinPortalBoundary() : runSupportScenario()).catch(() => { console.error('Support scenario blocked at ordinary browser boundary; private support-scenario receipt retained.'); process.exitCode = 1 })
}
