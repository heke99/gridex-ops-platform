// Controlled AT-Z10M GIVEN evidence only. No APP, send, response or live DSO authority.
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createContext,Script} from 'node:vm'
import ts from 'typescript'
import {canonicalDeadlineForMessage} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {parseUnb} from '@/lib/ediel/core/unb'
import {parseProdatMessage,parsedProdatObjects} from '@/lib/ediel/prodat/parser'
import {isProdatCalendarMinute,prodatDate102,prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import {stockholmDateForInstant} from '@/lib/time/stockholm'

export type ControlledMChronologyBinding={
  fixtureId:string;sourceMessageId:string;companyId:string;environment:'test';payloadHash:string;
  meteringPointId:string;objectId:string;identityAgency:'9';issuerEdielId:string;receiverEdielId:string;
  oldMeter:string;newMeter:string;
}
export type ControlledMCalendarRow={
  market:'electricity';country:'SE';calendar_date:string;is_business_day:boolean;label:string|null;
}
export type ControlledMCalendarFault={date:string;kind:'missing'|'error'|'data_with_error'}
export type ControlledZ10MChronologyInput={
  source:ControlledMChronologyBinding&{
    rawPayload:string;messageVersion:'E2SE6A';sourceReceivedAt:string;
    direction:'inbound';actorRole:'SUPPLIER';applicationReference:'23-DDQ-PRODAT';
  };
  event:ControlledMChronologyBinding&{kind:'controlled_meter_replacement';marketMinute:string};
  send:ControlledMChronologyBinding&{kind:'controlled_dso_send';dispatchedAt:string};
  calendar:{fixtureId:string;provenance:'explicit_controlled_calendar';market:'electricity';country:'SE';
    firstDate:string;lastDate:string;rows:readonly ControlledMCalendarRow[];
    /** Finite external-I/O degradation controls, never product state. */
    faults?:readonly ControlledMCalendarFault[]};
}
type Reason='within_deadline'|'after_deadline'|'source_binding_mismatch'|'source_wire_invalid'
  |'source_version_mismatch'|'event_binding_mismatch'|'chronology_unavailable'|'send_before_event'
  |'send_after_observation'|'canonical_deadline_unavailable'|'calendar_namespace_mismatch'
  |'calendar_incomplete'|'calendar_read_missing'|'calendar_read_error'|'calendar_unexpected_io'
  |'calendar_source_unavailable'
type SourceBinding=Pick<ControlledZ10MChronologyInput['source'],
  'sourceMessageId'|'companyId'|'environment'|'payloadHash'|'messageVersion'|'sourceReceivedAt'|'meteringPointId'>
export type ControlledZ10MChronologyResult={
  criterion:'AT-Z10M-SUPPLIER:GIVEN:DSO_send_deadline';evidenceLevel:'controlled_fixture';authority:'none';
  status:'on_time'|'late'|'not_established';reason:Reason;source:SourceBinding|null;
  event:{marketMinute:string;utc:string;civilDate:string}|null;
  send:{instant:string;civilDate:string}|null;deadlineDate:string|null;
  rule:{offset:number;unit:'business_days';anchor:'meter_replacement';source:NonNullable<ReturnType<typeof canonicalDeadlineForMessage>>['source']}|null;
  calendar:{market:'electricity';country:'SE';firstDate:string;lastDate:string;provenance:'explicit_controlled_calendar';
    factsHash:string;implementationHash:string}|null;
  queries:string[];violations:{reason:Reason;date:string|null}[];
}
class QualificationFailure extends Error{
  constructor(readonly reason:Reason){super(reason)}
}
function fail(reason:Reason):never{throw new QualificationFailure(reason)}
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
const bindingKeys=['fixtureId','sourceMessageId','companyId','environment','payloadHash','meteringPointId',
  'objectId','identityAgency','issuerEdielId','receiverEdielId','oldMeter','newMeter'] as const
const identifier=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=128
  &&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value)
