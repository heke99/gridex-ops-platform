// masterplan: TEN-05, AT-TEN-05, TEN-06, AT-TEN-06
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>,lookups:[] as string[],rpc:vi.fn(),identity:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:(table:string)=>{
 const filters:string[]=[]
 const q:Record<string,unknown>={select:()=>q,order:()=>q,in:()=>q,is:()=>q,or:()=>q,limit:()=>q,abortSignal:()=>q,maybeSingle:()=>q,
  eq:(column:string,value:unknown)=>{filters.push(`${column}=${value}`);return q},
  then:(resolve:(v:unknown)=>unknown)=>{io.lookups.push(`${table}?${filters.join('&')}`)
   const data=io.rows[table]??[];return Promise.resolve({data,count:data.length,error:null}).then(resolve)}}
 return q}}}))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity',async original=>({...await original<typeof import('@/lib/ediel/tenant/tenantEdielIdentity')>(),
 resolveCanonicalTenantEdielIdentityWithEvidence:io.identity}))
import {processActorRole} from '@/lib/ediel/core/marketRole'
import {canonicalProdatApplicationReferenceForProcessGroup} from '@/lib/ediel/rulebook/prodatApplicationReference'
import {validateProdatApplicationReference} from '@/lib/ediel/rulebook/prodatRulebook'
import {classifyProductionInboundDecision} from '@/lib/ediel/inbound/productionInboundDecisionEngine'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import {extractMarketActorEdielIdFromRawPayload,inboundLegalReceiverEdielId,resolveInboundTenantFromIdentifiers} from '@/lib/ediel/tenant/resolveInboundTenant'

const tenantA='7300000000001',tenantB='7300000000002',sender='7300000000005',customer='CUST-4711'
const companyA='00000000-0000-4000-8000-00000000000a',companyB='00000000-0000-4000-8000-00000000000b'
const edifact=(family:'PRODAT'|'UTILTS'|'APERAK',code:string,appRef:string,nads:string,unbReceiver=tenantA)=>
 `UNA:+.? 'UNB+UNOC:3+${sender}:14+${unbReceiver}:14+261003:1200+REF++${appRef}'UNH+1+${family}:D:96B:UN:E2SE6A'BGM+${code}+DOC+9'${nads}UNT+4+1'UNZ+1+REF'`

beforeEach(()=>{io.rows={};io.lookups=[];io.rpc.mockReset();io.identity.mockReset()})

describe('TEN-05 role is decided by the business process, not a global field',()=>{
 it('supplier processes use 23-DDQ-PRODAT and permission processes 23-DGI-PRODAT',()=>{
  for(const group of ['supplier_switch','customer_masterdata','delivery_contract','masterdata','metering'] as const)
   expect(canonicalProdatApplicationReferenceForProcessGroup(group)).toBe('23-DDQ-PRODAT')
  expect(canonicalProdatApplicationReferenceForProcessGroup('metering_access')).toBe('23-DGI-PRODAT')
 })
 it('the same actor acts as supplier under DDQ and as ESCO under DGI; unknown references give no role',()=>{
  expect(processActorRole('23-DDQ-PRODAT')).toBe('supplier')
  expect(processActorRole('23-DGI-PRODAT')).toBe('energy_service_company')
  for(const reference of [null,'','23-XYZ-PRODAT','27-DDQ-PRODAT','DDQ']) expect(processActorRole(reference)).toBeNull()
 })
 it('an inbound reference from the other process is refused for that message code',()=>{
  expect(validateProdatApplicationReference({messageCode:'Z14',applicationReference:'23-DGI-PRODAT'}).ok).toBe(true)
  const wrongPermission=validateProdatApplicationReference({messageCode:'Z14',applicationReference:'23-DDQ-PRODAT'})
  expect(wrongPermission).toMatchObject({ok:false,expectedApplicationReference:'23-DGI-PRODAT',ruleKeys:['APPREF_DGI_FOR_PERMISSION']})
  const wrongSupplier=validateProdatApplicationReference({messageCode:'Z04',applicationReference:'23-DGI-PRODAT'})
  expect(wrongSupplier).toMatchObject({ok:false,expectedApplicationReference:'23-DDQ-PRODAT',ruleKeys:['APPREF_DDQ_FOR_SUPPLIER']})
 })
 it('Z14 only yields permission effects and never a supply effect',()=>{
  const decision=classifyProductionInboundDecision({messageFamily:'PRODAT',messageCode:'Z14',actorRole:'energy_service_company',
   rawPayload:edifact('PRODAT','Z14','23-DGI-PRODAT',`NAD+DO+${tenantA}::260'NAD+MS+${sender}::260'`)} as never)
  expect(['activate_permission','reject_permission','none']).toContain(decision.businessEffect)
  expect(JSON.stringify(decision)).not.toMatch(/supply_activat|activate_supply|start_supply/)
 })
 it('Z04 never grants a general ESCO permission: no permission effect and the permission executor refuses it before any write',async()=>{
  const decision=classifyProductionInboundDecision({messageFamily:'PRODAT',messageCode:'Z04',actorRole:'supplier',
   rawPayload:edifact('PRODAT','Z04','23-DDQ-PRODAT',`NAD+DO+${tenantA}::260'NAD+MS+${sender}::260'`)} as never)
  expect(decision.businessEffect).not.toMatch(/permission/)
  expect(String(decision.scenario)).not.toMatch(/^prodat_permission/)
  await expect(applyPermissionMarketSource({actorUserId:'user',message:{id:'m',company_id:companyA,direction:'inbound',message_family:'PRODAT',message_code:'Z04'} as never}))
   .resolves.toMatchObject({applied:false,permissionId:null,reason:'not_inbound_permission_source'})
  expect(io.rpc).not.toHaveBeenCalled()
 })
})

