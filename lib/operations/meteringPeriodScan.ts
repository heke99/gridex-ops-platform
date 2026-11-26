import { supabaseService } from '@/lib/supabase/service'

type PeriodScanRow = {
  point_id: string
  site_id: string | null
  customer_id: string | null
  grid_owner_id: string | null
  meter_point_id: string | null
  facility_id: string | null
  missing_months: string[]
}

export async function scanMeteringPeriodPoints(
  input: { companyId: string; monthStarts: string[]; includeUnlinked: boolean },
): Promise<{ pointsWithGaps: PeriodScanRow[]; meteringPointsScanned: number }> {
  const requestedMonths = new Set(input.monthStarts)
  const db = supabaseService as unknown as {
    rpc(
      name: 'gridex_scan_metering_period_points_v2',
      args: { p_company_id: string; p_month_starts: string[]; p_include_unlinked: boolean; p_after_point_id?: string },
    ): PromiseLike<{ data: PeriodScanRow[] | null; error: unknown }>
  }
  const pointsWithGaps: PeriodScanRow[] = []
  let meteringPointsScanned = 0
  let afterPointId: string | undefined

  for (;;) {
    const { data: page, error } = await db.rpc('gridex_scan_metering_period_points_v2', {
      p_company_id: input.companyId,
      p_month_starts: input.monthStarts,
      p_include_unlinked: input.includeUnlinked,
      ...(afterPointId && { p_after_point_id: afterPointId }),
    })
    if (error) throw error
    if (!Array.isArray(page)) throw new Error('Periodmotorns mätpunktsurval saknas.')
    if (page.length === 0) return { pointsWithGaps, meteringPointsScanned }
    for (const point of page) {
      if (!point.point_id || (afterPointId && point.point_id <= afterPointId)) {
        throw new Error('Periodmotorns mätpunktsurval har en ogiltig ordning.')
      }
      if (!Array.isArray(point.missing_months) || point.missing_months.some((month) => !requestedMonths.has(month))) {
        throw new Error('Periodmotorns mätpunktsurval innehåller en obegärd period.')
      }
      afterPointId = point.point_id
      meteringPointsScanned += 1
      if (point.missing_months.length > 0) pointsWithGaps.push(point)
    }
  }
}
