import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {describe,expect,it} from 'vitest'
import {raw,line,characteristic,type Parts} from './fixtures/prodat-register'
import {qualifyControlledZ10MChronology,type ControlledMCalendarRow,type ControlledZ10MChronologyInput} from '../scripts/helpers/ediel-z10m-calendar-chronology'

const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
function rows(first:string,last:string,closed:readonly string[]=[]):ControlledMCalendarRow[]{
  const result:ControlledMCalendarRow[]=[]
  for(const date=new Date(first+'T00:00:00Z');date.toISOString().slice(0,10)<=last;date.setUTCDate(date.getUTCDate()+1)){
    const key=date.toISOString().slice(0,10),weekday=date.getUTCDay()
    result.push({market:'electricity',country:'SE',calendar_date:key,
      is_business_day:weekday!==0&&weekday!==6&&!closed.includes(key),label:closed.includes(key)?'Explicit controlled closure':null})
  }
  return result
}
function fixture(options:{minute?:string;first?:string;last?:string;sent?:string;received?:string;closed?:readonly string[]}={}):ControlledZ10MChronologyInput{
  const minute=options.minute??'202609300000',first=options.first??'2026-09-30',last=options.last??'2026-10-20'
  const body:Parts[]=[
    ['NAD','FR',['60001','160','SVK'],'','','','','','','SE'],
    ['NAD','DO',['90001','160','SVK'],'','','','','','','SE'],
    line('1','735123456789012345','1','9'),['DTM',['157',minute,'203']],['DTM',['354','15','806']],
    ...characteristic('Z13','E58'),...characteristic('Z04','Z04'),...characteristic('Z12','D',3),
    ...characteristic('Z16','101',3),...characteristic('Z02','1',3),...characteristic('Z05','6',3),
    ['RFF',['MG','NEW-METER']],['RFF',['Z02','OLD-METER']],['RFF',['LI','CONTROLLED-M-REF']],
    line('2','735123456789012345','2','9'),...characteristic('Z16','102',3),
    ...characteristic('Z02','1',3),...characteristic('Z05','6',3),
  ]
  const wire=raw(body,'Z10').replace('+S+R+','+60001:14+90001:14+')
    .replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++++1'")
  const binding={fixtureId:'controlled-M-calendar',sourceMessageId:'11111111-1111-4111-8111-111111111111',
    companyId:'22222222-2222-4222-8222-222222222222',environment:'test' as const,payloadHash:hash(wire),
    meteringPointId:'33333333-3333-4333-8333-333333333333',objectId:'735123456789012345',identityAgency:'9' as const,
    issuerEdielId:'60001',receiverEdielId:'90001',oldMeter:'OLD-METER',newMeter:'NEW-METER'}
  return {source:{...binding,rawPayload:wire,messageVersion:'E2SE6A',sourceReceivedAt:options.received??'2026-10-20T10:00:00Z',
    direction:'inbound',actorRole:'SUPPLIER',applicationReference:'23-DDQ-PRODAT'},
    event:{...binding,kind:'controlled_meter_replacement',marketMinute:minute},
    send:{...binding,kind:'controlled_dso_send',dispatchedAt:options.sent??'2026-10-14T21:59:59Z'},
    calendar:{fixtureId:binding.fixtureId,provenance:'explicit_controlled_calendar',market:'electricity',country:'SE',
      firstDate:first,lastDate:last,rows:rows(first,last,options.closed)}}
}
function rebindWire(input:ControlledZ10MChronologyInput,wire:string){
  input.source.rawPayload=wire
  for(const value of [input.source,input.event,input.send])value.payloadHash=hash(wire)
}

