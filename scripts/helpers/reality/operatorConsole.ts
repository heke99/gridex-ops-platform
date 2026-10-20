// Gridex platform staff at work in the real admin UI (Playwright, real login),
// for go-live steps that are operator actions in production.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { LIVE } from '../live-chain-fixture'

let browser: Browser | null = null
const sessions = new Map<string, BrowserContext>()

export async function operatorSession(email: string, password: string) {
  const existing = sessions.get(email)
  if (existing) return existing
  browser ??= await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
  const context = await browser.newContext({ baseURL: LIVE.appUrl })
  const page = await context.newPage()
  await page.goto('/login')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')])
  await page.close()
  sessions.set(email, context)
  return context
}

export async function closeOperatorConsole() { await browser?.close(); browser = null; sessions.clear() }

/**
 * Ediel's published actor registry (companies.xml from ediel.se, kept as a
 * project fixture) with every e-mail address rewritten to example.invalid, so no
 * message can ever reach a real market actor even if a transport is misconfigured.
 * Each actor's Ediel SMTP address becomes ediel-<EdielId>@example.invalid.
 */
export function sanitizedActorRegistry(): { path: string; mailboxFor: (edielId: string) => string } {
  const source = readFileSync('__tests__/fixtures/ediel-actor-registry/companies.xml', 'utf8')
  const rewritten = source.replace(/<Company>([\s\S]*?)<\/Company>/g, company => {
    const edielId = /<Key Type="EdielId">(\d+)<\/Key>/.exec(company)?.[1] ?? 'unknown'
    return company
      .replace(/(<CommunicationAddress Type="SMTP">)[^<]*(<\/CommunicationAddress>)/g, `$1ediel-${edielId}@example.invalid$2`)
      .replace(/[A-Za-z0-9._%+-]+@(?!example\.invalid)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, `contact-${edielId}@example.invalid`)
  })
  if (/@(?!example\.invalid)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(rewritten)) throw Error('registry_sanitization_incomplete')
  const path = join(tmpdir(), `companies-reality-${process.pid}.xml`)
  writeFileSync(path, rewritten)
  return { path, mailboxFor: edielId => `ediel-${edielId}@example.invalid` }
}

/**
 * Submits a server-action form and waits for the action's own response. A
 * networkidle wait resolves at once on an idle page, so closing the page after
 * it aborted the POST before the server ever saw it.
 */
async function submitServerAction(page: Page, submit: () => Promise<void>, timeout: number) {
  const response = page.waitForResponse(r => r.request().method() === 'POST' && Boolean(r.request().headers()['next-action']), { timeout })
  await submit()
  const status = (await response).status()
  await page.waitForLoadState('load')
  return status
}

/** /admin/ediel/actors: upload, type IMPORTERA, "Godkänn och importera" (grid owner registry included). */
export async function importActorRegistry(context: BrowserContext, filePath: string) {
  const page = await context.newPage()
  await page.goto('/admin/ediel/actors')
  await page.setInputFiles('input[name="actorImportFile"]', filePath)
  await page.fill('input[name="confirmApply"]', 'IMPORTERA')
  const action = await submitServerAction(page, () => page.click('button[name="importMode"][value="apply"]'), 600_000)
  const text = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
  await page.close()
  return { actionStatus: action, page: text.slice(0, 2000) }
}

/**
 * Searches the register for the actor by name (the search box matches name,
 * org.nr and source, not Ediel ID: FINDINGS F31) and presses "Verifiera för
 * kundflöde" on that actor's card.
 */
