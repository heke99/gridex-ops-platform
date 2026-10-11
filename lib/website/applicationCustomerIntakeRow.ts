// Maps a stored website application payload into the flat intake row shape
// consumed by the admin import intake (`buildCustomerParamsFromImportRow`), so
// "Skapa kund från ansökan" reuses the canonical admin onboarding path.
// Contract fields are intentionally omitted: the contract is created later in
// the application review flow, not as a side effect of customer creation.

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = str(value)
    if (candidate) return candidate
  }
  return null
}

export function websiteApplicationPayloadToIntakeRow(
  payload: JsonRecord | null | undefined,
  application: { grid_owner_id?: string | null; grid_area_code?: string | null; price_area_code?: string | null } = {},
): Record<string, string> {
  const base = isRecord(payload) ? payload : {}
  const customer = isRecord(base.customer) ? base.customer : {}
  const site = isRecord(base.site) ? base.site : {}
  const meter = isRecord(base.metering_point) ? base.metering_point : {}

  const rawType = first(customer.customer_type, base.customer_type)?.toLowerCase() ?? null
  const companyName = first(customer.company_name, base.company_name)
  const orgNumber = first(customer.org_number, customer.organization_number, base.org_number)
  const customerType = rawType === 'business' || rawType === 'company' || rawType === 'foretag'
    ? 'business'
    : rawType === 'private' || rawType === 'privat'
      ? 'private'
      : companyName || orgNumber
        ? 'business'
        : 'private'

  let firstName = first(customer.first_name, base.first_name)
  let lastName = first(customer.last_name, base.last_name)
  const fullName = first(customer.full_name, base.full_name, base.name)
  if ((!firstName || !lastName) && fullName && customerType === 'private') {
    const parts = fullName.split(/\s+/)
    firstName = firstName ?? parts[0] ?? null
    lastName = lastName ?? (parts.length > 1 ? parts.slice(1).join(' ') : null)
  }

  const row: Record<string, string | null> = {
    customer_type: customerType,
    first_name: firstName,
    last_name: lastName,
    company_name: customerType === 'business' ? companyName ?? fullName : null,
    email: first(customer.email, base.email),
    phone: first(customer.phone, base.phone),
    personal_number: customerType === 'private' ? first(customer.personal_number, customer.ssn, base.personal_number) : null,
    org_number: customerType === 'business' ? orgNumber : null,
    apartment_number: first(site.apartment_number, customer.apartment_number),
    street: first(site.street, customer.street, base.street),
    postal_code: first(site.postal_code, customer.postal_code, base.postal_code),
    city: first(site.city, customer.city, base.city),
    care_of: first(site.care_of, customer.care_of),
    country: first(site.country, customer.country) ?? 'SE',
    facility_id: first(site.facility_id, base.facility_id),
    meter_point_id: first(meter.metering_point_id, meter.meter_point_id, base.metering_point_id),
    grid_owner_id: first(application.grid_owner_id, site.grid_owner_id, base.grid_owner_id),
    grid_area_code: first(application.grid_area_code, site.grid_area_code, base.grid_area_code),
    price_area_code: first(application.price_area_code, site.price_area_code, base.price_area_code)?.toUpperCase() ?? null,
    move_in_date: first(site.move_in_date),
  }

  return Object.fromEntries(
    Object.entries(row).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
  )
}
