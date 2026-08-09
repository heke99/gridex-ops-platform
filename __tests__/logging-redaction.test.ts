import { describe, expect, it } from 'vitest'
import {
  redactLogText,
  safeLogError,
  sanitizeLogMetadata,
} from '@/lib/logging/redaction'

describe('logging redaction', () => {
  it('redacts personal data and bearer credentials inside free text', () => {
    const value = redactLogText(
      'user anna@example.com person 19900101-1234 ip 192.168.10.42 Authorization: Bearer abc.def.ghi',
    )

    expect(value).not.toContain('anna@example.com')
    expect(value).not.toContain('19900101-1234')
    expect(value).not.toContain('192.168.10.42')
    expect(value).not.toContain('abc.def.ghi')
    expect(value).toContain('[REDACTED_EMAIL]')
    expect(value).toContain('[REDACTED_PERSON_NUMBER]')
    expect(value).toContain('[REDACTED_IP]')
  })

  it('redacts sensitive metadata fields recursively while preserving safe identifiers', () => {
    const value = sanitizeLogMetadata({
      companyId: 'company-safe-id',
      request_id: 'request-safe-id',
      customer_email: 'anna@example.com',
      authorization: 'Bearer secret-token',
      nested: {
        payload: { personal_number: '19900101-1234' },
        code: 'P0001',
      },
    })

    expect(value.companyId).toBe('company-safe-id')
    expect(value.request_id).toBe('request-safe-id')
    expect(value.customer_email).toBe('[REDACTED]')
    expect(value.authorization).toBe('[REDACTED]')
    expect(value.nested).toEqual({ payload: '[REDACTED]', code: 'P0001' })
  })

  it('normalizes camelCase and separator variants before classifying sensitive keys', () => {
    const value = sanitizeLogMetadata({
      accessToken: 'opaque-secret-token',
      'client-secret': 'opaque-client-secret',
      customerEmail: 'not-an-email-shaped-secret',
      requestId: 'request-safe-id',
    })

    expect(value.accessToken).toBe('[REDACTED]')
    expect(value['client-secret']).toBe('[REDACTED]')
    expect(value.customerEmail).toBe('[REDACTED]')
    expect(value.requestId).toBe('request-safe-id')
  })

  it('keeps technical error codes but redacts personal data from messages', () => {
    const error = Object.assign(new Error('Failed for anna@example.com from 10.0.0.8'), {
      code: 'PGRST205',
    })
    const value = safeLogError(error)

    expect(value.code).toBe('PGRST205')
    expect(value.message).not.toContain('anna@example.com')
    expect(value.message).not.toContain('10.0.0.8')
  })
})
