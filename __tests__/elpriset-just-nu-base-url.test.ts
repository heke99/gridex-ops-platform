import { afterEach, describe, expect, it } from 'vitest'
import { buildElprisetJustNuUrl } from '@/lib/pricing/spot/elprisetJustNuClient'

afterEach(() => { delete process.env.ELPRISETJUSTNU_BASE_URL })

describe('spot price provider origin', () => {
  it('uses the public provider when no simulator origin is configured', () => {
    expect(buildElprisetJustNuUrl({ date: '2026-09-01', priceArea: 'SE3' })).toBe('https://www.elprisetjustnu.se/api/v1/prices/2026/09-01_SE3.json')
  })

  it('uses a configured simulator origin with the same path', () => {
    process.env.ELPRISETJUSTNU_BASE_URL = 'http://127.0.0.1:3901/'
    expect(buildElprisetJustNuUrl({ date: '2026-09-01', priceArea: 'SE3' })).toBe('http://127.0.0.1:3901/api/v1/prices/2026/09-01_SE3.json')
  })
})
