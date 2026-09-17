import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import { compareInboundPayloadToTgtTestData } from '@/lib/ediel/testing/tgtAutoMatcher'
import { applyInboundZ15PermissionState } from '@/lib/ediel/flows/prodatPermissionLifecycle'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { parseInboundProdat } from '@/lib/ediel/prodat/compatAdapter'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'

// Every DB boundary is explicit and in-memory. No market message is sent.
const db = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), event: vi.fn(), link: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: db }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: db.event, linkEdielMessage: db.link }))
beforeEach(() => {
  vi.clearAllMocks()
  db.from.mockImplementation(() => { throw new Error('Unexpected DB request in DTM read test') })
})
const point = '735999999999999999'
function payload(code: string, body: string[], header = ['DTM+137:202609171200:203','DTM+ZZZ:1:805']): string {
  const segments = ['UNH+M+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+DOCUMENT+9+AB`,...header,
    'NAD+FR+12345:160:SVK+++++++SE','NAD+DO+54321:160:SVK+++++++SE',`LIN+1++${point}:::9`,...body]
  return "UNA:+.? 'UNB+UNOC:3+12345:14+54321:14+260917:1200+I++23-DGI-PRODAT'" + [...segments,`UNT+${segments.length+1}+M`,'UNZ+1+I'].join("'")+"'"
}
const alternate = (s: string) => 'UNA*;.! ~' + s.slice(9).replace(/:/g,'*').replace(/\+/g,';').replace(/\?/g,'!').replace(/'/g,'~')
function message(raw: string | null, code='Z04', parsed: Record<string,unknown> = {}): EdielMessageRow {
  return {id:'message-id',company_id:'tenant-A',direction:'inbound',message_family:'PRODAT',message_code:code,raw_payload:raw,parsed_payload:parsed,environment:'test'} as EdielMessageRow
}
function testData(field: string, expected: string): EdielTgtCaseTestData {
  const columns = [{name:'obj',index:0,sourceOrder:0,testCase:'SYNTHETIC-DTM'}]
  const fields = [{fieldCode:field,fieldName:`Synthetic field ${field}`,values:{obj:expected}}]
  const block = {kind:'PRODAT' as const,sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'Synthetic object',entityNumbers:['1'],columns,fields}
  return {suite:'PRODAT',roleCode:'supplier',testCaseCode:'SYNTHETIC-DTM',title:'Synthetic DTM',sourceNote:'Synthetic behavior test, not portal evidence',groups:[{block,columns,fields}]}
}
const explicitDates = [ ['210','92','202610011230'],['211','93','202611011230'],['216','157','202609301230'],
  ['212','51','202610021230'],['302','90','202610031230'],['321','91','202611021230'],['326','693','202609161230'],['327','164','202612011230'],
] as const

describe('DTM source dates reach consumers without stale metadata or semantic aliases', () => {
  for (const custom of [false,true]) {
    const transform = custom ? alternate : (s:string)=>s
    it(`staging uses wire contract date, not cached or validity date (custom=${custom})`, () => {
      const raw = transform(payload('Z04',['DTM+92:202610011230:203','DTM+157:202510011230:203']))
      const staged = parseInboundProdatBusinessData(message(raw,'Z04',{contractStartDate:'19990101'}))
      expect(staged.site.contractStartDate).toBe('202610011230')
      expect(staged.contract.startDate).toBe('202610011230')
      expect(db.from).not.toHaveBeenCalled()
    })
    for (const body of [[],['DTM+92:202602301230:203'],['LIN+2','DTM+92:202610011230:203']]) {
      it(`staging cannot fill missing/invalid date ${JSON.stringify(body)} (custom=${custom})`, () => {
        expect(parseInboundProdatBusinessData(message(transform(payload('Z04',body)),'Z04',{startDate:'19990101'})).site.contractStartDate).toBeNull()
      })
    }
    for (const [field,q,date] of explicitDates) {
      it(`TGT compares supplied source field ${field} including clock (custom=${custom})`, () => {
        const row = message(transform(payload('Z04',[`DTM+${q}:${date}:203`])))
        expect(compareInboundPayloadToTgtTestData({message:row,testData:testData(field,date)})).toEqual([])
        expect(compareInboundPayloadToTgtTestData({message:row,testData:testData(field,date.slice(0,10)+'31')})).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:field})]))
      })
    }
    it(`TGT distinguishes period units (custom=${custom})`, () => {
      const row = message(transform(payload('Z04',['DTM+354:1:802'])))
      expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('508','1:802')})).toEqual([])
      expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('508','1:801')})).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'508'})]))
    })
    it(`TGT compares header time and offset only in the first header (custom=${custom})`, () => {
      const row = message(transform(payload('Z04',['DTM+137:200001011200:203'])))
      expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('205','202609171200')})).toEqual([])
      expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('205','200001011200')})).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'205'})]))
    })
    it(`compatibility ingress keeps distinct explicit wire dates (custom=${custom})`, () => {
      const parsed = parseInboundProdat(transform(payload('Z04',['DTM+92:202610011230:203','DTM+157:202609301230:203'])))
      expect(parsed.parsedPayload).toMatchObject({contractStartDate:'202610011230',validityStartDate:'202609301230'})
    })
  }
  it('keeps explicit fallback only for records genuinely lacking a wire payload', () => {
    expect(parseInboundProdatBusinessData(message(null,'Z04',{contractStartDate:'2026-10-01'})).site.contractStartDate).toBe('2026-10-01')
  })
})

