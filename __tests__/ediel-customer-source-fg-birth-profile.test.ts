// masterplan: AT-Z06F-SUPPLIER, AT-Z06G-SUPPLIER
// Real physical token scopes and catalog selection; declared DB catalog port.
// This is not durable source admission or business acceptance evidence.
import {beforeEach,expect,it,vi} from 'vitest'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,type Parts} from './fixtures/prodat-register'
import {resolveCustomerSourceFgBirthProfile} from '@/lib/inbound-mail/customerSourceFgBirthProfile'
import {resolveCustomerSourceBirthProfile} from '@/lib/inbound-mail/customerSourceBirthProfile'

const catalog=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:catalog}))
const evidence={rulePackId:'declared-pack',messageProfileId:'declared-profile',sourceHash:'b'.repeat(64),originalVersion:'26.A:r3',databaseProfileKey:'PRODAT:Z06:F:26.A:r3',profileKey:'semantic-alias',unhAssociationCode:'E2SE6A',originalSnapshot:{rulePack:{id:'declared-pack'},messageProfile:{id:'declared-profile'},guideSources:[{source:'declared-original'}]}}
const receipt='2026-10-06T22:30:00Z'
function wire(reasons:string[]){
 const body:Parts[]=reasons.flatMap((reason,i)=>[line(String(i+1),`73599900000000${i}`,undefined,'9'),...characteristic('Z13',reason),['RFF',['LI',`OWN-${i}`]] as Parts])
 return guideOrderedFixtureRaw(body,'Z06')
}
beforeEach(()=>{catalog.mockReset().mockResolvedValue(evidence)})

it.each([['F','E64'],['G','E32']] as const)('binds the exact %s catalog witness, derived from the physical reason, at the actual Swedish receipt date',async(_subtype,reason)=>{
 const result=await resolveCustomerSourceFgBirthProfile({rawPayload:wire([reason,reason]),receivedAt:receipt})
 expect(catalog).toHaveBeenCalledExactlyOnceWith({family:'PRODAT',messageCode:'Z06',transactionSubtype:reason,applicationReference:'23-DDQ-PRODAT',direction:'inbound',businessDate:'2026-10-07'})
 expect(result).toEqual({canonical_rule_pack_id:evidence.rulePackId,rule_profile_key:evidence.databaseProfileKey,rule_profile_version_id:evidence.messageProfileId,rule_profile_version:evidence.originalVersion,rule_pack_checksum:evidence.sourceHash,rule_pack_snapshot:{...evidence.originalSnapshot,profileKey:evidence.databaseProfileKey,profileVersionId:evidence.messageProfileId,version:evidence.originalVersion,checksum:evidence.sourceHash}})
})

it('the existing E34 route is unchanged and the F/G resolver never borrows it',async()=>{
 expect(await resolveCustomerSourceFgBirthProfile({rawPayload:wire(['E34']),receivedAt:receipt})).toBeNull();expect(catalog).not.toHaveBeenCalled()
 // E resolver still refuses F/G without a catalog call; the two routes are disjoint.
 for(const reason of ['E64','E32'])expect(await resolveCustomerSourceBirthProfile({rawPayload:wire([reason]),receivedAt:receipt})).toBeNull()
 expect(catalog).not.toHaveBeenCalled()
})

it.each([
 ['mixed F/G',()=>wire(['E64','E32'])],['mixed G/F',()=>wire(['E32','E64'])],['mixed F/E',()=>wire(['E64','E34'])],['mixed E/G',()=>wire(['E34','E32'])],
 ['unknown reason',()=>wire(['E65'])],
 ['missing own reason',()=>wire(['E64']).replace("CCI++Z13'CAV+E64'",'')],
 ['duplicate own reason',()=>wire(['E64']).replace("CAV+E64'","CAV+E64'CCI++Z13'CAV+E64'")],
 ['header reason',()=>wire(['E32']).replace(/LIN[^']*'/,'')],
 ['additional header reason',()=>wire(['E32']).replace("LIN+1","CCI++Z13'CAV+E32'LIN+1")],
 ['two messages',()=>wire(['E64']).replace(/UNZ[^']*'/,wire(['E64']).slice(wire(['E64']).indexOf('UNH')))],
 ['wrong code',()=>wire(['E64']).replace('BGM+Z06','BGM+Z09')],
 ['missing application reference',()=>wire(['E64']).replace('+23-DDQ-PRODAT','')],
] as const)('refuses %s without a catalog call',async(_name,raw)=>{
 expect(await resolveCustomerSourceFgBirthProfile({rawPayload:raw(),receivedAt:receipt})).toBeNull();expect(catalog).not.toHaveBeenCalled()
})

it('refuses an extra physical later-register reason',async()=>{
 const raw=guideOrderedFixtureRaw([line('1','735999000000001','1','9'),...characteristic('Z13','E64'),['RFF',['LI','OWN']],line('2','735999000000001','2','9'),...characteristic('Z13','E64')],'Z06')
 expect(await resolveCustomerSourceFgBirthProfile({rawPayload:raw,receivedAt:receipt})).toBeNull();expect(catalog).not.toHaveBeenCalled()
})

it('refuses a different association guide, propagates catalog ambiguity and requires the database key',async()=>{
 catalog.mockResolvedValueOnce({...evidence,unhAssociationCode:'E2SE5A'})
 await expect(resolveCustomerSourceFgBirthProfile({rawPayload:wire(['E64']),receivedAt:receipt})).rejects.toThrow('customer_source_birth_association_mismatch')
 catalog.mockRejectedValueOnce(Error('canonical_rule_pack_evidence_count:2'))
 await expect(resolveCustomerSourceFgBirthProfile({rawPayload:wire(['E32']),receivedAt:receipt})).rejects.toThrow('evidence_count:2')
 catalog.mockResolvedValueOnce({...evidence,databaseProfileKey:undefined})
 await expect(resolveCustomerSourceFgBirthProfile({rawPayload:wire(['E64']),receivedAt:receipt})).rejects.toThrow('database_profile_key_missing')
})

it('does not substitute now for an invalid retained receipt clock',async()=>{
 await expect(resolveCustomerSourceFgBirthProfile({rawPayload:wire(['E64']),receivedAt:'invalid'})).rejects.toThrow('receipt_clock_invalid')
 expect(catalog).not.toHaveBeenCalled()
})
