import {it,expect,afterAll} from 'vitest'
import {writeFileSync} from 'node:fs'
import {input,type Parts} from '@/__tests__/fixtures/prodat-register'
import {deathRaw,deathBody} from '@/__tests__/fixtures/prodat-death-status'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {source} from '@/__tests__/fixtures/prodat-identity'
const observations:unknown[]=[]
afterAll(()=>writeFileSync('/workspace/scratch/2a201d6d5897/aperak-text-runtime-fix1-20260920/related-owner-observations.json',JSON.stringify(observations,null,2)))
for(const extra of [false,true])it(`death owner adjacent CAV ${extra?'fault retains all candidates':'control'}`,()=>{
 const status:Parts[]=[['CCI','','Z17'],['CAV','Z41'],...(extra?[['CAV','BAD']]:[])]
 const wire=deathRaw('Z06',deathBody('E34',status)),p=projectProdatDiagnostics(validateProdatDeathStatus({...input(wire,'Z06'),code:'Z06',direction:'inbound'}))
 let draft:string|undefined;if(extra)draft=buildAperakDraft({sourceMessage:source(wire,'Z06'),outcome:'negative',applicationErrors:p.applicationErrors}).rawPayload!
 observations.push({extra,p,draft})
 if(!extra)expect(p.applicationErrors).toEqual([])
 else{expect(p.applicationErrors).toHaveLength(1);expect(p.applicationErrors[0].text).toContain('BAD')}
})
