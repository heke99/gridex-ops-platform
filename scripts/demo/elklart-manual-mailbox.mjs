// Configure the real admin form after the controlled SMTP receipt exists.
import fs from 'node:fs'
import { X509Certificate, createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { assertPrivatePath } from './elklart-ops-bootstrap.mjs'
const root = '/workspace/elklart-runtime'
const read = file => JSON.parse(fs.readFileSync(assertPrivatePath(`${root}/${file}`), 'utf8'))
const tenant = read('ops/tenant.json')
const accounts = read('ops/accounts.json')
if (tenant.fictional !== true) throw Error('Fictional tenant required')
const receipts = fs.readdirSync(`${root}/provider-smtp`).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => read(`provider-smtp/${name}`))
if (!receipts.some(row => row.status === 'sent' && row.envelope?.from === 'manual-ops@elklart.example.invalid' && row.envelope?.to?.includes('network-owner@elklart.example.invalid') && row.accepted?.includes('network-owner@elklart.example.invalid'))) throw Error('Verify controlled manual SMTP delivery first')
const cert = new X509Certificate(fs.readFileSync(`${root}/tls/server.pem`))
const pin = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', `--ignore-certificate-errors-spki-list=${pin}`] })
try {
  const context = await browser.newContext()
  await context.route('**/*', route => ['https://localhost:3000', 'http://localhost:54321'].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort())
  const page = await context.newPage()
  await page.goto('https://localhost:3000/login?next=%2Fadmin%2Fmanual-mailboxes', { timeout: 90000 })
  await page.locator('[name=email]').fill(accounts.platform.email)
  await page.locator('[name=password]').fill(accounts.platform.password)
  await Promise.all([page.waitForURL(url => url.pathname === '/admin/manual-mailboxes', { timeout: 90000 }), page.locator('button[type=submit]').click()])
  const name = 'Elklart lokal manuell SMTP (ingen IMAP)'
  if (!(await page.getByRole('row').filter({has:page.getByText(name,{exact:true})}).count())) {
    const form = page.locator('form').filter({ has: page.locator('[name=mailbox_name]') })
    for (const [key,value] of Object.entries({mailbox_name:name,from_email:'manual-ops@elklart.example.invalid',reply_to_email:'manual-ops@elklart.example.invalid',smtp_host:'127.0.0.1',smtp_port:'38482',smtp_username:'ediel@elklart.example.invalid',smtp_secret_reference:'env:MANUAL_MAILBOX_ELKLART_SMTP_PASSWORD',imap_host:'',imap_username:'',imap_secret_reference:''})) await form.locator(`[name=${key}]`).fill(value)
    await form.locator('[name=company_id]').selectOption(tenant.companyId)
    await form.locator('[name=environment]').selectOption('production')
    await form.locator('[name=smtp_secure]').uncheck()
    await form.locator('[name=is_verified]').check()
    await Promise.all([page.waitForURL(url => url.searchParams.has('status'), {timeout:90000}),form.getByRole('button',{name:'Spara brevlåda'}).click()])
    if(new URL(page.url()).searchParams.get('status')!=='success') throw Error('Ordinary mailbox action failed')
  }
  if (!(await page.getByRole('row').filter({has:page.getByText(name,{exact:true})}).count())) throw Error('Mailbox readback missing')
  const output = assertPrivatePath(`${root}/ops/manual-mailbox-evidence.json`)
  fs.writeFileSync(output,JSON.stringify({companyId:tenant.companyId,source:'ordinary_admin_mailbox_form',smtpDeliveryVerified:true,imapConfigured:false,marketCertification:false,checkedAt:new Date().toISOString()}),{mode:0o600})
  console.log('Controlled SMTP mailbox configured through ordinary admin form; IMAP remains unconfigured.')
} finally { await browser.close() }
