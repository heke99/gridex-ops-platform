import type { CustomerCaseRow } from '@/lib/customer-cases/types'

export const EDIEL_OPERATIONAL_CASE_SOURCE = 'ediel_inbound_state_machine'
export const CUSTOMER_SUPPORT_CASE_SOURCE_FILTER = `source.is.null,source.neq.${EDIEL_OPERATIONAL_CASE_SOURCE}`
const TENANT_SUPPORT_SOURCE_PREFIX = 'tenant_support_'
const SUPPORT_MARKER = 'support_case'

// PostgREST .or() wraps these branches. NULL source can qualify only through
// the legacy boolean marker. The regular expression matches the literal prefix.
const legacySupport = `metadata.cs.${JSON.stringify({ [SUPPORT_MARKER]: true })}`
export const TENANT_SUPPORT_CASE_FILTER = [
  `and(source.is.null,${legacySupport})`,
  `and(source.neq.${EDIEL_OPERATIONAL_CASE_SOURCE},or(source.match.^${TENANT_SUPPORT_SOURCE_PREFIX},${legacySupport}))`,
].join(',')

export function isTenantSupportCase(row: Pick<CustomerCaseRow, 'source' | 'metadata'>): boolean {
  return row.source !== EDIEL_OPERATIONAL_CASE_SOURCE
    && (row.metadata?.[SUPPORT_MARKER] === true || row.source?.startsWith(TENANT_SUPPORT_SOURCE_PREFIX) === true)
}
