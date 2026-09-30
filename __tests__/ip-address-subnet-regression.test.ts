import { Address4, Address6 } from 'ip-address'
import { expect, it } from 'vitest'

it('keeps IPv4 and IPv6 subnet membership separate even when their prefix bits coincide', () => {
  // GHSA-j6r3-76f7-8jcv: matching prefix bits must not admit another family.
  expect(new Address6('a00::1').isInSubnet(new Address4('10.0.0.0/8'))).toBe(false)
  expect(new Address4('32.1.13.184').isInSubnet(new Address6('2001:db8::/32'))).toBe(false)
  expect(new Address6('a00::1').isHostInSubnet(new Address4('10.0.0.0/8'))).toBe(false)
  expect(new Address4('32.1.13.184').isHostInSubnet(new Address6('2001:db8::/32'))).toBe(false)
})

it('retains genuine same-family subnet matches and denials', () => {
  expect(new Address4('10.1.2.3').isInSubnet(new Address4('10.0.0.0/8'))).toBe(true)
  expect(new Address4('8.8.8.8').isInSubnet(new Address4('10.0.0.0/8'))).toBe(false)
  expect(new Address6('2001:db8::1').isInSubnet(new Address6('2001:db8::/32'))).toBe(true)
  expect(new Address6('2001:db9::1').isInSubnet(new Address6('2001:db8::/32'))).toBe(false)
})
