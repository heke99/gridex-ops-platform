import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({route:vi.fn(),read:vi.fn(),owners:[] as Record<string,unknown>[],filters:[] as [string,unknown][]}))
vi.mock('@/lib/ediel/core/kernel',()=>({resolveCanonicalOutboundContext:io.route}))
vi.mock('@/lib/ediel/production/requestedChangeSource',()=>({readRequestedChangeSource:io.read,originateRequestedChange:vi.fn()}))
vi.mock('@/lib/ediel/intent/lifeEventGateway',()=>({renderAndQueueRequestedChange:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{const q:Record<string,unknown>={select:()=>q,eq:(c:string,v:unknown)=>{io.filters.push([c,v]);return q},
 limit:async()=>({data:io.owners.filter(o=>io.filters.every(([c,v])=>o[c]===v)),error:null})};return q}}}))
import {prepareAndQueueProdatRequestedChange} from '@/lib/ediel/flows/prodatRequestedChange'
const company='00000000-0000-4000-8000-000000000001',grid='00000000-0000-4000-8000-000000000002'
beforeEach(()=>{io.filters=[];io.owners=[{id:grid,name:'Synthetic grid owner',ediel_id:'7300000000002',company_id:company,is_active:true}]
 io.read.mockReset().mockResolvedValue({status:'ready',companyId:company,environment:'test',legalReceiverId:'7300000000002',legalActorId:'a',legalSenderId:'7300000000001'})
 io.route.mockReset().mockRejectedValue(new Error('stop after route selection'))})
it('routes an unselected requested change to the tenant route of the actual legal receiver grid owner',async()=>{
 await expect(prepareAndQueueProdatRequestedChange({companyId:company,eventId:'e',actorUserId:'u'})).rejects.toThrow('stop after route selection')
 expect(io.route).toHaveBeenCalledWith(expect.objectContaining({requestType:'customer_masterdata',gridOwner:{id:grid,name:'Synthetic grid owner',ediel_id:'7300000000002'}}))
 expect(io.filters).toEqual(expect.arrayContaining([['company_id',company],['ediel_id','7300000000002'],['is_active',true]]))
})
it('keeps an explicitly selected route and never guesses among ambiguous grid owners',async()=>{
 await expect(prepareAndQueueProdatRequestedChange({companyId:company,eventId:'e',actorUserId:'u',preferredRouteId:'route'})).rejects.toThrow()
 expect(io.route.mock.calls[0][0]).toMatchObject({preferredRouteId:'route'})
 io.owners.push({...io.owners[0],id:'other'});io.filters=[];io.route.mockClear()
 await expect(prepareAndQueueProdatRequestedChange({companyId:company,eventId:'e',actorUserId:'u'})).rejects.toThrow()
 expect(io.route.mock.calls[0][0].gridOwner??null).toBeNull()
})
