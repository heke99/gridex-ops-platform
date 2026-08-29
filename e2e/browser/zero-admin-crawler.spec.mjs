import { test, expect } from '@playwright/test'

const baseUrl = String(process.env.GRIDEX_E2E_BROWSER_BASE_URL || '').trim()
const email = String(process.env.GRIDEX_E2E_BROWSER_EMAIL || '').trim()
const password = String(process.env.GRIDEX_E2E_BROWSER_PASSWORD || '')
const maxPages = Number.parseInt(String(process.env.GRIDEX_E2E_CRAWLER_MAX_PAGES || '400'), 10)

const ALLOWED_PATH_PREFIXES = ['/dashboard', '/admin']
const SKIP_PATTERNS = [/\/logout(?:\/|$)/i, /\/api\//i, /\/auth\//i, /\/download(?:\/|$)/i, /\/export(?:\/|$)/i]
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MANUAL_ACTION_TERMS = [
  'manuell', 'manual', 'godkänn', 'approve', 'retry', 'försök igen', 'kör ', 'skapa ',
  'markera hanterad', 'markera skickad', 'åtgärd krävs', 'kräver åtgärd', 'blockerad', 'blocked',
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
    for (const [key, value] of url.searchParams.entries()) if (key === 'tab') kept.append(key, value)
    url.search = kept.toString()
    return url.toString()
  } catch {
    return null
  }
}

function routeSurfaceKey(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const segments = url.pathname.split('/').map((segment) => UUID_SEGMENT.test(segment) ? ':uuid' : segment)
    return `${segments.join('/')}${url.search}`
  } catch {
    return String(rawUrl)
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

function signalClass(text, tag, href) {
  const value = String(text || '').toLowerCase()
  const target = String(href || '').toLowerCase()
  if (tag === 'a' && (target.includes('/work-queue') || target.includes('/outbound/unresolved'))) return 'review_navigation'
  if (/skyddad identitet|osäkra matchningar|manuell granskning|kräver manuell åtgärd|blockerad|blocked/.test(value)) return 'review_or_stop'
  if (/försök igen|retry/.test(value)) return 'retry_candidate'
  if (/kör automatisk genomgång|kör prognos/.test(value)) return 'scheduled_auto_candidate'
  if (/markera skickad/.test(value)) return 'event_driven_auto_candidate'
  if (/skapa uppgiftsbegäran|skapa tillståndsutkast/.test(value)) return 'lifecycle_auto_candidate'
  if (/skapa bolag|skapa konto|skicka inbjudan|skicka reset|skicka confirm|skapa kund/.test(value)) return 'intentional_manual'
  if (/manuella mailboxar|manuella förfrågningar/.test(value)) return 'legacy_manual_fallback'
  return 'manual_signal_unclassified'
}

async function collectManualSignals(page) {
  return page.locator('button, a, [role="button"], input[type="submit"]').evaluateAll((nodes, terms) => {
    const normalizedTerms = terms.map((term) => term.toLowerCase())
    return nodes.map((node) => ({
      text: String(node.textContent || node.getAttribute('value') || node.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '),
      tag: node.tagName.toLowerCase(), href: node.getAttribute('href'), type: node.getAttribute('type'),
    })).filter((item) => item.text && normalizedTerms.some((term) => item.text.toLowerCase().includes(term))).slice(0, 40)
  }, MANUAL_ACTION_TERMS)
}

function dedupeSignals(signals) {
  const map = new Map()
  for (const signal of signals) {
    const key = `${signal.class}|${signal.text}|${signal.href || ''}`
    const existing = map.get(key) || { ...signal, pages: [], occurrences: 0 }
    existing.occurrences += 1
    if (!existing.pages.includes(signal.page)) existing.pages.push(signal.page)
    map.set(key, existing)
  }
  return [...map.values()].map(({ page: _page, ...signal }) => signal)
    .sort((a, b) => b.occurrences - a.occurrences || a.text.localeCompare(b.text, 'sv'))
}

function summarizeSignals(signals) {
  const counts = {}
  for (const signal of signals) counts[signal.class] = (counts[signal.class] || 0) + 1
  return counts
}

async function login(page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.getByLabel('E-post').fill(email)
  await page.getByLabel('Lösenord').fill(password)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 }),
    page.getByRole('button', { name: 'Logga in' }).click(),
  ])
}

