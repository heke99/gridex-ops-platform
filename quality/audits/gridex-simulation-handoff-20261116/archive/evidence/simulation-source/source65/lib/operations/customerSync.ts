import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { BillingUnderlayRow, GridOwnerDataRequestRow, MeteringValueRow, OutboundRequestRow } from '@/lib/cis/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { PowerOfAttorneyRow, SupplierSwitchRequestRow } from '@/lib/operations/types'

export type CustomerSyncCustomerRow = {
  id: string
  customer_type: string | null
  status: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  personal_number: string | null
  org_number: string | null
  customer_number: string | null
  apartment_number?: string | null
  created_at: string
}

export type CustomerSyncStage =
  | 'missing_site'
  | 'missing_metering_point'
  | 'missing_grid_owner'
  | 'missing_price_area'
  | 'missing_contract'
  | 'missing_power_of_attorney'
  | 'ready_for_switch'
  | 'switch_in_progress'
  | 'waiting_external_response'
  | 'active_missing_meter_values'
  | 'active_synced'
  | 'manual_review'

export type CustomerSyncSignal = 'blocked' | 'attention' | 'ready' | 'in_progress' | 'healthy'

export type CustomerIdentityKey = {
  label: string
  value: string
}

export type CustomerSyncProfile = {
  customerId: string
  customerName: string
  customerNumber: string | null
  customerStatus: string | null
  email: string | null
  signal: CustomerSyncSignal
  stage: CustomerSyncStage
  stageLabel: string
  priorityRank: number
  recommendedAction: string
  href: string
  blockers: string[]
  warnings: string[]
  identityKeys: CustomerIdentityKey[]
  counts: {
    sites: number
    activeSites: number
    meteringPoints: number
    activeMeteringPoints: number
    contracts: number
    signedOrActiveContracts: number
    powersOfAttorney: number
    signedPowersOfAttorney: number
    switchRequests: number
    openSwitchRequests: number
    gridOwnerRequests: number
    openGridOwnerRequests: number
    meteringValues: number
    billingUnderlays: number
    unresolvedOutbound: number
  }
  latestDates: {
    customerCreatedAt: string
    latestSwitchAt: string | null
    latestMeterValueAt: string | null
    latestGridOwnerRequestAt: string | null
  }
}

export type CustomerSyncSummary = {
  totalCustomers: number
  blocked: number
  attention: number
  ready: number
  inProgress: number
  healthy: number
  missingSites: number
  missingMeteringPoints: number
  missingContracts: number
  missingPowersOfAttorney: number
  readyForSwitch: number
  activeMissingMeterValues: number
  unresolvedOutbound: number
}

export type CustomerSyncBuildResult = {
  profiles: CustomerSyncProfile[]
  summary: CustomerSyncSummary
}

type BuildCustomerSyncProfilesInput = {
  customers: CustomerSyncCustomerRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  contracts: CustomerContractRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
  switchRequests: SupplierSwitchRequestRow[]
  gridOwnerDataRequests: GridOwnerDataRequestRow[]
  meteringValues: MeteringValueRow[]
  billingUnderlays?: BillingUnderlayRow[]
  outboundRequests: OutboundRequestRow[]
  now?: Date
}

function customerDisplayName(customer: CustomerSyncCustomerRow): string {
  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  return (customer.full_name ?? customer.company_name ?? name) || 'Namnlös kund'
}

function normalizeDate(value: string | null | undefined): number {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortByUpdatedOrCreated<T extends { updated_at?: string | null; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => normalizeDate(b.updated_at ?? b.created_at) - normalizeDate(a.updated_at ?? a.created_at)
  )
}

function isPoaSignedAndValid(poa: PowerOfAttorneyRow, now: Date): boolean {
  if (poa.status !== 'signed') return false

  const validFrom = normalizeDate(poa.valid_from)
  const validTo = normalizeDate(poa.valid_to)
  const nowTime = now.getTime()

  if (validFrom > 0 && validFrom > nowTime) return false
  if (validTo > 0 && validTo < nowTime) return false

  return true
}

