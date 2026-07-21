import { describe, expect, it } from 'vitest'
import { ipAllowedByRules, ipMatchesRule, normalizeIpAddress, trustedClientIp, trustIntegrationProxyHeaders } from '@/lib/integrations/ipPolicy'

describe('integration API IP policy', () => {
  it('supports exact IPv4 and CIDR', () => {
    expect(ipMatchesRule('192.0.2.10', '192.0.2.10')).toBe(true)
    expect(ipMatchesRule('192.0.2.10', '192.0.2.0/24')).toBe(true)
    expect(ipMatchesRule('192.0.3.10', '192.0.2.0/24')).toBe(false)
  })

  it('supports IPv6 CIDR and mapped IPv4', () => {
    expect(ipMatchesRule('2001:db8::12', '2001:db8::/32')).toBe(true)
    expect(ipMatchesRule('2001:db9::12', '2001:db8::/32')).toBe(false)
    expect(normalizeIpAddress('::ffff:203.0.113.9')).toBe('203.0.113.9')
  })

  it('trusts proxy headers only on Vercel or explicit opt-in', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.8, 10.0.0.1' })
    expect(trustIntegrationProxyHeaders({ VERCEL: undefined, INTEGRATION_API_TRUST_PROXY_HEADERS: undefined })).toBe(false)
    expect(trustedClientIp(headers, { VERCEL: undefined, INTEGRATION_API_TRUST_PROXY_HEADERS: undefined })).toBeNull()
    expect(trustedClientIp(headers, { VERCEL: '1', INTEGRATION_API_TRUST_PROXY_HEADERS: undefined })).toBe('203.0.113.8')
    expect(trustedClientIp(headers, { VERCEL: undefined, INTEGRATION_API_TRUST_PROXY_HEADERS: 'true' })).toBe('203.0.113.8')
    expect(trustedClientIp(headers, { VERCEL: '1', INTEGRATION_API_TRUST_PROXY_HEADERS: 'false' })).toBeNull()
  })

  it('fails closed for invalid rules and missing addresses', () => {
    expect(ipAllowedByRules(null, ['10.0.0.0/8'])).toBe(false)
    expect(ipAllowedByRules('10.0.0.1', ['invalid'])).toBe(false)
    expect(ipAllowedByRules(null, [])).toBe(true)
  })
})
