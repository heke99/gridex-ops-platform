// FINDINGS F26: an unverified client grid-area code always asked the customer
// to "complete the full address", also when the full address had been sent.
import { describe, expect, it } from 'vitest'
import { gridAreaClaimNextAction } from '@/lib/energy/resolver'

describe('gridAreaClaimNextAction', () => {
  it('asks for the full address only when it is missing', () => {
    expect(gridAreaClaimNextAction({ fullAddress: false, exactAddressProviderAllowed: true, warnings: [] })).toMatch(/Komplettera full adress/)
    for (const exactAddressProviderAllowed of [true, false]) for (const warnings of [['exact_address_cache_miss'], ['polygon_no_match'], []]) {
      expect(gridAreaClaimNextAction({ fullAddress: true, exactAddressProviderAllowed, warnings })).not.toMatch(/Komplettera full adress/)
    }
  })

  it('names the website channel, where exact-address verification is off', () => {
    expect(gridAreaClaimNextAction({ fullAddress: true, exactAddressProviderAllowed: false, warnings: [] }))
      .toMatch(/Full adress togs emot, men exakt adressverifiering används inte i den här kanalen/)
  })

  it('names an exact-address cache miss and a polygon miss separately', () => {
    expect(gridAreaClaimNextAction({ fullAddress: true, exactAddressProviderAllowed: true, warnings: ['exact_address_cache_miss'] })).toMatch(/finns ännu inte i det exakta adressregistret/)
    for (const warning of ['polygon_no_match', 'polygon_wgs84_transform_unavailable_or_no_match']) {
      expect(gridAreaClaimNextAction({ fullAddress: true, exactAddressProviderAllowed: true, warnings: [warning] })).toMatch(/matchade inget nätområde i polygondata/)
    }
  })

  it('always keeps the claim a client claim awaiting verified facts', () => {
    for (const fullAddress of [true, false]) for (const exactAddressProviderAllowed of [true, false]) {
      const text = gridAreaClaimNextAction({ fullAddress, exactAddressProviderAllowed, warnings: ['polygon_no_match'] })
      expect(text).toMatch(/^Nätområdeskoden är endast ett klientpåstående\./)
      expect(text).toMatch(/verifierade anläggningsuppgifter från OPS\/nätägaren/)
    }
  })
})
