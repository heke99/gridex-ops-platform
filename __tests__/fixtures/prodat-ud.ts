import type { Parts } from './prodat-register'

// Synthetic P26.A p79 NAD fixture, independent of runtime renderer.
export function ud(overrides: Record<number, string | readonly string[]> = {}): Parts {
  const parts: (string | readonly string[])[] = ['NAD', 'UD', ['00-CUSTOMER', '', '89'], '', ['Name', 'Second'], ['Street', '', 'Box'], 'Town', '', '001 23', 'SE']
  for (const [key, value] of Object.entries(overrides)) parts[Number(key)] = value
  return parts
}

// Independent synthetic selected source, never read from a rendered NAD.
export function udAddressFact(meteringPointId = 'A', companyId = 'synthetic-company', identityAgency: '9'|'89' = '89') {
  return selectedAddressFact(meteringPointId, companyId, identityAgency, '00-CUSTOMER', ['Street', '', 'Box'])
}
export function selectedAddressFact(meteringPointId:string, companyId:string, identityAgency:'9'|'89', userId:string, addressLines:readonly string[] = [], qualifier:''|'1'|'SE1'|'SE2' = ''): import('@/lib/ediel/prodat/prodatEndUserAddress').ProdatEndUserAddressObject {
  return {meteringPointId,identityAgency,endUser:{id:userId,qualifier,agency:qualifier?'260':'89'},
    availability:addressLines.some(Boolean)?'available':'unavailable',addressLines,
    source:{kind:'caller_selection',companyId,reference:'fixed synthetic test source'}}
}

// Fixed independent postal selections for existing synthetic fixtures. Equal
// selections permit omission; no rendered payload supplies these source facts.
export function selectedInvoiceeFact(meteringPointId:string,companyId:string,identityAgency:'9'|'89',userId:string,lines:readonly string[]=[],qualifier:''|'1'|'SE1'|'SE2'='',postalCode='',city='',country='SE'):import('@/lib/ediel/prodat/prodatInvoicee').ProdatInvoiceeObject {
  const address={lines:[lines[0]??'',lines[1]??'',lines[2]??''] as [string,string,string],postalCode,city,country,representation:{convention:'fixed synthetic positional postal tuple',reference:'independent test source',mode:1 as const}}
  const identity={id:userId,qualifier,agency:qualifier?'260' as const:'89' as const}
  return {meteringPointId,identityAgency,endUser:{identity,address},invoicee:{identity,nameLines:['Invoicee'],address,availability:lines.some(Boolean)?'available':'unavailable'},event:{state:'none',reference:'synthetic no invoice-address change'},source:{kind:'caller_selection',companyId,reference:'fixed synthetic invoicee selection'}}
}
export function udInvoiceeFact(meteringPointId='A',companyId='synthetic-company',identityAgency:'9'|'89'='89') {
  return selectedInvoiceeFact(meteringPointId,companyId,identityAgency,'00-CUSTOMER',['Street','','Box'],'','001 23','Town')
}
