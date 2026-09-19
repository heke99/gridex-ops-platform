import {it,expect} from 'vitest'
import type {EdielTgtCaseTestData} from '@/lib/ediel/testing/tgtTestData'
import {buildEdielTgtDraft,getEdielTgtDraftOptionsForCase} from '@/lib/ediel/testing/tgtEdifact'
import {buildProfiledProdatSegments} from '@/lib/ediel/prodat/builders/profileRenderer'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
// Actual registered EL producers, synthetic settings. No readiness or external portal claim.
for(const [testCaseCode,code,reason] of [['1.2.5','Z04','Z70'],['2.1.1','Z06','E64'],['2.1.2','Z06','E64'],['2.1.3','Z06','E32']])it(`active ${testCaseCode} ${code}/${reason} needs no GAS producer`,()=>{
 const step=getEdielTgtDraftOptionsForCase('PRODAT','supplier',testCaseCode).find(s=>s.canGenerate&&s.family==='PRODAT'&&s.code===code)!
 expect(step).toBeDefined()
 const columns=[{name:code+(reason==='Z70'?'D':reason==='E64'?'F':'G'),index:0,sourceOrder:0,testCase:testCaseCode}]
 const values:Record<string,string>={'209':'735123456789012345','210':'202610010000','508':'15:806','217':'Z03','223':reason,'224':'METER','260':'TES','227':'199001011234','228':'Synthetic','229':'Street','231':'12345','232':'Town','316':'SE'}
 const fields=Object.entries(values).map(([fieldCode,value])=>({fieldCode,fieldName:fieldCode,values:{[columns[0].name]:value}}))
 const importedTestData:EdielTgtCaseTestData={suite:'PRODAT',roleCode:'supplier',testCaseCode,title:'Synthetic source',sourceNote:'No external certification',groups:[{columns,fields,block:{kind:'PRODAT',sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'A',entityNumbers:['1'],columns,fields}}]}
 const result=buildEdielTgtDraft({importedTestData,actorUserId:'actor',testSuite:'PRODAT',roleCode:'supplier',testCaseCode,stepNo:step.stepNo,systemTestContext:{companyId:'tenant-A',testSuite:'PRODAT',actorSettingId:null,actorEdielId:'12345',actorName:null,senderSubaddress:null,testPortalEdielId:'54321',testPortalName:null,testPortalEmail:null,defaultReceiverSubaddress:'PRODAT',testBrpEdielId:'11111',testBrpName:null,settings:null}})
 const wire=tokenizeEdifact(result.rawPayload)
 expect(wire.segments.some((t,i)=>t.tag==='CCI'&&segmentComposite(t,2,wire.una)[0]==='Z13'&&segmentComposite(wire.segments[i+1],1,wire.una)[0]===reason)).toBe(true)
 expect(wire.segments.filter(t=>t.tag==='RFF'&&['Z08','Z06'].includes(segmentComposite(t,1,wire.una)[0]))).toEqual([])
 expect(result.validationIssues.filter(i=>i.code.startsWith('PRODAT_GAS_'))).toEqual([])
 expect(gasApplicabilitySendIssue({message_family:'PRODAT',message_code:code,raw_payload:result.rawPayload,direction:'outbound'})).toBeNull()
})
it('profile final decisions use resolved EL despite forged root GAS facts',()=>{
 const result=buildProfiledProdatSegments({context:{code:'Z04',senderEdielId:'12345',receiverEdielId:'54321',bgmReference:'DOC',transactionReference:'LI',customerName:'Synthetic',meterPointId:'A',meterPointIdAgency:'89',dependentConditionFacts:{market:'gas'}},variant:'D',mode:'test'})
 expect(result.issues.filter(i=>i.code.startsWith('PRODAT_GAS_'))).toEqual([])
 expect(result.diagnostics.dependentConditionStatuses?.filter(i=>['320','240'].includes(i.fieldNumber as string))).toEqual([
  expect.objectContaining({fieldNumber:'320',status:'not_required',requirement:'forbidden',decisionPhase:'rendered_wire_gas'}),
  expect.objectContaining({fieldNumber:'240',status:'not_required',requirement:'forbidden',decisionPhase:'rendered_wire_gas'}),
 ])
})
