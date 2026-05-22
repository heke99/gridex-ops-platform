export type CustomerReadinessInput = {
  customer: Record<string, unknown>
  sites?: Array<Record<string, unknown>>
  meteringPoints?: Array<Record<string, unknown>>
  contracts?: Array<Record<string, unknown>>
  powersOfAttorney?: Array<Record<string, unknown>>
  billingUnderlays?: Array<Record<string, unknown>>
  partnerExports?: Array<Record<string, unknown>>
}

export type CustomerReadinessScore = {
  customerScore: number
  contractScore: number
  powerOfAttorneyScore: number
  siteScore: number
  billingScore: number
  readyForContract: boolean
  readyForSwitch: boolean
  readyForBilling: boolean
  readyForExport: boolean
  blockers: Array<{ area: string; code: string; title: string; severity: 'warning' | 'blocked' }>
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim() : ''
}

function hasAny(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => text(row, key).length > 0)
}

function score(parts: boolean[]): number {
  if (parts.length === 0) return 0
  return Math.round((parts.filter(Boolean).length / parts.length) * 100)
}

export function calculateCustomerReadinessScore(input: CustomerReadinessInput): CustomerReadinessScore {
  const sites = input.sites ?? []
  const meteringPoints = input.meteringPoints ?? []
  const contracts = input.contracts ?? []
  const powersOfAttorney = input.powersOfAttorney ?? []
  const billingUnderlays = input.billingUnderlays ?? []
  const partnerExports = input.partnerExports ?? []
  const blockers: CustomerReadinessScore['blockers'] = []

  const customerScore = score([
    hasAny(input.customer, ['full_name', 'first_name', 'company_name']),
    hasAny(input.customer, ['personal_number', 'org_number']),
    hasAny(input.customer, ['email']),
    hasAny(input.customer, ['phone']),
    hasAny(input.customer, ['street', 'billing_street']),
  ])

  if (!hasAny(input.customer, ['personal_number', 'org_number'])) {
    blockers.push({ area: 'customer', code: 'missing_identity_number', title: 'Person-/orgnummer saknas', severity: 'blocked' })
  }
  if (!hasAny(input.customer, ['email', 'phone'])) {
    blockers.push({ area: 'customer', code: 'missing_contact', title: 'Kontaktuppgift saknas', severity: 'warning' })
  }

  const siteScore = score([
    sites.length > 0,
    meteringPoints.length > 0,
    sites.some((site) => hasAny(site, ['street', 'address', 'facility_id'])),
    meteringPoints.some((point) => hasAny(point, ['meter_point_id', 'metering_point_id'])),
    sites.some((site) => hasAny(site, ['grid_owner_id', 'grid_owner_name', 'network_area_code'])),
  ])
  if (sites.length === 0) blockers.push({ area: 'site', code: 'missing_site', title: 'Anläggning saknas', severity: 'blocked' })
  if (meteringPoints.length === 0) blockers.push({ area: 'metering', code: 'missing_metering_point', title: 'Mätpunkt saknas', severity: 'blocked' })

  const activeContracts = contracts.filter((contract) => ['signed', 'active', 'pending_signature'].includes(text(contract, 'status')))
  const contractScore = score([
    activeContracts.length > 0,
    activeContracts.some((contract) => hasAny(contract, ['contract_name'])),
    activeContracts.some((contract) => hasAny(contract, ['starts_at', 'expected_start_at', 'confirmed_start_at', 'actual_start_at'])),
    activeContracts.some((contract) => hasAny(contract, ['campaign_version', 'price_version', 'terms_version'])),
  ])
  if (activeContracts.length === 0) blockers.push({ area: 'contract', code: 'missing_contract', title: 'Avtal saknas', severity: 'blocked' })

  const signedPoa = powersOfAttorney.some((poa) => ['signed', 'active', 'valid'].includes(text(poa, 'status')))
  const powerOfAttorneyScore = score([powersOfAttorney.length > 0, signedPoa])
  if (!signedPoa) blockers.push({ area: 'poa', code: 'missing_signed_poa', title: 'Signerad fullmakt saknas', severity: 'blocked' })

  const billingScore = score([
    billingUnderlays.length > 0,
    billingUnderlays.some((row) => ['validated', 'received', 'exported'].includes(text(row, 'status'))),
    partnerExports.some((row) => ['queued', 'sent', 'acknowledged'].includes(text(row, 'status'))),
  ])

  return {
    customerScore,
    contractScore,
    powerOfAttorneyScore,
    siteScore,
    billingScore,
    readyForContract: customerScore >= 80 && siteScore >= 60,
    readyForSwitch: customerScore >= 80 && siteScore >= 80 && contractScore >= 50 && powerOfAttorneyScore >= 100,
    readyForBilling: customerScore >= 80 && siteScore >= 80 && contractScore >= 75,
    readyForExport: customerScore >= 80 && siteScore >= 80 && contractScore >= 75 && billingScore >= 67,
    blockers,
  }
}
