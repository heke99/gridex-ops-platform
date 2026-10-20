import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),db:vi.fn(),ids:vi.fn(),contextCompany:'own',permissions:['communication.read']}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:io.db}))
vi.mock('@/lib/admin/guards',()=>({requireAdminPageAccess:async()=>({userId:'current-actor',companyId:io.contextCompany,permissions:io.permissions,email:'fixture@example.invalid'})}))
vi.mock('@/lib/tenant/scope',()=>({getOperationalCompanyScope:async()=>({companyId:'own',memberships:[{companyId:'own',status:'active',companyStatus:'active'}]})}))
vi.mock('@/components/admin/AdminHeader',()=>({default:({title}:{title:string})=>React.createElement('header',null,title)}))
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('not_found')}}))
import {reportingObligationContext} from '@/lib/ediel/operations/reportingObligationContext'
import {deriveEdielMeteringMethodProcessNextAction,deriveEdielProcessNextAction,readEdielProcessNextActions} from '@/lib/ediel/operations/processNextAction'
import Page from '@/app/admin/ediel/process-watches/page'

const id='10203040-1111-4111-8111-102030405060'
function sourceInput(code:'Z09'|'Z13'='Z09'):Parameters<typeof deriveEdielProcessNextAction>[0]{
  return {companyId:'own',evaluatedAt:'2026-10-02T12:00:00Z',access:{canRead:true,canReview:false,canPrepare:false},
    message:{id,company_id:'own',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:code,status:'sent',
      requires_contrl:false,contrl_status:'not_required',contrl_due_at:null,requires_aperak:false,aperak_status:'not_required'},
    expectation:{id:'private-watch',source_message_id:id,expected_code:code==='Z09'?'Z06':'Z14',due_at:'2026-11-19T23:00:00Z',status:'pending',metadata:code==='Z09'?{
      timerRuleId:'TM-METHOD40',timerKind:'source_validity_day_watch',anchorType:'z09_validity_day',validityDay:'2026-10-10',dueDay:'2026-11-19',
      actualAcceptedAt:'2026-10-01T12:00:00Z',remoteReceiptKnown:false,automaticResendAllowed:false,authorizesMarketEffects:false,
      observationCriterion:'same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day',
    }:{anchorType:'actual_accepted_smtp_observed_at',anchorAt:'2026-10-01T12:00:00Z',timerKind:'internal_sender_watch',remoteReceiptKnown:false}},
  }
}

function owner(input=sourceInput()){
  io.rpc.mockImplementation(async(name:string)=>({error:null,data:name===(input.message.message_code==='Z09'?'gridex_ediel_metering_method_expectations_v1':'gridex_ediel_business_expectations_v1')?[input.expectation]:[]}))
  io.ids.mockResolvedValue({error:null,data:[input.message]})
  io.db.mockReturnValue({from:()=>({select:()=>({in:io.ids})})})
}
const readInput={companyId:'own',actorUserId:'current-actor',environment:'test' as const,messageIds:[id],evaluatedAt:'2026-10-02T12:00:00Z',access:{canRead:true,canReview:false,canPrepare:false}}
beforeEach(()=>{vi.resetAllMocks();io.contextCompany='own';io.permissions=['communication.read'];owner()})