describe('DTM production renderer and narrow source-backed exceptions', () => {
  const base: ProdatEngineProductionContext = {code:'Z03',bgmReference:'DOCUMENT',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:point,customerId:'USR',customerName:'Synthetic User',customerIdAgency:'89',customerCountry:'SE',siteAddress:'Test street',siteCountry:'SE',reasonForTransaction:'Z22'}
  it('preserves contract clock instead of flattening to midnight', () => {
    const result = buildProfiledProdatSegments({context:{...base,startDate:'2026-10-01T12:30'},generatedAt:new Date('2026-07-01T12:30Z')})
    expect(result.segments).toContain('DTM+92:202610011230:203')
    expect(result.segments).toContain('DTM+137:202607011330:203')
  })
  it('preserves explicitly different contract and validity dates in Z06', () => {
    const result = buildProfiledProdatSegments({context:{...base,code:'Z06',reasonForTransaction:'E64',contractStartDate:'2026-10-01T12:30',validityStartDate:'2026-09-30T12:45'},variant:'F'})
    expect(result.segments).toEqual(expect.arrayContaining(['DTM+92:202610011230:203','DTM+157:202609301245:203']))
  })
  it('does not turn a report/permission end into contract closure', () => {
    const result = buildProfiledProdatSegments({context:{...base,code:'Z08',reasonForTransaction:'E58',permissionEndDate:'2026-10-01'},variant:'H'})
    expect(result.segments.some(s => s.startsWith('DTM+93:'))).toBe(false)
  })
  it('does not require the optional permission creation timestamp in Z18', () => {
    const raw = payload('Z18',['DTM+164:202610011230:203','CCI++Z13','CAV+S17','CCI++Z25','CAV+1','RFF+Z09:PERMISSION','RFF+LI:CASE','RFF+Z05:NET','NAD+UD+USR::89++Synthetic User+++++SE'])
    const result = preflightEdielPayload({rawPayload:raw,messageStandard:'edifact',mode:'send'})
    expect(result.issues.some(i=>i.code==='PRODAT_Z18_DTM_693_MISSING')).toBe(false)
  })
  it('finite nonhistorical reporting end does not imply historical S18', () => {
    const raw = payload('Z13',['DTM+90:202610011230:203','DTM+91:202610021230:203','CCI++Z13','CAV+S17','NAD+UD+USR::89++Synthetic User+++++SE'])
    const result = preflightEdielPayload({rawPayload:raw,messageStandard:'edifact',mode:'send'})
    expect(result.issues.some(i=>i.code==='PRODAT_Z13VH_REASON_FOR_TRANSACTION_MISMATCH')).toBe(false)
    expect(parseProdatMessage(raw).lineItems[0].isHistoricalMeteringRequest).toBe(false)
  })
})

