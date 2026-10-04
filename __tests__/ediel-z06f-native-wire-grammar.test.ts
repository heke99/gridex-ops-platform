import {expect,it} from 'vitest'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {z06fNativeStructureWire,z06fNativeReadingWire} from '../scripts/helpers/ediel-z06f-reading-followup-native-wire'
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
