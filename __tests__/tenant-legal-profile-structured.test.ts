import { describe, expect, it } from 'vitest'
import {
  buildBillingInformation,
  buildDisputeResolutionInformation,
  buildStructuredAddress,
  buildStructuredContact,
  normalizeCountryCode,
  normalizeEmail,
  normalizePostalCode,
  normalizeSwedishOrganizationNumber,
  normalizeUrl,
} from '@/lib/legal/tenantLegalProfile'

describe('structured tenant legal profile', () => {
  it('builds a structured postal address with a stable display text', () => {
    const data = new FormData()
    data.set('postal_address_line_1', 'Storgatan 1')
    data.set('postal_address_line_2', 'C/O Gridex')
    data.set('postal_address_postal_code', '211 20')
    data.set('postal_address_city', 'Malmö')
    data.set('postal_address_country_code', 'se')

    expect(buildStructuredAddress(data, 'postal_address')).toEqual({
      formatted: 'Storgatan 1, C/O Gridex, 211 20 Malmö, SE',
      address_line_1: 'Storgatan 1',
      address_line_2: 'C/O Gridex',
      postal_code: '211 20',
      city: 'Malmö',
      country_code: 'SE',
    })
  })

  it('keeps contact name separate from the actual communication channel', () => {
    const data = new FormData()
    data.set('complaints_name', 'Klagomålsansvarig')
    data.set('complaints_email', 'KLAGOMAL@EXAMPLE.SE')
    data.set('complaints_description', 'Kontakta oss skriftligen.')

    expect(buildStructuredContact(data, 'complaints', 'Klagomål')).toEqual({
      text: 'Kontakta oss skriftligen.',
      name: 'Klagomålsansvarig',
      email: 'klagomal@example.se',
      description: 'Kontakta oss skriftligen.',
    })
  })

  it('builds structured billing and dispute information', () => {
    const data = new FormData()
    data.set('billing_email', 'faktura@example.se')
    data.set('billing_bankgiro', '123-4567')
    data.set('billing_description', 'Faktureras månadsvis.')
    data.set('dispute_authority', 'Allmänna reklamationsnämnden')
    data.set('dispute_url', 'arn.se')
    data.set('dispute_description', 'Klagomål lämnas först till bolaget.')

    expect(buildBillingInformation(data)).toMatchObject({
      email: 'faktura@example.se',
      bankgiro: '123-4567',
      text: 'Faktureras månadsvis.',
    })
    expect(buildDisputeResolutionInformation(data)).toMatchObject({
      authority: 'Allmänna reklamationsnämnden',
      url: 'https://arn.se/',
      text: 'Klagomål lämnas först till bolaget.',
    })
  })

  it('normalizes and validates Swedish legal identifiers', () => {
    expect(normalizePostalCode('21120', 'SE')).toBe('211 20')
    expect(() => normalizePostalCode('abc21120xyz', 'SE')).toThrow('123 45')
    expect(normalizeSwedishOrganizationNumber('5560160680')).toBe('556016-0680')
    expect(() => normalizeSwedishOrganizationNumber('5560160681')).toThrow('giltigt svenskt organisationsnummer')
  })

  it('rejects malformed contact values', () => {
    expect(() => normalizeEmail('inte-en-mail', 'E-post')).toThrow('giltig e-postadress')
    expect(() => normalizeUrl('localhost', 'Webbplats')).toThrow('giltig webbadress')
    expect(() => normalizeCountryCode('SWE')).toThrow('två bokstäver')
  })
})
