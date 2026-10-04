import {beforeEach, describe, expect, it, vi} from 'vitest'
const state=vi.hoisted(()=>({customer:{} as Record<string,unknown>, customerLifeEvent:null as Record<string,unknown>|null, customerMasterdata:null as Record<string,unknown>|null, envelope:null as Record<string,unknown>|null,sourceRpc:vi.fn(),receiverSource:vi.fn(),realEnvelope:false}))
vi.mock('@/lib/actor-registry/registryMarketSource',()=>({requireRegistryDispatchSource:state.receiverSource}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:state.sourceRpc}}))
vi.mock('@/lib/cis/db-shared',()=>({getCustomerExportContext:vi.fn(async()=>({customer:state.customer,customerLifeEvent:state.customerLifeEvent,customerMasterdata:state.customerMasterdata,site:{company_id:'COMPANY',facility_id:'735123456789012345',street:'Installation Street',postal_code:'99999',city:'Installation City',country:'SE',move_in_date:'2026-10-01'}})),requireContextCompanyId:()=> 'COMPANY'}))
vi.mock('@/lib/customer-operations/customerSiteProcessContext',()=>({resolveCustomerSiteProcessContext:async()=>({processType:'supplier_switch',requestedStartDate:'2026-10-01'}),resolveProdatCustomerProcessVariant:()=>({supported:true,z01Variant:'L',z01Reason:'Z22',expectedZ02Variant:'L'})}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> 'E2SE6A')}))
vi.mock('@/lib/ediel/messages',async(importActual)=>{const actual=await importActual<typeof import('@/lib/ediel/messages')>();return {buildEdifactEnvelope:vi.fn((input)=>{state.envelope=input;return state.realEnvelope?actual.buildEdifactEnvelope(input):{raw:'WIRE',interchangeReference:'I',payloadPreflight:{}}})}})
vi.mock('@/lib/ediel/references',async(importActual)=>({...await importActual<typeof import('@/lib/ediel/references')>(),computeOutboundAckDueAt:()=>null,deriveEdielAckDefaults:()=>({requiresContrl:true,requiresAperak:true,contrlStatus:'pending',aperakStatus:'pending',utiltsErrStatus:'not_required'})}))
import {buildCustomerMasterdataZ01Draft} from '@/lib/ediel/intent/renderers/customerMasterdataZ01'
import {buildFacilityLookupZ01Draft} from '@/lib/ediel/intent/renderers/facilityLookupZ01'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prepareCustomerMasterdataSource,bindCustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import {customerMasterdataSendIssue} from '@/lib/ediel/prodat/customerMasterdataAuthority'
import {getCustomerExportContext} from '@/lib/cis/db-shared'
const input={wireReferences:{documentReference:'DOC',transactionReference:'LI',interchangeReference:'12345678901234',messageReference:'1'},companyId:'COMPANY',actorUserId:'ACTOR',request:{id:'REQUEST',customer_id:'CUSTOMER',customer_site_id:'SITE',grid_owner_id:'DSO',grid_area_code:'NET',price_area:'SE3'},routeContext:{companyId:'COMPANY',actor:{senderEdielId:'12345',legalActorEdielId:'12345',tenantIdentity:{companyId:'COMPANY',environment:'test',legalEdielId:'12345',transportEdielId:'12345'}},senderEdielId:'12345',receiverEdielId:'54321',environment:'test',applicationReference:'23-DDQ-PRODAT',routeRuntime:{route_profile_id:'PROFILE'},route:{id:'ROUTE'}},outboundRequestId:'OUT',operationId:'OP',intentId:'INTENT',gridOwner:{owner_code:'NET'}} as unknown as Parameters<typeof buildFacilityLookupZ01Draft>[0]
async function qualifiedMasterdata(data:Record<string,unknown>){
 const projection={status:'authorized',companyId:'COMPANY',customerId:'CUSTOMER',environment:'test',asOf:'2026-10-01T00:00:00Z',sourceKind:'registered_customer_address',sourceReference:'registered-source',sourceDigest:'d'.repeat(64),sourceContextId:'00000000-0000-4000-8000-000000000111',...data}
 state.sourceRpc.mockResolvedValueOnce({data:projection,error:null})
 return prepareCustomerMasterdataSource({companyId:'COMPANY',customerId:'CUSTOMER',actorUserId:'ACTOR',environment:'test',asOf:projection.asOf})
}
const masterdataInput={wireReferences:input.wireReferences,actorUserId:'ACTOR',routeContext:input.routeContext,
  dataRequest:{id:'REQUEST',company_id:'COMPANY',customer_id:'CUSTOMER',site_id:'SITE',metering_point_id:null,grid_owner_id:'DSO'},
  gridOwner:{owner_code:'NET'},externalReference:'DOC',transactionReference:'LI',messageVersion:'E2SE6A'}
