// Genuine disposable legal/company/contract/bootstrap and rendered Z03 only.
// This stage has no received Z04, accepted supply source, customer-version owner
// or AI origin. External contract/POA facts and SMTP remain explicit synthetic
// boundaries; no private approval/receipt is inserted to advance the market.
import {normalSwitchNetworkRegistry,futureNativeSupplyDate} from './ediel-normal-switch-native-fixture'
import {expect} from 'vitest'
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'

export type LegalSourceStageScope=Pick<Awaited<ReturnType<typeof seedNormalSwitchNativeFixture>>,'companyId'|'actorUserId'|'receiver'>

export async function createLegalSourceStageFixture(provider:(email:string)=>void){
 const f=await seedNormalSwitchNativeFixture({provider,requestedStartDate:futureNativeSupplyDate()})
 // Legal-source suites own their registry lifecycle from a held state: revoke
 // the version the switch seed needed for its Z03 through the real owner.
 const registry=normalSwitchNetworkRegistry(f.companyId)
 if(registry){const {revokeNetworkRegistrySource}=await import('@/lib/ediel/production/networkRegistrySource')
  const revoked=await revokeNetworkRegistrySource({companyId:f.companyId,actorUserId:registry.reviewerId,artifactId:registry.artifact.artifactId,sourceHash:registry.artifact.sourceHash,claimsHash:registry.artifact.claimsHash,reason:'SYNTHETIC reset for an independent registry lifecycle'});expect(revoked.status).toBe('held')}
 expect(sql(`SELECT jsonb_build_object('received',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='inbound'),'supply',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),'ai',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_family='AI_LIST'))`)).toEqual({received:0,supply:0,ai:0})
 return f
}
