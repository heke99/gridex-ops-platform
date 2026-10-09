// poa-mail-review: #1
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResendEmailProvider } from '@/lib/email/providers/resendProvider'

describe('Resend provider idempotency (poa-mail-review #1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('sends the idempotency key as hashed HTTP header and never as a mail header', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ id: 'msg_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const rawKey = 'manual-grid-owner-request:company-123:site-456'
    const input = {
      from: 'a@example.test',
      to: 'b@example.test',
      subject: 's',
      html: '<p>x</p>',
      idempotencyKey: rawKey,
      headers: { 'Message-ID': '<GX-FIR-1@example.test>', 'Idempotency-Key': 'smuggled' },
    }
    const result = await new ResendEmailProvider().sendEmail(input as never)
    expect(result.providerMessageId).toBe('msg_1')
    const sendCall = calls.find((c) => String(c.url).endsWith('/emails'))!
    expect(sendCall).toBeDefined()
    const headers = new Headers(sendCall.init.headers)
    const httpKey = headers.get('Idempotency-Key')
    expect(httpKey).toMatch(/^gx-[0-9a-f]{64}$/)
    expect(httpKey!.length).toBeLessThanOrEqual(256)
    const body = JSON.parse(String(sendCall.init.body))
    expect(body.headers?.['Idempotency-Key']).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain(rawKey)
    expect(JSON.stringify(body)).not.toContain('smuggled')
  })
})
