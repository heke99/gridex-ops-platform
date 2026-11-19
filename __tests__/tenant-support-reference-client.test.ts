import { describe, expect, it } from 'vitest'
import { createSupportClient } from '../docs/examples/tenant-support-reference-client.mjs'

const reference = 'support_case_fixture'
const detailPath = `/api/v1/customer/support/cases/${reference}`
const cursor = 'opaque +/= % continuation'
const initial = {
  data: {
    case_reference: reference,
    messages: Array.from({ length: 500 }, (_, index) => ({ body: `Synthetic message ${index + 1}` })),
  },
}
const lastPage = { data: [{ body: 'Synthetic message 501' }] }

function customerClient(fetchImpl: typeof fetch) {
  return createSupportClient({
    baseUrl: 'https://synthetic.invalid',
    apiKey: 'synthetic-fixture-key',
    portalUserId: 'synthetic-portal-user',
    fetchImpl,
  })
}

describe('API-76 support reference client continuation', () => {
  it('exposes the detail cursor and retrieves the 501st message using the existing messages route', async () => {
    const requested: URL[] = []
    const client = customerClient(async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      requested.push(url)
      expect(request.method).toBe('GET')
      expect(request.headers.get('x-gridex-customer-portal-user-id')).toBe('synthetic-portal-user')
      if (url.pathname === detailPath) {
        return Response.json(initial, { headers: { 'X-Gridex-Next-Cursor': cursor } })
      }
      expect(url.pathname).toBe(`${detailPath}/messages`)
      expect(url.search).toBe(`?cursor=${encodeURIComponent(cursor)}`)
      expect(url.searchParams.get('cursor')).toBe(cursor)
      return Response.json(lastPage)
    })

    const firstPage = await client.getCasePage(reference)
    expect(firstPage).toEqual({ body: initial, nextCursor: cursor })
    const nextPage = await client.listMessages(reference, firstPage.nextCursor)
    expect(nextPage).toEqual({ body: lastPage, nextCursor: null })
    expect([...firstPage.body.data.messages, ...nextPage.body.data]).toHaveLength(501)
    expect(requested.map(({ pathname }) => pathname)).toEqual([detailPath, `${detailPath}/messages`])
  })

  it('keeps getCase returning the legacy JSON even when a continuation header is present', async () => {
    const client = customerClient(async () => Response.json(initial, { headers: { 'X-Gridex-Next-Cursor': cursor } }))
    expect(await client.getCase(reference)).toEqual(initial)
  })

  it('supports a first messages page and keeps the existing error code and status for an invalid cursor', async () => {
    const client = customerClient(async (input, init) => {
      const url = new URL(new Request(input, init).url)
      expect(url.pathname).toBe(`${detailPath}/messages`)
      if (url.searchParams.has('cursor')) {
        return Response.json({ error: { code: 'invalid_cursor', message: 'Ogiltig sidmarkör.' } }, { status: 400 })
      }
      return Response.json(lastPage)
    })
    expect(await client.listMessages(reference)).toEqual({ body: lastPage, nextCursor: null })
    await expect(client.listMessages(reference, 'synthetic-invalid')).rejects.toMatchObject({
      status: 400, code: 'invalid_cursor', message: 'Ogiltig sidmarkör.',
    })
  })
})
