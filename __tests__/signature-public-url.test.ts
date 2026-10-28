import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicSigningBaseUrl } from '@/lib/auth/urls'

afterEach(() => { vi.unstubAllEnvs() })

describe('neutral public signing origin', () => {
  it('uses the configured neutral HTTPS origin independently of the admin origin', () => {
    vi.stubEnv('PUBLIC_SIGNING_BASE_URL', 'https://agreements.example.invalid/')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://admin.example.invalid')
    expect(getPublicSigningBaseUrl()).toBe('https://agreements.example.invalid')
  })
  it('keeps existing links usable when a separate public domain is not configured', () => {
    vi.stubEnv('PUBLIC_SIGNING_BASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://admin.example.invalid')
    expect(getPublicSigningBaseUrl()).toBe('https://admin.example.invalid')
  })
  it.each(['http://agreements.example.invalid', 'https://user:password@agreements.example.invalid', 'https://agreements.example.invalid/path', 'https://agreements.example.invalid?token=value', 'https://agreements.example.invalid/#fragment', 'javascript:alert(1)'])('rejects a signing configuration that is not a clean HTTPS origin: %s', (value) => {
    vi.stubEnv('PUBLIC_SIGNING_BASE_URL', value)
    expect(() => getPublicSigningBaseUrl()).toThrow(/public_signing_origin_invalid/)
  })
})