type Instant={milliseconds:number;subMillisecond:number}
function instant(value:string):Instant{
  const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/)
  if(!match||!isProdatCalendarMinute(match.slice(1,6).join(''))||Number(match[6])>59
    ||(match[8]!=='Z'&&(Number(match[8].slice(1,3))>23||Number(match[8].slice(4,6))>59)))fail('chronology_unavailable')
  // Preserve PostgreSQL microseconds; Date.parse alone would round distinct bounds equal.
  const wholeSecond=Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[8]}`)
  const fraction=Number((match[7]??'').padEnd(6,'0'))
  return Number.isFinite(wholeSecond)?{milliseconds:wholeSecond+Math.floor(fraction/1000),subMillisecond:fraction%1000}:fail('chronology_unavailable')
}
const before=(left:Instant,right:Instant)=>left.milliseconds<right.milliseconds
  ||(left.milliseconds===right.milliseconds&&left.subMillisecond<right.subMillisecond)
function day(value:string):string{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!prodatDate102(value))fail('calendar_incomplete')
  return value
}
function nextDay(value:string):string{
  const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1)
  return date.toISOString().slice(0,10)
}

function physicalBinding(input:ControlledZ10MChronologyInput){
  const {source,event,send}=input
  if(!source||!event||!send||!bindingKeys.every(key=>identifier(source[key]))
    ||source.environment!=='test'||source.direction!=='inbound'||source.actorRole!=='SUPPLIER'
    ||source.identityAgency!=='9'||source.oldMeter===source.newMeter
    ||typeof source.rawPayload!=='string'||!/^[a-f0-9]{64}$/.test(source.payloadHash)
    ||hash(source.rawPayload)!==source.payloadHash
    ||!bindingKeys.every(key=>source[key]===event[key]&&source[key]===send[key]))fail('source_binding_mismatch')
  if(source.messageVersion!=='E2SE6A')fail('source_version_mismatch')
  if(source.rawPayload.length>256*1024||!validateEdifactEnvelope(source.rawPayload).ok)fail('source_wire_invalid')
  const tokens=tokenizeEdifact(source.rawPayload),unhs=tokens.segments.filter(segment=>segment.tag==='UNH')
  const unbs=tokens.segments.filter(segment=>segment.tag==='UNB')
  if(unhs.length!==1||unbs.length!==1)fail('source_wire_invalid')
  const type=segmentComposite(unhs[0],2,tokens.una),unb=parseUnb(unbs[0],tokens.una)
  if(type.join(':')!=='PRODAT:D:97A:UN:'+source.messageVersion)fail('source_version_mismatch')
  const parsed=parseProdatMessage(source.rawPayload),objects=parsedProdatObjects(parsed)
  if(parsed.messageCode!=='Z10'||parsed.timezoneOffset!=='1'||objects.length!==1||!objects[0].validRegisterChain
    ||objects[0].meteringPointId!==source.objectId||objects[0].identityAgency!==source.identityAgency
    ||objects[0].registers.length<2||parsed.legalSenderId!==source.issuerEdielId
    ||parsed.legalReceiverId!==source.receiverEdielId||unb?.sender!==source.issuerEdielId
    ||unb.receiver!==source.receiverEdielId||unb.testIndicator!=='1'||unb.applicationReference!=='23-DDQ-PRODAT'
    ||source.applicationReference!==unb.applicationReference)fail('source_wire_invalid')
  const first=objects[0].registers[0]
  if(first.reasonForTransaction!=='E58'||first.oldMeterNumber!==source.oldMeter||first.meterNumber!==source.newMeter)fail('source_wire_invalid')
  const registers=objects[0].registers
  // Physical membership only; the genuine runtime owns R/D and full APP validation.
  if(!registers.every(register=>identifier(register.meterTimeFrame))
    ||new Set(registers.map(register=>register.meterTimeFrame)).size!==registers.length)fail('source_wire_invalid')
  if(event.kind!=='controlled_meter_replacement'||send.kind!=='controlled_dso_send'
    ||first.validityStartDate!==event.marketMinute)fail('event_binding_mismatch')
  const utc=prodatMarketMinuteToUtc(event.marketMinute)
  if(!utc)fail('event_binding_mismatch')
  instant(send.dispatchedAt);instant(source.sourceReceivedAt)
  return {source:{sourceMessageId:source.sourceMessageId,companyId:source.companyId,environment:source.environment,
    payloadHash:source.payloadHash,messageVersion:source.messageVersion,sourceReceivedAt:source.sourceReceivedAt,
    meteringPointId:source.meteringPointId},
    event:{marketMinute:event.marketMinute,utc,civilDate:stockholmDateForInstant(utc)},
    send:{instant:send.dispatchedAt,civilDate:stockholmDateForInstant(send.dispatchedAt)}}
}

function sealedCalendar(input:ControlledZ10MChronologyInput,eventDay:string,offset:number){
  const calendar=input.calendar
  if(!calendar||calendar.fixtureId!==input.source.fixtureId||calendar.market!=='electricity'||calendar.country!=='SE'
    ||calendar.provenance!=='explicit_controlled_calendar')fail('calendar_namespace_mismatch')
  const first=day(calendar.firstDate),last=day(calendar.lastDate)
  if(first!==eventDay||last<first||!Array.isArray(calendar.rows)||calendar.rows.length>62)fail('calendar_incomplete')
  const facts=new Map<string,Readonly<ControlledMCalendarRow>>()
  for(const row of calendar.rows){
    if(row.market!=='electricity'||row.country!=='SE')fail('calendar_namespace_mismatch')
    const key=day(row.calendar_date)
    if(key<first||key>last||facts.has(key)||typeof row.is_business_day!=='boolean'
      ||!(row.label===null||typeof row.label==='string'))fail('calendar_incomplete')
    facts.set(key,Object.freeze({market:row.market,country:row.country,calendar_date:key,
      is_business_day:row.is_business_day,label:row.label}))
  }
  const ordered:Readonly<ControlledMCalendarRow>[]=[]
  let eligible=0
  for(let key=first;key<=last;key=nextDay(key)){
    if(ordered.length===62||!facts.has(key))fail('calendar_incomplete')
    const row=facts.get(key)!
    ordered.push(row);if(key>first&&row.is_business_day)eligible+=1
  }
  if(ordered.length!==facts.size||eligible<offset)fail('calendar_incomplete')
  const faults=new Map<string,ControlledMCalendarFault['kind']>()
  for(const fault of calendar.faults??[]){
    if(!facts.has(fault.date)||fault.date<=first||faults.has(fault.date)
      ||!['missing','error','data_with_error'].includes(fault.kind))fail('calendar_incomplete')
    faults.set(fault.date,fault.kind)
  }
  return {facts,faults,first,last,factsHash:hash(JSON.stringify(ordered))}
}

async function actualCalendarRun(snapshot:ReturnType<typeof sealedCalendar>,offset:number,
  audit:Pick<ControlledZ10MChronologyResult,'queries'|'violations'>){
  const sourceFile=fileURLToPath(new URL('../../lib/ediel/calendar/marketCalendar.ts',import.meta.url))
  const source=readFileSync(sourceFile,'utf8'),implementationHash=hash(source)
  const reject=(reason:Reason,date:string|null=null):never=>{
    audit.violations.push({reason,date});return fail(reason)
  }
  const closed=(methods:Record<string,unknown>)=>new Proxy(Object.assign(Object.create(null) as Record<string,unknown>,methods),{
    get(target,key){
      if(typeof key==='string'&&Object.hasOwn(target,key))return target[key]
      return reject('calendar_unexpected_io')
    },
  })
  let expectedDate=nextDay(snapshot.first)
  const service=closed({from:(table:string)=>{
    if(table!=='ediel_market_calendar_entries')return reject('calendar_unexpected_io')
    return closed({select:(columns:string)=>{
      if(columns!=='calendar_date,is_business_day,label')return reject('calendar_unexpected_io')
      const filters=new Map<string,string>()
      const query:Record<string,unknown>=closed({eq:(column:string,value:string)=>{
        if(!['market','country','calendar_date'].includes(column)||filters.has(column)||typeof value!=='string')
          return reject('calendar_unexpected_io')
        filters.set(column,value);return query
      },maybeSingle:async()=>{
        const key=filters.get('calendar_date')??null
        if(filters.size!==3||filters.get('market')!=='electricity'||filters.get('country')!=='SE')
          return reject('calendar_unexpected_io',key)
        if(key===null||key!==expectedDate||!snapshot.facts.has(key)||audit.queries.length>=62)return reject('calendar_unexpected_io',key)
        audit.queries.push(key);expectedDate=nextDay(key)
        const fault=snapshot.faults.get(key)
        if(fault)return reject(fault==='missing'?'calendar_read_missing':'calendar_read_error',key)
        const row=snapshot.facts.get(key)!
        return {data:{calendar_date:key,is_business_day:row.is_business_day,label:row.label},error:null}
      }})
      return query
    }})
  }})
  const compiled=ts.transpileModule(source,{fileName:sourceFile,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  if(compiled.diagnostics?.some(diagnostic=>diagnostic.category===ts.DiagnosticCategory.Error))fail('calendar_source_unavailable')
  const calendarModule={exports:{}},context=createContext({module:calendarModule,exports:calendarModule.exports,
    require:(request:string)=>request==='@/lib/supabase/service'?{supabaseService:service}:reject('calendar_unexpected_io'),
    calendarAnchor:snapshot.first+'T00:00:00Z',calendarOffset:offset},{codeGeneration:{strings:false,wasm:false}})
  new Script(compiled.outputText,{filename:sourceFile}).runInContext(context,{timeout:1000})
  // Date is VM-local. The original function is called, not reimplemented.
  const calculated=await new Script("module.exports.addBusinessDays(new Date(calendarAnchor),calendarOffset,'electricity').then(value=>value.toISOString())")
    .runInContext(context,{timeout:1000}) as string
  if(audit.violations.length)fail(audit.violations[0].reason)
  const deadline=day(calculated.slice(0,10))
  if(calculated!==deadline+'T00:00:00.000Z'||deadline>snapshot.last||audit.queries.at(-1)!==deadline)fail('calendar_unexpected_io')
  return {deadline,implementationHash}
}

/** Source-bound controlled chronology only. Genuine R/D, APP and effects stay with their owners. */
export async function qualifyControlledZ10MChronology(input:ControlledZ10MChronologyInput):Promise<ControlledZ10MChronologyResult>{
  const result:ControlledZ10MChronologyResult={criterion:'AT-Z10M-SUPPLIER:GIVEN:DSO_send_deadline',
    evidenceLevel:'controlled_fixture',authority:'none',status:'not_established',reason:'source_binding_mismatch',
    source:null,event:null,send:null,deadlineDate:null,rule:null,calendar:null,queries:[],violations:[]}
  try{
    Object.assign(result,physicalBinding(input))
    const sent=instant(input.send.dispatchedAt)
    if(before(sent,instant(result.event!.utc)))fail('send_before_event')
    if(before(instant(input.source.sourceReceivedAt),sent))fail('send_after_observation')
    const policy=canonicalDeadlineForMessage({family:'PRODAT',code:'Z10',subtype:'M'})
    const constraints=policy?.constraints.filter(value=>value.kind==='within_after'&&value.anchor==='meter_replacement')
    if(!policy||policy.direction!=='inbound'||constraints?.length!==1||constraints[0].unit!=='business_days'
      ||constraints[0].offset!==10||constraints[0].condition!==null)fail('canonical_deadline_unavailable')
    const offset=constraints[0].offset
    result.rule={offset,unit:'business_days',anchor:'meter_replacement',source:policy.source}
    const snapshot=sealedCalendar(input,result.event!.civilDate,offset)
    const actual=await actualCalendarRun(snapshot,offset,result)
    result.calendar={market:'electricity',country:'SE',firstDate:snapshot.first,lastDate:snapshot.last,
      provenance:'explicit_controlled_calendar',factsHash:snapshot.factsHash,implementationHash:actual.implementationHash}
    result.deadlineDate=actual.deadline
    result.status=result.send!.civilDate<=actual.deadline?'on_time':'late'
    result.reason=result.status==='on_time'?'within_deadline':'after_deadline'
  }catch(error){
    result.status='not_established';result.deadlineDate=null
    result.reason=result.violations[0]?.reason??(error instanceof QualificationFailure?error.reason:'calendar_source_unavailable')
  }
  return result
}
