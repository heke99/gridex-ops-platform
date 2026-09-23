import {expect,it} from 'vitest'
import {structuralOwnerSource} from './helpers/structuralOwnerFixtures'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
it.each([['Z04','Z22'],['Z06','E34'],['Z06','E64'],['Z06','E32'],['Z10','E58']] as const)('actual canonical engine validates synthetic %s/%s original', (code,reason)=>{
 const result=resolveCanonicalRuntimeDecision(structuralOwnerSource(code,reason))
 expect([result.syntaxDecision,result.applicationDecision,result.functionalDecision],JSON.stringify(result.issues)).toEqual(['accepted','accepted','accepted'])
})
