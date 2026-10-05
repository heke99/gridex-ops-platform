import {it,expect,vi} from 'vitest'
import type {ProdatDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {raw} from '@/__tests__/fixtures/prodat-register'
import {source,z10} from '@/__tests__/fixtures/prodat-identity'
const state=vi.hoisted(()=>({mutation:'none'}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>({profileKey:'synthetic',sourceHash:'evidence',messageProfileId:'profile',rulePackId:'pack'})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
vi.mock('@/lib/ediel/rulebook/canonicalPolicyFieldValidator',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/rulebook/canonicalPolicyFieldValidator')>()
 return {...actual,validateCanonicalPolicyFields:(input:Parameters<typeof actual.validateCanonicalPolicyFields>[0])=>actual.validateCanonicalPolicyFields(input).map(i=>{
 if(i.prodatDiagnostic?.kind!=='field'||i.prodatDiagnostic.fieldNumber!=='226'||state.mutation==='none')return i;
 const diagnostic: Partial<Extract<ProdatDiagnostic,{kind:'field'}>>={...i.prodatDiagnostic};
 if(state.mutation==='missing-component')delete diagnostic.component;
 if(state.mutation==='invalid-occurrence')diagnostic.occurrence={...i.prodatDiagnostic.occurrence,lineIndex:-1,registerPosition:-1};
 if(state.mutation==='empty-component')diagnostic.component={};
 if(state.mutation==='wrong-component')diagnostic.component={...diagnostic.component,valueElement:'C082'};
 if(state.mutation==='zero-register')diagnostic.occurrence={...i.prodatDiagnostic.occurrence,registerPosition:0};
 if(state.mutation==='header-object')diagnostic.occurrence={...i.prodatDiagnostic.occurrence,scope:'header'};
 if(state.mutation==='absent-line-with-object')diagnostic.occurrence={...i.prodatDiagnostic.occurrence,lineIndex:null};
 return {...i,prodatDiagnostic:diagnostic as ProdatDiagnostic};
 })}
})
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
it('complete typed missing226 remains qualified',async()=>{
 state.mutation='none';const d=await resolveCanonicalRuntimeDecisionWithRegistry(source(raw(z10(false),'Z10'),'Z10'));
 expect(d.prodatProcessingDisposition?.kind).toBe('continue');expect(d.responsePlan.find(p=>p.family==='APERAK')?.applicationErrors?.[0]).toMatchObject({ercCode:'41',fieldCode:'226'});
})
for(const mutation of ['missing-component','invalid-occurrence','empty-component','wrong-component','zero-register','header-object','absent-line-with-object'])it(mutation+' must remain internal until complete owned metadata exists',async()=>{
 state.mutation=mutation;const msg=source(raw(z10(false),'Z10'),'Z10'),d=await resolveCanonicalRuntimeDecisionWithRegistry(msg);
 const plan=d.responsePlan.find(p=>p.family==='APERAK');
 expect(d.prodatProcessingDisposition?.kind).toBe('internal_review');expect(plan).toBeUndefined();
})

import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {prodatErrorOccurrence} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {parseUna} from '@/lib/ediel/core/una'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
it('requires the special109 source rule while retaining a qualified special109',()=>{
 const payload=raw(z10(),'Z10'),tokens=tokenizeEdifact(payload).segments.map(t=>t.raw);
 const occurrence=prodatErrorOccurrence({rawSegments:tokens,una:parseUna(payload)},tokens,'object')!;
 for(const sourceRule of ['PRODAT26A:P17/93/121','']){
 const result=projectProdatDiagnostics([{code:'PRODAT_DATE_EVENT_XOR',severity:'error',blocking:true,title:'Both dates',description:'Both contract dates',prodatDiagnostic:{kind:'application',ercCode:'40',applicationCode:'109',sourceRule,occurrence}}]);
 expect(result.disposition.kind).toBe(sourceRule?'continue':'internal_review');expect(result.applicationErrors).toHaveLength(sourceRule?1:0);
 }
})
