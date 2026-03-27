import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
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

function isSignedAndValidPowerOfAttorney(
  poa: PowerOfAttorneyRow,
  now: Date
): boolean {
  if (poa.status !== 'signed') return false

  const validFrom = toDateOrNull(poa.valid_from)
  const validTo = toDateOrNull(poa.valid_to)

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
  const scoped = powersOfAttorney.filter(
    (poa) => poa.scope === 'supplier_switch'
  )

  const siteScoped = scoped.filter((poa) => poa.site_id === customerSiteId)
  const globalScoped = scoped.filter((poa) => poa.site_id === null)

  const ordered = [...siteScoped, ...globalScoped].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )

  return ordered[0] ?? null
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
        'Ingen fullmakt för leverantörsbyte finns registrerad för kunden eller anläggningen.',
      priority: 'critical',
      taskType: 'power_of_attorney_missing',
    })
  } else if (!isSignedAndValidPowerOfAttorney(latestPowerOfAttorney, now)) {
    issues.push({
      code: 'power_of_attorney_not_signed',
      title: 'Fullmakt inte giltig',
      description:
        'Det finns en fullmakt registrerad, men den är inte signerad eller inte längre giltig.',
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
    if (!candidateMeteringPoint.meter_point_id?.trim()) {
      issues.push({
        code: 'meter_point_id_missing',
        title: 'Mätpunkts-ID saknas',
        description:
          'Den valda mätpunkten saknar mätpunkts-ID och måste kompletteras.',
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

  if (!site.current_supplier_name?.trim()) {
    issues.push({
      code: 'current_supplier_missing',
      title: 'Nuvarande leverantör saknas',
      description:
        'Nuvarande elleverantör bör vara registrerad innan byte skickas vidare.',
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