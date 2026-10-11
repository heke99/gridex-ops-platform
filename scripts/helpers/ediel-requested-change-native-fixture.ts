// Disposable local fixture: real contract/signature/PDF/POA, sent Z03, captured
// physical Z04 and atomic business owner. No accepted/approved private facts seeded.
import {expect} from 'vitest'
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import {seedOriginalMailboxNative} from './originalMailboxNative'
import {buildCancellationProspectiveZ04} from './ediel-cancellation-prospective-source-2ea'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {matchOutboundRequestForInbound,matchMeteringPointForInbound} from '@/lib/inbound-mail/inboundMatcher'
import {getEdielMessageById} from '@/lib/ediel/db'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
/** Actual local signed contract→rendered/archived/accepted Z03→canonical Z04
 * source→business owner. No private accepted supply/source record is seeded. */
export async function createRequestedChangeSupplyFixture(provider:(email:string)=>void,options:{requestedStartDate?:string}={}){
 const requestedStartDate=options.requestedStartDate??'2026-09-24'
 const f=await seedNormalSwitchNativeFixture({requestedStartDate,provider})
 // Explicit NEW synthetic active installation, monthly profiled settlement and
 // one all-time cumulative register101 (constant1/digits6), selected before mail
 // or source birth. It supplies no receiver READ or already-received UTILTS fact.
 const wire=buildCancellationProspectiveZ04(f),receivedAt=new Date().toISOString()
 const mail=await seedOriginalMailboxNative(sql,literal,{companyId:f.companyId,environment:'test',raw:wire,receivedAt,smtpFrom:assertEdielSmtpReadiness().from})
 const outboundMatch=await matchOutboundRequestForInbound({companyId:f.companyId,parsed:mail.parsed,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId})
 const meteringPointMatch=await matchMeteringPointForInbound({companyId:f.companyId,parsed:mail.parsed})
 const source=await createInboundEdielMessage({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test',inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,parsed:mail.parsed,outboundMatch,meteringPointMatch})
 expect(source,'public_creator_must_return_actual_source').toMatch(/^[a-f0-9-]{36}$/)
 const message=await getEdielMessageById(source!);expect(message).not.toBeNull()
 expect(message).toMatchObject({id:source,company_id:f.companyId,environment:'test',direction:'inbound',message_code:'Z04',raw_payload:wire,inbound_email_message_id:mail.inboundEmailMessageId,rule_profile_key:'PRODAT:Z04:L:26.A:r3'})
 // The public creator owns the first reception. Observe its actual custody;
 // never call the writer again or backfill source, receipt or transport facts.
 const receptions=sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM gridex_ediel_inbound_receptions.receptions r WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source)};`)
 expect(receptions).toHaveLength(1)
 expect(receptions[0]).toMatchObject({source_message_id:source,company_id:f.companyId,environment:'test',inbound_email_message_id:mail.inboundEmailMessageId,parse_result_id:mail.parseResultId,actor_user_id:f.actorUserId,classification:'first_reception',canonical_payload_hash:mail.sourcePayloadHash,received_payload_hash:mail.sourcePayloadHash})
 const retainedMail=sql<{received_at:string;raw_edifact_payload:string}>(`SELECT to_jsonb(m) FROM public.inbound_email_messages m WHERE company_id=${literal(f.companyId)} AND id=${literal(mail.inboundEmailMessageId)};`)
 expect(retainedMail.raw_edifact_payload).toBe(wire)
 expect(Date.parse(retainedMail.received_at)).toBe(Date.parse(receivedAt))
 expect(Date.parse(message!.message_received_at!)).toBe(Date.parse(retainedMail.received_at))
 expect(Date.parse(String(receptions[0].received_at))).toBe(Date.parse(retainedMail.received_at))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message!,{actorUserId:f.actorUserId});expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 const canonical=await recordReceivedSourceValidation({original:message!,validated:message!,resolvedCompanyId:f.companyId,decision});expect(canonical.status).toBe('recorded');
 // Production inbound order: record validation, then capture the frozen rule-pack basis.
 await captureFreshEdielSourceRulePackEvidence(f.companyId,message!.id);const session=createReceivedSourceOwnerSession(canonical);expect(session).not.toBeNull()
 const result=await applyInboundBusinessStateMachine({message:message!,actorUserId:f.actorUserId,matchedSwitchRequestId:f.switchId,onSourceSwitchCommitted:session!.onSwitchCommitted});expect(result.outcome).toBe('supplier_switch_accepted');await session!.finish()
 const period=sql<string>(`SELECT to_jsonb(id) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(source)} AND metering_point_id=${literal(f.pointId)}`);expect(period).toBeTruthy();return {...f,period,source:source!}
}
