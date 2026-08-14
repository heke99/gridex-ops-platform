import { describe, expect, it } from 'vitest'
import { classifyDependencyError, assertJsonResponse } from '@/lib/runtime/dependencyErrors'
import { integrationCredential } from '@/lib/integrations/apiAuth'
import { isValidIdempotencyKey } from '@/lib/api/idempotencyKey'

function requestHeaders(values: Record<string, string>) {
  return { headers: new Headers(values) }
}

describe('dependency error contract', () => {
  it.each([
    [{ status: 502 }, 'dependency_bad_gateway'],
    [{ status: 503 }, 'dependency_unavailable'],
    [{ status: 504 }, 'dependency_bad_gateway'],
    [{ status: 522 }, 'dependency_timeout'],
    [Object.assign(new Error('fetch failed'), { code: 'ETIMEDOUT' }), 'dependency_timeout'],
    [Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }), 'dependency_unavailable'],
  ])('classifies %p', (error, code) => {
    expect(classifyDependencyError(error)?.code).toBe(code)
  })

  it('rejects upstream HTML before parsing', () => {
    expect(() => assertJsonResponse({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }) })).toThrowError(/extern tjänst/i)
  })
})

describe('strict integration credential parsing', () => {
  it.each(['Bearer secret-token', 'bearer secret-token', 'BEARER secret-token'])('accepts %s', (authorization) => {
    expect(integrationCredential(requestHeaders({ authorization }) as never)).toEqual({ ok: true, token: 'secret-token', legacyApiKey: false })
  })

  it('does not fall back to x-api-key when Authorization is malformed', () => {
    expect(integrationCredential(requestHeaders({ authorization: 'Basic value', 'x-api-key': 'legacy-token' }) as never)).toEqual({ ok: false, malformedAuthorization: true })
  })
})

describe('canonical Idempotency-Key grammar', () => {
  it('accepts the published grammar', () => expect(isValidIdempotencyKey('order_1:+~-')).toBe(true))
  it.each(['short', 'contains space', 'slash/key', 'åttatecken', 'line\nbreak'])('rejects %p', (key) => expect(isValidIdempotencyKey(key)).toBe(false))
  it('rejects values above 200 characters', () => expect(isValidIdempotencyKey('a'.repeat(201))).toBe(false))
})
