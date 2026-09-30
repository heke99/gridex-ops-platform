import { createServer } from 'node:http'
import { inspect } from 'node:util'
import { request } from 'playwright'
import { expect, it } from 'vitest'
import { eventV2SafeGet } from '../e2e/helpers/event-v2-safe-request.mjs'

it('keeps authenticated transport failure headers out of published error evidence', async () => {
  const key = 'SYNTHETIC_EVENT_V2_KEY_SENTINEL'
  const assertion = 'SYNTHETIC_EVENT_V2_ASSERTION_SENTINEL'
  const headers = { authorization: `Bearer ${key}`, 'x-gridex-customer-assertion': assertion }
  const server = createServer((incoming) => incoming.socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('synthetic_loopback_server_missing')
  const url = `http://127.0.0.1:${address.port}/api/v1/customer/events`
  const context = await request.newContext()
  try {
    const original = await context.get(url, { headers, timeout: 2_000 }).catch(error => error as Error)
    expect(original).toBeInstanceOf(Error)
    expect(String(original)).toContain(key)
    expect(String(original)).toContain(assertion)

    const safe = await eventV2SafeGet(context, url, { headers, timeout: 2_000 }).catch(error => error as Error)
    expect(safe).toBeInstanceOf(Error)
    expect((safe as Error).message).toBe('event_v2_http_transport_failed')
    expect((safe as Error).cause).toBeUndefined()
    const published = `${String(safe)}\n${inspect(safe)}`
    expect(published).not.toContain(key)
    expect(published).not.toContain(assertion)
    expect(published).not.toContain('Call log:')
  } finally {
    await context.dispose()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