test('zero-admin crawler traverses authenticated OPS and inventories manual intervention surfaces', async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000)
  test.skip(!baseUrl || !email || !password, 'Zero-admin crawler requires production target and credentials.')

  const pageErrors = []
  const consoleErrors = []
  const requestFailures = []
  page.on('pageerror', (error) => pageErrors.push({ url: page.url(), message: error.message }))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const location = message.location()
    consoleErrors.push({ url: page.url(), message: message.text(), source_url: location?.url || null, line: location?.lineNumber ?? null, column: location?.columnNumber ?? null })
  })
  page.on('requestfailed', (request) => requestFailures.push({ url: request.url(), errorText: request.failure()?.errorText || 'request_failed' }))

  await login(page)

  const start = new URL('/dashboard', baseUrl).toString()
  const queue = [{ url: start, key: routeSurfaceKey(start) }]
  const queuedSurfaces = new Set([routeSurfaceKey(start)])
  const visitedSurfaces = new Set()
  const pages = []
  const failures = []
  const manualSignals = []

  while (queue.length > 0 && visitedSurfaces.size < maxPages) {
    const item = queue.shift()
    if (!item || visitedSurfaces.has(item.key)) continue
    visitedSurfaces.add(item.key)

    let response = null
    try {
      response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(250)
    } catch (error) {
      failures.push({ url: item.url, kind: 'navigation_error', detail: error instanceof Error ? error.message : String(error) })
      continue
    }

    const finalUrl = page.url()
    const status = response?.status() ?? null
    const bodyText = await page.locator('body').innerText().catch(() => '')
    const redirectedToLogin = new URL(finalUrl).pathname.startsWith('/login')
    const appError = /Internal Server Error|Application error|Unhandled Runtime Error|Something went wrong/i.test(bodyText)
    pages.push({ requested: pagePath(item.url), surface: item.key, final: pagePath(finalUrl), status, title: await page.title().catch(() => '') })

    if (redirectedToLogin) failures.push({ url: item.url, kind: 'auth_loop', detail: finalUrl })
    if (status !== null && status >= 400) failures.push({ url: item.url, kind: 'http_status', detail: status })
    if (appError) failures.push({ url: item.url, kind: 'application_error_text', detail: bodyText.slice(0, 500) })

    for (const signal of await collectManualSignals(page).catch(() => [])) {
      manualSignals.push({ page: pagePath(finalUrl), class: signalClass(signal.text, signal.tag, signal.href), ...signal })
    }

    const hrefs = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')))
    for (const href of hrefs) {
      const next = normalizedInternalUrl(href, finalUrl)
      if (!next) continue
      const key = routeSurfaceKey(next)
      if (!visitedSurfaces.has(key) && !queuedSurfaces.has(key)) {
        queuedSurfaces.add(key)
        queue.push({ url: next, key })
      }
    }
  }

  const sameOriginRequestFailures = requestFailures.filter((item) => {
    try { return new URL(item.url).origin === new URL(baseUrl).origin && item.errorText !== 'net::ERR_ABORTED' } catch { return false }
  })
  const dedupedManualSignals = dedupeSignals(manualSignals)
  const report = {
    schema_version: 4, target_origin: new URL(baseUrl).origin, max_pages: maxPages,
    pages_visited: visitedSurfaces.size, pages_remaining: queue.length, pages, failures,
    page_errors: pageErrors, console_errors: consoleErrors, request_failures: sameOriginRequestFailures,
    manual_intervention_signal_occurrences: manualSignals.length,
    manual_intervention_unique_signals: dedupedManualSignals,
    manual_intervention_summary: summarizeSignals(dedupedManualSignals),
  }

  await testInfo.attach('zero-admin-crawler-report.json', { body: Buffer.from(JSON.stringify(report, null, 2)), contentType: 'application/json' })
  console.log(`ZERO_ADMIN_CRAWLER pages=${report.pages_visited} remaining=${report.pages_remaining} failures=${failures.length} uniqueManual=${dedupedManualSignals.length} consoleErrors=${consoleErrors.length}`)
  console.log(`ZERO_ADMIN_CRAWLER_MANUAL_SUMMARY ${JSON.stringify(report.manual_intervention_summary)}`)

  expect(report.pages_visited, 'Crawler should cover more than the three legacy authenticated smoke pages').toBeGreaterThan(3)
  expect(failures, 'Authenticated OPS crawler found broken routes or auth loops').toEqual([])
  expect(pageErrors, 'Authenticated OPS crawler observed browser page errors').toEqual([])
  expect(sameOriginRequestFailures, 'Authenticated OPS crawler observed non-aborted same-origin request failures').toEqual([])
  expect(report.pages_remaining, 'Crawler hit its route cap before exhausting deduplicated route surfaces').toBe(0)
})
