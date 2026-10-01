// Declared protected native source port, genuine checked/opaque adapter, actual
// decoder and evidence reader. This is not authentic source or native acceptance.
import {beforeEach,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn());vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {prepareCustomerMasterdataSource,bindCustomerMasterdataValidationContext,type CustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import {createCustomerMasterdataAddressFacts,customerMasterdataSendIssue,bindCustomerMasterdataRenderingSource} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import {createProdatRegisterEvidence,readProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateRulebookMessage,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
const input={companyId:'owned-company',customerId:'owned-customer',actorUserId:'current-actor',environment:'test' as const,asOf:'2026-10-01T12:00:00Z'}
const values={status:'authorized',companyId:input.companyId,customerId:input.customerId,environment:'test',asOf:input.asOf,sourceKind:'registered_customer_address',sourceReference:'address-A',sourceDigest:'a'.repeat(64),sourceContextId:'00000000-0000-4000-8000-000000000001',customerIdentity:{id:'5566778899',qualifier:'SE1',agency:'260'},endUserMasterdata:{nameParts:['Name ','Second'],streetParts:['','Own + street:2 ',''],postalCode:'12345',city:'City ',country:'SE'}}
const raw="UNB+UNOC:3+A:14+B:14+261001:0000+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+D+9'LIN+1++735123456789012345:9'NAD+UD+5566778899:SE1:260++Name :Second+.:Own ?+ street?:2 :+City ++12345+SE'UNT+5+M'UNZ+1+I'"
const row={direction:'outbound',message_family:'PRODAT',message_code:'Z01',company_id:input.companyId,customer_id:input.customerId,environment:'test',raw_payload:raw,intent_id:'actual-intent',communication_route_id:'actual-route'}
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:structuredClone(values),error:null})})
async function setup(){const projection=await prepareCustomerMasterdataSource(input);const context=bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:input.companyId,customerId:input.customerId,environment:'test',rawPayload:raw,intentId:row.intent_id,routeId:row.communication_route_id,projection});return {projection,context}}
it('preserves literal component positions and only the prescribed missing-first wire dot',async()=>{
 const {projection,context}=await setup();expect(customerMasterdataSendIssue(row,context)).toBeNull()
 const objects=createCustomerMasterdataAddressFacts({projection,meteringPointId:'735123456789012345',identityAgency:'9'}),tokens=tokenizeEdifact(raw)
 const registerEvidence=createProdatRegisterEvidence({code:'Z01',rawSegments:tokens.segments.map(s=>s.raw),una:tokens.una,facts:{endUserAddressObjects:objects}})
 expect(readProdatRegisterEvidence({code:'Z01',rawSegments:tokens.segments.map(s=>s.raw),una:tokens.una,companyId:input.companyId,customerMasterdataContext:context,parsedPayload:{prodatEngine:{registerEvidence}}})?.endUserAddressObjects?.[0].addressLines).toEqual(['','Own + street:2 ',''])
})
it.each(['company_id','customer_id','environment','intent_id','communication_route_id'] as const)('holds a changed actual %s before live send',async field=>{const {context}=await setup();expect(customerMasterdataSendIssue({...row,[field]:'different'},context)?.blocking).toBe(true)})
it('cannot promote copied protected results or JSON metadata into source authority',async()=>{
 const {projection,context}=await setup();expect(()=>createCustomerMasterdataAddressFacts({projection:structuredClone(projection),meteringPointId:'735123456789012345',identityAgency:'9'})).toThrow('source_unqualified')
 expect(customerMasterdataSendIssue(row,{...context} as CustomerMasterdataValidationContext)?.blocking).toBe(true)
 const tokens=tokenizeEdifact(raw),objects=createCustomerMasterdataAddressFacts({projection,meteringPointId:'735123456789012345',identityAgency:'9'})
 const registerEvidence=createProdatRegisterEvidence({code:'Z01',rawSegments:tokens.segments.map(s=>s.raw),facts:{endUserAddressObjects:objects}})
 expect(()=>readProdatRegisterEvidence({code:'Z01',rawSegments:tokens.segments.map(s=>s.raw),companyId:input.companyId,parsedPayload:{prodatEngine:{registerEvidence}}})).toThrow('source_unqualified')
})
it('holds changed rendered text even with matching RAW metadata and a genuine selection',async()=>{const {context}=await setup();const altered=raw.replace('Name :Second','Name:Second');const next=bindCustomerMasterdataValidationContext({...context,rawPayload:altered});expect(customerMasterdataSendIssue({...row,raw_payload:altered},next)?.blocking).toBe(true)})
it('never treats a formatting dot alone as an available registered source',async()=>{rpc.mockResolvedValue({data:{...values,endUserMasterdata:{...values.endUserMasterdata,streetParts:['.']}},error:null});await expect(prepareCustomerMasterdataSource(input)).rejects.toThrow('source_result_invalid')})
it('binds every validator and preflight to actual input bytes despite a contradictory source row',async()=>{
 const {context}=await setup(),altered=raw.replace('Name :Second','Name:Second')
 const request={family:'PRODAT',code:'Z01',rawPayload:altered,mode:'send' as const,direction:'outbound' as const,environment:'test' as const,companyId:input.companyId,customerMasterdataContext:context,customerMasterdataRow:row}
 for(const result of [validateRulebookMessage(request),await validateRulebookMessageWithRegistry(request)])expect(result.issues.some(issue=>issue.code==='PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')).toBe(true)
 const result=preflightEdielPayload({rawPayload:altered,messageStandard:'edifact',mode:'send',companyId:input.companyId,dateEventRow:row,customerMasterdataContext:context,customerMasterdataRow:row})
 expect(result.blocking).toBe(true);expect(result.issues.some(issue=>issue.code.includes('CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED'))).toBe(true)
})
it('lets genuine rendering source reach the same field authority and never the live send context',async()=>{
 const {projection}=await setup(),renderingSource=bindCustomerMasterdataRenderingSource({projection,companyId:input.companyId,environment:'test',rawPayload:raw})
 expect(renderingSource.authorizesPersistence).toBe(false);expect(renderingSource.authorizesTransport).toBe(false)
 const request={family:'PRODAT',code:'Z01',rawPayload:raw,mode:'send' as const,direction:'outbound' as const,environment:'test' as const,companyId:input.companyId,customerMasterdataRenderingSource:renderingSource}
 expect(validateRulebookMessage({...request,validationPurpose:'render'}).issues.some(issue=>issue.code==='PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')).toBe(false)
 for(const purpose of [undefined,'send','outbound_original'] as const)expect(validateRulebookMessage({...request,validationPurpose:purpose}).issues.some(issue=>issue.code==='PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')).toBe(true)
 expect(validateRulebookMessage({...request,validationPurpose:'render',customerMasterdataRenderingSource:{...renderingSource}}).issues.some(issue=>issue.code==='PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')).toBe(true)
 expect(customerMasterdataSendIssue(row,renderingSource as unknown as CustomerMasterdataValidationContext)?.blocking).toBe(true)
})
it.each(['customer_id','intent_id','communication_route_id'] as const)('prioritizes actual message %s over a detached matching source row',async field=>{
 const {context}=await setup()
 const request={family:'PRODAT',code:'Z01',rawPayload:raw,mode:'send' as const,direction:'outbound' as const,environment:'test' as const,companyId:input.companyId,customerMasterdataContext:context,customerMasterdataRow:row,messageRow:{...row,created_at:input.asOf,message_received_at:input.asOf,[field]:'foreign'}}
 for(const result of [validateRulebookMessage(request),await validateRulebookMessageWithRegistry(request)])expect(result.issues.some(issue=>issue.code==='PRODAT_CUSTOMER_MASTERDATA_SOURCE_UNQUALIFIED')).toBe(true)
})
