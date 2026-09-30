import {beforeEach, describe, expect, it, vi} from 'vitest'
const state=vi.hoisted(()=>({customer:{} as Record<string,unknown>, envelope:null as Record<string,unknown>|null}))
vi.mock('@/lib/cis/db-shared',()=>({getCustomerExportContext:vi.fn(async()=>({customer:state.customer,site:{company_id:'COMPANY',facility_id:'735123456789012345',street:'Street',postal_code:'12345',city:'City',country:'SE',move_in_date:'2026-10-01'}})),requireContextCompanyId:()=> 'COMPANY'}))
vi.mock('@/lib/customer-operations/customerSiteProcessContext',()=>({resolveCustomerSiteProcessContext:async()=>({processType:'supplier_switch',requestedStartDate:'2026-10-01'}),resolveProdatCustomerProcessVariant:()=>({supported:true,z01Variant:'L',z01Reason:'Z22',expectedZ02Variant:'L'})}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=> 'E2SE6A')}))
vi.mock('@/lib/ediel/messages',()=>({buildEdifactEnvelope:vi.fn((input)=>{state.envelope=input;return {raw:'WIRE',interchangeReference:'I',payloadPreflight:{}}})}))
vi.mock('@/lib/ediel/references',()=>({computeOutboundAckDueAt:()=>null,deriveEdielAckDefaults:()=>({requiresContrl:true,requiresAperak:true,contrlStatus:'pending',aperakStatus:'pending',utiltsErrStatus:'not_required'})}))
import {buildCustomerMasterdataZ01Draft} from '@/lib/ediel/intent/renderers/customerMasterdataZ01'
import {buildFacilityLookupZ01Draft} from '@/lib/ediel/intent/renderers/facilityLookupZ01'
const input={actorUserId:'ACTOR',request:{id:'REQUEST',customer_id:'CUSTOMER',customer_site_id:'SITE',grid_owner_id:'DSO',grid_area_code:'NET',price_area:'SE3'},routeContext:{senderEdielId:'12345',receiverEdielId:'54321',environment:'test',applicationReference:'23-DDQ-PRODAT',route:{id:'ROUTE'}},outboundRequestId:'OUT',operationId:'OP',intentId:'INTENT',gridOwner:{owner_code:'NET'}} as unknown as Parameters<typeof buildFacilityLookupZ01Draft>[0]
beforeEach(()=>{state.customer={};state.envelope=null})
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
    const draft=await buildCustomerMasterdataZ01Draft({actorUserId:'ACTOR',routeContext:input.routeContext,
      dataRequest:{id:'REQUEST',company_id:'COMPANY',customer_id:'CUSTOMER',site_id:'SITE',metering_point_id:null,grid_owner_id:'DSO'},
      gridOwner:{owner_code:'NET'},externalReference:'DOC',transactionReference:'LI',messageVersion:'E2SE6A'})
    expect(state.envelope?.segments).toEqual(expect.arrayContaining([expect.stringContaining('NAD+UD+199001011234:SE2:260++Test Person+Street')]))
    const engine=draft.parsedPayload?.prodatEngine as Record<string,unknown>
    const evidence=engine.registerEvidence as {facts:{endUserAddressObjects:unknown[]}}
    expect(evidence.facts.endUserAddressObjects).toContainEqual(expect.objectContaining({meteringPointId:'735123456789012345',
      identityAgency:'9',endUser:{id:'199001011234',qualifier:'SE2',agency:'260'},addressLines:['Street'],
      source:{kind:'caller_selection',companyId:'COMPANY',reference:'customer-export-context:CUSTOMER/SITE'}}))
  })

})
