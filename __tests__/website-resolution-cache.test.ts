import { describe, expect, it } from 'vitest'

import { websiteEnergyResolutionCacheKey } from '@/lib/energy/websiteResolutionCache'

describe('website energy resolution cache key', () => {
  it('normalizes equivalent Swedish address inputs', () => {
    const first = websiteEnergyResolutionCacheKey({
      companyId: 'company-a',
      street: '  Storgatan  12 ',
      postalCode: '111 22',
      city: ' Stockholm ',
      country: 'se',
    })
    const second = websiteEnergyResolutionCacheKey({
      companyId: 'company-a',
      street: 'Storgatan',
      streetNumber: '12',
      postalCode: '11122',
      city: 'stockholm',
      country: 'SE',
    })

    expect(first).toBe(second)
  })

  it('isolates identical lookups between tenants', () => {
    const shared = {
      street: 'Storgatan 12',
      postalCode: '11122',
      city: 'Stockholm',
      country: 'SE',
    }

    expect(
      websiteEnergyResolutionCacheKey({ companyId: 'company-a', ...shared }),
    ).not.toBe(
      websiteEnergyResolutionCacheKey({ companyId: 'company-b', ...shared }),
    )
  })

  it('never places raw address text in the cache key', () => {
    const key = websiteEnergyResolutionCacheKey({
      companyId: 'company-a',
      street: 'Hemliggatan 99',
      postalCode: '11122',
      city: 'Stockholm',
    })

    expect(key).toMatch(/^website-energy-resolution-v2-papilite-first:company-a:[a-f0-9]{64}$/)
    expect(key).not.toContain('Hemliggatan')
    expect(key).not.toContain('11122')
  })
})
