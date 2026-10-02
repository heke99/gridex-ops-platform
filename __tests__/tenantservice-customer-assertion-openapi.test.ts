import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CUSTOMER_ASSERTION_HEADER } from '@/lib/customer-portal/customerAssertion'

describe('customer assertion header is part of the published contract', () => {
  const spec = JSON.parse(readFileSync('docs/openapi/customer-portal-v1.json', 'utf8'))
  const operations = Object.entries(spec.paths as Record<string, Record<string, { parameters?: Array<{ name?: string; in?: string; required?: boolean }>; responses?: Record<string, { description?: string }> }>>)
    .filter(([path]) => path.startsWith('/api/v1/customer/'))
    .flatMap(([path, item]) => Object.entries(item).filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).map(([method, op]) => ({ path, method, op })))

  it('documents the optional header on every customer API operation', () => {
    expect(operations.length).toBeGreaterThan(20)
    for (const { path, method, op } of operations) {
      const header = op.parameters?.find((parameter) => parameter.name === CUSTOMER_ASSERTION_HEADER)
      expect(header, `${method} ${path}`).toMatchObject({ in: 'header', required: false })
    }
  })

  it('documents the 403 outcomes when verification is required', () => {
    for (const { path, method, op } of operations) {
      if (!op.responses?.['403']) continue
      expect(op.responses['403'].description, `${method} ${path}`).toContain('customer_assertion_invalid')
    }
  })
})
