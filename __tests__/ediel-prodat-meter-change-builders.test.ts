import {it,expect} from 'vitest'
import {buildProdatMessage} from '@/lib/ediel/prodat/buildProdat'
import {buildZ10Segments} from '@/lib/ediel/prodat/builders/z10'
import {validateEdielTgtDraft} from '@/lib/ediel/testing/tgtEdifact'
import {meterChange,changeRaw,changeBody,changeFields} from './fixtures/prodat-meter-change'
import type {EdielTgtExpectedStep} from '@/lib/ediel/testing/tgtRegistry'
function selection(){const s=meterChange(true);s.objects[0].legalGridOwner={id:'12345',qualifier:'160',agency:'SVK'};s.objects[0].legalSupplier={id:'54321',qualifier:'160',agency:'SVK'};return s}
const generic=()=>({companyId:'tenant',role:'supplier',businessCode:'Z10',transactionSubtype:'M',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A',identityAgency:'89' as const},environment:'test',dates:{validityStartDate:'202610010000',observationLength:'15',observationLengthFormat:'806'},codedAttributes:{Z13:'E58',Z04:'Z04',Z15:'Z32',Z14:'L639Q'},references:{MG:'NEW-A',Z02:'OLD-A',LI:'EVENT-A'},dependentConditionFacts:{market:'electricity' as const,registerObjects:[{meteringPointId:'A',identityAgency:'89' as const,expectedRegisterCount:1,meterReadingsSentInUtilts:false}],dateEventObjects:[{kind:'change_before_supply' as const,meteringPointId:'A',identityAgency:'89' as const,change:{reference:'change',revision:'1'},contract:{reference:'contract',revision:'1'},changeEffectiveAt:'202610010000',supplyStartsAt:'202609010000',supplier:{id:'54321',qualifier:'160',agency:'SVK'}}]}})
it('generic pure builder rejects selected output without independently assessed change facts',()=>{
 expect(()=>buildProdatMessage(generic())).toThrow('oberoende ändrings-/tröskelfakta saknas')
})
it('generic pure builder validates supplied output against its own new facts',()=>{
 const request={...generic(),dependentConditionFacts:{...generic().dependentConditionFacts,meterChange:selection()}}
 expect(buildProdatMessage(request).validation.issues.filter(i=>i.code.startsWith('PRODAT_METER_CHANGE_'))).toEqual([])
 request.codedAttributes.Z15='Z31'
 expect(()=>buildProdatMessage(request)).toThrow('angivet värde avviker från oberoende nyvärde')
})
it('profile renderer renders known required own characteristics and replacement refs from pure facts',()=>{
 const result=buildZ10Segments({context:{code:'Z10',senderEdielId:'12345',receiverEdielId:'54321',bgmReference:'DOC',transactionReference:'EVENT-A',customerName:'Synthetic',meterPointId:'A',meterPointIdAgency:'89',validityStartDate:'202610010000',meteringMethod:'Z04',dependentConditionFacts:{meterChange:selection()}},mode:'test',variant:'M',generatedAt:new Date('2026-09-19T12:00:00Z')})
 expect(result.segments).toEqual(expect.arrayContaining(['CCI++Z15','CAV+Z32','CCI++Z14','CAV+:::L639Q','RFF+MG:NEW-A','RFF+Z02:OLD-A']))
 expect(result.issues.filter(i=>i.code.startsWith('PRODAT_METER_CHANGE_'))).toEqual([])
})
it('TGT actual draft validator treats portal inbound as U and does not invent history',()=>{
 const step={stepNo:1,family:'PRODAT',code:'Z10',actor:'portal',direction:'inbound'} as EdielTgtExpectedStep
 const issues=validateEdielTgtDraft(changeRaw(changeBody(changeFields('BAD','INVALID'))),step)
 expect(issues.map(i=>i.code)).toContain('PRODAT_METER_CHANGE_FIELD_INVALID')
 const absent=validateEdielTgtDraft(changeRaw(),step)
 expect(absent.filter(i=>i.code.startsWith('PRODAT_METER_CHANGE_'))).toEqual([])
})

import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
it('actual profile renderer preserves combined service characters in independently bound LI, meter and legal actor refs',()=>{
 const s=selection(),o=s.objects[0];o.li="LI+CCI:Z15?UNH'BGM+Z10";o.oldMeter.number="OLD+RFF:MG?'UNH";o.newMeter.number="NEW+RFF:MG?'UNH";o.legalGridOwner.id="GRID+NAD:FR?'UNH"
 const result=buildZ10Segments({context:{code:'Z10',senderEdielId:'12345',receiverEdielId:'54321',legalSenderId:o.legalGridOwner.id,bgmReference:'DOC',transactionReference:o.li,customerName:'Synthetic',meterPointId:'A',meterPointIdAgency:'89',validityStartDate:'202610010000',meteringMethod:'Z04',dependentConditionFacts:{meterChange:s}},mode:'test',variant:'M',generatedAt:new Date('2026-09-19T12:00:00Z')})
 expect(result.issues.filter(i=>i.code.startsWith('PRODAT_METER_CHANGE_'))).toEqual([])
 const wire=tokenizeEdifact(result.segments.join("'")+"'")
 expect(wire.segments.filter(t=>t.tag==='RFF').map(t=>segmentComposite(t,1,wire.una))).toEqual(expect.arrayContaining([['LI',o.li],['MG',o.newMeter.number],['Z02',o.oldMeter.number]]))
 expect(wire.segments.filter(t=>t.tag==='UNH')).toHaveLength(0)
})
