import {it,expect} from 'vitest'
import {payload,fields} from './fixtures/prodat-gas'
import {resolveProdatDependentCondition} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
// Fixed independent source expectations P26.A r3 p21,p65,p77,p110,p119,123.
// Source-valid Z10M/E58; invalid early Z10F scratch history is not an oracle.
it('EL outgoing excludes320 and240 even when values supplied',()=>{
 const r=fields(payload('Z04','Z22',[['RFF',['Z08','HEAT']],['RFF',['Z06','SERIAL']]]))
 expect(r.filter(i=>i.severity==='error'||i.blocking)).toHaveLength(2)
})
it('GAS Z06E must not require320',()=>expect(resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'320',facts:{market:'gas',canonicalSubtype:'E'}})?.status).toBe('not_required'))
it('GAS Z06E240 is optional, not required',()=>expect(resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'240',facts:{market:'gas',canonicalSubtype:'E'}})?.status).toBe('not_required'))
it('GAS Z06F240 missing serial-change evidence stays U',()=>expect(resolveProdatDependentCondition({messageCode:'Z06',fieldNumber:'240',facts:{market:'gas',canonicalSubtype:'F'}})?.status).toBe('undetermined'))
it('GAS Z10M240 missing serial-change evidence stays U',()=>expect(resolveProdatDependentCondition({messageCode:'Z10',fieldNumber:'240',facts:{market:'gas',canonicalSubtype:'M'}})?.status).toBe('undetermined'))
it('actual EL inbound wire is sufficient to eliminate320/240 U blockers',()=>{
 const r=validateRulebookMessage({family:'PRODAT',code:'Z04',rawPayload:payload(),direction:'inbound',mode:'parse'})
 expect(r.issues.filter(i=>['RFF+Z08','RFF+Z06'].includes(i.fieldPath??'')&&(i.severity==='error'||i.blocking))).toEqual([])
})
