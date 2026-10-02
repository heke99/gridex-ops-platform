// Synthetic reference integration for an organization's own support page ("Mina sidor").
// Server-side only: GRIDEX_API_KEY must never reach the browser. Contract 2026-10-02.4.
//
// Flow: the organization's backend authenticates its end customer itself, then calls Gridex on
// that customer's behalf with the linked portal user id. Gridex only returns content that staff
// explicitly made customer-visible; internal notes and call logs are never returned.
import { randomUUID } from 'node:crypto'

/**
 * @param {{ baseUrl?: string, apiKey: string, portalUserId: string, fetchImpl?: typeof fetch }} options
 */
export function createSupportClient({ baseUrl = 'https://app.gridex.se', apiKey, portalUserId, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('GRIDEX_API_KEY is required (server-side only)')
  if (!portalUserId) throw new Error('An actively linked portal user id is required')

  async function call(method, path, body, idempotencyKey) {
    const headers = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-gridex-customer-portal-user-id': portalUserId,
      'x-gridex-auth-user-id': portalUserId,
    }
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
    const response = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const payload = await response.json()
    if (!response.ok) {
      const error = new Error(payload?.error?.message ?? `HTTP ${response.status}`)
      error.status = response.status
      error.code = payload?.error?.code ?? null
      throw error
    }
    return payload
  }

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
    getCase: (caseReference) => call('GET', `/api/v1/customer/support/cases/${encodeURIComponent(caseReference)}`),
    /**
     * Adds a message to an open case (closed cases return 409 support_case_closed).
     * @param {string} caseReference
     * @param {string} message
     * @param {string} [idempotencyKey]
     */
    reply: (caseReference, message, idempotencyKey = randomUUID()) =>
      call('POST', `/api/v1/customer/support/cases/${encodeURIComponent(caseReference)}/messages`, { message }, idempotencyKey),
  }
}

// Example run against a synthetic environment:
//   GRIDEX_API_KEY=... GRIDEX_PORTAL_USER_ID=... node docs/examples/tenant-support-reference-client.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const client = createSupportClient({
    baseUrl: process.env.GRIDEX_API_BASE_URL,
    apiKey: process.env.GRIDEX_API_KEY,
    portalUserId: process.env.GRIDEX_PORTAL_USER_ID,
  })
  const opened = await client.openCase({ title: 'Fråga om faktura', message: 'Syntetiskt testärende.' })
  console.log('opened', opened.data.case_reference, opened.data.status)
  const detail = await client.getCase(opened.data.case_reference)
  console.log('messages', detail.data.messages.map((message) => `${message.author_type}: ${message.body}`))
}
