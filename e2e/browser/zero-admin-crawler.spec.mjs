import { test, expect } from '@playwright/test'

const baseUrl = String(process.env.GRIDEX_E2E_BROWSER_BASE_URL || '').trim()
const email = String(process.env.GRIDEX_E2E_BROWSER_EMAIL || '').trim()
const password = String(process.env.GRIDEX_E2E_BROWSER_PASSWORD || '')
const maxPages = Number.parseInt(String(process.env.GRIDEX_E2E_CRAWLER_MAX_PAGES || '80'), 10)

const ALLOWED_PATH_PREFIXES = ['/dashboard', '/admin']
const SKIP_PATTERNS = [
  /\/logout(?:\/|$)/i,
  /\/api\//i,
  /\/auth\//i,
  /\/download(?:\/|$)/i,
  /\/export(?:\/|$)/i,
]
const MANUAL_ACTION_TERMS = [
  'manuell', 'manual', 'godkänn', 'approve', 'retry', 'försök igen', 'kör ', 'skapa ',
  'markera hanterad', 'åtgärd krävs', 'kräver åtgärd', 'blockerad', 'blocked',
  'review', 'granska', 'skicka', 'submit', 'bekräfta', 'confirm',
]

function normalizedInternalUrl(rawHref, currentUrl) {
  if (!rawHref) return null
  try {
    const url = new URL(rawHref, currentUrl)
    const base = new URL(baseUrl)
    if (url.origin !== base.origin) return null
    if (!ALLOWED_PATH_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) return null
    if (SKIP_PATTERNS.some((pattern) => pattern.test(url.pathname))) return null
    url.hash = ''
    const kept = new URLSearchParams()
    for (const [key, value] of url.searchParams.entries()) {
      if (['status', 'priority', 'type', 'q', 'page'].includes(key)) kept.append(key, value)
    }
    url.search = kept.toString()
    return url.toString()
  } catch {
    return null
  }
}

function pagePath(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return String(url)
  }
}

async function collectManualSignals(page) {
  return page.locator('button, a, [role="button"], input[type="submit"]').evaluateAll((nodes, terms) => {
    const normalizedTerms = terms.map((term) => term.toLowerCase())
    return nodes
      .map((node) => ({
        text: String(node.textContent || node.getAttribute('value') || node.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '),
        tag: node.tagName.toLowerCase(),
        href: node.getAttribute('href'),
        type: node.getAttribute('type'),
      }))
      .filter((item) => item.text && normalizedTerms.some((term) => item.text.toLowerCase().includes(term)))
      .slice(0, 30)
  }, MANUAL_ACTION_TERMS)
}

test('zero-admin crawler traverses authenticated OPS and inventories manual intervention surfaces', async ({ page }, testInfo) => {
  test.skip(
    !baseUrl || !email || !password,
    'Zero-admin crawler requires GRIDEX_E2E_BROWSER_BASE_URL, GRIDEX_E2E_BROWSER_EMAIL and GRIDEX_E2E_BROWSER_PASSWORD.'
  )

  const pageErrors = []
  const consoleErrors = []
  const requestFailures = []
  page.on('pageerror', (error) => pageErrors.push({ url: page.url(), message: error.message }))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ url: page.url(), message: message.text() })
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()
    requestFailures.push({ url: request.url(), errorText: failure?.errorText || 'request_failed' })
  })

  await page.goto('/login')
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(password)
  await page.getByRole('button', { name: 'Logga in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

  const start = new URL('/dashboard', baseUrl).toString()
  const queue = [start]
  const queued = new Set(queue)
  const visited = new Set()
  const pages = []
  const failures = []
  const manualSignals = []

  while (queue.length > 0 && visited.size < maxPages) {
    const target = queue.shift()
    if (!target || visited.has(target)) continue
    visited.add(target)

    let response = null
    try {
      response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => null)
    } catch (error) {
      failures.push({ url: target, kind: 'navigation_error', detail: error instanceof Error ? error.message : String(error) })
      continue
    }

    const finalUrl = page.url()
    const status = response?.status() ?? null
    const bodyText = await page.locator('body').innerText().catch(() => '')
    const redirectedToLogin = new URL(finalUrl).pathname.startsWith('/login')
    const appError = /Internal Server Error|Application error|Unhandled Runtime Error|Something went wrong/i.test(bodyText)

    pages.push({
      requested: pagePath(target),
      final: pagePath(finalUrl),
      status,
      title: await page.title().catch(() => ''),
    })

    if (redirectedToLogin) failures.push({ url: target, kind: 'auth_loop', detail: finalUrl })
    if (status !== null && status >= 400) failures.push({ url: target, kind: 'http_status', detail: status })
    if (appError) failures.push({ url: target, kind: 'application_error_text', detail: bodyText.slice(0, 500) })

    const signals = await collectManualSignals(page).catch(() => [])
    for (const signal of signals) {
      manualSignals.push({ page: pagePath(finalUrl), ...signal })
    }

    const hrefs = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')))
    for (const href of hrefs) {
      const next = normalizedInternalUrl(href, finalUrl)
      if (next && !visited.has(next) && !queued.has(next)) {
        queued.add(next)
        queue.push(next)
      }
    }
  }

  const report = {
    schema_version: 1,
    target_origin: new URL(baseUrl).origin,
    max_pages: maxPages,
    pages_visited: visited.size,
    pages_remaining: queue.length,
    pages,
    failures,
    page_errors: pageErrors,
    console_errors: consoleErrors,
    request_failures: requestFailures.filter((item) => {
      try {
        return new URL(item.url).origin === new URL(baseUrl).origin
      } catch {
        return false
      }
    }),
    manual_intervention_signals: manualSignals,
  }

  await testInfo.attach('zero-admin-crawler-report.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  })

  console.log(`ZERO_ADMIN_CRAWLER pages=${report.pages_visited} failures=${failures.length} manualSignals=${manualSignals.length}`)
  console.log(`ZERO_ADMIN_CRAWLER_REPORT ${JSON.stringify(report)}`)

  expect(report.pages_visited, 'Crawler should cover more than the three legacy authenticated smoke pages').toBeGreaterThan(3)
  expect(failures, 'Authenticated OPS crawler found broken routes or auth loops').toEqual([])
  expect(pageErrors, 'Authenticated OPS crawler observed browser page errors').toEqual([])
})
