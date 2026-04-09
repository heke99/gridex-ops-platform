import type {
  CustomerOperationTaskRow,
  PowerOfAttorneyRow,
} from '@/lib/operations/types'
import type {
  CustomerSiteRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'

function isSignedPowerOfAttorney(
  poa: PowerOfAttorneyRow,
  now: Date
): boolean {
  if (poa.scope !== 'supplier_switch') return false
  if (poa.status !== 'signed') return false

  const validFrom = poa.valid_from ? new Date(poa.valid_from) : null
  const validTo = poa.valid_to ? new Date(poa.valid_to) : null

  if (validFrom && !Number.isNaN(validFrom.getTime()) && validFrom > now) {
    return false
  }

  if (validTo && !Number.isNaN(validTo.getTime()) && validTo < now) {
    return false
  }

  return true
}

function getSiteForTask(
  task: CustomerOperationTaskRow,
  sites: CustomerSiteRow[]
): CustomerSiteRow | null {
  if (!task.site_id) return null
  return sites.find((site) => site.id === task.site_id) ?? null
}

function getMeteringPointsForSite(
  siteId: string | null,
  meteringPoints: MeteringPointRow[]
): MeteringPointRow[] {
  if (!siteId) return []
  return meteringPoints.filter((point) => point.site_id === siteId)
}

export function isTaskLikelyResolved(params: {
  task: CustomerOperationTaskRow
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
  now?: Date
}): boolean {
  const { task, sites, meteringPoints, powersOfAttorney } = params
  const now = params.now ?? new Date()

  const site = getSiteForTask(task, sites)
  const siteMeteringPoints = getMeteringPointsForSite(task.site_id, meteringPoints)

  switch (task.task_type) {
    case 'power_of_attorney_missing': {
      return powersOfAttorney.some((poa) => {
        if (poa.customer_id !== task.customer_id) return false
        if (poa.scope !== 'supplier_switch') return false
        if (poa.site_id && poa.site_id !== task.site_id) return false
        return true
      })
    }

    case 'power_of_attorney_not_signed': {
      return powersOfAttorney.some((poa) => {
        if (poa.customer_id !== task.customer_id) return false
        if (poa.scope !== 'supplier_switch') return false
        if (poa.site_id && poa.site_id !== task.site_id) return false
        return isSignedPowerOfAttorney(poa, now)
      })
    }

    case 'metering_point_missing': {
      return siteMeteringPoints.length > 0
    }

    case 'meter_point_id_missing': {
      return siteMeteringPoints.some(
        (point) => Boolean(point.meter_point_id?.trim())
      )
    }

    case 'grid_owner_missing': {
      return Boolean(
        site?.grid_owner_id ||
          siteMeteringPoints.some((point) => Boolean(point.grid_owner_id))
      )
    }

    case 'price_area_missing': {
      return Boolean(
        site?.price_area_code ||
          siteMeteringPoints.some((point) => Boolean(point.price_area_code))
      )
    }

    case 'current_supplier_missing': {
      return Boolean(site?.current_supplier_name?.trim())
    }

    case 'move_in_date_missing': {
      return Boolean(site?.move_in_date)
    }

    default:
      return false
  }
}