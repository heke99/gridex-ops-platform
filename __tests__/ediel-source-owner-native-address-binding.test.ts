// local/122: native fixture address binding, not native/business acceptance.
import {describe,expect,it} from 'vitest'
import {bindNativeFixturePartyAddresses} from '../scripts/helpers/ediel-native-party-addresses'
import {nativeCalendarShiftDays,shiftMarketDates,viaOriginalCalendar} from './helpers/nativeMarketCalendar'
import {observationHandoffMessage} from './helpers/utiltsObservationHandoff'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {utiltsObservationOrderGuideIssues} from '@/lib/ediel/utilts/observationOrderGuide'

const days=nativeCalendarShiftDays(new Date('2026-11-07T00:29:05.125Z'))
const S=(value:string)=>shiftMarketDates(value,days)
const handoff=viaOriginalCalendar(observationHandoffMessage,days)

describe('native fixture party address token binding',()=>{
 for(const sender of ['60000','73001','89999'])for(const end of ['202610150000','202611010000'])
 it(`keeps shifted observation order for ${sender} through ${end}`,()=>{
  const raw=handoff(S('2026-09-30'),'synthetic-tenant').raw_payload!
  const bound=bindNativeFixturePartyAddresses(raw,{sender,receiver:'40000'})
   .replaceAll(S('202607010000'),S('202610010000'))
   .replaceAll(S('202608010000'),S(end)).replace('?+0200','?+0100')
  const wire=tokenizeEdifact(bound)
  const times=wire.segments.filter(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='597')
   .map(s=>segmentComposite(s,1,wire.una)[1])
  const unb=wire.segments.find(s=>s.tag==='UNB')!
  const partyIds=wire.segments.filter(s=>s.tag==='NAD'&&['MS','MR'].includes(segmentComposite(s,1,wire.una)[0]))
   .map(s=>segmentComposite(s,2,wire.una)[0])
  expect({days,times,issues:utiltsObservationOrderGuideIssues(bound),unbSender:segmentComposite(unb,2,wire.una)[0],
   unbReceiver:segmentComposite(unb,3,wire.una)[0],partyIds}).toEqual({days:41,times:[S(end),S('202610010000'),S(end)],
   issues:[],unbSender:sender,unbReceiver:'40000',partyIds:[sender,'40000']})
 })
 it('preserves non-address wire bytes including DTM QTY FTX control references and framing',()=>{
  const raw=["UNA:+.? '","UNB+UNOC:3+91100:ZZ+21660:ZZ+261107:1200+91100++23-DDQ-E66-S++1'",
   "NAD+MS+91100:SVK:260'","NAD+MR+21660:SVK:260'","DTM+597:202609110000:203'","QTY+136:91100'",
   "FTX+AAI+++unchanged ⚡ 91100 21660 91100:ZZ'","UNZ+1+91100'"].join('\r\n')
  const expected=["UNA:+.? '","UNB+UNOC:3+73001:ZZ+40000:ZZ+261107:1200+91100++23-DDQ-E66-S++1'",
   "NAD+MS+73001:SVK:260'","NAD+MR+40000:SVK:260'","DTM+597:202609110000:203'","QTY+136:91100'",
   "FTX+AAI+++unchanged ⚡ 91100 21660 91100:ZZ'","UNZ+1+91100'"].join('\r\n')
  expect(bindNativeFixturePartyAddresses(raw,{sender:'73001',receiver:'40000'})).toBe(expected)
 })
})
