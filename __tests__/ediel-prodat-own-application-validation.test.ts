import {bindDeathStatusSourceContext,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {deathRaw,deathSelection} from './fixtures/prodat-death-status'
import {source as prodatSource} from './fixtures/prodat-identity'
import {describe,it,expect,vi} from 'vitest'
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async importOriginal=>{
  const actual=await importOriginal<typeof import('@/lib/ediel/rulebook/canonicalRulePackRegistry')>()
  const rulePackId='00000000-0000-4000-8000-000000000012',messageProfileId='00000000-0000-4000-8000-000000000011',profileKey='PRODAT:Z04:L:26.A:r3',sourceHash='a'.repeat(64)
  return {...actual,resolveCanonicalRulePack:async()=>({profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey:profileKey,sourceHash,messageProfileId,rulePackId,
    originalVersion:'26.A:r3',originalSnapshot:{rulePack:{id:rulePackId,guide_version:'26.A',guide_revision:'3',source_hash:sourceHash},
      messageProfile:{id:messageProfileId,rule_pack_id:rulePackId,profile_key:profileKey},guideSources:[]}})}
})
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatApplicationObjects} from '@/lib/ediel/core/runtimeDecision'
import {projectProdatApplicationObjects,bindReceivedProdatApplicationObjects,qualifyReceivedProdatApplicationObject} from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import {projectProdatRegisterValidation} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {prodatFieldDiagnostic,prodatLocalDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {ownerSourceWithInstallationStatus as ownerSource} from './helpers/sourceOwnerFixtures'
import {raw,line,input} from './fixtures/prodat-register'
import {head} from './fixtures/prodat-identity'

function pure(){
  const source=raw([...head(),line('1','A',undefined,'9'),line('2','B',undefined,'9')]),wire=tokenizeEdifact(source)
  const register=projectProdatRegisterValidation({code:'Z04',rawSegments:wire.segments.map(s=>s.raw),una:wire.una,
    registerIssues:[],fieldIssues:[],completeRuleSelection:true,handledFields:new Set(['213'])})
  return {source,wire,register}
}
describe('complete same-invocation PRODAT application scope',()=>{
  it('a qualified own field rejection does not borrow its outcome into a sibling',()=>{
    const {source,register}=pure(),diagnostic=prodatFieldDiagnostic('213','missing',input(source),[],'OWN',0)
    const facet=projectProdatApplicationObjects({register,completeInvocation:true,issues:[{severity:'error',blocking:true,code:'OWN',title:'Own',description:'Own',prodatDiagnostic:diagnostic}]})
    expect(facet.headerDecision).toBe('accepted')
    expect(facet.objects.map(o=>o.applicationDecision)).toEqual(['rejected','accepted'])
    const received=bindReceivedProdatApplicationObjects({...facet,sourcePayloadHash:evidenceHash(source)},source)!
    const scope={messageIndex:register.objects[1].messageIndex,messageReference:register.objects[1].messageReference,objectId:register.objects[1].objectId,identityAgency:register.objects[1].identityAgency,registers:register.objects[1].registers}
    expect(qualifyReceivedProdatApplicationObject(received,scope)).toBe(true)
    expect(qualifyReceivedProdatApplicationObject(received,{...scope,objectId:'OTHER'})).toBe(false)
  })
  it('a qualified header error rejects every own object without fabricating a local reference',()=>{
    const {source,register}=pure(),diagnostic=prodatFieldDiagnostic('204','missing',input(source),[],'HEADER',undefined,'header')
    const facet=projectProdatApplicationObjects({register,completeInvocation:true,issues:[{severity:'error',blocking:true,code:'HEADER',title:'Header',description:'Header',prodatDiagnostic:diagnostic}]})
    expect(facet.headerDecision).toBe('rejected');expect(facet.objects.map(o=>o.applicationDecision)).toEqual(['rejected','rejected'])
  })
  for(const kind of ['internal','local_unknown','local_evidence'] as const)it(`unqualified ${kind} does not infer own acceptance from absent national errors`,()=>{
    const {register}=pure(),facet=projectProdatApplicationObjects({register,completeInvocation:true,issues:[{severity:'error',blocking:true,code:'UNKNOWN',title:'Unknown',description:'Unknown',prodatDiagnostic:prodatLocalDiagnostic(kind,'OWN','Unknown owner')}]})
    expect(facet.headerDecision).toBe('held');expect(facet.objects.map(o=>o.applicationDecision)).toEqual(['held','held'])
  })
  it('a dependent-only or incomplete selection cannot produce an accepted object',()=>{
    const {register}=pure(),facet=projectProdatApplicationObjects({register,completeInvocation:false,issues:[]})
    expect(facet.objects.map(o=>o.applicationDecision)).toEqual(['held','held'])
  })
  it('scope binding rejects omitted/copied registers, source changes and extra authority fields',()=>{
    const {source,register}=pure(),facet={...projectProdatApplicationObjects({register,completeInvocation:true,issues:[]}),sourcePayloadHash:evidenceHash(source)}
    expect(bindReceivedProdatApplicationObjects(facet,source)).not.toBeNull()
    for(const bad of [{...facet,objects:[facet.objects[0]]},{...facet,objects:[facet.objects[0],facet.objects[0]]},{...facet,sourcePayloadHash:'f'.repeat(64)},{...facet,businessAccepted:true}])expect(bindReceivedProdatApplicationObjects(bad,source)).toBeNull()
  })
})

// Only registry IO is synthetic. Actual syntax, full field owner and immutable
// source handoff run together; this is not a native original/registry proof.
it('actual full canonical owner marks its application facet and refuses copied authority',async()=>{
  const message=ownerSource('Z12'),decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  const facet=readReceivedCanonicalProdatApplicationObjects(decision,message)
  expect(facet?.objects.map(o=>o.applicationDecision)).toEqual(['accepted'])
  const evidence=buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision})
  expect(evidence?.prodatApplicationValidation).toEqual(facet)
  expect(readReceivedCanonicalProdatApplicationObjects(structuredClone(decision),message)).toBeNull()
  expect(readReceivedCanonicalProdatApplicationObjects(decision,{...message,raw_payload:message.raw_payload+' '})).toBeNull()
  decision.responsePlan=[]
  expect(readReceivedCanonicalProdatApplicationObjects(decision,message)).toBeNull()
})

