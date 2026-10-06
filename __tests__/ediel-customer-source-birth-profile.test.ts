// Real physical token scopes and catalog selection; declared DB catalog port.
// This is not durable source admission or business acceptance evidence.
import {beforeEach,expect,it,vi} from 'vitest'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,type Parts} from './fixtures/prodat-register'
import {resolveCustomerSourceBirthProfile} from '@/lib/inbound-mail/customerSourceBirthProfile'

const catalog=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:catalog}))
const evidence={rulePackId:'declared-pack',messageProfileId:'declared-profile',sourceHash:'a'.repeat(64),originalVersion:'26.A:r3',databaseProfileKey:'PRODAT:Z06:E:26.A:r3',profileKey:'semantic-alias',unhAssociationCode:'E2SE6A',originalSnapshot:{rulePack:{id:'declared-pack'},messageProfile:{id:'declared-profile'},guideSources:[{source:'declared-original'}]}}
const receipt='2026-10-06T22:30:00Z'
function wire(reasons:string[]=['E34']){
 const body:Parts[]=reasons.flatMap((reason,i)=>[line(String(i+1),`73599900000000${i}`,undefined,'9'),...characteristic('Z13',reason),['RFF',['LI',`OWN-${i}`]] as Parts])
 return guideOrderedFixtureRaw(body,'Z06')
}
beforeEach(()=>{catalog.mockReset().mockResolvedValue(evidence)})

it('binds the exact catalog witness for every homogeneous own E34 object at the actual Swedish receipt date',async()=>{
 const result=await resolveCustomerSourceBirthProfile({rawPayload:wire(['E34','E34']),receivedAt:receipt})
 expect(catalog).toHaveBeenCalledExactlyOnceWith({family:'PRODAT',messageCode:'Z06',transactionSubtype:'E34',applicationReference:'23-DDQ-PRODAT',direction:'inbound',businessDate:'2026-10-07'})
 expect(result).toEqual({canonical_rule_pack_id:evidence.rulePackId,rule_profile_key:evidence.databaseProfileKey,rule_profile_version_id:evidence.messageProfileId,rule_profile_version:evidence.originalVersion,rule_pack_checksum:evidence.sourceHash,rule_pack_snapshot:{...evidence.originalSnapshot,profileKey:evidence.databaseProfileKey,profileVersionId:evidence.messageProfileId,version:evidence.originalVersion,checksum:evidence.sourceHash}})
})

it.each([
 ['F',()=>wire(['E64'])],['G',()=>wire(['E32'])],['mixed E/F',()=>wire(['E34','E64'])],['mixed F/E',()=>wire(['E64','E34'])],
 ['missing own reason',()=>wire().replace("CCI++Z13'CAV+E34'",'')],
 ['duplicate own reason',()=>wire().replace("CAV+E34'","CAV+E34'CCI++Z13'CAV+E34'")],
 ['header reason',()=>wire().replace(/LIN[^']*'/,'')],
 ['additional header reason',()=>wire().replace("LIN+1","CCI++Z13'CAV+E34'LIN+1")],
 ['two messages',()=>wire().replace(/UNZ[^']*'/,wire().slice(wire().indexOf('UNH')))],
 ['wrong code',()=>wire().replace('BGM+Z06','BGM+Z09')],
 ['missing application reference',()=>wire().replace('+23-DDQ-PRODAT','')],
] as const)('does not borrow an E profile for %s',async(_name,raw)=>{
 expect(await resolveCustomerSourceBirthProfile({rawPayload:raw(),receivedAt:receipt})).toBeNull();expect(catalog).not.toHaveBeenCalled()
})

it('qualifies a repeated-register chain whose common E34 occurs only on the first own register',async()=>{
 const raw=guideOrderedFixtureRaw([line('1','735999000000001','1','9'),...characteristic('Z13','E34'),['RFF',['LI','OWN']],line('2','735999000000001','2','9')],'Z06')
 expect(await resolveCustomerSourceBirthProfile({rawPayload:raw,receivedAt:receipt})).not.toBeNull();expect(catalog).toHaveBeenCalledTimes(1)
})

it.each(['E34','E64'])('refuses an extra physical later-register reason %s',async reason=>{
 const raw=guideOrderedFixtureRaw([line('1','735999000000001','1','9'),...characteristic('Z13','E34'),['RFF',['LI','OWN']],line('2','735999000000001','2','9'),...characteristic('Z13',reason)],'Z06')
 expect(await resolveCustomerSourceBirthProfile({rawPayload:raw,receivedAt:receipt})).toBeNull();expect(catalog).not.toHaveBeenCalled()
})

it('keeps released separators inside source data from becoming another physical reason',async()=>{
 expect(await resolveCustomerSourceBirthProfile({rawPayload:wire().replace('OWN-0',"OWN?+CCI?+?+Z13?'CAV?+E64"),receivedAt:receipt})).not.toBeNull()
 expect(catalog).toHaveBeenCalledTimes(1)
})

it('refuses a different association guide before supplying a pin',async()=>{
 catalog.mockResolvedValue({...evidence,unhAssociationCode:'E2SE5A'})
 await expect(resolveCustomerSourceBirthProfile({rawPayload:wire(),receivedAt:receipt})).rejects.toThrow('customer_source_birth_association_mismatch')
})
it.each([0,2])('propagates %i native catalog rows without inventing a profile',async count=>{
 catalog.mockRejectedValue(Error('canonical_rule_pack_evidence_count:'+count))
 await expect(resolveCustomerSourceBirthProfile({rawPayload:wire(),receivedAt:receipt})).rejects.toThrow('evidence_count:'+count)
})
it('requires the database activation key rather than the semantic alias',async()=>{
 catalog.mockResolvedValue({...evidence,databaseProfileKey:undefined})
 await expect(resolveCustomerSourceBirthProfile({rawPayload:wire(),receivedAt:receipt})).rejects.toThrow('database_profile_key_missing')
})
it('does not substitute now for an invalid retained receipt clock',async()=>{
 await expect(resolveCustomerSourceBirthProfile({rawPayload:wire(),receivedAt:'invalid'})).rejects.toThrow('receipt_clock_invalid')
 expect(catalog).not.toHaveBeenCalled()
})