const identity=(companyId:string,legal:string,roles=['energy_service_company'])=>({identity:{legalActorId:`legal-${companyId}`,legalEdielId:legal,
 transportActorId:`legal-${companyId}`,transportEdielId:legal,representedByTransportAgent:false,transportRelationId:null,roleCodes:roles},evidence:{}})
const valid={valid_from:'2026-01-01T00:00:00Z',valid_to:null}

describe('TEN-06 shared mailbox: legal receiver only from the family qualifier',()=>{
 it('PRODAT DO and UTILTS MR name the legal receiver; sender MS and customer NADs never do',()=>{
  expect(extractMarketActorEdielIdFromRawPayload(edifact('PRODAT','Z14','23-DGI-PRODAT',`NAD+MS+${sender}::260'NAD+DO+${tenantB}::260'NAD+UD+${customer}'`))).toBe(tenantB)
  expect(extractMarketActorEdielIdFromRawPayload(edifact('UTILTS','E31','23-DDQ-UTILTS',`NAD+MS+${sender}::260'NAD+MR+${tenantB}::260'`))).toBe(tenantB)
  expect(extractMarketActorEdielIdFromRawPayload(edifact('PRODAT','Z14','23-DGI-PRODAT',`NAD+MS+${sender}::260'NAD+MR+${tenantB}::260'`))).toBeNull()
 })
 it('a single verified legal identity resolves exactly that tenant and service context',async()=>{
  io.rows.tenant_actor_identifiers=[{company_id:companyB,identifier_value:tenantB,...valid}]
  io.identity.mockResolvedValue(identity(companyB,tenantB))
  const resolution=await resolveInboundTenantFromIdentifiers({environment:'test',messageFamily:'PRODAT',messageCode:'Z14',
   senderEdielId:sender,receiverEdielId:tenantB,marketActorEdielId:tenantB})
  expect(resolution).toMatchObject({status:'resolved',companyId:companyB,marketActorEdielId:tenantB})
  expect(io.lookups).toContain(`tenant_actor_identifiers?environment=test&identifier_type=EdielId&identifier_value=${tenantB}`)
 })
 it('two tenants claiming the legal receiver are held as ambiguous and no tenant is chosen',async()=>{
  io.rows.tenant_actor_identifiers=[{company_id:companyA,identifier_value:tenantB,...valid},{company_id:companyB,identifier_value:tenantB,...valid}]
  io.identity.mockImplementation(async({companyId}:{companyId:string})=>identity(companyId,tenantB))
  const resolution=await resolveInboundTenantFromIdentifiers({environment:'test',messageFamily:'PRODAT',messageCode:'Z14',
   senderEdielId:sender,receiverEdielId:tenantB,marketActorEdielId:tenantB})
  expect(resolution).toMatchObject({status:'ambiguous',companyId:null})
 })
 it('a PRODAT/UTILTS message without exactly one legal receiver NAD is never attributed to the UNB transport receiver',()=>{
  const missing=edifact('PRODAT','Z14','23-DGI-PRODAT',`NAD+MS+${sender}::260'`)
  const twoReceivers=edifact('UTILTS','E31','23-DDQ-UTILTS',`NAD+MR+${tenantA}::260'NAD+MR+${tenantB}::260'`)
  expect(inboundLegalReceiverEdielId(missing,tenantA)).toBeNull()
  expect(inboundLegalReceiverEdielId(twoReceivers,tenantA)).toBeNull()
  // Families without a legal receiver qualifier (APERAK/CONTRL) keep the UNB receiver.
  expect(inboundLegalReceiverEdielId(edifact('APERAK','312','',`NAD+MS+${sender}::260'`),tenantA)).toBe(tenantA)
 })
 it('the normalized UTILTS_ERR family (UNH UTILTS + BGM ERR) is held too, never attributed to the UNB receiver',async()=>{
  io.rows.tenant_actor_identifiers=[{company_id:companyA,identifier_value:tenantA,...valid}]
  io.identity.mockResolvedValue(identity(companyA,tenantA,['electricity_supplier','energy_service_company','grid_owner']))
  for(const nads of [`NAD+MS+${sender}::260'`,`NAD+MR+${tenantA}::260'NAD+MR+${tenantB}::260'`]){
   const raw=edifact('UTILTS','ERR','23-DDQ-UTILTS',nads)
   expect(inboundLegalReceiverEdielId(raw,tenantA)).toBeNull()
   const resolution=await resolveInboundTenantFromIdentifiers({environment:'test',messageFamily:'UTILTS_ERR',messageCode:'ERR',
    senderEdielId:sender,receiverEdielId:tenantA,marketActorEdielId:inboundLegalReceiverEdielId(raw,tenantA)})
   expect(resolution).toMatchObject({status:'unresolved',companyId:null,marketActorEdielId:null})
  }
  expect(io.identity).not.toHaveBeenCalled()
 })
 it('unclear attribution is held unresolved and the tenant is never guessed from the UNB receiver or a customer id',async()=>{
  io.rows.tenant_actor_identifiers=[{company_id:companyA,identifier_value:tenantA,...valid}]
  io.identity.mockResolvedValue(identity(companyA,tenantA))
  const resolution=await resolveInboundTenantFromIdentifiers({environment:'test',messageFamily:'PRODAT',messageCode:'Z14',
   senderEdielId:sender,receiverEdielId:tenantA,marketActorEdielId:null,referenceCandidates:[customer]} as never)
  expect(resolution).toMatchObject({status:'unresolved',companyId:null})
  expect(io.identity).not.toHaveBeenCalled()
  expect(io.lookups.join('\n')).not.toContain(customer)
 })
})
