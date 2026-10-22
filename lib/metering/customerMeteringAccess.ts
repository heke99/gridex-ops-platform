// Customer channels (Mina sidor, the customer API, the partner/website API) read metering values only
// through these database functions. Each value must lie inside one of the customer's access windows for
// the same tenant and metering point: an established supply period (Ediel-confirmed start and end) or,
// for history before our supply, a value bound to a grid-owner-approved metering permission. The filter
// runs in the database before any limit, page, sum or chart (FINDINGS F79, owner decision 2026-10-22).
// Internal staff reads keep their own permissions and do not use these functions.
import { supabaseService } from '@/lib/supabase/service'

export type CustomerMeteringScope = { companyId: string; customerIds: string[] }

// The functions return SETOF the table row, so the PostgREST builder behaves like a table select;
// typed as such until the generated database types include these functions (GEN owner).
type TableRows = ReturnType<ReturnType<typeof supabaseService.from>['select']>

/** normalized_metering_values visible to the customers; extra PostgREST filters/orders apply on top. */
export function customerNormalizedMeteringValues(scope: CustomerMeteringScope, filters: {
  customerSiteId?: string | null
  facilityId?: string | null
  periodStartFrom?: string | null
  periodStartBefore?: string | null
  periodEndTo?: string | null
  before?: { periodStart: string; id: string } | null
  limit?: number | null
} = {}) {
  return supabaseService.rpc('gridex_customer_normalized_metering_values_v1', {
    p_company_id: scope.companyId,
    p_customer_ids: scope.customerIds,
    p_customer_site_id: filters.customerSiteId ?? null,
    p_facility_id: filters.facilityId ?? null,
    p_period_start_from: filters.periodStartFrom ?? null,
    p_period_start_before: filters.periodStartBefore ?? null,
    p_period_end_to: filters.periodEndTo ?? null,
    p_before_period_start: filters.before?.periodStart ?? null,
    p_before_id: filters.before?.id ?? null,
    p_limit: filters.limit ?? null,
  }) as unknown as TableRows
}

/** metering_values visible to the customers (Mina sidor detail rows). */
export function customerMeteringValues(scope: CustomerMeteringScope, filters: {
  periodStartFrom?: string | null
  periodStartBefore?: string | null
  limit?: number | null
} = {}) {
  return supabaseService.rpc('gridex_customer_metering_values_v1', {
    p_company_id: scope.companyId,
    p_customer_ids: scope.customerIds,
    p_period_start_from: filters.periodStartFrom ?? null,
    p_period_start_before: filters.periodStartBefore ?? null,
    p_limit: filters.limit ?? null,
  }) as unknown as TableRows
}
