// components/admin/customers/billing-metering/utils.ts
import type {
  BillingUnderlayRow,
  MeteringValueRow,
  PartnerExportRow,
} from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'

export type PeriodRange = {
  start: string
  end: string
  label: string
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function statusTone(status: string | null | undefined): string {
  if (!status) {
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }

  if (['received', 'validated', 'acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['exported', 'sent', 'prepared', 'queued'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

export function siteLabel(siteId: string | null, sites: CustomerSiteRow[]): string {
  if (!siteId) return '—'
  return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

export function meteringPointLabel(
  meteringPointId: string | null,
  meteringPoints: MeteringPointRow[]
): string {
  if (!meteringPointId) return '—'
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    meteringPointId
  )
}

export function gridOwnerLabel(
  gridOwnerId: string | null,
  gridOwners: GridOwnerRow[]
): string {
  if (!gridOwnerId) return '—'
  return gridOwners.find((owner) => owner.id === gridOwnerId)?.name ?? gridOwnerId
}

export function badgeTone(kind: string): string {
  switch (kind) {
    case 'outbound':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
    case 'data_request':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
    case 'meter_value':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    case 'billing_underlay':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
    case 'partner_export':
      return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300'
    case 'site':
    case 'metering_point':
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

export function latestSiteId(sites: CustomerSiteRow[]): string {
  return sites[0]?.id ?? ''
}

export function latestMeteringPointId(meteringPoints: MeteringPointRow[]): string {
  return meteringPoints[0]?.id ?? ''
}

export function inferredGridOwnerId(
  sites: CustomerSiteRow[],
  meteringPoints: MeteringPointRow[]
): string {
  return meteringPoints[0]?.grid_owner_id ?? sites[0]?.grid_owner_id ?? ''
}

export function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function inferDefaultPeriod(): PeriodRange {
  const now = new Date()
  const start = monthStart(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const end = monthStart(new Date(now.getFullYear(), now.getMonth(), 1))
  return {
    start: formatDateInput(start),
    end: formatDateInput(end),
    label: 'Föregående kalendermånad',
  }
}

export function inferLatestBillingPeriod(
  billingUnderlays: BillingUnderlayRow[],
  siteId: string,
  meteringPointId: string
): PeriodRange | null {
  const rows = billingUnderlays.filter((row) => {
    if (meteringPointId) return row.metering_point_id === meteringPointId
    if (siteId) return row.site_id === siteId
    return true
  })

  const normalized = rows
    .filter(
      (row) =>
        typeof row.underlay_year === 'number' &&
        typeof row.underlay_month === 'number'
    )
    .sort((a, b) => {
      const aKey = (a.underlay_year ?? 0) * 100 + (a.underlay_month ?? 0)
      const bKey = (b.underlay_year ?? 0) * 100 + (b.underlay_month ?? 0)
      return bKey - aKey
    })

  const latest = normalized[0]
  if (!latest?.underlay_year || !latest?.underlay_month) return null

  const nextStart = monthStart(
    new Date(latest.underlay_year, latest.underlay_month, 1)
  )
  const nextEnd = monthStart(
    new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 1)
  )

  return {
    start: formatDateInput(nextStart),
    end: formatDateInput(nextEnd),
    label: `Nästa saknade månad efter ${latest.underlay_year}-${String(
      latest.underlay_month
    ).padStart(2, '0')}`,
  }
}

export function inferLatestMeteringPeriod(
  meteringValues: MeteringValueRow[],
  meteringPointId: string
): PeriodRange | null {
  const rows = meteringPointId
    ? meteringValues.filter((row) => row.metering_point_id === meteringPointId)
    : meteringValues

  const validDates = rows
    .map((row) => (row.read_at ? new Date(row.read_at) : null))
    .filter((value): value is Date => {
      if (!value) return false
      return !Number.isNaN(value.getTime())
    })
    .sort((a, b) => b.getTime() - a.getTime())

  const latest = validDates[0]
  if (!latest) return null

  const nextStart = monthStart(new Date(latest.getFullYear(), latest.getMonth() + 1, 1))
  const nextEnd = monthStart(new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 1))

  return {
    start: formatDateInput(nextStart),
    end: formatDateInput(nextEnd),
    label: `Nästa månad efter senaste mätvärde ${latest.getFullYear()}-${String(
      latest.getMonth() + 1
    ).padStart(2, '0')}`,
  }
}

export function bestRecommendedPeriod(params: {
  billingUnderlays: BillingUnderlayRow[]
  meteringValues: MeteringValueRow[]
  siteId: string
  meteringPointId: string
  mode: 'billing' | 'meter_values' | 'generic'
}): PeriodRange {
  if (params.mode === 'billing') {
    return (
      inferLatestBillingPeriod(
        params.billingUnderlays,
        params.siteId,
        params.meteringPointId
      ) ?? inferDefaultPeriod()
    )
  }

  if (params.mode === 'meter_values') {
    return (
      inferLatestMeteringPeriod(params.meteringValues, params.meteringPointId) ??
      inferDefaultPeriod()
    )
  }

  return (
    inferLatestBillingPeriod(
      params.billingUnderlays,
      params.siteId,
      params.meteringPointId
    ) ??
    inferLatestMeteringPeriod(params.meteringValues, params.meteringPointId) ??
    inferDefaultPeriod()
  )
}

export function buildUnderlayMap(billingUnderlays: BillingUnderlayRow[]) {
  return new Map(billingUnderlays.map((underlay) => [underlay.id, underlay]))
}

export function splitPartnerExports(partnerExports: PartnerExportRow[]) {
  return {
    billingExports: partnerExports.filter((row) => row.export_kind === 'billing_underlay'),
    meteringExports: partnerExports.filter((row) => row.export_kind === 'meter_values'),
    customerSnapshotExports: partnerExports.filter(
      (row) => row.export_kind === 'customer_snapshot'
    ),
  }
}