describe('controlled M GIVEN, actual canonical calendar source and unchanged date/parser functions',()=>{
  it('binds exact source/hash/version and computes the tenth day with the actual immutable canonical rule',async()=>{
    const input=fixture(),result=await qualifyControlledZ10MChronology(input)
    expect(result).toMatchObject({evidenceLevel:'controlled_fixture',authority:'none',status:'on_time',reason:'within_deadline',
      source:{sourceMessageId:input.source.sourceMessageId,companyId:input.source.companyId,payloadHash:hash(input.source.rawPayload),
        messageVersion:'E2SE6A',sourceReceivedAt:input.source.sourceReceivedAt,meteringPointId:input.source.meteringPointId},
      event:{marketMinute:'202609300000',utc:'2026-09-29T23:00:00.000Z',civilDate:'2026-09-30'},
      send:{civilDate:'2026-10-14'},deadlineDate:'2026-10-14',
      rule:{offset:10,unit:'business_days',anchor:'meter_replacement',source:{edition:'26A',effectiveFrom:'2026-04-01',section:'10.2.1',pages:'198'}}})
    expect(result.calendar?.implementationHash).toBe(hash(readFileSync(fileURLToPath(new URL('../lib/ediel/calendar/marketCalendar.ts',import.meta.url)),'utf8')))
    expect(result.calendar?.factsHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.queries).toEqual(['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06',
      '2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11','2026-10-12','2026-10-13','2026-10-14'])
    expect(result.violations).toEqual([])
  })
  it('distinguishes the last Stockholm civil minute from the first subsequent day without inventing a refusal',async()=>{
    expect(await qualifyControlledZ10MChronology(fixture({sent:'2026-10-14T21:59:59Z'}))).toMatchObject({status:'on_time',deadlineDate:'2026-10-14'})
    expect(await qualifyControlledZ10MChronology(fixture({sent:'2026-10-14T22:00:00Z'}))).toMatchObject({status:'late',reason:'after_deadline',
      send:{civilDate:'2026-10-15'},deadlineDate:'2026-10-14',authority:'none'})
  })
  it('uses explicit nonbusiness weekday data instead of a ten-calendar-day or weekend-only calculation',async()=>{
    const result=await qualifyControlledZ10MChronology(fixture({closed:['2026-10-05'],sent:'2026-10-15T12:00:00Z'}))
    expect(result).toMatchObject({status:'on_time',deadlineDate:'2026-10-15',calendar:{provenance:'explicit_controlled_calendar'}})
    expect(result.queries).toContain('2026-10-05');expect(result.violations).toEqual([])
  })
  it.each(['missing','error','data_with_error'] as const)('rejects a reached %s read on the declared nonbusiness weekday',async kind=>{
    const input=fixture({closed:['2026-10-05']})
    input.calendar.faults=[{date:'2026-10-05',kind}]
    const result=await qualifyControlledZ10MChronology(input)
    expect(result).toMatchObject({status:'not_established',deadlineDate:null,
      reason:kind==='missing'?'calendar_read_missing':'calendar_read_error',
      violations:[{reason:kind==='missing'?'calendar_read_missing':'calendar_read_error',date:'2026-10-05'}]})
    expect(result.queries).toEqual(['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05'])
  })
  it.each(['gap','duplicate','date','boolean','horizon'] as const)('rejects %s in the complete finite calendar',async kind=>{
    const input=fixture(),original=[...input.calendar.rows]
    if(kind==='gap')input.calendar.rows=original.filter(row=>row.calendar_date!=='2026-10-05')
    if(kind==='duplicate')input.calendar.rows=[...original,{...original[1],is_business_day:!original[1].is_business_day}]
    if(kind==='date')input.calendar.rows=[...original,{...original[1],calendar_date:'2026-11-31'}]
    if(kind==='boolean')input.calendar.rows=original.map(row=>row.calendar_date==='2026-10-05'
      ?{...row,is_business_day:null as unknown as boolean}:row)
    if(kind==='horizon'){input.calendar.lastDate='2026-10-04';input.calendar.rows=original.filter(row=>row.calendar_date<='2026-10-04')}
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'calendar_incomplete',deadlineDate:null,queries:[]})
  })
  it.each(['market','country'] as const)('rejects a wrong %s namespace rather than borrowing a matching date',async key=>{
    const input=fixture()
    input.calendar.rows=input.calendar.rows.map(row=>row.calendar_date==='2026-10-05'
      ?{...row,[key]:key==='market'?'gas':'NO'} as ControlledMCalendarRow:row)
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'calendar_namespace_mismatch',queries:[]})
  })
  it('keeps fixed UTC+1 wire inversion separate from the summer Stockholm date rollover',async()=>{
    const result=await qualifyControlledZ10MChronology(fixture({minute:'202609302330',first:'2026-10-01'}))
    expect(result).toMatchObject({status:'on_time',deadlineDate:'2026-10-15',
      event:{marketMinute:'202609302330',utc:'2026-09-30T22:30:00.000Z',civilDate:'2026-10-01'}})
    expect(result.queries[0]).toBe('2026-10-02')
  })
  it('counts civil business dates across the actual Stockholm DST rollback',async()=>{
    const result=await qualifyControlledZ10MChronology(fixture({minute:'202610232300',first:'2026-10-24',last:'2026-11-10',
      sent:'2026-11-06T22:59:59Z',received:'2026-11-10T10:00:00Z'}))
    expect(result).toMatchObject({status:'on_time',deadlineDate:'2026-11-06',
      event:{utc:'2026-10-23T22:00:00.000Z',civilDate:'2026-10-24'},send:{civilDate:'2026-11-06'}})
    expect(result.queries[0]).toBe('2026-10-25')
  })
  it('refuses send-before-event even when the send date would satisfy an upper deadline',async()=>{
    expect(await qualifyControlledZ10MChronology(fixture({sent:'2026-09-29T22:59:59Z'})))
      .toMatchObject({status:'not_established',reason:'send_before_event',deadlineDate:null,queries:[]})
  })
  it('does not turn an actual observation before a future event/send into timely evidence',async()=>{
    expect(await qualifyControlledZ10MChronology(fixture({received:'2026-09-29T22:00:00Z'})))
      .toMatchObject({status:'not_established',reason:'send_after_observation',deadlineDate:null,queries:[]})
  })
  it('preserves microsecond ordering rather than rounding a later send to the same ingress millisecond',async()=>{
    expect(await qualifyControlledZ10MChronology(fixture({sent:'2026-10-14T12:00:00.000002Z',received:'2026-10-14T12:00:00.000001Z'})))
      .toMatchObject({status:'not_established',reason:'send_after_observation',queries:[]})
    expect(await qualifyControlledZ10MChronology(fixture({sent:'2026-10-14T14:00:00.000001+02:00',received:'2026-10-14T12:00:00.000001Z'})))
      .toMatchObject({status:'on_time',deadlineDate:'2026-10-14'})
  })
  it.each(['2026-11-31T10:00:00Z','2026-10-14T24:00:00Z','2026-10-14T10:00:60Z','2026-10-14T10:00:00'])('rejects invalid/offset-free send %s',async dispatchedAt=>{
    const input=fixture();input.send.dispatchedAt=dispatchedAt
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'chronology_unavailable',queries:[]})
  })
  it.each(['fixtureId','sourceMessageId','companyId','environment','payloadHash','meteringPointId','objectId','identityAgency',
    'issuerEdielId','receiverEdielId','oldMeter','newMeter'] as const)('rejects a different event %s binding',async key=>{
    const input=fixture()
    Object.assign(input.event,{[key]:'different-controlled-binding'})
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'source_binding_mismatch',queries:[]})
  })
  it('binds physical source bytes and version, not a copied version string',async()=>{
    const input=fixture();rebindWire(input,input.source.rawPayload.replace('E2SE6A','E2SE6B'))
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'source_version_mismatch',queries:[]})
  })
  it.each(['0',''] as const)('does not relabel physical production flag %s as a controlled test source',async flag=>{
    const input=fixture();rebindWire(input,input.source.rawPayload.replace('23-DDQ-PRODAT++++1',
      flag?'23-DDQ-PRODAT++++'+flag:'23-DDQ-PRODAT'))
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'source_wire_invalid',queries:[]})
  })
  it('rejects changed physical bytes and a send observation bound to another payload',async()=>{
    const changed=fixture();changed.source.rawPayload+=' '
    expect(await qualifyControlledZ10MChronology(changed)).toMatchObject({status:'not_established',reason:'source_binding_mismatch',queries:[]})
    const otherSend=fixture();otherSend.send.payloadHash='0'.repeat(64)
    expect(await qualifyControlledZ10MChronology(otherSend)).toMatchObject({status:'not_established',reason:'source_binding_mismatch',queries:[]})
  })
  it.each(['actorRole','direction'] as const)('does not accept a different controlled %s GIVEN',async key=>{
    const input=fixture();Object.assign(input.source,{[key]:key==='actorRole'?'GRID_OWNER':'outbound'})
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'source_binding_mismatch',queries:[]})
  })
  it('does not promote wire document creation or a different claimed event minute',async()=>{
    const input=fixture();input.event.marketMinute='202609171200'
    expect(await qualifyControlledZ10MChronology(input)).toMatchObject({status:'not_established',reason:'event_binding_mismatch',queries:[]})
  })
  it('requires the physical M reason, legal parties and first register event boundary',async()=>{
    for(const [before,after] of [['CAV+E58','CAV+Z22'],['NAD+FR+60001','NAD+FR+60002'],['DTM+157:202609300000','DTM+92:202609300000']]){
      const input=fixture();rebindWire(input,input.source.rawPayload.replace(before,after))
      expect((await qualifyControlledZ10MChronology(input)).status).toBe('not_established')
    }
  })
  it('retains its private calendar snapshot when supplied rows are subsequently mutated',async()=>{
    const stable=await qualifyControlledZ10MChronology(fixture({closed:['2026-10-05']})),input=fixture({closed:['2026-10-05']})
    const pending=qualifyControlledZ10MChronology(input)
    for(const row of input.calendar.rows)row.is_business_day=false
    input.calendar.rows=[]
    const result=await pending
    expect(result).toEqual(stable)
  })
})
