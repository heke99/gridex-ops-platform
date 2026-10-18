import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {isValidElement,type ReactNode} from 'react'
const fixture=vi.hoisted(()=>({cursor:0,state:[] as unknown[],fetch:vi.fn()}))
// Declared synthetic React hook state. Invoke the actual component's actual
// click handler and fetch orchestration; no DOM/browser/native proof is claimed.
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{
 const index=fixture.cursor++
 if(!(index in fixture.state))fixture.state[index]=initial
 return [fixture.state[index],(value:unknown)=>{fixture.state[index]=value}]
}}))
import Workspace from '@/app/retention/decision-evidence/workspace'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',policyId='00000000-0000-4000-8000-000000000004'
const retentionClass='completed_decision_review_reason',permissions=['ediel.retention.purge','ediel.retention.completed_review_reason']
const policy={companyId:company,policyId,retentionClass,targetId:actor,sourceHash:'a'.repeat(64),documentHash:'b'.repeat(64),bytesAvailable:true,issuerQualified:true,currentQualified:true,submittedBy:actor,reviews:[],purge:null,revoked:false}
function text(node:ReactNode):string{
 if(typeof node==='string'||typeof node==='number')return String(node)
 if(Array.isArray(node))return node.map(text).join('')
 if(isValidElement<{children?:ReactNode}>(node))return text(node.props.children)
 return ''
}
function buttons(node:ReactNode):{onClick:()=>Promise<void>;children?:ReactNode}[]{
 if(Array.isArray(node))return node.flatMap(buttons)
 if(!isValidElement<{children?:ReactNode;onClick:()=>Promise<void>}>(node))return []
 return [...(node.type==='button'?[node.props]:[]),...buttons(node.props.children)]
}
async function purge(){
 fixture.cursor=0
 const view=Workspace({companyId:company,userId:actor,permissions})
 const button=buttons(view).find(b=>text(b.children)==='Gallra beslutad motivering')
 expect(button).toBeDefined();await button!.onClick()
}
beforeEach(()=>{
 vi.resetAllMocks();fixture.cursor=0
 fixture.state=[retentionClass,actor,{documentHash:'c'.repeat(64),targetMetadataHash:'d'.repeat(64),bytesAvailable:true,documentByteLength:20},null,null,policyId,policy,'',false,'']
 vi.stubGlobal('fetch',fixture.fetch)
})
afterEach(()=>{vi.unstubAllGlobals()})
it.each([false,true])('retains the successful purge receipt when a following GET would deny, replay=%s',async replay=>{
 fixture.fetch.mockImplementation(async(_url:string,options?:RequestInit)=>options?.method==='POST'
  ?{ok:true,json:async()=>({status:'purged',replay,authority:'none'})}
  :{ok:false,json:async()=>({error:'EXPIRED_DISCLOSURE_DENIED'})})
 await purge()
 expect(fixture.fetch).toHaveBeenCalledExactlyOnceWith(`/api/ediel/decision-evidence-retention/${policyId}/purge`,expect.objectContaining({method:'POST',body:'{}',cache:'no-store'}))
 expect(fixture.state[6]).toBeNull();expect(fixture.state[2]).toBeNull();expect(fixture.state[8]).toBe(false)
 expect(fixture.state[9]).toContain('bekräftad');expect(fixture.state[9]).not.toContain('EXPIRED_DISCLOSURE_DENIED')
 if(replay)expect(fixture.state[9]).toContain('Tidigare')
})
it('keeps a held result distinct from completed purge without an obligatory disclosure read',async()=>{
 fixture.fetch.mockResolvedValue({ok:true,json:async()=>({status:'held',authority:'none'})})
 await purge();expect(fixture.fetch).toHaveBeenCalledTimes(1);expect(fixture.state[6]).toBeNull();expect(fixture.state[2]).toBeNull()
 expect(fixture.state[9]).toContain('hålls');expect(fixture.state[9]).not.toContain('bekräftad')
})
it('does not display success when the purge POST itself is denied',async()=>{
 fixture.fetch.mockResolvedValue({ok:false,json:async()=>({error:'CURRENT_NATIVE_CLASS_DENIED'})})
 await purge();expect(fixture.fetch).toHaveBeenCalledTimes(1);expect(fixture.state[9]).toBe('CURRENT_NATIVE_CLASS_DENIED');expect(fixture.state[9]).not.toContain('bekräftad');expect(fixture.state[8]).toBe(false)
})
