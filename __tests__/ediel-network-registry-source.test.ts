import {beforeEach,expect,it,vi} from 'vitest'
const port=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:port.rpc}}))
import {archiveNetworkRegistrySource,reviewNetworkRegistrySource,readNetworkRegistrySourceBytes} from '@/lib/ediel/production/networkRegistrySource'
const scope={companyId:'00000000-0000-4000-8000-000000000001',actorUserId:'00000000-0000-4000-8000-000000000002'},artifactId='00000000-0000-4000-8000-000000000003',sourceHash='a'.repeat(64),claimsHash='b'.repeat(64)
const input={...scope,environment:'test' as const,networkActorId:artifactId,validFrom:'2026-10-01T00:00:00Z',validUntil:'2026-10-20T00:00:00Z',source:{bytesBase64:Buffer.from('%PDF-1.7\nSYNTHETIC actual original network registry').toString('base64'),mimeType:'application/pdf' as const,reference:'SYNTHETIC',version:'1'}}
beforeEach(()=>port.rpc.mockReset())
it('archives original bytes and submitted registry claims, never client authority',async()=>{
 port.rpc.mockResolvedValue({data:{status:'archived',artifactId,sourceHash,claimsHash,missing:['authentic_current_network_registry_issuer_and_representation']},error:null})
 expect(await archiveNetworkRegistrySource(input)).toMatchObject({status:'archived',artifactId})
 expect(port.rpc).toHaveBeenCalledWith('ediel_archive_network_registry_source_v1',{p_company_id:scope.companyId,p_actor_user_id:scope.actorUserId,p_submission:expect.objectContaining({networkActorId:artifactId})})
 expect(port.rpc.mock.calls[0][1].p_submission).not.toHaveProperty('companyId')
})
it.each(['','YWJj','%%%%'])('rejects invalid PDF bytes before the authority port: %s',async bytesBase64=>{
 await expect(archiveNetworkRegistrySource({...input,source:{...input.source,bytesBase64}})).rejects.toThrow();expect(port.rpc).not.toHaveBeenCalled()
})
it('holds a separately submitted review if native legal authority is missing',async()=>{
 port.rpc.mockResolvedValue({data:{status:'held',artifactId,missing:['authentic_current_network_registry_issuer_and_representation']},error:null})
 expect(await reviewNetworkRegistrySource({...scope,artifactId,sourceHash,claimsHash,decision:'approve',reason:'Separate reviewed source'})).toMatchObject({status:'held'})
})
it('requires an actual native registry-version ID for authorized review',async()=>{
 port.rpc.mockResolvedValue({data:{status:'authorized',artifactId},error:null})
 await expect(reviewNetworkRegistrySource({...scope,artifactId,sourceHash,claimsHash,decision:'approve',reason:'Separate review'})).rejects.toThrow()
})
it('refuses substituted scoped document bytes/hash',async()=>{
 port.rpc.mockResolvedValue({data:{status:'archived',artifactId,bytesBase64:input.source.bytesBase64,mimeType:'application/pdf',sourceHash,byteLength:Buffer.from(input.source.bytesBase64,'base64').length},error:null})
 await expect(readNetworkRegistrySourceBytes({...scope,artifactId})).rejects.toThrow()
})

it('returns the independently qualified opaque decision ID',async()=>{port.rpc.mockResolvedValue({data:{status:'authorized',artifactId,registryVersionId:artifactId},error:null});expect(await reviewNetworkRegistrySource({...scope,artifactId,sourceHash,claimsHash,decision:'approve',reason:'Separate review'})).toEqual({status:'authorized',artifactId,registryVersionId:artifactId})})
