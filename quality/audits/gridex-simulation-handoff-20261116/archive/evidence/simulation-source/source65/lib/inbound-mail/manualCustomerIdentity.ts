import type { ManualFacilityExtractedPayload } from '@/lib/customer-operations/manualFacilityResponseParser'

type Hints = Pick<ManualFacilityExtractedPayload, 'personal_number' | 'org_number' | 'customer_identity_number'>

/** Only explicit customer labels in the newly authored body are identity hints.
 * Neither a signature's arbitrary numbers nor an AI guess identifies a customer. */
export function extractManualCustomerIdentityHints(text: string): { hints: Hints; reasons: string[] } {
  const values: Record<keyof Hints, Set<string>> = {
    personal_number: new Set(), org_number: new Set(), customer_identity_number: new Set(),
  }
  const reasons: string[] = []
  const labels: Array<[keyof Hints, RegExp]> = [
    ['customer_identity_number', /^(?:kundens\s+)?person\s*-?\s*(?:\/|eller)\s*organisationsnummer\s*(?::|#|är\b)\s*(.*)$/i],
    ['personal_number', /^(?:kundens\s+)?person(?:nummer|nr\.?)\s*(?::|#|är\b)\s*(.*)$/i],
    ['org_number', /^(?:kundens\s+)?(?:organisationsnummer|org\.?\s*(?:nr|nummer)\.?)\s*(?::|#|är\b)\s*(.*)$/i],
  ]
  for (const line of text.split(/\r?\n/)) {
    for (const [key, label] of labels) {
      const match = label.exec(line.trim())
      if (!match) continue
      const raw = /^([\d][\d \t+\-]*\d)(?!\d)/.exec(match[1])?.[1]
      const value = raw?.replace(/\D/g, '') ?? ''
      if (!(key === 'org_number' ? /^\d{10}$/ : /^(?:\d{10}|\d{12})$/).test(value)) reasons.push('customer_identity_invalid')
      else values[key].add(value)
      break
    }
  }
  const hints: Hints = {}
  for (const key of Object.keys(values) as Array<keyof Hints>) {
    if (values[key].size > 1) reasons.push('multiple_customer_identities')
    if (values[key].size === 1) hints[key] = [...values[key]][0]
  }
  return { hints, reasons: [...new Set(reasons)] }
}

export function manualCustomerIdentityMatches(hints: Hints, customer: Record<string, unknown>): boolean {
  const number = (value: unknown) => typeof value === 'string' ? value.replace(/\D/g, '') : ''
  const personal = number(customer.personal_number), organization = number(customer.org_number)
  const samePersonal = (value: string) => Boolean(personal && (value === personal
    || value.length === 10 && personal.length === 12 && value === personal.slice(2)))
  return (!hints.personal_number || samePersonal(hints.personal_number))
    && (!hints.org_number || Boolean(organization && hints.org_number === organization))
    && (!hints.customer_identity_number || samePersonal(hints.customer_identity_number)
      || Boolean(organization && hints.customer_identity_number === organization))
}