export async function verifyActorForCustomerFlow(context: BrowserContext, actorName: string) {
  const page = await context.newPage()
  await page.goto(`/admin/ediel/actors?q=${encodeURIComponent(actorName)}&status=all`)
  const card = page.locator('div.rounded-2xl', { has: page.getByText(actorName, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Verifiera för kundflöde' }) }).first()
  const button = card.getByRole('button', { name: 'Verifiera för kundflöde' })
  const enabled = await button.isEnabled().catch(() => false)
  const action = enabled ? await submitServerAction(page, () => button.click(), 120_000) : null
  const text = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
  await page.close()
  return { clicked: enabled, actionStatus: action, page: text.slice(0, 1500) }
}

/**
 * /admin/platform/go-live/<companyId>#brp: the onboarding step where Gridex staff choose the tenant's
 * balance responsible party from the Ediel registry and the date it applies from (FINDINGS F44).
 */
export async function chooseTenantBrp(context: BrowserContext, companyId: string, brpName: string, validFrom: string) {
  const page = await context.newPage()
  await page.goto(`/admin/platform/go-live/${companyId}#brp`)
  const form = page.locator('section#brp form')
  const option = await form.locator('select[name="brp_actor_id"] option').filter({ hasText: brpName }).first().getAttribute('value')
  if (!option) { await page.close(); return { actionStatus: 0, status: 'option_missing', message: brpName } }
  await form.locator('select[name="brp_actor_id"]').selectOption(option)
  await form.locator('input[name="valid_from"]').fill(validFrom)
  const actionStatus = await submitServerAction(page, () => form.getByRole('button', { name: 'Spara BRP' }).click(), 120_000)
  await page.waitForURL(url => url.searchParams.has('status'), { timeout: 30_000 }).catch(() => undefined)
  const url = new URL(page.url())
  const shown = (await page.locator('section#brp').innerText().catch(() => '')).replace(/\s+/g, ' ')
  await page.close()
  return { actionStatus, status: url.searchParams.get('status'), message: url.searchParams.get('message'), shown: shown.slice(0, 400) }
}

/**
 * /admin/network-owners: "Kontrollera nätägare" links each SVK grid area owner
 * (platform_grid_owners) to its OPS grid owner and recomputes verification.
 * Verifying the actor for the customer flow does not do this (FINDINGS F32).
 */
export async function checkGridOwners(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto('/admin/network-owners')
  const action = await submitServerAction(page, () => page.getByRole('button', { name: 'Kontrollera nätägare' }).click(), 300_000)
  await page.close()
  return { actionStatus: action }
}

/** /admin/ediel/auto-readiness → "Fler kontroller" → "Bekräfta säkra routes" (registry shows no subaddress required). */
export async function confirmSafeBlankSubaddresses(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto('/admin/ediel/auto-readiness')
  await page.getByText('Fler kontroller').click()
  const action = await submitServerAction(page, () => page.getByRole('button', { name: 'Bekräfta säkra routes' }).click(), 300_000)
  await page.close()
  return { actionStatus: action }
}

/** /admin/network-owners?edit=<id> → "Sök certifikat nu för vald nätägare" (Expisoft directory lookup). */
export async function searchGridOwnerCertificate(context: BrowserContext, gridOwnerId: string) {
  const page = await context.newPage()
  await page.goto(`/admin/network-owners?edit=${gridOwnerId}`)
  const action = await submitServerAction(page, () => page.getByRole('button', { name: 'Sök certifikat nu för vald nätägare' }).click(), 120_000)
  await page.waitForURL(url => url.searchParams.has('status'), { timeout: 30_000 }).catch(() => undefined)
  const url = new URL(page.url())
  await page.close()
  return { actionStatus: action, status: url.searchParams.get('status'), message: url.searchParams.get('message') }
}

/**
 * /admin/ediel/route-readiness?q=<EdielId>&env=<lane>: "Materialisera <lane>-route" for each of the tenant's
 * blocked routes to the grid owner. The cards do not name the tenant (FINDINGS F33), so the form is
 * picked by its hidden companyId.
 */
export async function materializeTenantRoutes(context: BrowserContext, companyId: string, edielId: string, environment: 'test' | 'production') {
  const clicks: Array<{ button: string; route: string; actionStatus: number; code: string | null }> = []
  for (const name of [environment === 'production' ? 'Materialisera production-route' : 'Materialisera test-route']) {
    const done = new Set<string>()
    for (let attempt = 0; attempt < 15; attempt++) {
      const page = await context.newPage()
      await page.goto(`/admin/ediel/route-readiness?q=${edielId}&env=${environment}`)
      const forms = page.locator(`form:has(input[name="companyId"][value="${companyId}"])`).filter({ has: page.getByRole('button', { name }) })
      let target: { index: number; route: string } | null = null
      for (let index = 0; index < await forms.count(); index++) {
        const form = forms.nth(index)
        // Read the hidden fields in one evaluation: a locator wait on an absent field costs its full timeout.
        const route = await form.evaluate(element => ['messageFamily', 'messageCode', 'actorSettingId']
          .map(name => element.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value).filter(Boolean).join('/'))
        if (!done.has(route)) { target = { index, route }; break }
      }
      if (!target) {
        // The streamed page can still hold the cards in its hidden boundary when the load event fires; retry.
        if (done.size === 0 && attempt < 5) { await page.close(); await new Promise(resolve => setTimeout(resolve, 5_000)); continue }
        if (done.size === 0) clicks.push({ button: name, route: 'none', actionStatus: 0, code: `not_found forms=${await forms.count()} cards=${await page.locator(`input[name="companyId"][value="${companyId}"]`).count()} text=${(await page.locator('#admin-main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}` })
        await page.close(); break
      }
      done.add(target.route)
      const actionStatus = await submitServerAction(page, () => forms.nth(target.index).getByRole('button', { name }).click(), 120_000)
      await page.waitForURL(url => url.searchParams.has('code') || url.searchParams.has('status'), { timeout: 30_000 }).catch(() => undefined)
      clicks.push({ button: name, route: target.route, actionStatus, code: new URL(page.url()).searchParams.get('code') })
      await page.close()
    }
  }
  return clicks
}

/**
 * /admin/platform/go-live/<companyId>: "Kontrollera & godkänn production" with the UUID of a saved
 * outbound production message (readiness, dry run, live transition and first live send in one step).
 */
export async function approveCompanyProduction(context: BrowserContext, companyId: string, messageId: string) {
  const page = await context.newPage()
  await page.goto(`/admin/platform/go-live/${companyId}`)
  await page.fill('input[name="message_id"]', messageId)
  const actionStatus = await submitServerAction(page, () => page.getByRole('button', { name: 'Kontrollera & godkänn production' }).click(), 300_000)
  await page.waitForURL(url => url.searchParams.has('status'), { timeout: 60_000 }).catch(() => undefined)
  const url = new URL(page.url())
  await page.close()
  return { actionStatus, status: url.searchParams.get('status'), message: url.searchParams.get('message') }
}

/**
 * /admin/platform/go-live/<companyId>/route-wizard: "Skapa valda production routes" for PRODAT and UTILTS.
 * These are the tenant's dynamic market routes whose receiver is the customer's verified grid owner.
 */
export async function createProductionRoutesFromWizard(context: BrowserContext, companyId: string) {
  const page = await context.newPage()
  await page.goto(`/admin/platform/go-live/${companyId}/route-wizard`)
  for (const family of ['PRODAT', 'UTILTS']) await page.locator(`input[name="message_family"][value="${family}"]`).check()
  const actionStatus = await submitServerAction(page, () => page.getByRole('button', { name: 'Skapa valda production routes' }).click(), 120_000)
  await page.waitForURL(url => url.searchParams.has('status') || url.searchParams.has('message'), { timeout: 30_000 }).catch(() => undefined)
  const url = new URL(page.url())
  await page.close()
  return { actionStatus, status: url.searchParams.get('status'), message: url.searchParams.get('message') }
}
