import {beforeEach, describe, expect, it, vi} from 'vitest'
const state=vi.hoisted(()=>({customer:{} as Record<string,unknown>, customerLifeEvent:null as Record<string,unknown>|null, envelope:null as Record<string,unknown>|null}))
vi.mock('@/lib/cis/db-shared',()=>({getCustomerExportContext:vi.fn(async()=>({customer:state.customer,customerLifeEvent:state.customerLifeEvent,site:{company_id:'COMPANY',facility_id:'735123456789012345',street:'Installation Street',postal_code:'99999',city:'Installation City',country:'SE',move_in_date:'2026-10-01'}})),requireContextCompanyId:()=> 'COMPANY'}))
vi.mock('@/lib/customer-operations/customerSiteProcessContext',()=>({resolveCustomerSiteProcessContext:async()=>({processType:'supplier_switch',requestedStartDate:'2026-10-01'}),resolveProdatCustomerProcessVariant:()=>({supported:true,z01Variant:'L',z01Reason:'Z22',expectedZ02Variant:'L'})}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> 'E2SE6A')}))
vi.mock('@/lib/ediel/messages',()=>({buildEdifactEnvelope:vi.fn((input)=>{state.envelope=input;return {raw:'WIRE',interchangeReference:'I',payloadPreflight:{}}})}))
vi.mock('@/lib/ediel/references',()=>({computeOutboundAckDueAt:()=>null,deriveEdielAckDefaults:()=>({requiresContrl:true,requiresAperak:true,contrlStatus:'pending',aperakStatus:'pending',utiltsErrStatus:'not_required'})}))
import {buildCustomerMasterdataZ01Draft} from '@/lib/ediel/intent/renderers/customerMasterdataZ01'
import {buildFacilityLookupZ01Draft} from '@/lib/ediel/intent/renderers/facilityLookupZ01'
import {getCustomerExportContext} from '@/lib/cis/db-shared'
const input={companyId:'COMPANY',actorUserId:'ACTOR',request:{id:'REQUEST',customer_id:'CUSTOMER',customer_site_id:'SITE',grid_owner_id:'DSO',grid_area_code:'NET',price_area:'SE3'},routeContext:{senderEdielId:'12345',receiverEdielId:'54321',environment:'test',applicationReference:'23-DDQ-PRODAT',route:{id:'ROUTE'}},outboundRequestId:'OUT',operationId:'OP',intentId:'INTENT',gridOwner:{owner_code:'NET'}} as unknown as Parameters<typeof buildFacilityLookupZ01Draft>[0]
const masterdataInput={actorUserId:'ACTOR',routeContext:input.routeContext,
  dataRequest:{id:'REQUEST',company_id:'COMPANY',customer_id:'CUSTOMER',site_id:'SITE',metering_point_id:null,grid_owner_id:'DSO'},
  gridOwner:{owner_code:'NET'},externalReference:'DOC',transactionReference:'LI',messageVersion:'E2SE6A'}
beforeEach(()=>{vi.clearAllMocks();state.customer={};state.envelope=null;state.customerLifeEvent={effectiveVersionCount:1,endUserMasterdata:{street:['Street'],postCode:'12345',city:'City',country:'FI'}}})
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

  it('requires the known request tenant before querying any customer data',async()=>{
    await expect(buildCustomerMasterdataZ01Draft({...masterdataInput,dataRequest:{...masterdataInput.dataRequest,company_id:null}})).rejects.toThrow('z01_customer_masterdata_company_required')
    await expect(buildFacilityLookupZ01Draft({...input,companyId:''})).rejects.toThrow('facility_lookup_company_required')
    expect(getCustomerExportContext).not.toHaveBeenCalled()
  })

})