describe('current owner decisions and distinct legal-obligation context',()=>{
  it('does not produce obligation facts before current source validation',()=>{
    expect(reportingObligationContext({sourceKind:'outbound_method_watch',currentOwnerScopeValidated:false,businessState:'pending'})).toEqual([])
    const input=sourceInput();input.message.company_id='foreign'
    const result=deriveEdielMeteringMethodProcessNextAction(input)
    expect(result).toMatchObject({cause:'source_context_held',allowedActions:[]})
    expect(result.reportingObligations??[]).toEqual([])
  })

  it('preserves the actual Z06 watch date and explicitly holds its separate legal anchors',()=>{
    const result=deriveEdielMeteringMethodProcessNextAction(sourceInput())
    expect(result).toMatchObject({cause:'business_response_pending',timeBasis:{anchor:'z09_validity_day',dueDay:'2026-11-19',businessDueAt:'2026-11-19T23:00:00.000Z'}})
    expect(result.reportingObligations).toHaveLength(2)
    expect(result.reportingObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:'supplier_method_notice',status:'held',dueDay:null}),
      expect.objectContaining({kind:'physical_method_completion',status:'held',dueDay:null}),
    ]))
  })

  it('does not trust similarly named or self-qualified metadata as DSO/customer evidence',()=>{
    const input=sourceInput();Object.assign(input.expectation.metadata,{remoteReceivedAt:'2026-10-01',completeReceiptDay:'2026-10-01',customerApprovalDay:'2026-10-01',changeRequired:false,qualified:true})
    expect(deriveEdielMeteringMethodProcessNextAction(input).reportingObligations?.every(row=>row.status==='held'&&row.dueDay===null)).toBe(true)
    const esco=sourceInput('Z13');esco.expectation.status='fulfilled';Object.assign(esco.expectation.metadata,{customerApprovalDay:'2026-10-01',appliedAt:'2026-10-01',settlementChangeRequired:false,qualified:true})
    expect(deriveEdielProcessNextAction(esco).reportingObligations).toEqual([expect.objectContaining({kind:'esco_reporting_start',status:'held',dueDay:null})])
  })

  it('Z14 qualification or technical ACK does not prove customer approval or actual first reporting',()=>{
    const input=sourceInput('Z13');input.expectation.status='fulfilled';input.message.contrl_status='received'
    expect(deriveEdielProcessNextAction(input)).toMatchObject({cause:'business_response_received',reportingObligations:[{
      kind:'esco_reporting_start',status:'held',dueDay:null,missing:expect.arrayContaining(['customer_approval_day_required','settlement_method_branch_required']),
      version:expect.any(String),basis:null,requiresImmediateAction:false,sourceRefs:expect.any(Array),legalBreachDetermined:false,authorizesProviderEntry:false,automaticResendAllowed:false,
    }]})
    input.expectation.status='rejected'
    expect(deriveEdielProcessNextAction(input).reportingObligations??[]).toEqual([])
  })

  it('actual protected owner reads keep current actor, tenant, environment and source checks',async()=>{
    const result=await readEdielProcessNextActions(readInput)
    expect(result.get(id)?.reportingObligations?.every(row=>row.status==='held')).toBe(true)
    expect(io.rpc).toHaveBeenCalledWith('gridex_ediel_metering_method_expectations_v1',{p_input:{companyId:'own',environment:'test',actorUserId:'current-actor',messageId:id,limit:100,action:'read'}})
    expect(io.db).toHaveBeenCalledWith('own')
    expect(io.ids).toHaveBeenCalledWith('id',[id])
    io.rpc.mockResolvedValue({error:new Error('current_read_denied'),data:null});io.db.mockClear()
    await expect(readEdielProcessNextActions(readInput)).rejects.toThrow('current_read_denied')
    expect(io.db).not.toHaveBeenCalled()
  })

  it('actual server page separates the original watch from missing legal evidence without new write actions',async()=>{
    const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({environment:'test',sourceId:id})}))
    expect(html).toContain('bevakningsdag 2026-11-19')
    expect(html).toContain('Separata rapporterings- och ändringsfrister')
    expect(html).toContain('Leverantörsunderrättelse')
    expect(html).toContain('Fysisk mätmetodsändring')
    expect(html).toContain('Kan inte fastställas')
    expect(html).not.toContain('Rapportering startad')
    expect(html).not.toContain('Skicka på nytt')
    expect((html.match(/<button/g)??[])).toHaveLength(1)
    io.contextCompany='foreign';io.rpc.mockClear()
    const denied=renderToStaticMarkup(await Page({searchParams:Promise.resolve({sourceId:id})}))
    expect(denied).not.toContain('<article')
    expect(denied).not.toContain('Leverantörsunderrättelse')
    expect(io.rpc).not.toHaveBeenCalled()
  })
})
