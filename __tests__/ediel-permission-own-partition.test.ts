// masterplan: SC-011, SC-023
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {applyPermissionMarketSource, type PermissionObjectDisposition, type PermissionMarketTransitionResult} from '@/lib/ediel/permissions/permissionMarketTransition'
import {applyInboundZ15PermissionState} from '@/lib/ediel/flows/prodatPermissionLifecycle'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {applyInboundProdatZ14ToMeteringPermission} from '@/lib/onboarding/inboundEdielLinking'
import {applyZ14SnapshotToMeteringPermission} from '@/lib/onboarding/infoRequests'

// This native source-owner IO port models only the typed consumer contract.
// The companion SQL regression runs the real executor/ledgers/attester.
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),event:vi.fn(),governance:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:io.event}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:io.governance}))
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const source=(code='Z14')=>({id:id(30),company_id:id(1),direction:'inbound',message_family:'PRODAT',message_code:code,
 raw_payload:"UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z15+DOC'LIN+1++POINT-A:::9'LIN+2'"}) as EdielMessageRow
const scope=(line:number,point:string|null='POINT-A')=>({messageIndex:0,messageReference:'M',objectId:point,identityAgency:'9',
 registers:[{lineIndex:line,lineNumber:String(line+1),registerIndex:null,registerPosition:0,segmentIndex:5+line}]})
const partition=()=>({version:1,applied:true,permissionId:id(10) as string|null,status:'partially_approved',idempotent:false,
 sourceMessageId:id(30),sourceCode:'Z14',canonicalAssessmentId:id(1030),sourcePayloadHash:'a'.repeat(64),
 manifest:[{object:scope(0),status:'applied',permissionId:id(10),reason:null},
  {object:scope(1,null),status:'rejected',reason:'own_application_not_accepted'}] as PermissionObjectDisposition[],
 permissionResults:[{applied:true,permissionId:id(10),status:'partially_approved'}] as NonNullable<PermissionMarketTransitionResult['permissionResults']>})
beforeEach(()=>{vi.clearAllMocks();io.rpc.mockResolvedValue({data:partition(),error:null})
 io.from.mockImplementation((table:string)=>{const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:table==='ediel_messages'?source():{id:id(10),company_id:id(1),status:'partially_approved'},error:null})};return query})})

