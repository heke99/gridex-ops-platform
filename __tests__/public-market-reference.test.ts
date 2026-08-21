import { describe, expect, it } from 'vitest'

import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'
import { projectPublicMarketReference } from '@/lib/pricing/publicMarketReference'

describe('public market reference projection', () => {
  it('removes internal persistence ids from website quote validation payloads', () => {
    const projected = projectPublicMarketReference({
      provider: 'nordpool',
      source: 'spot_price_summary',
      price_area: 'SE3',
      reference_type: 'preview',
      reference_period: '2026-08',
      price_sek_per_kwh: 1,
      price_ore_per_kwh: 100,
      price_ex_vat_sek_per_kwh: 0.8,
      price_ex_vat_ore_per_kwh: 80,
      includes_vat: true,
      spot_price_summary_id: '8d63cc83-5fcf-4e98-9a7a-7b415f89c012',
      internal_market_id: '0b8ff913-d416-48d9-a14b-b2da914f434f',
    })

    expect(projected).toMatchObject({
      provider: 'nordpool',
      source: 'spot_price_summary',
      price_area: 'SE3',
      price_ex_vat_sek_per_kwh: 0.8,
      price_ex_vat_ore_per_kwh: 80,
    })
    expect(projected).not.toHaveProperty('spot_price_summary_id')
    expect(projected).not.toHaveProperty('internal_market_id')
    expect(() => assertPublicResponsePayload({
      data: { market_reference: projected },
    })).not.toThrow()
  })

  it('recovers ex-VAT prices without exposing extra internal fields', () => {
    const projected = projectPublicMarketReference({
      provider: 'nordpool',
      price_area: 'SE3',
      price_sek_per_kwh: 1.25,
      price_ore_per_kwh: 125,
      includes_vat: true,
      spot_price_summary_id: 'internal-id',
    })

    expect(projected).toMatchObject({
      price_ex_vat_sek_per_kwh: 1,
      price_ex_vat_ore_per_kwh: 100,
    })
    expect(projected).not.toHaveProperty('spot_price_summary_id')
  })
})
