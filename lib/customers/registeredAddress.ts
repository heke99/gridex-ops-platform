// FINDINGS F51 (owner decision 2026-10-22): the customer's own registered address (folkbokföringsadress) is
// collected — declared by the customer in the website application/API, or entered by the logged-in staff member
// at manual intake — and stored as the one active `customer_addresses` row of type 'registered'. The protected
// Ediel masterdata rule (20261001014700) uses exactly that row as the end user's address for a request made
// today (Z01); an invoice or facility address is never used instead. Every write keeps its provenance and the
// previous address as history (moved_out_at), so there is never more than one current registered address.
import { tenantSelect, tenantUpdate, tenantInsert } from '@/lib/supabase/tenantQuery'

export type RegisteredAddressInput = { street: string; street2?: string | null; postalCode: string; city: string; country?: string | null }
export type RegisteredAddressSource = 'website_declaration' | 'staff_entry'

const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/** Swedish postal code as stored (NNN NN). */
export function normalizeSwedishPostalCode(value: string) {
  const digits = value.replace(/\s+/g, '')
  return /^\d{5}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : null
}

/** Field errors for a registered address, using the limits of the Ediel masterdata shape (35 characters). */
export function validateRegisteredAddress(input: Partial<RegisteredAddressInput> | null | undefined) {
  const errors: Partial<Record<'street' | 'street2' | 'postalCode' | 'city' | 'country', string>> = {}
  const street = clean(input?.street), street2 = clean(input?.street2), city = clean(input?.city)
  const country = clean(input?.country || 'SE').toUpperCase()
  if (!street || street === '.') errors.street = 'Ange gatuadress enligt folkbokföringen.'
  else if (street.length > 35) errors.street = 'Gatuadressen får vara högst 35 tecken.'
  if (street2.length > 35) errors.street2 = 'Adressrad 2 får vara högst 35 tecken.'
  if (country !== 'SE') errors.country = 'Folkbokföringsadressen ska vara en svensk adress.'
  else if (!normalizeSwedishPostalCode(clean(input?.postalCode))) errors.postalCode = 'Ange ett svenskt postnummer med fem siffror.'
  if (!city) errors.city = 'Ange postort enligt folkbokföringen.'
  else if (city.length > 35) errors.city = 'Postorten får vara högst 35 tecken.'
  return errors
}

function stockholmToday(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/**
 * Records the customer's registered address. An identical current address is left as it is; a changed one
 * closes the current row today and opens the new one from today, so the rule always finds exactly one.
 */
export async function recordRegisteredAddress(input: {
  companyId: string
  customerId: string
  address: RegisteredAddressInput
  source: RegisteredAddressSource
  actorUserId: string | null
  /** When the customer declared it (website) or the staff member entered it. */
  declaredAt?: string | null
  /** The application, intake or request that carried it. */
  reference?: string | null
  now?: Date
}): Promise<{ status: 'created' | 'replaced' | 'unchanged'; addressId: string }> {
  const errors = validateRegisteredAddress(input.address)
  if (Object.keys(errors).length > 0) throw new Error(`registered_address_invalid:${Object.keys(errors).join(',')}`)
  const address = {
    street_1: clean(input.address.street), street_2: clean(input.address.street2) || null,
    postal_code: normalizeSwedishPostalCode(clean(input.address.postalCode))!, city: clean(input.address.city), country: 'SE',
  }
  const today = stockholmToday(input.now)
  const { data: current, error: readError } = await tenantSelect(input.companyId, "customer_addresses", 'id,street_1,street_2,postal_code,city,country,moved_in_at,moved_out_at')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('type', 'registered').eq('is_active', true).returns<Array<{ id: string; street_1: string | null; street_2: string | null; postal_code: string | null; city: string | null; country: string | null; moved_in_at: string | null; moved_out_at: string | null }>>()
  if (readError) throw readError
  const open = (current ?? []).filter(row => !row.moved_out_at || today < String(row.moved_out_at))
  const same = open.find(row => row.street_1 === address.street_1 && (row.street_2 ?? null) === address.street_2
    && row.postal_code === address.postal_code && row.city === address.city && (row.country ?? 'SE') === address.country)
  if (same && open.length === 1) return { status: 'unchanged', addressId: String(same.id) }

  const metadata = { registered_address_source: input.source, declared_at: input.declaredAt ?? new Date().toISOString(),
    declared_by: input.actorUserId, source_reference: input.reference ?? null }
  if (open.length > 0) {
    const { error } = await tenantUpdate(input.companyId, "customer_addresses", { moved_out_at: today, updated_at: new Date().toISOString(), updated_by: input.actorUserId })
      .in('id', open.map(row => row.id)).eq('company_id', input.companyId).eq('customer_id', input.customerId)
    if (error) throw error
  }
  const { data: inserted, error } = await tenantInsert(input.companyId, "customer_addresses", {
    company_id: input.companyId, customer_id: input.customerId, type: 'registered', ...address,
    moved_in_at: open.length > 0 ? today : null, is_active: true, metadata,
    created_by: input.actorUserId, updated_by: input.actorUserId,
  }).select('id').single()
  if (error) throw error
  return { status: open.length > 0 ? 'replaced' : 'created', addressId: String((inserted as { id: string }).id) }
}
