import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import { postPublicWebhook } from '@/lib/integrations/publicWebhookTransport'

const { lookup, request } = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup }))
vi.mock('node:https', () => ({ request }))

const url = 'https://webhook-fixture.example.invalid/receiver'
const validBody = 'synthetic complete response'
const readError = new Error('synthetic response stream failure')
const connectionError = new Error('synthetic connection failure before headers')
const maxBytes = 64 * 1024

class ResponseStream extends EventEmitter {
  complete = false
  destroyed = false

  constructor(readonly statusCode?: number) { super() }

  finish(body: string | Buffer) {
    this.emit('data', body)
    if (this.destroyed) return
    this.complete = true
    this.emit('end')
    this.emit('close')
  }

  destroy(error: Error) {
    this.destroyed = true
    this.emit('error', error)
  }
}

function requestFixture(status: number | undefined, handle: (response: ResponseStream, req: EventEmitter) => void, options: { noHeaders?: boolean } = {}) {
  const response = new ResponseStream(status)
  request.mockImplementationOnce((target, settings, onResponse) => {
    expect(String(target)).toBe(url)
    expect(settings.method).toBe('POST')
    const req = new EventEmitter()
    settings.signal.addEventListener('abort', () => req.emit('error', settings.signal.reason), { once: true })
    return Object.assign(req, {
      end: () => queueMicrotask(() => {
        if (!options.noHeaders) onResponse(response)
        handle(response, req)
      }),
    })
  })
  return response
}

function post(signal = new AbortController().signal) {
  return postPublicWebhook({ url, headers: new Headers(), body: 'synthetic request', signal })
}

beforeEach(() => {
  request.mockReset()
  lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }])
})

it.each([201, 503])('preserves status and a complete response body for HTTP %s', async status => {
  requestFixture(status, response => response.finish(validBody))
  await expect(post()).resolves.toEqual({ status, ok: status === 201, body: validBody })
  expect(lookup).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledOnce()
})

it('keeps a received 2xx and discards incomplete response bytes', async () => {
  requestFixture(201, response => {
    response.emit('data', 'synthetic partial response')
    response.destroy(readError)
  })
  await expect(post()).resolves.toEqual({ status: 201, ok: true, body: '', bodyReadError: 'webhook_response_body_incomplete' })
})

it('keeps a known retryable HTTP status if the response aborts', async () => {
  requestFixture(503, response => {
    response.emit('aborted')
    response.destroy(readError)
  })
  await expect(post()).resolves.toEqual({ status: 503, ok: false, body: '', bodyReadError: 'webhook_response_body_incomplete' })
})

it('keeps the status on a premature close before the response ends', async () => {
  requestFixture(202, response => response.emit('close'))
  const nextTurn = new Promise(resolve => setImmediate(() => resolve('still pending')))
  await expect(Promise.race([post(), nextTurn])).resolves.toEqual({ status: 202, ok: true, body: '', bodyReadError: 'webhook_response_body_incomplete' })
})

it('keeps the status if the request timeout aborts a stalled response body', async () => {
  const controller = new AbortController()
  requestFixture(200, () => controller.abort(new DOMException('synthetic timeout', 'AbortError')))
  await expect(post(controller.signal)).resolves.toEqual({ status: 200, ok: true, body: '', bodyReadError: 'webhook_response_body_incomplete' })
})

it.each([200, 503])('enforces the body byte cap without discarding known HTTP %s', async status => {
  const response = requestFixture(status, current => {
    current.emit('data', Buffer.alloc(maxBytes, 97))
    current.emit('data', Buffer.from('z'))
  })
  await expect(post()).resolves.toEqual({ status, ok: status === 200, body: '', bodyReadError: 'webhook_response_too_large' })
  expect(response.destroyed).toBe(true)
})

it('still accepts a complete body exactly at the byte cap', async () => {
  const response = requestFixture(200, current => current.finish(Buffer.alloc(maxBytes, 97)))
  const result = await post()
  expect(result).toEqual({ status: 200, ok: true, body: 'a'.repeat(maxBytes) })
  expect(response.destroyed).toBe(false)
})

it('still rejects the original request failure when headers never arrived', async () => {
  requestFixture(undefined, (_response, req) => req.emit('error', connectionError), { noHeaders: true })
  await expect(post()).rejects.toBe(connectionError)
})
