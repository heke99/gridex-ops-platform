import {copyProdatEndUserAddressObjects,type ProdatEndUserAddressObject} from '@/lib/ediel/prodat/prodatEndUserAddress'
export type SwedishProdatEndUserQualifier = 'SE1' | 'SE2'

export type SwedishProdatCustomerIdentity = {
  id: string | null
  qualifier: SwedishProdatEndUserQualifier | null
  name: string
}

type CustomerIdentitySource = Record<string, unknown> | null | undefined

function sanitize(value: unknown): string {
  if(typeof value!=='string')return ''
  if(/[\x00-\x1f\x7f]/.test(value))throw new Error('prodat_customer_identity_field_invalid')
  return value.trim()
}

function field(customer: CustomerIdentitySource, key: string): string | null {
  const value = sanitize(customer?.[key])
  return value || null
}

/**
 * Resolve the Swedish legal end-user identity used by PRODAT.
 *
 * Ediel PRODAT defines SE1 as Swedish organisation number and SE2 as Swedish
 * personal identity number. The semantic source field therefore decides the
 * qualifier; identifier length must never be used to guess it. Internal
 * customer numbers are intentionally excluded from the legal identity.
 */
export function resolveSwedishProdatCustomerIdentity(
  customer: CustomerIdentitySource,
): SwedishProdatCustomerIdentity {
  const organisationNumber = field(customer, 'org_number')
  const personalNumber = field(customer, 'personal_number')

  const id = organisationNumber ?? personalNumber
  const qualifier: SwedishProdatEndUserQualifier | null = organisationNumber
    ? 'SE1'
    : personalNumber
      ? 'SE2'
      : null

  const firstName = field(customer, 'first_name')
  const lastName = field(customer, 'last_name')
  const composedName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const name =
    field(customer, 'company_name') ??
    field(customer, 'full_name') ??
    (composedName || null) ??
    ''

  return { id, qualifier, name }
}

/** A selected server export context is protocol input, not a market mandate.
 * Preserve its own customer/object/address and tenant through render/persist. */
export function prodatAddressFactsFromExportContext(input:{companyId:string;reference:string;meterPointId:string;identityAgency:'9'|'89';customer:SwedishProdatCustomerIdentity;addressLines:readonly string[]}):ProdatEndUserAddressObject[] {
  if(!input.customer.id||!input.customer.qualifier||!input.customer.name)throw new Error('prodat_verified_customer_identity_required')
  return copyProdatEndUserAddressObjects([{meteringPointId:input.meterPointId,identityAgency:input.identityAgency,
    endUser:{id:input.customer.id,qualifier:input.customer.qualifier,agency:'260'},
    availability:input.addressLines.some(Boolean)?'available':'unavailable',addressLines:[...input.addressLines],
    source:{kind:'caller_selection',companyId:input.companyId,reference:input.reference}}])
}
