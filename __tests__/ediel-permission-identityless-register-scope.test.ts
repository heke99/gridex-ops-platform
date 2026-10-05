// masterplan: P-07, AT-P-07
import {expect,it} from 'vitest'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import type {ProdatRegisterValidationEvidence} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {bindReceivedProdatApplicationObjects,type ProdatApplicationObjectValidation} from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import {prodatIdentityOmissionCases} from '@/lib/ediel/prodat/prodatIdentityOmissionScope'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {alphabets,characteristic,input,raw,type Parts} from './fixtures/prodat-register'
function assess(code:string,reason:string,body:Parts[],alphabet:readonly string[]=alphabets[0]){
 const applicationReference=['Z13','Z14'].includes(code)?'23-DGI-PRODAT':'23-DDQ-PRODAT'
 const payload=raw(body,code,alphabet).replace('23-DDQ-PRODAT',applicationReference),wire=input(payload,code)
 let register:ProdatRegisterValidationEvidence|undefined,application:ProdatApplicationObjectValidation|undefined
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:reason,direction:'inbound',referenceDate:'2026-10-01',applicationReference,mode:'parse'})
 const issues=validateCanonicalPolicyFields({policy,...wire,onRegisterValidation:value=>{register=value},onApplicationObjects:value=>{application=value}})
 if(!register||!application)throw Error('actual canonical owner missing')
 return {register,application,issues,payload}
}
it('derives only prescribed field209 omission cases from the same owners',()=>{
 expect(prodatIdentityOmissionCases()).toEqual([{messageCode:'Z14',transactionReason:'Z96'},{messageCode:'Z13',transactionReason:'S17'},{messageCode:'Z13',transactionReason:'S18'}])
})
for(const alphabet of alphabets)it(`actual canonical Z14N keeps mandatory LIN without inventing identity ${alphabet.join('')}`,()=>{
 const result=assess('Z14','N',[
 ['NAD','FR',['54321','160','SVK'],'','','','','','','SE'],['NAD','DO',['12345','160','SVK'],'','','','','','','SE'],
 ['LIN','1'],...characteristic('Z13','Z96'),...characteristic('Z23','A76'),['RFF',['LI','REQUEST']],
 ],alphabet)
 expect(result.register.objects).toMatchObject([{objectId:null,identityAgency:null,disposition:'accepted',registers:[{lineNumber:'1',registerIndex:null,registerPosition:1}]}])
 expect(bindReceivedRegisterValidation(result.register,result.payload)).toEqual(result.register)
 expect(result.application.headerDecision).toBe('accepted')
 expect(result.application.objects[0].applicationDecision).toBe('accepted')
})
it.each(['S17','S18'])('identityless Z13%s register scope stays physical and separate from whole application guidance',reason=>{
 const result=assess('Z13',reason==='S17'?'V':'VH',[['LIN','1'],...characteristic('Z13',reason),['RFF',['LI','OWN']]])
 expect(result.register.objects[0]).toMatchObject({objectId:null,identityAgency:null,disposition:'accepted'})
 expect(bindReceivedRegisterValidation(result.register,result.payload)).toEqual(result.register)
 expect(result.application.headerDecision).not.toBe('accepted') // independent required header/UD/source conditions still hold
})
it.each([
 ['positive','Z14','V',[['LIN','1'],...characteristic('Z13','S17')]],
 ['foreigncode','Z04','L',[['LIN','1'],...characteristic('Z13','Z22')]],
 ['unknownreason','Z14','N',[['LIN','1'],...characteristic('Z13','N')]],
 ['partialidentity','Z14','N',[['LIN','1','',['','','','9']],...characteristic('Z13','Z96')]],
 ['register','Z14','N',[['LIN','1','','',['1','1']],...characteristic('Z13','Z96')]],
 ['sequence','Z14','N',[['LIN','0'],...characteristic('Z13','Z96')]],
 ['repeatedreason','Z14','N',[['LIN','1'],...characteristic('Z13','Z96'),...characteristic('Z13','Z96')]],
] as [string,string,string,Parts[]][])('does not mint omission privileges for %s',(_name,code,reason,body)=>{
 const result=assess(code,reason,body)
 expect(result.register.objects[0].disposition).not.toBe('accepted')
 const forged=structuredClone(result.register);forged.objects[0].disposition='accepted';forged.objects[0].reasons=[]
 expect(bindReceivedRegisterValidation(forged,result.payload)).toBeNull()
})
it('does not erase or borrow another physical object when binding absence',()=>{
 const first=assess('Z14','N',[['LIN','1'],...characteristic('Z13','Z96'),['RFF',['LI','ONE']],['LIN','2'],...characteristic('Z13','Z96'),['RFF',['LI','TWO']]])
 expect(first.register.objects.map(object=>object.registers[0].lineIndex)).toEqual([0,1])
 expect(bindReceivedRegisterValidation(first.register,first.payload)).toEqual(first.register)
 const forged=structuredClone(first.register);forged.objects[1].registers=forged.objects[0].registers
 expect(bindReceivedRegisterValidation(forged,first.payload)).toBeNull()
})

it('retains independent own negative guidance on prescribed identityless scope',()=>{
 const result=assess('Z14','N',[['NAD','FR',['54321','160','SVK'],'','','','','','','SE'],['NAD','DO',['12345','160','SVK'],'','','','','','','SE'],['LIN','1'],...characteristic('Z13','Z96'),...characteristic('Z23','INVALID'),['RFF',['LI','REQUEST']]])
 expect(result.register.objects[0].disposition).toBe('accepted')
 expect(result.application.objects[0].applicationDecision).toBe('rejected')
 const facet={...result.application,sourcePayloadHash:evidenceHash(result.payload)}
 expect(bindReceivedProdatApplicationObjects(facet,result.payload)).toEqual(facet)
})
