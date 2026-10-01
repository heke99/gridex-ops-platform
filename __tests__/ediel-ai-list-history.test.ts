import {describe,expect,it,vi} from 'vitest'
// Chronology fixtures test only the pure projection. They are not acceptance or
// source-owner evidence; the existing owner/timeline/native probes stay separate.
vi.mock('@/lib/ediel/sources/structuralSourceReadset',async()=>{const actual=await vi.importActual<typeof import('@/lib/ediel/sources/structuralSourceReadset')>('@/lib/ediel/sources/structuralSourceReadset');return {...actual,reviewedBusinessFor:(readset:{sources:{sourceMessageId:string;objects:{business:unknown}[]}[]},id:string)=>readset.sources.find(source=>source.sourceMessageId===id)?.objects[0].business}})
import {projectAiListHistory,type AiListHistoryScope,type AiListSupplyPeriod} from '@/lib/ediel/aiListHistory'
import type {StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import type {StructuralVersion} from '@/lib/ediel/sources/structuralSourceSelection'
import {emptySourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'
import {parseProdatMessage,parsedProdatObjects} from '@/lib/ediel/prodat/parser'
import {aiListCell} from '@/lib/ediel/aiListFormat'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
const at=(day:string)=>prodatMarketMinuteToUtc(`${day}0000`)!
const scope:AiListHistoryScope={companyId:'company',environment:'test',customerId:'customer',siteId:'site',legalSupplier:'12345',legalNetwork:'54321',fromDate:'20261001',toDate:'20261101',cutoffAt:'2026-11-02T12:00:00.000000Z'}
const object={messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',registers:[]}
const period:AiListSupplyPeriod={id:'period',company_id:'company',customer_id:'customer',metering_point_id:'point',start_date:'2026-10-01',end_date:null}
function source(id:string,day:string,code:'Z04'|'Z06'|'Z10'='Z04'):StructuralVersion{return {sourceMessageId:id,payloadHash:'a'.repeat(64),assessmentId:`${id}-assessment`,factsHash:'b'.repeat(64),availableAt:at('20261001'),disposition:'accepted',replaces:null,
  coverage:{kind:'post_ledger_supply',baselineSourceMessageId:'baseline',baselineAssessmentId:'baseline-assessment',baselineFactsHash:'b'.repeat(64),supplyPeriodId:'period',switchRequestId:'switch',switchCreatedAt:at('20260930'),outboundSourceMessageId:'outbound',outboundCreatedAt:at('20260930'),validFrom:at('20261001'),validTo:null},
  wire:{object,messageCode:code,businessCase:code==='Z04'?'supply_baseline':code==='Z10'?'meter_exchange':'change_without_reading',functionCode:'9',documentReference:id,caseReference:'case',effectiveFrom:{fieldNumber:code==='Z04'?'210':'216',marketMinute:`${day}0000`,utc:at(day)},contractStartMinute:'202610010000',legalSender:'54321',legalReceiver:'12345',transportSender:'54321',transportReceiver:'12345',meterNumber:code==='Z10'?'new-meter':'old-meter',oldMeterNumber:code==='Z10'?'old-meter':null,registers:[{position:1,registerId:'901'}]}}}
function readset(versions=[source('baseline','20261001')]):StructuralReadset{return {timeline:{...emptySourceDecisionTimeline(),status:'inspected',boundedReadComplete:true,snapshotId:'snapshot',readsetHash:'c'.repeat(64),cutoffAt:scope.cutoffAt,ledgerStartedAt:at('20260901')},versions,closures:[],closureBlockers:[],correctionContextBlockers:[],unresolvedSources:false,
  sources:versions.map(version=>({sourceMessageId:version.sourceMessageId,payloadHash:version.payloadHash,asOf:null,assessments:[],rawPayload:`UNB+UNOC:3+54321:14+12345:14+261001:1200+I+23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+${version.wire.messageCode}+${version.sourceMessageId}+9'LIN+1++735123456789012345:::9'RFF+Z05:NET'RFF+MG:${version.wire.meterNumber}'NAD+UD+199001011234:SE2:260++Dated Person'NAD+IT+SITE+++Street ${version.sourceMessageId}+City++12345+SE'NAD+Z02+BRP:160:SVK'UNT+10+M'UNZ+1+I'`,
    objects:[{object,disposition:'accepted',reasons:[],party:null,business:{companyId:'company',environment:'test',customerId:'customer',meteringPointId:'point',siteId:'site'}}]}))}}
describe('AI dated supply/source projection',()=>{
  it('preserves source two-line names and three-line addresses without inventing CSV whitespace',()=>{
    const raw=readset().sources[0].rawPayload.replace('++Dated Person','++ Dated Person : Second Name ').replace('+++Street baseline','+++ First Street : : Third Street ')
    const parsed=parsedProdatObjects(parseProdatMessage(raw))[0].registers[0]
    expect(parsed.endUserName).toBe('Dated Person\nSecond Name')
    expect(parsed.installationAddress).toBe('First Street\n\nThird Street')
    expect(()=>aiListCell(parsed.endUserName)).toThrow('ai_list_cell_separator_invalid')
    expect(()=>aiListCell(parsed.installationAddress)).toThrow('ai_list_cell_separator_invalid')
  })
  it('uses dated original legal identity and blanks detail bounds at head edges',()=>{
    const result=projectAiListHistory(scope,[period],readset())
    expect(result.details).toMatchObject([{elanvandarId:'199001011234',elanvandarNamn:'Dated Person',franDatum:null,tillDatum:null}])
    expect(result.evidence.supplyPeriodIds).toEqual(['period'])
  })
  it('splits a structural transition even though supplier-only network columns stay blank',()=>{
    const result=projectAiListHistory(scope,[period],readset([source('baseline','20261001'),source('exchange','20261015','Z10')]))
    expect(result.details.map(row=>[row.franDatum,row.tillDatum,row.matarNummer,row.arsforbrukningKwh])).toEqual([[null,'20261015',null,null],['20261015',null,null,null]])
    expect(result.details[1].anlaggningsAdress).toBe('Street baseline')
  })
  it('carries permitted earlier Z06 address through a later Z10 and search start',()=>{
    const result=projectAiListHistory({...scope,fromDate:'20261020'},[period],readset([source('baseline','20261001'),source('address','20261010','Z06'),source('exchange','20261015','Z10')]))
    expect(result.details).toHaveLength(1)
    expect(result.details[0]).toMatchObject({anlaggningsAdress:'Street address',franDatum:null})
  })
  it('includes ended periods and requires a dated authoritative supply end',()=>{
    const ended={...period,end_date:'2026-10-25'},data=readset();data.versions[0].coverage!.validTo=at('20261025')
    expect(projectAiListHistory(scope,[ended],data).details[0].tillDatum).toBe('20261025')
    expect(()=>projectAiListHistory(scope,[ended],readset())).toThrow('dated_supply_end_owner_missing')
  })
  it('uses confirmed actual delivery boundaries ahead of scheduled dates and still proves the original source',()=>{
    const actual={...period,start_date:'2026-09-30',end_date:'2026-10-20',actual_start_date:'2026-10-01',actual_end_date:'2026-10-25'}
    const data=readset();data.versions[0].coverage!.validTo=at('20261025')
    expect(projectAiListHistory(scope,[actual],data).details[0]).toMatchObject({franDatum:null,tillDatum:'20261025'})
    expect(()=>projectAiListHistory(scope,[{...actual,actual_start_date:'2026-10-02'}],data)).toThrow('ai_list_history_unavailable')
    expect(()=>projectAiListHistory(scope,[actual],readset())).toThrow('dated_supply_end_owner_missing')
  })
  it('does not manufacture pre-ledger, unqualified customer, foreign tenant or date-only histories',()=>{
    const before=readset();before.timeline.ledgerStartedAt=at('20261002')
    expect(()=>projectAiListHistory(scope,[period],before)).toThrow('ai_list_history_unavailable')
    expect(()=>projectAiListHistory(scope,[{...period,company_id:'foreign'}],readset())).toThrow('supply_period_tenant_mismatch')
    const customer=source('customer','20261010','Z06');customer.wire.businessCase='customer_only';customer.coverage=null
    expect(()=>projectAiListHistory(scope,[period],readset([source('baseline','20261001'),customer]))).toThrow('dated_customer_change_owner_missing')
    const minute=source('minute','20261015','Z10');minute.wire.effectiveFrom.marketMinute='202610151200';minute.wire.effectiveFrom.utc=prodatMarketMinuteToUtc('202610151200')!
    expect(()=>projectAiListHistory(scope,[period],readset([source('baseline','20261001'),minute]))).toThrow('date_only_boundary_unrepresentable')
  })
})
