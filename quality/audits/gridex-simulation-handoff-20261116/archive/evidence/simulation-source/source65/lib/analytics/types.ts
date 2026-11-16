export type AnalyticsFilters = {
  month: string
  biddingZoneCode?: string | null
  gridOwnerId?: string | null
  customerType?: string | null
  meteringMethod?: string | null
  status?: string | null
}

export type MetricCard = {
  key: string
  label: string
  value: string
  hint: string
  status: 'ok' | 'warning' | 'critical' | 'info'
  href?: string
}

export type MonthlyMetricRow = {
  month: string
  total_customers?: number | null
  active_customers?: number | null
  new_customers?: number | null
  ended_customers?: number | null
  total_sites?: number | null
  active_sites?: number | null
  total_metering_points?: number | null
  active_metering_points?: number | null
  metering_values_received?: number | null
  metering_values_missing?: number | null
  requested_metering_values?: number | null
  successful_metering_requests?: number | null
  failed_metering_requests?: number | null
  forecast_kwh?: number | null
  actual_kwh?: number | null
  diff_kwh?: number | null
  diff_percent?: number | null
}

export type ForecastSummaryRow = {
  biddingZoneCode: string
  gridOwnerId?: string | null
  gridOwnerName?: string | null
  forecastKwh: number
  forecastMwh: number
  actualKwh: number
  diffKwh: number
  diffPercent: number | null
  confidenceScore: number
  missingDataCount: number
}

export type SimpleChartRow = {
  key: string
  label: string
  value: number
  hint?: string
}

export type DeviationRow = {
  id: string
  type: string
  affects: string
  severity: string
  status: string
  actionHref?: string
  message: string
  entityType?: string | null
  entityId?: string | null
}

export type ReportDefinition = {
  key: string
  label: string
  description: string
}
