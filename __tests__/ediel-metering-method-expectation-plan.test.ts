import {describe,expect,it} from 'vitest'
import {prepareEdielMeteringMethodExpectationPlan,EDIEL_METERING_METHOD_EXPECTATION_CONSTRAINTS} from '@/lib/ediel/meteringMethodExpectationPolicy'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {source,head} from './fixtures/prodat-identity'
import {raw,line,characteristic,alphabets} from './fixtures/prodat-register'
import type {EdielMessageRow} from '@/lib/ediel/types'
const policy=(subtype='F')=>resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z09',subtypeOrReasonCode:subtype,direction:'outbound',referenceDate:'2026-09-30',mode:'catalog_evidence'})
const message=(date='202612312300',alphabet:readonly string[]=alphabets[0]):EdielMessageRow=>({...source(raw([...head(),line('1','735123456789012345',undefined,'9'),
 ['DTM',['157',date,'203']],...characteristic('Z13','E64'),...characteristic('Z04','Z04')],'Z09',alphabet),'Z09'),direction:'outbound',message_sent_at:'2026-10-15T09:00:00Z'})
describe('source-validity-day metering-method watch',()=>{
 it('uses frozen HB197–199 forty calendar days from own Z09 validity, never SMTP',()=>{
  expect(prepareEdielMeteringMethodExpectationPlan(message(),policy())).toMatchObject({ruleId:'TM-METHOD40',offset:40,unit:'calendar_days',anchor:'z09_validity_day',
   validityDay:'2026-12-31',sourceSubtype:'F',expectedCode:'Z06',automaticResendAllowed:false,deadlineSource:{edition:'26A',section:'10.2.1',pages:'198'}})
  expect(EDIEL_METERING_METHOD_EXPECTATION_CONSTRAINTS.constraint.anchor).toBe('validity_date_from_Z09_F_or_G')
 })
 it('preserves the same admitted policy projection with alternate UNA',()=>{
  const p=policy('G'),m=message('202610010000',alphabets[1]);m.raw_payload=m.raw_payload!.replace('E64','E32').replace('CAV;Z04','CAV;Z03')
  const plan=prepareEdielMeteringMethodExpectationPlan(m,p)
  expect(plan?.validityDay).toBe('2026-10-01');expect(plan?.policy.sourceTrace).toBe(p.sourceTrace)
  expect(Object.isFrozen(plan)).toBe(true)
 })
 it('does not invent method deadlines for another Z09 subtype',()=>expect(prepareEdielMeteringMethodExpectationPlan(message(),policy('E'))).toBeNull())
 it('holds missing, ambiguous and invalid physical validity anchors',()=>{
  const m=message();m.raw_payload=m.raw_payload!.replace("DTM+157:202612312300:203'",'')
  expect(()=>prepareEdielMeteringMethodExpectationPlan(m,policy())).toThrow(/validity_day_required/)
  const duplicate=message();duplicate.raw_payload=duplicate.raw_payload!.replace("DTM+157:202612312300:203'","DTM+157:202612312300:203'DTM+157:202612312300:203'")
  expect(()=>prepareEdielMeteringMethodExpectationPlan(duplicate,policy())).toThrow(/validity_day_required/)
  expect(()=>prepareEdielMeteringMethodExpectationPlan(message('202602302300'),policy())).toThrow(/validity_day_invalid/)
 })
 it('holds actual multiple-message/object sources before provider entry',()=>{
  const m=message();m.raw_payload=m.raw_payload!.replace("UNT+", "LIN+2++OTHER:::9'UNT+")
  expect(()=>prepareEdielMeteringMethodExpectationPlan(m,policy())).toThrow(/own_message_required/)
 })
})