describe('DTM Z15 persistence consumes permission end164, never contract/report dates', () => {
  function memoryPermission() {
    db.from.mockImplementation((table: string) => {
      if (table !== 'metering_permissions') throw new Error(`Unexpected ${table}`)
      let writing = false
      const q = {select:vi.fn(),eq:vi.fn(),in:vi.fn(),order:vi.fn(),limit:vi.fn(),update:vi.fn(),then:vi.fn()}
      for(const name of ['select','eq','in','order','limit'] as const) q[name].mockReturnValue(q)
      q.update.mockImplementation((patch:Record<string,unknown>)=>{writing=true;db.update(patch);return q})
      q.then.mockImplementation((resolve:(value:unknown)=>unknown)=>Promise.resolve({data:writing?[{id:'permission-row'}]:[{id:'permission-row',company_id:'tenant-A',permission_reference:'PERMISSION',metadata:{retained:true}}],error:null}).then(resolve))
      return q
    })
  }
  it('persists permission end timestamp and explicit DATE projection', async () => {
    memoryPermission()
    const row = message(payload('Z15',['DTM+164:202610011230:203','RFF+Z09:PERMISSION','CCI++Z13','CAV+S17']),'Z15V')
    expect((await applyInboundZ15PermissionState({actorUserId:'actor',message:row})).applied).toBe(true)
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({approved_end_date:'2026-10-01',metadata:expect.objectContaining({z15:expect.objectContaining({permissionEndTimestamp:'202610011230'})})}))
  })
  for(const dates of [[],['DTM+164:202602301230:203'],['DTM+93:202610011230:203'],['DTM+91:202610011230:203'],['DTM+164:20261001:102'],['DTM+164:202610011230:203','LIN+2','DTM+164:202611011230:203']]) {
    it(`cannot mutate permission state with unsupported date evidence ${JSON.stringify(dates)}`, async () => {
      memoryPermission()
      const row = message(payload('Z15',[...dates,'RFF+Z09:PERMISSION','CCI++Z13','CAV+S17']),'Z15V')
      expect((await applyInboundZ15PermissionState({actorUserId:'actor',message:row})).applied).toBe(false)
      expect(db.update).not.toHaveBeenCalled()
    })
  }
})


describe('complete preflight and expected-date regression controls', () => {
  const body = ['DTM+164:202610011230:203','CCI++Z13','CAV+S17','CCI++Z25','CAV+1','RFF+Z09:PERMISSION','RFF+LI:CASE','RFF+Z05:NET','NAD+UD+USR::89++Synthetic User+++++SE']
  for (const transform of [(value: string) => value, alternate]) {
    it('accepts a complete Z18 without optional creation693', () => {
      const result = preflightEdielPayload({rawPayload:transform(payload('Z18',body)),messageStandard:'edifact',mode:'send'})
      expect(result.issues.filter(i => i.severity === 'error')).toEqual([])
      expect(result.ok).toBe(true)
    })
    for (const changed of [body.filter(value => !value.startsWith('DTM+164')), body.map(value => value.replace('202610011230:203','202602301230:203')), body.map(value => value.replace('202610011230:203','20261001:102'))]) {
      it('blocks missing/invalid end164 even with valid header dates', () => {
        expect(preflightEdielPayload({rawPayload:transform(payload('Z18',changed)),messageStandard:'edifact',mode:'send'}).blocking).toBe(true)
      })
    }
    for (const header of [ ['DTM+ZZZ:1:805'], ['DTM+137:202609171200:203'], ['DTM+137:202609171200:203','DTM+ZZZ:2:805'] ]) {
      it('blocks missing message time205 or absent/wrong standard offset206', () => {
        expect(preflightEdielPayload({rawPayload:transform(payload('Z18',body,header)),messageStandard:'edifact',mode:'send'}).blocking).toBe(true)
      })
    }
  }
  it('compares a portal period annotation without discarding its format', () => {
    const row = message(payload('Z04',['DTM+354:1:802']))
    expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('508','1 (2379=802)')})).toEqual([])
    expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('508','1 (2379=801)')})).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'508'})]))
  })
  it('accepts the explicit optional birth annotation but not arbitrary garbage', () => {
    const row = message(payload('Z04',['DTM+329:20000229:102']))
    expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('249','20000229 (optional)')})).toEqual([])
    expect(compareInboundPayloadToTgtTestData({message:row,testData:testData('249','garbage20000229')})).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'249'})]))
  })
})
