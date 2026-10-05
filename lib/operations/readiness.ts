import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import { hasMeteringPointIdentity } from '@/lib/customers/meteringIdentity'
import type {
  PowerOfAttorneyRow,
  SwitchReadinessIssue,
  SwitchReadinessResult,
} from '@/lib/operations/types'

function toDateOrNull(value: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function poaExtraString(poa: PowerOfAttorneyRow, key: string): string | null {
  const value = (poa as unknown as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isSignedAndValidPowerOfAttorney(
  poa: PowerOfAttorneyRow,
  now: Date
): boolean {
  if (poa.status !== 'signed') return false

  const hasEvidence = Boolean(
    poa.document_path?.trim() ||
    poa.signed_at ||
    poaExtraString(poa, 'accepted_at') ||
    poa.reference ||
    (poa as unknown as Record<string, unknown>).fullmakt_snapshot
  )
  if (!hasEvidence) return false

  const validFrom = toDateOrNull(poa.valid_from)
  const validTo = toDateOrNull(poa.valid_to) ?? toDateOrNull(poaExtraString(poa, 'valid_until'))

  if (validFrom && validFrom > now) return false
  if (validTo && validTo < now) return false

  return true
}

function selectCandidateMeteringPoint(
  meteringPoints: MeteringPointRow[]
): MeteringPointRow | null {
  const active = meteringPoints.find((point) => point.status === 'active')
  if (active) return active

  const pending = meteringPoints.find(
    (point) => point.status === 'pending_validation'
  )
  if (pending) return pending

  return meteringPoints[0] ?? null
}

function getRelevantPowerOfAttorney(
  customerSiteId: string,
  powersOfAttorney: PowerOfAttorneyRow[]
): PowerOfAttorneyRow | null {
  // Site is an operational identity boundary. A POA for Site A (or a legacy
  // site-less POA) must never silently authorize Site B. If a future product
  // supports a true multi-site mandate it needs an explicit, typed scope model;
  // null site is not such evidence.
  const exactSite = powersOfAttorney
    .filter((poa) => poa.scope === 'supplier_switch')
    .filter((poa) => {
      const rowSite = poa.site_id ?? poaExtraString(poa, 'customer_site_id')
      return rowSite === customerSiteId
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return exactSite[0] ?? null
}

export function evaluateSiteSwitchReadiness(params: {
  site: CustomerSiteRow
  meteringPoints: MeteringPointRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
  now?: Date
}): SwitchReadinessResult {
  const { site, meteringPoints, powersOfAttorney } = params
  const now = params.now ?? new Date()

  const issues: SwitchReadinessIssue[] = []
  const candidateMeteringPoint = selectCandidateMeteringPoint(meteringPoints)
  const latestPowerOfAttorney = getRelevantPowerOfAttorney(site.id, powersOfAttorney)

  if (!latestPowerOfAttorney) {
    issues.push({
      code: 'power_of_attorney_missing',
      title: 'Fullmakt saknas',
      description:
        'Ingen site-specifik fullmakt för leverantörsbyte finns registrerad för anläggningen.',
      priority: 'critical',
      taskType: 'power_of_attorney_missing',
    })
  } else if (!isSignedAndValidPowerOfAttorney(latestPowerOfAttorney, now)) {
    issues.push({
      code: 'power_of_attorney_not_signed',
      title: 'Fullmakt inte giltig',
      description:
        'Det finns en fullmakt registrerad för anläggningen, men den är inte signerad eller inte längre giltig.',
      priority: 'critical',
      taskType: 'power_of_attorney_not_signed',
    })
  }

  if (!candidateMeteringPoint) {
    issues.push({
      code: 'metering_point_missing',
      title: 'Mätpunkt saknas',
      description:
        'Ingen mätpunkt är kopplad till anläggningen. Leverantörsbyte kan inte startas utan mätpunkt.',
      priority: 'critical',
      taskType: 'metering_point_missing',
    })
  } else {
    if (!hasMeteringPointIdentity(candidateMeteringPoint)) {
      issues.push({
        code: 'meter_point_id_missing',
        title: 'Mätpunkts-ID saknas',
        description:
          'Den valda mätpunkten saknar ett mätpunkts-ID eller en verifierad Ediel-referens.',
        priority: 'critical',
        taskType: 'meter_point_id_missing',
      })
    }

    if (!candidateMeteringPoint.grid_owner_id && !site.grid_owner_id) {
      issues.push({
        code: 'grid_owner_missing',
        title: 'Nätägare saknas',
        description:
          'Varken anläggningen eller mätpunkten har nätägare angiven.',
        priority: 'high',
        taskType: 'grid_owner_missing',
      })
    }

    if (!candidateMeteringPoint.grid_area_code && !site.grid_area_code) {
      issues.push({
        code: 'grid_area_missing',
        title: 'Nätområde saknas',
        description:
          'Varken anläggningen eller mätpunkten har nätområdeskod angiven. Ediel får inte skickas innan nätområdet är verifierat.',
        priority: 'high',
        taskType: 'grid_area_missing',
      })
    }

    if (!candidateMeteringPoint.price_area_code && !site.price_area_code) {
      issues.push({
        code: 'price_area_missing',
        title: 'Elområde saknas',
        description:
          'Varken anläggningen eller mätpunkten har elområde angivet.',
        priority: 'high',
        taskType: 'price_area_missing',
      })
    }
  }

  // The current supplier is not needed to address a Z03 supplier-switch
  // notification to the grid owner. Persisted rows explicitly marked unknown
  // therefore continue without a switch blocker. If the row is not marked
  // unknown, keep the existing data-quality issue so contradictory/legacy
  // states remain visible and fail closed until normalized by master data.
  if (!site.current_supplier_name?.trim() && !site.current_supplier_unknown) {
    issues.push({
      code: 'current_supplier_missing',
      title: 'Nuvarande leverantör saknas',
      description:
        'Nuvarande elleverantör saknas och anläggningen är inte markerad med okänd nuvarande leverantör.',
      priority: 'normal',
      taskType: 'current_supplier_missing',
    })
  }

  if (!site.move_in_date) {
    issues.push({
      code: 'move_in_date_missing',
      title: 'Inflyttningsdatum saknas',
      description:
        'Anläggningen saknar flytt-/startdatum. Detta bör kompletteras inför switchflödet.',
      priority: 'normal',
      taskType: 'move_in_date_missing',
    })
  }

  return {
    customerId: site.customer_id,
    siteId: site.id,
    siteName: site.site_name,
    candidateMeteringPointId: candidateMeteringPoint?.id ?? null,
    latestPowerOfAttorneyId: latestPowerOfAttorney?.id ?? null,
    isReady: issues.length === 0,
    issues,
  }
}

export function evaluateCustomerSwitchReadiness(params: {
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
}): SwitchReadinessResult[] {
  const { sites, meteringPoints, powersOfAttorney } = params

  return sites.map((site) =>
    evaluateSiteSwitchReadiness({
      site,
      meteringPoints: meteringPoints.filter((point) => point.site_id === site.id),
      powersOfAttorney,
    })
  )
}
