import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {it,expect,vi} from 'vitest'
import {msg,prior} from './fixtures/prodat-prior-flow'
import {parseProdatMessage} from '@/lib/ediel/prodat/parser'
import {validateProdatPermissionMessage} from '@/lib/ediel/testing/prodatPermissionEngine'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('NO_LIVE_DB')}}}))
function resolver(rows:Record<string,unknown>[]){
 const reads:{table:string;ops:unknown[][]}[]=[]
 const db={from:(table:string)=>{const ops:unknown[][]=[];reads.push({table,ops});const q:Record<string,unknown>={then:(done:(v:unknown)=>unknown)=>done({data:rows.filter(row=>ops.every(([op,k,v])=>op==='eq'?row[String(k)]===v:op==='in'?(v as unknown[]).includes(row[String(k)]):true)),error:null})};for(const op of ['select','eq','in','not','lte','order','limit'])q[op]=(...v:unknown[])=>{ops.push([op,...v]);return q};return q}}
 const path='app/admin/ediel/actions.part-3.ts',f=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),code=f.statements.filter(s=>ts.isFunctionDeclaration(s)&&['resolveProdatPermissionContextForAck','uniqueNonEmpty'].includes(s.name?.text??'')).map(s=>s.getText(f).replace(/^export /,'')).join('\n')
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 return {reads,run:new Function('supabaseService','parseProdatMessage',js+';return resolveProdatPermissionContextForAck')(db,parseProdatMessage) as (m:ReturnType<typeof msg>)=>Promise<unknown>}
}
it('A1 excludes another company before retrieving raw candidates',async()=>{const r=resolver([prior('Z13','CASE-ALPHA',{company_id:'OTHER'})]);const result=await r.run(msg());expect(r.reads[0].ops).toContainEqual(['eq','company_id',msg().company_id]);expect(result).toMatchObject({kind:'internal_review'})})
it('A1 ownerless source cannot query raw candidates',async()=>{const r=resolver([prior()]);await r.run({...msg(),company_id:null} as unknown as ReturnType<typeof msg>);expect(r.reads).toEqual([])})
for(const li of ['PREFIX-CASE-ALPHA','case-alpha'])it('A3 exact LI rejects '+li,async()=>{const r=resolver([prior('Z13',li)]);expect(await r.run(msg('Z14','Z96'))).toMatchObject({kind:'internal_review'})})
it('A6 empty history is internal and never national105',async()=>{const r=resolver([]);const context=await r.run(msg());expect(context).toMatchObject({kind:'internal_review'});expect(()=>validateProdatPermissionMessage({message:msg(),context:context as never})).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')})
it('A6 draft is not dispatch evidence',async()=>{const r=resolver([prior('Z13','CASE-ALPHA',{status:'draft',message_sent_at:null})]);expect(await r.run(msg())).toMatchObject({kind:'internal_review'})})
it('A4 distinct exact candidates are ambiguous',async()=>{const r=resolver([prior(),prior('Z13','CASE-ALPHA',{id:'SECOND'})]);expect(await r.run(msg())).toMatchObject({kind:'internal_review'})})
it('A8 caller-authored success cannot qualify permission relation',()=>{expect(()=>validateProdatPermissionMessage({message:msg(),context:{hasMatchingPriorPermissionFlow:true,matchReason:'unchecked'}})).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')})
