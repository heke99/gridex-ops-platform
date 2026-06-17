import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { CustomerInfoRequestRow } from '@/lib/onboarding/infoRequests'
import type { CustomerAuthorizationDocumentRow, PowerOfAttorneyRow } from '@/lib/operations/types'

type AuthorizationDocumentLike = Pick<CustomerAuthorizationDocumentRow, 'document_type' | 'status' | 'power_of_attorney_id'> & Record<string, unknown>

type SnapshotInput = {
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney?: PowerOfAttorneyRow[]
  documents?: AuthorizationDocumentLike[]
  infoRequests?: CustomerInfoRequestRow[]
  contracts?: CustomerContractRow[]
}

export type CustomerCardSnapshot = {
  primarySite: CustomerSiteRow | null
  primaryMeteringPoint: MeteringPointRow | null
  hasAuthorization: boolean
  hasFacilityId: boolean
  hasMeteringPoint: boolean
  hasGridOwner: boolean
  hasContract: boolean
  hasPricePlan: boolean
  missingLabels: string[]
  switchBlockerLabels: string[]
  nextStepLabel: string
  nextStepDescription: string
  recommendedAction: 'request_data' | 'request_switch' | 'follow_up'
  hasOpenInfoRequest: boolean
}

function truthy(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

export function isSignedPowerOfAttorney(row: PowerOfAttorneyRow | Record<string, unknown>): boolean {
  const raw = row as Record<string, unknown>
  return String(raw.status ?? '').toLowerCase() === 'signed' && Boolean(
    truthy(raw.document_path) ||
    truthy(raw.signed_at) ||
    truthy(raw.accepted_at) ||
    truthy(raw.reference) ||
    truthy(raw.fullmakt_snapshot)
  )
}

export function isAvailablePowerOfAttorneyDocument(row: AuthorizationDocumentLike | Record<string, unknown>): boolean {
  const raw = row as Record<string, unknown>
  if (String(raw.document_type ?? '') !== 'power_of_attorney') return false
  return ['available', 'active', 'uploaded', 'signed', 'suggested'].includes(String(raw.status ?? '').toLowerCase())
}

export function hasValidPowerOfAttorney(
  powersOfAttorney: Array<PowerOfAttorneyRow | Record<string, unknown>> = [],
  documents: Array<AuthorizationDocumentLike | Record<string, unknown>> = []
): boolean {
  return powersOfAttorney.some(isSignedPowerOfAttorney) || documents.some(isAvailablePowerOfAttorneyDocument)
}

export function humanizeMissingField(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  const normalized = text.toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ')

  if (normalized.includes('metering point') || normalized.includes('mätpunkt')) return 'Mätpunkt/anläggnings-ID'
  if (normalized.includes('facility') || normalized.includes('anlägg')) return 'Anläggnings-ID'
  if (normalized.includes('grid owner') || normalized.includes('nätäg')) return 'Verifierad nätägare'
  if (normalized.includes('power of attorney') || normalized.includes('fullmakt')) return 'Signerad fullmakt'
  if (normalized.includes('price plan') || normalized.includes('prisplan')) return 'Kopplad prisplan'
  if (normalized.includes('contract') || normalized.includes('avtal')) return 'Avtal'
  if (normalized.includes('legal') || normalized.includes('villkor')) return 'Juridiska godkännanden'
  if (normalized.includes('route') || normalized.includes('prodat') || normalized.includes('z01')) return 'Kontaktväg till nätägare'
  return text.replaceAll('_', ' ')
}

export function humanizeBlockerReason(value: unknown): string {
  if (!value) return ''
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  const lower = raw.toLowerCase()

  if (lower.includes('prodat') || lower.includes('z01') || lower.includes('route')) {
    if (lower.includes('grid') || lower.includes('nät')) return 'Nätägare behöver verifieras innan begäran kan skickas.'
    if (lower.includes('meter')) return 'Mätpunkt eller anläggnings-ID behöver kompletteras innan begäran kan skickas.'
    return 'Kontaktvägen till mottagaren behöver verifieras innan begäran kan skickas.'
  }

  if (lower.includes('auth') || lower.includes('fullmakt')) return 'Signerad fullmakt behöver verifieras innan begäran kan skickas.'
  if (lower.includes('{') || lower.includes('"field"')) return humanizeMissingField(raw)
  return raw
}

export function buildCustomerCardSnapshot(input: SnapshotInput): CustomerCardSnapshot {
  const primarySite = input.sites.find((site) => site.status === 'active') ?? input.sites[0] ?? null
  const primaryMeteringPoint = primarySite
    ? input.meteringPoints.find((point) => point.site_id === primarySite.id && point.status === 'active') ??
      input.meteringPoints.find((point) => point.site_id === primarySite.id) ??
      null
    : input.meteringPoints[0] ?? null

  const hasAuthorization = hasValidPowerOfAttorney(input.powersOfAttorney ?? [], input.documents ?? [])
  const hasFacilityId = truthy(primarySite?.facility_id)
  const hasMeteringPoint = Boolean(primaryMeteringPoint && truthy(primaryMeteringPoint.meter_point_id ?? primaryMeteringPoint.ediel_reference ?? primaryMeteringPoint.id))
  const hasGridOwner = truthy(primaryMeteringPoint?.grid_owner_id ?? primarySite?.grid_owner_id)
  const hasContract = (input.contracts ?? []).length > 0
  const hasPricePlan = (input.contracts ?? []).some((contract) => {
    const raw = contract as unknown as Record<string, unknown>
    return truthy(raw.price_plan_id) || truthy(raw.price_plan_version_id) || truthy(raw.contract_price_snapshot_id) || truthy(raw.contract_name)
  })
  const hasOpenInfoRequest = (input.infoRequests ?? []).some((request) => !['completed', 'cancelled', 'rejected'].includes(String(request.status ?? '').toLowerCase()))

  const missingLabels = [
    hasAuthorization ? null : 'Signerad fullmakt',
    hasFacilityId ? null : 'Anläggnings-ID',
    hasMeteringPoint ? null : 'Mätpunkt',
    hasGridOwner ? null : 'Verifierad nätägare',
    hasContract ? null : 'Avtal',
    hasPricePlan ? null : 'Kopplad prisplan',
  ].filter((value): value is string => Boolean(value))

  const switchBlockerLabels = missingLabels.filter((label) => label !== 'Avtal')
  const recommendedAction = switchBlockerLabels.length > 0 ? 'request_data' : hasOpenInfoRequest ? 'follow_up' : 'request_switch'
  const nextStepLabel = recommendedAction === 'request_switch'
    ? 'Begär leverantörsbyte'
    : recommendedAction === 'follow_up'
      ? 'Följ upp pågående uppgiftsbegäran'
      : 'Begär uppgifter'
  const nextStepDescription = recommendedAction === 'request_switch'
    ? 'Grunduppgifterna ser klara ut. Systemet gör en sista kontroll innan något skickas.'
    : switchBlockerLabels.length > 0
      ? `Saknas: ${switchBlockerLabels.join(', ')}.`
      : 'Systemet väntar på svar eller komplettering.'

  return {
    primarySite,
    primaryMeteringPoint,
    hasAuthorization,
    hasFacilityId,
    hasMeteringPoint,
    hasGridOwner,
    hasContract,
    hasPricePlan,
    missingLabels,
    switchBlockerLabels,
    nextStepLabel,
    nextStepDescription,
    recommendedAction,
    hasOpenInfoRequest,
  }
}