beforeEach(()=>{vi.clearAllMocks();state.customer={};state.envelope=null;state.customerMasterdata=null;state.realEnvelope=false;state.receiverSource.mockImplementation(async scope=>({companyId:'COMPANY',communicationRouteId:'ROUTE',routeProfileId:'PROFILE',selectedApplicationReference:scope.applicationReference,market:'EL',legalEdielId:'54321',countryCode:'SE',wire:{interchangePartyId:'54321',subaddress:null,family:'PRODAT',environment:'test'}}));state.customerLifeEvent={effectiveVersionCount:1,endUserMasterdata:{street:['Street'],postCode:'12345',city:'City',country:'FI'}}})
describe('facility lookup uses the shared source-owned customer identity',()=>{
  it.each([{customer_number:'INTERNAL',full_name:'Name'},{personal_number:'199001011234',customer_number:'INTERNAL'}])('blocks incomplete legal identity before constructing a draft',async customer=>{
    state.customer=customer
    await expect(buildFacilityLookupZ01Draft(input)).rejects.toThrow('facility_lookup_verified_customer_identity_required')
    expect(state.envelope).toBeNull()
  })
  it('renders explicit organisation identity as SE1/260 even when a personal number also exists',async()=>{
    state.customer={org_number:'5566778899',personal_number:'199001011234',company_name:"Legal A+B's AB"}
    await buildFacilityLookupZ01Draft(input)
    expect(state.envelope?.segments).toEqual(expect.arrayContaining([expect.stringContaining("NAD+UD+5566778899:SE1:260++Legal A?+B?'s AB")]))
    expect(state.envelope?.segments).not.toEqual(expect.arrayContaining([expect.stringContaining('199001011234')]))
  })
  it('ordinary Z01 projects source-owned address facts from the same server customer/object context',async()=>{
    state.customer={personal_number:'199001011234',full_name:'Test Person'}
    const draft=await buildCustomerMasterdataZ01Draft(masterdataInput)
    expect(state.envelope?.segments).toEqual(expect.arrayContaining([expect.stringContaining('NAD+UD+199001011234:SE2:260++Test Person+Street')]))
    const engine=draft.parsedPayload?.prodatEngine as Record<string,unknown>
    const evidence=engine.registerEvidence as {facts:{endUserAddressObjects:unknown[]}}
    expect(evidence.facts.endUserAddressObjects).toContainEqual(expect.objectContaining({meteringPointId:'735123456789012345',
      identityAgency:'9',endUser:{id:'199001011234',qualifier:'SE2',agency:'260'},addressLines:['Street'],
      source:{kind:'caller_selection',companyId:'COMPANY',reference:'customer-export-context:CUSTOMER/SITE'}}))
  })

  it.each(['facility','masterdata'] as const)('preserves both own 35-character name components and all own address positions through %s Z01',async kind=>{
    const name=['A'.repeat(35),'B'.repeat(35)]
    state.customer={personal_number:'199001011234',full_name:name.join(' ')}
    state.customerLifeEvent={effectiveVersionCount:1,endUserMasterdata:{name,street:['End User Street','','Box 12'],postCode:'00123',city:'End User City',country:'FI'}}
    if(kind==='facility')await buildFacilityLookupZ01Draft(input)
    else await buildCustomerMasterdataZ01Draft(masterdataInput)
    const ud=(state.envelope?.segments as string[]).find(segment=>segment.startsWith('NAD+UD'))
    expect(ud).toBe(`NAD+UD+199001011234:SE2:260++${name.join(':')}+End User Street::Box 12+End User City++00123+FI`)
    expect(ud).not.toContain('Installation')
    expect(getCustomerExportContext).toHaveBeenCalledWith(expect.objectContaining({companyId:'COMPANY',actorUserId:'ACTOR'}))
  })

  it.each(['facility','masterdata'] as const)('holds missing protected UD values without copying installation facts through %s Z01',async kind=>{
    state.customer={personal_number:'199001011234',full_name:'Test Person'}
    state.customerLifeEvent={effectiveVersionCount:1,endUserMasterdata:{name:['Test Person']}}
    const result=kind==='facility'?buildFacilityLookupZ01Draft(input):buildCustomerMasterdataZ01Draft(masterdataInput)
    await expect(result).rejects.toThrow('prodat_render_blocked:Z01')
    expect(state.envelope).toBeNull()
  })

  it.each(['facility','masterdata'] as const)('preserves literal qualified UD component bytes through %s Z01',async kind=>{
    const name=[' '+ 'A'.repeat(33)+' '," Actual A+B's Name "]
    const street=[' Selected Street ',' Second '+': Street ',' Last Street ']
    state.customer={personal_number:'199001011234',full_name:'TODAY'}
    state.customerMasterdata=await qualifiedMasterdata({customerIdentity:{id:'198001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:name,streetParts:street,postalCode:' 12345 ',city:' Selected City ',country:'FI'}})
    if(kind==='facility')await buildFacilityLookupZ01Draft(input)
    else await buildCustomerMasterdataZ01Draft(masterdataInput)
    const raw=(state.envelope?.segments as string[]).find(segment=>segment.startsWith('NAD+UD'))!
    const token=tokenizeEdifact(raw+"'").segments[0]
    expect(segmentComposite(token,4)).toEqual(name)
    expect(segmentComposite(token,5)).toEqual(street)
    expect(segmentComposite(token,6)).toEqual([' Selected City '])
    expect(segmentComposite(token,8)).toEqual([' 12345 '])
    const actualRaw="UNH+1+PRODAT:D:97A:UN:E2SE6A'"+(state.envelope?.segments as string[]).join("'")+"'"
    const projection=await qualifiedMasterdata({customerIdentity:{id:'198001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:name,streetParts:street,postalCode:' 12345 ',city:' Selected City ',country:'FI'}})
    const context=bindCustomerMasterdataValidationContext({kind:'customer_masterdata',companyId:'COMPANY',customerId:'CUSTOMER',environment:'test',rawPayload:actualRaw,intentId:'INTENT',routeId:'ROUTE',projection})
    const row={direction:'outbound',message_family:'PRODAT',message_code:'Z01',company_id:'COMPANY',customer_id:'CUSTOMER',environment:'test',raw_payload:actualRaw,intent_id:'INTENT',communication_route_id:'ROUTE'}
    expect(customerMasterdataSendIssue(row,context)).toBeNull()
    await expect(qualifiedMasterdata({customerIdentity:{id:'198001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:['A'.repeat(36)],streetParts:street,postalCode:'12345',city:'City',country:'FI'}})).rejects.toThrow('customer_masterdata_source_result_invalid')
  })
  it.each(['facility','masterdata'] as const)('carries own source facts through the actual encoded envelope and preflight for %s Z01',async kind=>{
    state.realEnvelope=true
    state.customer={personal_number:'199001011234',full_name:'TODAY'}
    state.customerMasterdata=await qualifiedMasterdata({customerIdentity:{id:'198001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:[' Actual name ','Second'],streetParts:['','Own Street ',''],postalCode:'12345',city:' City ',country:'FI'}})
    const draft=kind==='facility'?(await buildFacilityLookupZ01Draft(input)).draft:await buildCustomerMasterdataZ01Draft(masterdataInput)
    expect(draft.rawPayload).toContain('++ Actual name :Second+.:Own Street :+ City ++12345+FI')
    expect(draft.validationReport?.payloadPreflight).toMatchObject({blocking:false})
    expect(state.envelope?.customerMasterdataProjection).toBe(state.customerMasterdata)
  })

  it.each(['facility','masterdata'] as const)('renders the exact persisted Z01 namespaces without reallocating or shortening %s references',async kind=>{
    state.realEnvelope=true
    state.customerMasterdata=await qualifiedMasterdata({customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:['Test Person'],streetParts:['Street'],postalCode:'12345',city:'City',country:'FI'}})
    const wireReferences={documentReference:'D'.repeat(34)+'+',transactionReference:'L'.repeat(33)+"?'",interchangeReference:'12345678901234',messageReference:'1'}
    for(let attempt=0;attempt<2;attempt++){
      const draft=kind==='facility'?(await buildFacilityLookupZ01Draft({...input,wireReferences})).draft:await buildCustomerMasterdataZ01Draft({...masterdataInput,externalReference:'CALLER-STALE',transactionReference:'CALLER-STALE',wireReferences})
      const segments=tokenizeEdifact(draft.rawPayload!).segments
      expect(segmentComposite(segments.find(s=>s.tag==='UNB')!,5)).toEqual([wireReferences.interchangeReference])
      expect(segmentComposite(segments.find(s=>s.tag==='UNH')!,1)).toEqual([wireReferences.messageReference])
      expect(segmentComposite(segments.find(s=>s.tag==='UNT')!,2)).toEqual([wireReferences.messageReference])
      expect(segmentComposite(segments.find(s=>s.tag==='BGM')!,2)).toEqual([wireReferences.documentReference])
      expect(segmentComposite(segments.find(s=>s.tag==='RFF'&&segmentComposite(s,1)[0]==='LI')!,1)).toEqual(['LI',wireReferences.transactionReference])
      expect(draft.externalReference).toBe(wireReferences.documentReference)
      expect(draft.transactionReference).toBe(wireReferences.transactionReference)
    }
  })

  it.each(['facility','masterdata'] as const)('uses the same registered dated UD and passes its private selector through %s Z01',async kind=>{
    state.customer={org_number:'MUTABLE',company_name:'Mutable name'}
    state.customerLifeEvent=null
    state.customerMasterdata=await qualifiedMasterdata({customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},
      endUserMasterdata:{nameParts:['Source','Own name'],streetParts:['Own street','Box 12'],postalCode:'00123',city:'Own city',country:'FI'}})
    const draft=kind==='facility'?(await buildFacilityLookupZ01Draft(input)).draft:await buildCustomerMasterdataZ01Draft(masterdataInput)
    const ud=(state.envelope?.segments as string[]).find(segment=>segment.startsWith('NAD+UD'))
    expect(ud).toBe('NAD+UD+199001011234:SE2:260++Source:Own name+Own street:Box 12+Own city++00123+FI')
    expect(draft.parsedPayload?.customerMasterdataSourceContextId).toBe('00000000-0000-4000-8000-000000000111')
    expect(getCustomerExportContext).toHaveBeenCalledWith(expect.objectContaining({companyId:'COMPANY',actorUserId:'ACTOR',environment:'test'}))
  })

  it.each(['facility','masterdata'] as const)('keeps juridical supplier separate from a represented UNB sender through %s Z01',async kind=>{
    state.customer={personal_number:'199001011234',full_name:'Test Person'}
    state.realEnvelope=true
    state.customerMasterdata=await qualifiedMasterdata({customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:['Test Person'],streetParts:['Street'],postalCode:'12345',city:'City',country:'FI'}})
    const route={...input.routeContext,actor:{...input.routeContext.actor,senderEdielId:'77777',legalActorEdielId:'12345',tenantIdentity:{...input.routeContext.actor.tenantIdentity!,companyId:'COMPANY',environment:'test' as const,legalEdielId:'12345',transportEdielId:'77777'}},senderEdielId:'77777'}
    const draft=kind==='facility'?(await buildFacilityLookupZ01Draft({...input,routeContext:route})).draft:await buildCustomerMasterdataZ01Draft({...masterdataInput,routeContext:route})
    const unb=tokenizeEdifact(draft.rawPayload!).segments.find(x=>x.tag==='UNB')!
    expect(segmentComposite(unb,2)[0]).toBe('77777')
    expect(state.envelope?.senderEdielId).toBe('77777')
    expect(state.envelope?.segments).toEqual(expect.arrayContaining([expect.stringContaining('NAD+FR+12345:160:SVK')]))
    expect(state.envelope?.segments).not.toEqual(expect.arrayContaining([expect.stringContaining('NAD+FR+77777:160:SVK')]))
  })
  it.each(['facility','masterdata'] as const)('uses the qualified original legal receiver independently of its transport endpoint through %s Z01',async kind=>{
    state.realEnvelope=true
    state.customerMasterdata=await qualifiedMasterdata({customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:['Test Person'],streetParts:['Street'],postalCode:'12345',city:'City',country:'FI'}})
    state.receiverSource.mockResolvedValue({companyId:'COMPANY',communicationRouteId:'ROUTE',routeProfileId:'PROFILE',selectedApplicationReference:'23-DDQ-PRODAT',market:'EL',legalEdielId:'54321',countryCode:'DK',wire:{interchangePartyId:'88888',subaddress:null,family:'PRODAT',environment:'test'}})
    const route={...input.routeContext,receiverEdielId:'88888'}
    const draft=kind==='facility'?(await buildFacilityLookupZ01Draft({...input,routeContext:route})).draft:await buildCustomerMasterdataZ01Draft({...masterdataInput,routeContext:route})
    const wire=tokenizeEdifact(draft.rawPayload!),unb=wire.segments.find(s=>s.tag==='UNB')!,legal=wire.segments.find(s=>s.tag==='NAD'&&segmentComposite(s,1)[0]==='DO')!
    expect(segmentComposite(unb,3)[0]).toBe('88888');expect(segmentComposite(legal,2)).toEqual(['54321','160','SVK']);expect(segmentComposite(legal,9)).toEqual(['DK'])
    expect(state.receiverSource).toHaveBeenCalledWith({companyId:'COMPANY',communicationRouteId:'ROUTE',routeProfileId:'PROFILE',environment:'test',messageFamily:'PRODAT',applicationReference:'23-DDQ-PRODAT'})
  })
  it.each(['facility','masterdata'] as const)('holds missing or different source receiver instead of guessing NADDO from UNB through %s Z01',async kind=>{
    state.customer={personal_number:'199001011234',full_name:'Test Person'}
    state.receiverSource.mockRejectedValue(new Error('ediel_registry_current_el_dispatch_source_required'))
    await expect(kind==='facility'?buildFacilityLookupZ01Draft(input):buildCustomerMasterdataZ01Draft(masterdataInput)).rejects.toThrow('ediel_registry_current_el_dispatch_source_required')
    expect(state.envelope).toBeNull()
    state.receiverSource.mockResolvedValue({companyId:'FOREIGN',communicationRouteId:'ROUTE',routeProfileId:'PROFILE',selectedApplicationReference:'23-DDQ-PRODAT',market:'EL',legalEdielId:'54321',countryCode:'SE',wire:{interchangePartyId:'54321',subaddress:null,family:'PRODAT',environment:'test'}})
    await expect(kind==='facility'?buildFacilityLookupZ01Draft(input):buildCustomerMasterdataZ01Draft(masterdataInput)).rejects.toThrow('z01_verified_legal_receiver_required')
    expect(state.envelope).toBeNull()
  })

  it.each(['facility','masterdata'] as const)('holds absent or inconsistent legal sender without transport fallback through %s Z01',async kind=>{
    state.customer={personal_number:'199001011234',full_name:'Test Person'}
    for(const actor of [{...input.routeContext.actor,legalActorEdielId:''},{...input.routeContext.actor,tenantIdentity:null},{...input.routeContext.actor,tenantIdentity:{...input.routeContext.actor.tenantIdentity!,companyId:'FOREIGN'}}]){
      const route={...input.routeContext,actor}
      await expect(kind==='facility'?buildFacilityLookupZ01Draft({...input,routeContext:route}):buildCustomerMasterdataZ01Draft({...masterdataInput,routeContext:route})).rejects.toThrow('z01_verified_legal_sender_required')
    }
    expect(state.envelope).toBeNull()
  })

  it('requires the known request tenant before querying any customer data',async()=>{
    await expect(buildCustomerMasterdataZ01Draft({...masterdataInput,dataRequest:{...masterdataInput.dataRequest,company_id:null}})).rejects.toThrow('z01_customer_masterdata_company_required')
    await expect(buildFacilityLookupZ01Draft({...input,companyId:''})).rejects.toThrow('facility_lookup_company_required')
    expect(getCustomerExportContext).not.toHaveBeenCalled()
  })

})