describe('permission consumers preserve the actual full native partition',()=>{
 it('passes only actual source/tenant/execution actor and the selected expected owner',async()=>{
  const result=await applyPermissionMarketSource({actorUserId:id(2),message:source(),expectedPermissionId:id(10)})
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_permission_source_v1',{p_company_id:id(1),p_source_message_id:id(30),p_actor_user_id:id(2),p_expected_permission_id:id(10)})
  expect(result.manifest?.map(x=>x.status)).toEqual(['applied','rejected'])
  expect(result).toMatchObject({sourceMessageId:id(30),canonicalAssessmentId:id(1030),sourcePayloadHash:'a'.repeat(64),fullyApplied:false,reviewRequired:true})
 })
 it('uses the same full-source owner for Z15 with a malformed sibling',async()=>{
  io.rpc.mockResolvedValue({data:{...partition(),sourceCode:'Z15'},error:null})
  const result=await applyInboundZ15PermissionState({actorUserId:id(2),message:source('Z15')})
  expect(io.rpc).toHaveBeenCalledOnce()
  expect(result).toMatchObject({applied:true,status:'partially_approved',manifest:partition().manifest})
 })
 it('preserves multiple independently scoped parents without a first-permission fallback',async()=>{
  const actual=partition();actual.permissionId=null
  actual.permissionResults.push({applied:true,permissionId:id(20),status:'active'})
  actual.manifest[1]={object:scope(1,'POINT-B'),status:'applied',permissionId:id(20),reason:null}
  io.rpc.mockResolvedValue({data:actual,error:null})
  const result=await applyPermissionMarketSource({actorUserId:id(2),message:source()})
  expect(result.permissionId).toBeNull();expect(result.permissionResults).toHaveLength(2)
  expect(result).toMatchObject({fullyApplied:true,reviewRequired:false})
 })
 it('treats source-qualified N denial as processed, without calling it approval',async()=>{
  const actual=partition();actual.status='rejected_active';actual.permissionResults[0].status='rejected_active'
  actual.manifest=[{object:{...scope(0,null),identityAgency:null},status:'applied',permissionId:id(10),reason:null}]
  io.rpc.mockResolvedValue({data:actual,error:null})
  const result=await applyInboundProdatZ14ToMeteringPermission({actorUserId:id(2),message:source()})
  expect(result).toMatchObject({applied:true,status:'rejected_active',fullyApplied:true,reviewRequired:false})
  expect(io.event.mock.calls[0][0].message).not.toContain('godkänd')
  expect(io.event.mock.calls[0][0].payload).toMatchObject({manifest:actual.manifest,permissionResults:actual.permissionResults,status:'rejected_active'})
 })
 it('returns the exact full partition and warning event for a mixed source',async()=>{
  const result=await applyInboundProdatZ14ToMeteringPermission({actorUserId:id(2),message:source()})
  expect(result).toMatchObject({manifest:partition().manifest,permissionResults:partition().permissionResults,fullyApplied:false,reviewRequired:true})
  expect(io.event.mock.calls[0][0]).toMatchObject({eventType:'linked',eventStatus:'warning',payload:{canonicalAssessmentId:id(1030),sourcePayloadHash:'a'.repeat(64)}})
 })
 it('manual application checks the exact selected parent in a multi-parent receipt',async()=>{
  const actual=partition();actual.permissionId=null;actual.permissionResults.push({applied:true,permissionId:id(20),status:'active'})
  actual.manifest[1]={object:scope(1,'POINT-B'),status:'applied',permissionId:id(20),reason:null}
  io.rpc.mockResolvedValue({data:actual,error:null})
  await expect(applyZ14SnapshotToMeteringPermission({companyId:id(1),actorUserId:id(2),permissionId:id(10),sourceMessageId:id(30)})).resolves.toMatchObject({id:id(10)})
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_permission_source_v1',{p_company_id:id(1),p_source_message_id:id(30),p_actor_user_id:id(2),p_expected_permission_id:id(10)})
 })
 it('manual selection cannot borrow another parent effect while its own parent is held',async()=>{
  const actual=partition();actual.permissionId=null;actual.permissionResults.push({applied:false,permissionId:id(20),status:'held',reason:'own_original_missing'})
  actual.manifest[1]={object:scope(1,'POINT-B'),status:'held',permissionId:id(20),reason:'own_original_missing'}
  io.rpc.mockResolvedValue({data:actual,error:null})
  await expect(applyZ14SnapshotToMeteringPermission({companyId:id(1),actorUserId:id(2),permissionId:id(20),sourceMessageId:id(30)})).rejects.toThrow('own_original_missing')
  expect(io.from).toHaveBeenCalledExactlyOnceWith('ediel_messages')
 })
 it('keeps the actual immutable replay partition',async()=>{
  io.rpc.mockResolvedValue({data:{...partition(),idempotent:true},error:null})
  expect(await applyPermissionMarketSource({actorUserId:id(2),message:source()})).toMatchObject({idempotent:true,manifest:partition().manifest})
 })
 it('does not invent scoped evidence for a genuine historical whole-source result',async()=>{
  io.rpc.mockResolvedValue({data:{applied:true,permissionId:id(10),status:'active',idempotent:true},error:null})
  const result=await applyPermissionMarketSource({actorUserId:id(2),message:source()})
  expect(result.applied).toBe(true);expect(result.manifest).toBeUndefined();expect(result.canonicalAssessmentId).toBeUndefined()
  expect(result.fullyApplied).toBeUndefined();expect(result.reviewRequired).toBeUndefined()
 })
 it.each([
  ['foreign-source',(p:ReturnType<typeof partition>)=>({...p,sourceMessageId:id(31)})],
  ['foreign-source-code',(p:ReturnType<typeof partition>)=>({...p,sourceCode:'Z15'})],
  ['missing-canonical',(p:ReturnType<typeof partition>)=>({...p,canonicalAssessmentId:null})],
  ['duplicate-physical-register',(p:ReturnType<typeof partition>)=>({...p,manifest:[p.manifest[0],p.manifest[0]]})],
  ['uncommitted-eligible',(p:ReturnType<typeof partition>)=>({...p,manifest:[{...p.manifest[0],status:'eligible'}]})],
  ['applied-without-owned-effect',(p:ReturnType<typeof partition>)=>({...p,manifest:[p.manifest[1]]})],
  ['missing-register-occurrence',(p:ReturnType<typeof partition>)=>({...p,manifest:[{...p.manifest[0],object:{...scope(0),registers:[]}}]})],
  ['duplicate-parent',(p:ReturnType<typeof partition>)=>({...p,permissionResults:[p.permissionResults[0],p.permissionResults[0]]})],
  ['borrowed-parent-effect',(p:ReturnType<typeof partition>)=>({...p,permissionResults:[{...p.permissionResults[0],permissionId:id(20)}]})],
 ])('holds malformed native proof %s',async(_name,alter)=>{
  io.rpc.mockResolvedValue({data:alter(partition()),error:null})
  await expect(applyPermissionMarketSource({actorUserId:id(2),message:source()})).rejects.toThrow('permission_native_partition_invalid')
 })
 it('preserves native actor/source denial without local retries or guessed outcomes',async()=>{
  const error=new Error('permission_execution_actor_unqualified');io.rpc.mockResolvedValue({data:null,error})
  await expect(applyPermissionMarketSource({actorUserId:id(2),message:source()})).rejects.toBe(error)
  expect(io.rpc).toHaveBeenCalledOnce()
 })
})
