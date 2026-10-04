// masterplan: TEN-06
import {beforeEach,expect,it,vi} from 'vitest'
const shared=vi.hoisted(()=>({resolve:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('no outbound lookup expected')}}}))
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',async original=>({...await original<typeof import('@/lib/ediel/tenant/resolveInboundTenant')>(),resolveInboundTenantFromIdentifiers:shared.resolve}))
import {resolveTenantForInboundEdiel} from '@/lib/inbound-mail/inboundTenantResolver'
import type {ParsedEdifactEnvelope} from '@/lib/inbound-mail/edielEmailParser'
const tenantA='7300000000001',agent='7300000000009',tenantB='7300000000002'
function parsed(family:'PRODAT'|'UTILTS',nads:string,parties:Record<string,string[]>):ParsedEdifactEnvelope{
 return {rawPayload:`UNB+UNOC:3+${tenantA}:14+${agent}:14+261003:1200+REF'UNH+1+${family}:D:96B:UN:E2SE6A'BGM+Z04+DOC+9'${nads}UNT+3+1'UNZ+1+REF'`,messageFamily:family,messageCode:'Z04',messageFunctionCode:'9',acknowledgementRequestCode:null,interchangeReference:'REF',transactionReference:null,senderEdielId:tenantA,senderSubAddress:null,receiverEdielId:agent,receiverSubAddress:null,applicationReference:null,bgmReference:'DOC',messageTypeVersion:{syntaxIdentifier:null,directoryVersion:null,release:null,controllingAgency:null,associationAssignedCode:null},references:{},parties,dates:{},locations:{},quantities:[],errorCodes:[],freeText:[],segments:[],lineGroups:[]} as ParsedEdifactEnvelope}
beforeEach(()=>{shared.resolve.mockReset().mockResolvedValue({status:'unresolved',companyId:null,reasons:[],candidateCompanyIds:[],evidence:[],warnings:[]})})
it('never takes the sender NAD+MS as legal receiver when the receiver NAD is absent behind a shared transport agent',async()=>{
 await resolveTenantForInboundEdiel({environment:'test',parsed:parsed('PRODAT',`NAD+MS+${tenantA}::260'`,{MS:[tenantA]})})
 expect(shared.resolve).toHaveBeenCalledOnce()
 expect(shared.resolve.mock.calls[0][0].marketActorEdielId).not.toBe(tenantA)
})
it('uses only the family legal receiver qualifier: PRODAT DO and UTILTS MR',async()=>{
 await resolveTenantForInboundEdiel({environment:'test',parsed:parsed('PRODAT',`NAD+MS+${tenantA}::260'NAD+DO+${tenantB}::260'`,{MS:[tenantA],DO:[tenantB]})})
 await resolveTenantForInboundEdiel({environment:'test',parsed:parsed('UTILTS',`NAD+MS+${tenantA}::260'NAD+MR+${tenantB}::260'`,{MS:[tenantA],MR:[tenantB]})})
 expect(shared.resolve.mock.calls.map(call=>call[0].marketActorEdielId)).toEqual([tenantB,tenantB])
})
it('does not accept a DDQ or receiver qualifier from another family as legal receiver',async()=>{
 await resolveTenantForInboundEdiel({environment:'test',parsed:parsed('PRODAT',`NAD+MR+${tenantA}::260'`,{MR:[tenantA],DDQ:[tenantA]})})
 expect(shared.resolve.mock.calls[0][0].marketActorEdielId).not.toBe(tenantA)
})
