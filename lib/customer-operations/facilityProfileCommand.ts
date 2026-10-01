import 'server-only'
import { supabaseService } from '@/lib/supabase/service'
import { computeCustomerSiteAddressHash, normalizeSwedishPostalCode } from '@/lib/customer-sites/addressIntake'
import {
  customerProfileCommand, customerProfileSchemaError, executeCustomerProfileRpc,
  type CustomerProfileCommandInput, type CustomerProfileCommandResult,
} from './profilePreferencesCommand'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ') : null
}

/** Resolve only the customer's resource. The RPC locks and checks the current
 * actor, full customer/site relation and snapshot revision before any effect. */
export async function changeCustomerFacilityProfile(input: CustomerProfileCommandInput): Promise<CustomerProfileCommandResult> {
  const p_command = customerProfileCommand(input)
  const facility = record(input.payload.facility_data), patch = record(facility.address)
  const { data, error } = await supabaseService.from('customer_sites')
    .select('id,street,postal_code,city,country,care_of,apartment_number,address_revision')
    .eq('company_id', input.companyId).eq('customer_id', input.customerId)
    .eq('facility_reference', typeof facility.facility_reference === 'string' ? facility.facility_reference : '')
    .maybeSingle()
  if (error) { customerProfileSchemaError(error); throw error }
  let candidate: Record<string, unknown> | null = null
  if (data) {
    const current = data as Record<string, unknown>
    const field = (key: string) => text(key in patch ? patch[key] : current[key])
    const street = field('street'), city = field('city'), careOf = field('care_of'), apartmentNumber = field('apartment_number')
    const postalCode = normalizeSwedishPostalCode('postal_code' in patch ? patch.postal_code : current.postal_code)
    const country = (field('country') ?? 'SE').toUpperCase()
    const hash = computeCustomerSiteAddressHash({ street, city, postalCode, country, apartmentNumber })
    candidate = { siteId: current.id, snapshotRevision: current.address_revision,
      street, postal_code: postalCode, city, country, care_of: careOf, apartment_number: apartmentNumber,
      normalized: hash.normalized, address_hash: hash.hash, complete: hash.complete }
  }
  // A missing site still reaches the authorization/legacy-replay boundary.
  // Fresh commands receive the RPC's neutral404, never a foreign resource.
  return executeCustomerProfileRpc('gridex_change_customer_facility_profile_v1', { ...p_command, candidate })
}
