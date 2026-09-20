import {it,expect,vi} from 'vitest'
import {raw,characteristic,type Parts} from './fixtures/prodat-register'
import {source,z10} from './fixtures/prodat-identity'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>({select:()=>({limit:async()=>({error:{message:'SYNTHETIC_ABSENT_TABLE'}})})})}}))
import {deriveProdatAperakValidationIssues,resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
it('actual legacy TGT registry preserves valid control and exact224 negative without typed readiness requirements',async()=>{
 for(const same of [false,true]){
  const parts=z10().map(p=>same&&p[0]==='RFF'&&(p[1] as string[])[0]==='Z02'?['RFF',['Z02','NEW']] as Parts:p)
  parts.splice(3,0,...characteristic('Z02','1',3))
  const message=source(raw(parts,'Z10'),'Z10'),testData={suite:'PRODAT',roleCode:'supplier',testCaseCode:'AUTO',title:'Synthetic source control',sourceNote:'No live data',groups:[]} as const
  const issues=deriveProdatAperakValidationIssues({message,testData}),resolved=await resolveAndStoreProdatAperakErrors({message,testData})
  if(!same){expect(issues).toEqual([]);expect(resolved.errors).toEqual([]);continue}
  expect(issues.some(i=>i.ruleKey==='meter_number_invalid')).toBe(true)
  const error=resolved.errors.find(e=>e.fieldCode==='224')!
  expect(error).toMatchObject({ercCode:'42',fieldCode:'224',text:'Felaktigt mätarnummer NEW',referenceNumber:'735123456789012345',lineItemReference:'EVENT'})
  expect(error.prodatAperakText).toBeUndefined()
  const wire=tokenizeEdifact(buildAperakDraft({sourceMessage:message,outcome:'negative',applicationErrors:resolved.errors}).rawPayload!)
  expect(wire.segments.filter(s=>s.tag==='FTX').map(s=>segmentComposite(s,4,wire.una))).toContainEqual(['Felaktigt mätarnummer NEW'])
 }
})
