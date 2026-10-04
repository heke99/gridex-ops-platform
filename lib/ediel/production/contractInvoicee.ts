import {supabaseService} from '@/lib/supabase/service'
import {tenantDb} from '@/lib/supabase/tenantDb'
type ScopedSelect=ReturnType<ReturnType<typeof supabaseService.from>['select']>
import {invoiceeAddressesDiffer,type InvoiceeAddress,type ProdatInvoiceeObject} from '@/lib/ediel/prodat/prodatInvoicee'

type EndUser={identity:{id:string;qualifier:'SE1'|'SE2';agency:'260'};nameParts:readonly string[];streetParts:readonly string[];postalCode:string;city:string;country:string}
type ContractBilling={id:string;company_id:string;customer_id:string;invoice_recipient:string|null;billing_street:string|null;billing_postal_code:string|null;billing_city:string|null;billing_country:string|null;billing_address_same_as_site:boolean|null}
export type ContractInvoiceeContext={id:string;idCodeListQualifier:string;idAgency:'260';name:string;nameLines:string[];address:string;addressLines:string[];city:string;postalCode:string;country:string}

const CONVENTION='gridex-customer-contract-billing-lines-v1'
const clean=(value:string|null|undefined)=>typeof value==='string'?value.trim():''
const lines=(parts:readonly string[]):InvoiceeAddress['lines']=>[parts[0]??'',parts[1]??'',parts[2]??'']

/** P26.A pp23/82/109: IV is sent when the invoicee's address differs from the
 * end user's. The invoicee is the customer of the actual contract; its address
 * is the contract's own billing address, or the end user's when the contract
 * bills to the site or registers no separate address. */
export async function readContractInvoicee(input:{companyId:string;customerId:string;contractId:string;meteringPointId:string;identityAgency:'9'|'89';endUser:EndUser}):Promise<{fact:ProdatInvoiceeObject;invoicee:ContractInvoiceeContext|null}>{
 const{data,error}=await(tenantDb(input.companyId).from('customer_contracts')
  .select('id,company_id,customer_id,invoice_recipient,billing_street,billing_postal_code,billing_city,billing_country,billing_address_same_as_site') as ScopedSelect)
  .eq('id',input.contractId).returns<ContractBilling[]>().maybeSingle()
 if(error)throw error
 const contract=data as ContractBilling|null
 if(!contract||contract.company_id!==input.companyId||contract.customer_id!==input.customerId)throw Error('contract_invoicee_scope_mismatch')
 const reference=`customer_contract:${contract.id}`,representation={convention:CONVENTION,reference,mode:1 as const}
 const endUserAddress:InvoiceeAddress={lines:lines(input.endUser.streetParts),postalCode:input.endUser.postalCode,city:input.endUser.city,country:input.endUser.country,representation}
 const separate=contract.billing_address_same_as_site===false&&clean(contract.billing_street)!==''
 const invoiceeAddress:InvoiceeAddress=separate
  ?{lines:[clean(contract.billing_street),'',''],postalCode:clean(contract.billing_postal_code),city:clean(contract.billing_city),country:clean(contract.billing_country)||input.endUser.country,representation}
  :endUserAddress
 const nameLines=clean(contract.invoice_recipient)?[clean(contract.invoice_recipient).slice(0,35)]:[...input.endUser.nameParts].slice(0,2)
 const fact:ProdatInvoiceeObject={meteringPointId:input.meteringPointId,identityAgency:input.identityAgency,
  endUser:{identity:{...input.endUser.identity},address:endUserAddress},
  invoicee:{identity:{...input.endUser.identity},nameLines,address:invoiceeAddress,availability:'available'},
  event:{state:'none',reference},source:{kind:'caller_selection',companyId:input.companyId,reference}}
 const differs=invoiceeAddressesDiffer(endUserAddress,invoiceeAddress)===true
 const street=invoiceeAddress.lines.filter((line):line is string=>typeof line==='string'&&line!=='')
 return{fact,invoicee:differs?{id:input.endUser.identity.id,idCodeListQualifier:input.endUser.identity.qualifier,idAgency:'260',name:nameLines[0]??'',nameLines,
  address:street[0]??'',addressLines:street,city:String(invoiceeAddress.city??''),postalCode:String(invoiceeAddress.postalCode??''),country:String(invoiceeAddress.country??'')}:null}
}