function addIdentityKey(keys: CustomerIdentityKey[], label: string, value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized) return
  if (keys.some((key) => key.label === label && key.value === normalized)) return
  keys.push({ label, value: normalized })
}

function latestDateFromRows<T extends Record<string, unknown>>(
  rows: T[],
  fields: Array<keyof T>
): string | null {
  let latest: string | null = null
  let latestTime = 0

  for (const row of rows) {
    for (const field of fields) {
      const value = row[field]
      if (typeof value !== 'string') continue
      const timestamp = normalizeDate(value)
      if (timestamp > latestTime) {
        latestTime = timestamp
        latest = value
      }
    }
  }

  return latest
}

function summarizeStage(params: {
  blockers: string[]
  warnings: string[]
  hasSite: boolean
  hasMeteringPoint: boolean
  hasGridOwner: boolean
  hasPriceArea: boolean
  hasContract: boolean
  hasSignedPoa: boolean
  openSwitchRequests: SupplierSwitchRequestRow[]
  latestSwitch: SupplierSwitchRequestRow | null
  meteringValueCount: number
  unresolvedOutboundCount: number
}): Pick<CustomerSyncProfile, 'signal' | 'stage' | 'stageLabel' | 'priorityRank' | 'recommendedAction'> {
  const {
    hasSite,
    hasMeteringPoint,
    hasGridOwner,
    hasPriceArea,
    hasContract,
    hasSignedPoa,
    openSwitchRequests,
    latestSwitch,
    meteringValueCount,
    unresolvedOutboundCount,
  } = params

  if (!hasSite) {
    return {
      signal: 'blocked',
      stage: 'missing_site',
      stageLabel: 'Saknar anläggning',
      priorityRank: 10,
      recommendedAction: 'Lägg in anläggning på kundkortet innan switch eller mätvärdesflöde startas.',
    }
  }

  if (!hasMeteringPoint) {
    return {
      signal: 'blocked',
      stage: 'missing_metering_point',
      stageLabel: 'Saknar mätpunkt',
      priorityRank: 20,
      recommendedAction: 'Koppla mätpunkts-ID till anläggningen så inkommande Ediel-/nätägardata kan matchas rätt.',
    }
  }

  if (!hasGridOwner) {
    return {
      signal: 'blocked',
      stage: 'missing_grid_owner',
      stageLabel: 'Saknar nätägare',
      priorityRank: 30,
      recommendedAction: 'Komplettera nätägare på anläggning eller mätpunkt innan outbound/Ediel-routing.',
    }
  }

  if (!hasPriceArea) {
    return {
      signal: 'attention',
      stage: 'missing_price_area',
      stageLabel: 'Saknar elområde',
      priorityRank: 40,
      recommendedAction: 'Komplettera SE1–SE4 så pris, avtal och billing-underlag kan beräknas korrekt.',
    }
  }

  if (!hasContract) {
    return {
      signal: 'attention',
      stage: 'missing_contract',
      stageLabel: 'Saknar avtal/kampanj',
      priorityRank: 50,
      recommendedAction: 'Koppla kundavtal eller kampanj innan kunden aktiveras i operations.',
    }
  }

  if (!hasSignedPoa) {
    return {
      signal: 'attention',
      stage: 'missing_power_of_attorney',
      stageLabel: 'Saknar signerad fullmakt',
      priorityRank: 60,
      recommendedAction: 'Skapa eller markera fullmakt som signerad innan leverantörsbyte skickas.',
    }
  }

  if (unresolvedOutboundCount > 0) {
    return {
      signal: 'blocked',
      stage: 'manual_review',
      stageLabel: 'Route/outbound kräver review',
      priorityRank: 70,
      recommendedAction: 'Öppna unresolved outbound och fixa route, kanal eller payload innan automation fortsätter.',
    }
  }

  if (openSwitchRequests.length > 0) {
    const hasSubmitted = openSwitchRequests.some((request) => request.status === 'submitted')
    return {
      signal: hasSubmitted ? 'in_progress' : 'ready',
      stage: hasSubmitted ? 'waiting_external_response' : 'switch_in_progress',
      stageLabel: hasSubmitted ? 'Väntar extern kvittens' : 'Switch pågår',
      priorityRank: hasSubmitted ? 80 : 90,
      recommendedAction: hasSubmitted
        ? 'Följ upp CONTRL/APERAK eller nätägar-/leverantörssvar i operationskedjan.'
        : 'Fortsätt dispatchkedjan och kontrollera att outbound skapats korrekt.',
    }
  }

  if (latestSwitch && ['accepted', 'completed'].includes(latestSwitch.status)) {
    if (meteringValueCount === 0) {
      return {
        signal: 'attention',
        stage: 'active_missing_meter_values',
        stageLabel: 'Aktiv men saknar mätvärden',
        priorityRank: 100,
        recommendedAction: 'Begär eller importera mätvärden så kunden kan gå vidare till billing/partner-handoff.',
      }
    }

    return {
      signal: 'healthy',
      stage: 'active_synced',
      stageLabel: 'Synkad aktiv kund',
      priorityRank: 130,
      recommendedAction: 'Ingen akut åtgärd. Kontrollera bara kommande mätvärdes- och billingcykler.',
    }
  }

  return {
    signal: 'ready',
    stage: 'ready_for_switch',
    stageLabel: 'Redo för leverantörsbyte',
    priorityRank: 120,
    recommendedAction: 'Kunden har basdata, avtal och fullmakt. Starta eller köa leverantörsbyte.',
  }
}

