import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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


const exampleFile = fileURLToPath(new URL('../docs/examples/tenant-support-reference-client.mjs', import.meta.url))
const fixtureFetch = `
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  console.log('demo-request ' + JSON.stringify({
    url: request.url, method: request.method, key: request.headers.get('idempotency-key'), body: await request.text(),
  }))
  return Response.json({ data: { case_reference: 'synthetic-case', status: 'open', messages: [] } })
}
`
const testBaseUrl = 'https://support-test.example.invalid'

function runExample(env: NodeJS.ProcessEnv, args: string[] = []) {
  const loader = 'data:text/javascript,' + encodeURIComponent(fixtureFetch)
  const processResult = spawnSync(process.execPath, ['--import', loader, exampleFile, ...args], {
    encoding: 'utf8',
    env: { GRIDEX_API_KEY: 'synthetic-fixture-key', GRIDEX_PORTAL_USER_ID: 'synthetic-portal-user', ...env },
    timeout: 5000,
  })
  if (processResult.error) throw processResult.error
  const requests = processResult.stdout.split('\n')
    .filter((line) => line.startsWith('demo-request '))
    .map((line) => JSON.parse(line.slice('demo-request '.length)))
  return { status: processResult.status, stderr: processResult.stderr, requests }
}

describe('Support reference command safety and retry contract', () => {
  it('requires an explicit base URL before making any request', () => {
    const result = runExample({})
    expect(result.status).not.toBe(0)
    expect(result.requests).toEqual([])
    expect(result.stderr).toContain('GRIDEX_API_BASE_URL')
  })

  it('defaults to a read-only check at the selected test address', () => {
    const result = runExample({ GRIDEX_API_BASE_URL: testBaseUrl })
    expect(result.status).toBe(0)
    expect(result.requests).toEqual([{
      url: testBaseUrl + '/api/v1/customer/support/cases', method: 'GET', key: null, body: '',
    }])
  })

  it('requires a saved key before the explicit write and keeps it on retries', () => {
    const env = { GRIDEX_API_BASE_URL: testBaseUrl }
    const args = ['--write-test-case']
    const missingKey = runExample(env, args)
    expect(missingKey.status).not.toBe(0)
    expect(missingKey.requests).toEqual([])
    expect(missingKey.stderr).toContain('GRIDEX_IDEMPOTENCY_KEY')

    const keyedEnvironment = { ...env, GRIDEX_IDEMPOTENCY_KEY: 'synthetic-stored-request' }
    const first = runExample(keyedEnvironment, args)
    const firstRetry = runExample(keyedEnvironment, args)
    expect(first.status).toBe(0)
    expect(firstRetry.status).toBe(0)
    expect(first.requests).toHaveLength(1)
    expect(first.requests[0]).toMatchObject({
      url: testBaseUrl + '/api/v1/customer/support/cases', method: 'POST', key: 'synthetic-stored-request',
    })
    expect(firstRetry.requests).toEqual(first.requests)
  })

  it('does not write synthetic cases to the known production host', () => {
    const result = runExample({
      GRIDEX_API_BASE_URL: 'https://app.gridex.se', GRIDEX_IDEMPOTENCY_KEY: 'synthetic-stored-request',
    }, ['--write-test-case'])
    expect(result.status).not.toBe(0)
    expect(result.requests).toEqual([])
  })

  it('retains HTTP and retry metadata when a gateway error has no JSON', async () => {
    const client = customerClient(async () => new Response('synthetic proxy details', {
      status: 503, headers: { 'X-Request-ID': 'synthetic-gateway-request', 'Retry-After': '15' },
    }))
    await expect(client.listCases()).rejects.toMatchObject({
      status: 503, code: null, message: 'HTTP 503', requestId: 'synthetic-gateway-request', retryAfter: '15',
    })
  })

  it('keeps the API error code and HTTP metadata for JSON errors', async () => {
    const client = customerClient(async () => Response.json({
      error: { code: 'rate_limited', message: 'Försök igen senare.' },
    }, {
      status: 429, headers: { 'X-Request-ID': 'synthetic-api-request', 'Retry-After': '30' },
    }))
    await expect(client.listCases()).rejects.toMatchObject({
      status: 429, code: 'rate_limited', message: 'Försök igen senare.', requestId: 'synthetic-api-request', retryAfter: '30',
    })
  })
})
