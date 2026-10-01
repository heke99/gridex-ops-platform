// Disposable local fixture: real contract/signature/PDF/POA, sent Z03, captured
// physical Z04 and atomic business owner. No accepted/approved private facts seeded.
import {randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {ownerSource} from '../../__tests__/helpers/sourceOwnerFixtures'
import {tokenizeEdifact,segmentSourceSpan} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
import type {EdielMessageRow} from '@/lib/ediel/types'
/** Actual local signed contract→rendered/archived/accepted Z03→canonical Z04
 * source→business owner. No private accepted supply/source record is seeded. */
export async function createRequestedChangeSupplyFixture(provider:(email:string)=>void){
 const f=await seedNormalSwitchNativeFixture({requestedStartDate:'2026-09-24',provider}),source=randomUUID(),base=ownerSource()
 const point=sql<{gridArea:string;brp:string}>(`SELECT jsonb_build_object('gridArea',p.grid_area_code,'brp','99876') FROM public.metering_points p WHERE p.id=${literal(f.pointId)} AND company_id=${literal(f.companyId)}`)
 let wire=base.raw_payload!.replaceAll('735123456789012345',f.external).replaceAll('12345:14',f.receiver+':14').replaceAll('54321:14',f.sender+':14').replaceAll('NAD+Z02+11111:160:SVK',`NAD+Z02+${point.brp}:160:SVK`).replaceAll('RFF+LI:CASE-1',`RFF+LI:${f.caseReference}`).replaceAll('RFF+Z05:NET-1',`RFF+Z05:${point.gridArea}`).replaceAll('DTM+92:202610010000:203','DTM+92:202609240000:203').replaceAll('NAD+UD+CUSTOMER-1::89',`NAD+UD+${f.customerIdentity.id}:${f.customerIdentity.qualifier}:${f.customerIdentity.agency}`)
 const tokenized=tokenizeEdifact(wire),header=tokenized.segments.find(x=>x.tag==='UNB')!,span=segmentSourceSpan(header)!,parts=header.raw.split(tokenized.una.dataElementSeparator);while(parts.length<12)parts.push('');parts[9]='1';parts[11]='1';wire=wire.slice(0,span.startOffset)+parts.join(tokenized.una.dataElementSeparator)+wire.slice(span.endOffset)
 sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(source)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},${literal({...base.parsed_payload as Record<string,unknown>,start_date:'2026-09-24'})}::jsonb,clock_timestamp(),'23-DDQ-PRODAT',${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled`)
 const saved=await supabaseService.from('ediel_messages').select('*').eq('id',source).single();expect(saved.error).toBeNull();const message=saved.data as EdielMessageRow
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message);expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 const canonical=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.companyId,decision});expect(canonical.status).toBe('recorded');const session=createReceivedSourceOwnerSession(canonical);expect(session).not.toBeNull()
 const result=await applyInboundBusinessStateMachine({message,actorUserId:f.actorUserId,matchedSwitchRequestId:f.switchId,onSourceSwitchCommitted:session!.onSwitchCommitted});expect(result.outcome).toBe('supplier_switch_accepted');await session!.finish()
 const period=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source)} AND metering_point_id=${literal(f.pointId)}`);expect(period).toBeTruthy();return {...f,period,source}
}