export function buildCustomerSyncProfiles(input: BuildCustomerSyncProfilesInput): CustomerSyncBuildResult {
  const now = input.now ?? new Date()
  const sitesByCustomer = new Map<string, CustomerSiteRow[]>()
  const pointsBySite = new Map<string, MeteringPointRow[]>()
  const contractsByCustomer = new Map<string, CustomerContractRow[]>()
  const poaByCustomer = new Map<string, PowerOfAttorneyRow[]>()
  const switchByCustomer = new Map<string, SupplierSwitchRequestRow[]>()
  const gridRequestsByCustomer = new Map<string, GridOwnerDataRequestRow[]>()
  const meteringValuesByCustomer = new Map<string, MeteringValueRow[]>()
  const underlaysByCustomer = new Map<string, BillingUnderlayRow[]>()
  const outboundByCustomer = new Map<string, OutboundRequestRow[]>()

  for (const site of input.sites) {
    const rows = sitesByCustomer.get(site.customer_id) ?? []
    rows.push(site)
    sitesByCustomer.set(site.customer_id, rows)
  }

  for (const point of input.meteringPoints) {
    const rows = pointsBySite.get(point.site_id) ?? []
    rows.push(point)
    pointsBySite.set(point.site_id, rows)
  }

  for (const contract of input.contracts) {
    const rows = contractsByCustomer.get(contract.customer_id) ?? []
    rows.push(contract)
    contractsByCustomer.set(contract.customer_id, rows)
  }

  for (const poa of input.powersOfAttorney) {
    const rows = poaByCustomer.get(poa.customer_id) ?? []
    rows.push(poa)
    poaByCustomer.set(poa.customer_id, rows)
  }

  for (const request of input.switchRequests) {
    const rows = switchByCustomer.get(request.customer_id) ?? []
    rows.push(request)
    switchByCustomer.set(request.customer_id, rows)
  }

  for (const request of input.gridOwnerDataRequests) {
    const rows = gridRequestsByCustomer.get(request.customer_id) ?? []
    rows.push(request)
    gridRequestsByCustomer.set(request.customer_id, rows)
  }

  for (const value of input.meteringValues) {
    const rows = meteringValuesByCustomer.get(value.customer_id) ?? []
    rows.push(value)
    meteringValuesByCustomer.set(value.customer_id, rows)
  }

  for (const underlay of input.billingUnderlays ?? []) {
    const rows = underlaysByCustomer.get(underlay.customer_id) ?? []
    rows.push(underlay)
    underlaysByCustomer.set(underlay.customer_id, rows)
  }

  for (const outbound of input.outboundRequests) {
    const rows = outboundByCustomer.get(outbound.customer_id) ?? []
    rows.push(outbound)
    outboundByCustomer.set(outbound.customer_id, rows)
  }

  const profiles = input.customers.map((customer) => {
    const sites = sortByUpdatedOrCreated(sitesByCustomer.get(customer.id) ?? [])
    const meteringPoints = sites.flatMap((site) => pointsBySite.get(site.id) ?? [])
    const contracts = sortByUpdatedOrCreated(contractsByCustomer.get(customer.id) ?? [])
    const powersOfAttorney = sortByUpdatedOrCreated(poaByCustomer.get(customer.id) ?? [])
    const switchRequests = sortByUpdatedOrCreated(switchByCustomer.get(customer.id) ?? [])
    const gridOwnerDataRequests = sortByUpdatedOrCreated(gridRequestsByCustomer.get(customer.id) ?? [])
    const meteringValues = meteringValuesByCustomer.get(customer.id) ?? []
    const billingUnderlays = underlaysByCustomer.get(customer.id) ?? []
    const outboundRequests = outboundByCustomer.get(customer.id) ?? []

    const signedOrActiveContracts = contracts.filter((contract) =>
      ['signed', 'active'].includes(contract.status)
    )
    const signedPowersOfAttorney = powersOfAttorney.filter((poa) =>
      isPoaSignedAndValid(poa, now)
    )
    const activeSites = sites.filter((site) => site.status === 'active')
    const activeMeteringPoints = meteringPoints.filter((point) => point.status === 'active')
    const openSwitchRequests = switchRequests.filter((request) =>
      ['draft', 'queued', 'submitted'].includes(request.status)
    )
    const openGridOwnerRequests = gridOwnerDataRequests.filter((request) =>
      ['pending', 'sent'].includes(request.status)
    )
    const unresolvedOutbound = outboundRequests.filter(
      (outbound) => outbound.channel_type === 'unresolved' || outbound.status === 'failed'
    )

    const blockers: string[] = []
    const warnings: string[] = []

    const hasSite = sites.length > 0
    const hasMeteringPoint = meteringPoints.length > 0
    const hasGridOwner = sites.some((site) => site.grid_owner_id) || meteringPoints.some((point) => point.grid_owner_id)
    const hasPriceArea = sites.some((site) => site.price_area_code) || meteringPoints.some((point) => point.price_area_code)
    const hasContract = signedOrActiveContracts.length > 0
    const hasSignedPoa = signedPowersOfAttorney.length > 0

    if (!hasSite) blockers.push('Ingen anläggning kopplad')
    if (hasSite && !hasMeteringPoint) blockers.push('Ingen mätpunkt kopplad')
    if (hasMeteringPoint && !hasGridOwner) blockers.push('Nätägare saknas')
    if (hasMeteringPoint && !hasPriceArea) warnings.push('Elområde saknas')
    if (!hasContract) warnings.push('Signerat/aktivt avtal saknas')
    if (!hasSignedPoa) warnings.push('Signerad fullmakt saknas')
    if (unresolvedOutbound.length > 0) blockers.push('Outbound saknar route eller har felat')
    if (openGridOwnerRequests.length > 0) warnings.push('Nätägarrequest väntar fortfarande på svar')

    const latestSwitch = switchRequests[0] ?? null
    const stage = summarizeStage({
      blockers,
      warnings,
      hasSite,
      hasMeteringPoint,
      hasGridOwner,
      hasPriceArea,
      hasContract,
      hasSignedPoa,
      openSwitchRequests,
      latestSwitch,
      meteringValueCount: meteringValues.length,
      unresolvedOutboundCount: unresolvedOutbound.length,
    })

    const identityKeys: CustomerIdentityKey[] = []
    addIdentityKey(identityKeys, 'Kundnr', customer.customer_number)
    addIdentityKey(identityKeys, customer.org_number ? 'Org.nr' : 'Personnr', customer.org_number ?? customer.personal_number)
    addIdentityKey(identityKeys, 'E-post', customer.email)

    for (const site of sites.slice(0, 3)) {
      addIdentityKey(identityKeys, 'Anl.ID', site.facility_id)
      addIdentityKey(identityKeys, 'Adress', [site.street, site.postal_code, site.city].filter(Boolean).join(', '))
    }

    for (const point of meteringPoints.slice(0, 3)) {
      addIdentityKey(identityKeys, 'Mätpunkt', point.meter_point_id)
      addIdentityKey(identityKeys, 'Ediel-ref', point.ediel_reference)
    }

    const href = `/admin/customers/${customer.id}`
    const latestMeterValueAt = latestDateFromRows(meteringValues, ['read_at', 'created_at'])
    const latestGridOwnerRequestAt = latestDateFromRows(gridOwnerDataRequests, ['received_at', 'sent_at', 'requested_at', 'created_at'])

    return {
      customerId: customer.id,
      customerName: customerDisplayName(customer),
      customerNumber: customer.customer_number,
      customerStatus: customer.status,
      email: customer.email,
      href,
      ...stage,
      blockers,
      warnings,
      identityKeys,
      counts: {
        sites: sites.length,
        activeSites: activeSites.length,
        meteringPoints: meteringPoints.length,
        activeMeteringPoints: activeMeteringPoints.length,
        contracts: contracts.length,
        signedOrActiveContracts: signedOrActiveContracts.length,
        powersOfAttorney: powersOfAttorney.length,
        signedPowersOfAttorney: signedPowersOfAttorney.length,
        switchRequests: switchRequests.length,
        openSwitchRequests: openSwitchRequests.length,
        gridOwnerRequests: gridOwnerDataRequests.length,
        openGridOwnerRequests: openGridOwnerRequests.length,
        meteringValues: meteringValues.length,
        billingUnderlays: billingUnderlays.length,
        unresolvedOutbound: unresolvedOutbound.length,
      },
      latestDates: {
        customerCreatedAt: customer.created_at,
        latestSwitchAt: latestDateFromRows(switchRequests, ['completed_at', 'failed_at', 'submitted_at', 'updated_at', 'created_at']),
        latestMeterValueAt,
        latestGridOwnerRequestAt,
      },
    } satisfies CustomerSyncProfile
  })

  const sortedProfiles = profiles.sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank
    return normalizeDate(b.latestDates.customerCreatedAt) - normalizeDate(a.latestDates.customerCreatedAt)
  })

  const summary: CustomerSyncSummary = {
    totalCustomers: sortedProfiles.length,
    blocked: sortedProfiles.filter((profile) => profile.signal === 'blocked').length,
    attention: sortedProfiles.filter((profile) => profile.signal === 'attention').length,
    ready: sortedProfiles.filter((profile) => profile.signal === 'ready').length,
    inProgress: sortedProfiles.filter((profile) => profile.signal === 'in_progress').length,
    healthy: sortedProfiles.filter((profile) => profile.signal === 'healthy').length,
    missingSites: sortedProfiles.filter((profile) => profile.stage === 'missing_site').length,
    missingMeteringPoints: sortedProfiles.filter((profile) => profile.stage === 'missing_metering_point').length,
    missingContracts: sortedProfiles.filter((profile) => profile.stage === 'missing_contract').length,
    missingPowersOfAttorney: sortedProfiles.filter((profile) => profile.stage === 'missing_power_of_attorney').length,
    readyForSwitch: sortedProfiles.filter((profile) => profile.stage === 'ready_for_switch').length,
    activeMissingMeterValues: sortedProfiles.filter((profile) => profile.stage === 'active_missing_meter_values').length,
    unresolvedOutbound: sortedProfiles.reduce((sum, profile) => sum + profile.counts.unresolvedOutbound, 0),
  }

  return {
    profiles: sortedProfiles,
    summary,
  }
}
