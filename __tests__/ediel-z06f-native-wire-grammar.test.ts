import {describe,expect,it} from 'vitest'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {z06fNativeStructureWire,z06fNativeReadingWire,z06fNativeRequestedStartDate} from '../scripts/helpers/ediel-z06f-reading-followup-native-wire'
const scope={external:'735123456789012345',sender:'54321',receiver:'12345',brpEdielId:'99876',caseReference:'ACTUAL-SOURCE-CASE',gridAreaCode:'TES',requestedStartDate:'2026-10-03'}
it.each(['F','G'] as const)('native synthetic complete Z06%s input uses qualified full97A before any source owner',kind=>{
 const raw=z06fNativeStructureWire(scope,kind,'SOURCE-DOCUMENT')
 expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true)
 const grammar=validateUnsmGrammar(raw);expect(grammar.qualification).toBe('qualified');expect(grammar.sources[0].key).toBe('PRODAT:D:97A:UN');expect(grammar.syntaxOk,JSON.stringify(grammar.issues)).toBe(true)
 expect(raw).not.toContain('NAD+UD');expect(raw).toContain('RFF+LI:ACTUAL-SOURCE-CASE')
})
it.each([{}, {register:'901'}, {meter:'FOREIGN-METER'}, {agency:'89'}, {date:'next-day' as const}, {quantity:'NULL'}])('native MDR reading input %j has qualified full02B; source acceptance is a separate native owner',options=>{
 const raw=z06fNativeReadingWire(scope,options),grammar=validateUnsmGrammar(raw)
 expect(validateEdifactEnvelope(raw).syntaxOk).toBe(true);expect(grammar.qualification).toBe('qualified');expect(grammar.sources[0].key).toBe('UTILTS:D:02B:UN');expect(grammar.syntaxOk,JSON.stringify(grammar.issues)).toBe(true)
 expect(raw).toContain('NAD+MS+12345:SVK:260');expect(raw).toContain('NAD+MR+54321:SVK:260');expect(raw).toContain('STS+7++E64::260')
})

describe('native Z06 F fixture start date is calendar-stable',()=>{
 it('keeps the change instant and its next-day contrast on whole-month reading periods for every Stockholm date',()=>{
  const fixtureScope={external:'735999260731000007',sender:'21660',receiver:'91100',brpEdielId:'11111',caseReference:'C',gridAreaCode:'TES'}
  for(let day=0;day<366;day++){
   const today=new Date(Date.UTC(2026,0,1)+day*86400000).toISOString().slice(0,10)
   const requestedStartDate=z06fNativeRequestedStartDate(today)
   expect(requestedStartDate>today).toBe(true)
   for(const date of [undefined,'next-day'] as const){
    const period=z06fNativeReadingWire({...fixtureScope,requestedStartDate},{date}).match(/DTM\+324:(\d{12})(\d{12}):719/)!
    const [start,end]=[period[1],period[2]]
    const next=new Date(Date.UTC(+start.slice(0,4),+start.slice(4,6)-1+1,+start.slice(6,8)))
    expect(end.slice(0,8)).toBe(next.toISOString().slice(0,10).replaceAll('-',''))
   }
  }
 })
})
