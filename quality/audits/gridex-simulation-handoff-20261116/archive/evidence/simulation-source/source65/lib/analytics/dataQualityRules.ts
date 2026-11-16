// Contract mirror of gridex_data_quality_rule_catalog_v. The behavioral SQL test
// checks parity; the database catalog drives scanning, validity and reconciliation.
export const DATA_QUALITY_SOURCE = 'gridex_data_quality' as const
export const DATA_QUALITY_ACTIVE_STATUSES = ['active', 'live', 'ongoing'] as const

export const DATA_QUALITY_RULES = {
  missing_bidding_zone: { entityType: 'metering_point', scanner: true },
  missing_grid_owner: { entityType: 'metering_point', scanner: true },
  missing_start_date: { entityType: 'metering_point', scanner: true },
  missing_estimated_annual_consumption: { entityType: 'metering_point', scanner: true },
  active_metering_point_without_active_customer: { entityType: 'metering_point', scanner: true },
  missing_metering_values: { entityType: 'metering_point', scanner: true },
  invalid_metering_value: { entityType: 'metering_value', scanner: true },
  missing_customer_contract: { entityType: 'customer', scanner: true },
  incomplete_customer_onboarding: { entityType: 'customer', scanner: true },
  failed_ediel_message: { entityType: 'ediel_message', scanner: true },
  slow_grid_owner_response: { entityType: 'grid_owner_data_request', scanner: true },
  forecast_deviation: { entityType: 'metering_point', scanner: true },
  forecast_basis_missing: { entityType: 'metering_point', scanner: false },
} as const

export type ManagedDataQualityIssueType = keyof typeof DATA_QUALITY_RULES
export type DataQualityEntityType = typeof DATA_QUALITY_RULES[ManagedDataQualityIssueType]['entityType']

export type ManagedDataQualityIssueInput = {
  companyId: string
  entityId: string
  issueType: ManagedDataQualityIssueType
  message: string
  severity?: 'warning' | 'critical'
  periodMonth?: string | null
}
