import { describe, expect, it } from 'vitest'
import { normalizeExternalCustomerType } from '@/lib/customers/externalCustomerType'

describe('normalizeExternalCustomerType', () => {
  it('accepts canonical values', () => {
    expect(normalizeExternalCustomerType('private')).toEqual({ ok: true, value: 'private', deprecatedAlias: null })
    expect(normalizeExternalCustomerType('business')).toEqual({ ok: true, value: 'business', deprecatedAlias: null })
  })

  it('normalizes the temporary company alias', () => {
    expect(normalizeExternalCustomerType('company')).toEqual({ ok: true, value: 'business', deprecatedAlias: 'company' })
  })

  it('rejects unknown values', () => {
    expect(normalizeExternalCustomerType('consumer').ok).toBe(false)
  })
})
