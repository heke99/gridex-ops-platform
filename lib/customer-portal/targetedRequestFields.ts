export const targetedRequestFields = {
  facility_id: { label: 'Anläggnings-ID', type: 'text', limit: 32, numeric: true },
  metering_point_id: { label: 'Mätpunkts-ID', type: 'text', limit: 32, numeric: true },
  'site.address': { label: 'Anläggningens adress', type: 'text', limit: 240 },
  'customer.email': { label: 'E-postadress', type: 'email', limit: 254 },
  'customer.name': { label: 'Namn', type: 'text', limit: 180 },
  requested_start_date: { label: 'Önskat startdatum', type: 'date', limit: 10 },
} as const

export type TargetedRequestField = keyof typeof targetedRequestFields

export function requestedPortalFields(categories: unknown): TargetedRequestField[] {
  if (!Array.isArray(categories)) return []
  const names = new Set(categories)
  if (names.has('facility_data_invalid') || names.has('duplicate_facility_id')) names.add('facility_id')
  return (Object.keys(targetedRequestFields) as TargetedRequestField[]).filter((key) => names.has(key))
}

export function isPortalResponseRequest(row: {
  target_party_type?: unknown
  request_type?: unknown
  status?: unknown
  automation_origin?: unknown
  requested_data_categories?: unknown
}) {
  return row.target_party_type === 'customer'
    && row.request_type === 'website_customer_onboarding'
    && row.automation_origin === 'website_customer_application'
    && row.status === 'draft'
    && requestedPortalFields(row.requested_data_categories).length > 0
}
