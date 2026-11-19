// Synthetic reference integration for an organization's own support page ("Mina sidor").
// Server-side only: GRIDEX_API_KEY must never reach the browser. Contract 2026-10-02.4.
//
// Flow: the organization's backend authenticates its end customer itself, then calls Gridex on
// that customer's behalf with the linked portal user id. Gridex only returns content that staff
// explicitly made customer-visible; internal notes and call logs are never returned.
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

/**
 * If your organization requires verified customer login, supply a server-side callback
 * that verifies the current session and returns a fresh signed assertion for portalUserId.
 * It runs for every request, including reads and retries. On a write retry, keep the
 * original Idempotency-Key and body, and let the callback return a new assertion with a new jti.
 *
 * @param {{
 *   baseUrl?: string,
 *   apiKey: string,
 *   portalUserId: string,
 *   fetchImpl?: typeof fetch,
 *   getCustomerAssertion?: (context: { portalUserId: string }) => string | Promise<string>,
 * }} options
 */
export function createSupportClient({
  baseUrl = 'https://app.gridex.se',
  apiKey,
  portalUserId,
  fetchImpl = fetch,
  getCustomerAssertion,
}) {
  if (!apiKey) throw new Error('GRIDEX_API_KEY is required (server-side only)')
  if (!portalUserId) throw new Error('An actively linked portal user id is required')

  async function request(method, path, body, idempotencyKey) {
    const headers = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-gridex-customer-portal-user-id': portalUserId,
      'x-gridex-auth-user-id': portalUserId,
    }
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
    /** @type {RequestInit} */
    const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }
    if (getCustomerAssertion !== undefined) {
      const assertion = await Promise.resolve()
        .then(() => getCustomerAssertion({ portalUserId }))
        .catch(() => null)
      if (typeof assertion !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion)) {
        throw new Error('Customer assertion unavailable.')
      }
      headers['x-gridex-customer-assertion'] = assertion
      // The assertion must stay on the configured origin.
      init.redirect = 'error'
    }
    const response = await fetchImpl(`${baseUrl}${path}`, init)
    const wire = {
      status: response.status,
      requestId: response.headers.get('X-Request-ID'),
      retryAfter: response.headers.get('Retry-After'),
    }
    const payload = await response.json().catch(() => undefined)
    if (!response.ok || payload === undefined) {
      // An API error may have a structured code. A gateway can return plain text or no body.
      const message = typeof payload?.error?.message === 'string'
        ? payload.error.message
        : response.ok ? `Invalid JSON (HTTP ${wire.status})` : `HTTP ${wire.status}`
      const code = typeof payload?.error?.code === 'string' ? payload.error.code : null
      throw Object.assign(new Error(message), wire, { code })
    }
    return { payload, response }
  }

  async function call(method, path, body, idempotencyKey) {
    return (await request(method, path, body, idempotencyKey)).payload
  }

  async function readPage(path) {
    const { payload, response } = await request('GET', path)
    return { body: payload, nextCursor: response.headers.get('X-Gridex-Next-Cursor') }
  }

  const casePath = (caseReference) => `/api/v1/customer/support/cases/${encodeURIComponent(caseReference)}`

  return {
    /** Lists the customer's support cases (newest first). Pass page.next_cursor to continue. */
    listCases: (cursor) => call('GET', `/api/v1/customer/support/cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    /**
     * Opens a case. Reuse the same idempotency key when retrying the same submit.
     * @param {{ title: string, message: string, category?: string }} input
     * @param {string} [idempotencyKey]
     */
    openCase: ({ title, message, category }, idempotencyKey = randomUUID()) =>
      call('POST', '/api/v1/customer/support/cases', { title, message, category }, idempotencyKey),
    /** Case with its customer-visible messages. */
    getCase: (caseReference) => call('GET', casePath(caseReference)),
    /** Case detail and the cursor for continuing its message history. */
    getCasePage: (caseReference) => readPage(casePath(caseReference)),
    /**
     * Reads a message page. Pass nextCursor from getCasePage or listMessages to continue until it is null.
     * @param {string} caseReference
     * @param {string | null} [cursor]
     */
    listMessages: (caseReference, cursor = null) => {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      return readPage(`${casePath(caseReference)}/messages${query}`)
    },
    /**
     * Adds a message to an open case (closed cases return 409 support_case_closed).
     * @param {string} caseReference
     * @param {string} message
     * @param {string} [idempotencyKey]
     */
    reply: (caseReference, message, idempotencyKey = randomUUID()) =>
      call('POST', `${casePath(caseReference)}/messages`, { message }, idempotencyKey),
  }
}

// For an assertion-enforced organization, use the factory from your authenticated backend.
// First check read access in the selected test environment.
//   export GRIDEX_API_BASE_URL=https://support-test.example.invalid
//   export GRIDEX_API_KEY=... GRIDEX_PORTAL_USER_ID=...
//   node docs/examples/tenant-support-reference-client.mjs
//
// To open a synthetic case, generate a key once and save it with the submitted data.
//   export GRIDEX_IDEMPOTENCY_KEY="$(node -p "require('node:crypto').randomUUID()")"
//   node docs/examples/tenant-support-reference-client.mjs --write-test-case
// If the response was lost, use the same saved GRIDEX_IDEMPOTENCY_KEY and run again.
//   node docs/examples/tenant-support-reference-client.mjs --write-test-case
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const write = args.length === 1 && args[0] === '--write-test-case'
  if (args.length && !write) throw new Error('Use no arguments for read-only access or --write-test-case in a test environment.')

  const baseUrl = process.env.GRIDEX_API_BASE_URL?.trim()
  if (!baseUrl) throw new Error('Set GRIDEX_API_BASE_URL explicitly for the selected test environment.')
  const url = URL.canParse(baseUrl) ? new URL(baseUrl) : null
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('GRIDEX_API_BASE_URL must be an absolute HTTP(S) base URL without credentials, query, or fragment.')
  }

  const productionHostname = url.hostname.replace(/\.$/, '') === 'app.gridex.se'
  if (write && productionHostname) throw new Error('--write-test-case requires a test environment.')
  const idempotencyKey = process.env.GRIDEX_IDEMPOTENCY_KEY?.trim()
  if (write && !idempotencyKey) throw new Error('Save and set GRIDEX_IDEMPOTENCY_KEY before opening a test case.')

  const client = createSupportClient({
    baseUrl: url.href.replace(/\/+$/, ''),
    apiKey: process.env.GRIDEX_API_KEY,
    portalUserId: process.env.GRIDEX_PORTAL_USER_ID,
  })
  if (write) {
    const opened = await client.openCase({ title: 'Fråga om faktura', message: 'Syntetiskt testärende.' }, idempotencyKey)
    console.log('opened', opened.data.case_reference, opened.data.status)
  } else {
    await client.listCases()
    console.log('Support read access confirmed.')
  }
}