it('actual complete invocation accepts the good object while rejecting a sibling missing its own quantity',async()=>{
  const message=ownerSource('Z12'),wire=tokenizeEdifact(message.raw_payload!),first=wire.segments.findIndex(t=>t.tag==='LIN'),end=wire.segments.findIndex(t=>t.tag==='UNT')
  const body=wire.segments.slice(first,end).map(t=>t.raw),second=body.map(segment=>segment.replace('LIN+1+','LIN+2+').replaceAll('735123456789012345','735123456789012346').replaceAll('CASE-1','CASE-2'))
  const all=[...wire.segments.slice(0,first).map(t=>t.raw),...body.filter(segment=>!segment.startsWith('QTY+31')), ...second]
  const unh=all.findIndex(segment=>segment.startsWith('UNH+')),rawPayload="UNA:+.? '"+all.join("'")+"'UNT+"+(all.length-unh+1)+"+M'UNZ+1+I'"
  message.raw_payload=rawPayload
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message),facet=readReceivedCanonicalProdatApplicationObjects(decision,message)
  expect(decision.applicationDecision).toBe('rejected')
  expect(facet?.headerDecision).toBe('accepted')
  expect(facet?.objects.map(o=>[o.objectId,o.applicationDecision])).toEqual([['735123456789012345','rejected'],['735123456789012346','accepted']])
  expect(decision.responsePlan.filter(p=>p.family==='APERAK').flatMap(p=>p.applicationErrors??[]).map(e=>e.referenceNumber)).toEqual(['735123456789012345'])
})

it('qualified death context enters the same full field invocation; copies and serialized facts cannot choose it',()=>{
  const message={...prodatSource(deathRaw(),'Z06'),company_id:'00000000-0000-4000-8000-000000000002'}
  const basis: Extract<DeathStatusValidationContext,{direction:'inbound'}>={kind:'customer_life_event',direction:'inbound',code:'Z06',companyId:message.company_id,environment:'test',sourceMessageId:message.id,
    sourceContextReceiptId:'00000000-0000-4000-8000-000000000001',sourceContextFactsHash:'b'.repeat(64),rawPayload:message.raw_payload!,sourceEventId:'synthetic-event',sourceRevision:'2',sourceDigest:'a'.repeat(64),businessContext:'death',bilateralCapabilityVerified:false,selection:deathSelection()}
  const context=bindDeathStatusSourceContext(basis)
  const decision=resolveCanonicalRuntimeDecision(message,{deathStatusContext:context})
  expect(decision.policy?.prodatDependentFacts?.deathStatus).toEqual(context.selection)
  expect(decision.issues.some(issue=>issue.code==='PRODAT_DEATH_STATUS_REQUIRED')).toBe(true)
  expect(resolveCanonicalRuntimeDecision(message,{deathStatusContext:structuredClone(context)}).policy).toBeNull()
  expect(resolveCanonicalRuntimeDecision({...message,parsed_payload:{deathStatusContext:context,deathStatus:context.selection}}).policy?.prodatDependentFacts?.deathStatus).toBeUndefined()
})
it('syntax rejection runs before any supplied death context access',()=>{
  const message={...ownerSource('Z12'),raw_payload:ownerSource('Z12').raw_payload!.replace(/UNT\+[0-9]+/, 'UNT+999')}
  const facts={get deathStatusContext():never{throw Error('must not read context before syntax')}}
  expect(resolveCanonicalRuntimeDecision(message,facts).syntaxDecision).toBe('rejected')
})
