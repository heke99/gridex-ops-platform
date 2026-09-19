import {selectedAddressFact,selectedInvoiceeFact} from './fixtures/prodat-ud'
import {it,expect} from 'vitest'
import {buildProfiledProdatSegments} from '@/lib/ediel/prodat/builders/profileRenderer'
import {validateEdielTgtDraft} from '@/lib/ediel/testing/tgtEdifact'
import {deathRaw,deathBody} from './fixtures/prodat-death-status'
import type {EdielTgtExpectedStep} from '@/lib/ediel/testing/tgtRegistry'
it('profile renderer projects source-required Z09E without redundant event facts',()=>{
 const result=buildProfiledProdatSegments({context:{code:'Z09',senderEdielId:'12345',receiverEdielId:'54321',bgmReference:'DOC',transactionReference:'LI-A',customerName:'Synthetic',customerId:'CUSTOMER-A',meterPointId:'A',meterPointIdAgency:'89'},mode:'test',variant:'E',generatedAt:new Date('2026-09-19T12:00:00Z')})
 expect(result.segments).toEqual(expect.arrayContaining(['CCI++Z17','CAV+Z41']))
 expect(result.issues.filter(i=>i.code.startsWith('PRODAT_DEATH_STATUS_'))).toEqual([])
 expect(result.diagnostics.dependentConditionStatuses?.find(i=>i.fieldNumber==='310')).toMatchObject({status:'required',decisionPhase:'rendered_wire_death_status'})
})
it('TGT actual validator enforces source Z09E and tolerates eligible U absence',()=>{
 const step={stepNo:1,family:'PRODAT',code:'Z09',actor:'portal',direction:'inbound'} as EdielTgtExpectedStep
 expect(validateEdielTgtDraft(deathRaw('Z09'),step).map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_REQUIRED')
 expect(validateEdielTgtDraft(deathRaw('Z06',deathBody()),{...step,code:'Z06'}).filter(i=>i.code.startsWith('PRODAT_DEATH_STATUS_'))).toEqual([])
})
import {buildProdatMessage,type BuildProdatMessageInput} from '@/lib/ediel/prodat/buildProdat'
import {deathSelection} from './fixtures/prodat-death-status'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
it('generic pure builder projects own source Z09E status and retains explicit invalid caller status',()=>{
 const request:BuildProdatMessageInput={companyId:'tenant',role:'supplier',businessCode:'Z09',transactionSubtype:'E',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'A',identityAgency:'89'},customer:{id:'CUSTOMER-A',idAgency:'89',name:'Synthetic',address:'Street',city:'Town',postalCode:'12345',country:'SE'},dates:{validityStartDate:'202610010000'},references:{LI:'LI-A'},codedAttributes:{Z13:'E34'},environment:'test',dependentConditionFacts:{endUserAddressObjects:[selectedAddressFact('A','tenant','89','CUSTOMER-A',['Street'])],invoiceeObjects:[selectedInvoiceeFact('A','tenant','89','CUSTOMER-A',['Street'],'','12345','Town','SE')]}}
 expect(buildProdatMessage(request).rawEdifact).toContain("CCI++Z17'CAV+Z41'")
 expect(()=>buildProdatMessage({...request,codedAttributes:{Z13:'E34',Z17:'BAD'}})).toThrow('endast Z41 är giltigt')
})
it('profile binds independent Z06E source facts and preserves released LI/actor data',()=>{
 const selection=deathSelection(),o=selection.objects[0];o.lineItemReference="LI+CCI:Z17?'UNH";o.legalGridOwner={id:"GRID+NAD:FR?'UNH",qualifier:'160',agency:'SVK'};o.legalSupplier={id:'54321',qualifier:'160',agency:'SVK'}
 const context={code:'Z06' as const,senderEdielId:'12345',receiverEdielId:'54321',legalSenderId:o.legalGridOwner.id,bgmReference:'DOC',transactionReference:o.lineItemReference,customerName:'Synthetic',customerId:'CUSTOMER-A',customerIdAgency:'89' as const,meterPointId:'A',meterPointIdAgency:'89' as const,businessContext:'death' as const,dependentConditionFacts:{deathStatus:selection}}
 const result=buildProfiledProdatSegments({context,variant:'E',mode:'test'})
 expect(result.issues.filter(i=>i.code.startsWith('PRODAT_DEATH_STATUS_'))).toEqual([])
 const wire=tokenizeEdifact(result.segments.join("'")+"'")
 expect(wire.segments.filter(t=>t.tag==='RFF').map(t=>segmentComposite(t,1,wire.una))).toContainEqual(['LI',o.lineItemReference])
 const cleared=buildProfiledProdatSegments({context,variant:'E',mode:'test',portalSnapshot:{dependentConditionFacts:{deathStatus:null}}})
 expect(cleared.segments).not.toContain('CCI++Z17')
 expect(cleared.issues.map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_UNDETERMINED')
})
