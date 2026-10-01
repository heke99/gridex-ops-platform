import {copyProdatEndUserAddressObjects,type ProdatEndUserAddressObject} from '@/lib/ediel/prodat/prodatEndUserAddress'
import type { CustomerLifeEventExportProjection } from '@/lib/ediel/production/customerLifeEventExport'
import type { SourceQualifiedCustomerMasterdataProjection } from '@/lib/ediel/production/customerMasterdataSource'
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

/** Preserve the end user's literal source components. Installation and billing
 * addresses describe other objects and cannot complete a missing NAD+UD value.
 * A future-only life-event projection has not changed the current customer. */
export function resolveSwedishProdatEndUserExport(input: {
  customer: CustomerIdentitySource
  customerLifeEvent?: CustomerLifeEventExportProjection | null
  customerMasterdata?: SourceQualifiedCustomerMasterdataProjection | null
}): {
  identity: SwedishProdatCustomerIdentity
  nameLines: string[] | undefined
  addressLines: string[]
  postalCode: string | null
  city: string | null
  country: string
  sourceContextId: string | null
} {
  const masterdata = input.customerMasterdata
  if (masterdata) {
    const nameLines = [...masterdata.endUserMasterdata.nameParts]
    return {
      identity: { id: sanitize(masterdata.customerIdentity.id), qualifier: masterdata.customerIdentity.qualifier, name: nameLines.join(' ').trim() },
      nameLines,
      addressLines: [...masterdata.endUserMasterdata.streetParts],
      postalCode: masterdata.endUserMasterdata.postalCode || null,
      city: masterdata.endUserMasterdata.city || null,
      country: sanitize(masterdata.endUserMasterdata.country),
      sourceContextId: masterdata.sourceContextId,
    }
  }
  const identity = resolveSwedishProdatCustomerIdentity(input.customer)
  const source = input.customerLifeEvent && input.customerLifeEvent.effectiveVersionCount > 0
    ? input.customerLifeEvent.endUserMasterdata : undefined
  const nameLines = source?.name?.map(sanitize)
  return {
    identity: { ...identity, name: nameLines ? nameLines.join(' ').trim() : identity.name },
    nameLines,
    addressLines: source ? (source.street ?? []).map(sanitize) : [],
    postalCode: source ? sanitize(source.postCode) || null : null,
    city: source ? sanitize(source.city) || null : null,
    // Empty is deliberate: the serializer must not manufacture a Swedish
    // country from the legal-id qualifier or the installation's country.
    country: source ? sanitize(source.country) : '',
    sourceContextId: null,
  }
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
