import {supabaseService} from '@/lib/supabase/service'
import {bindDeathStatusSourceContext,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {copyDeathSelection,type DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'

/** Separate authentic workbook classification plus the SAME registered test
 * original; neither a fixture outcome nor literal E34/Z41 supplies that fact. */
export type ClassifiedCustomerEventFixtureBasis={status:'authorized';sourceKind:'independently_classified_fixture';authorizesBusinessEffect:false;
 companyId:string;environment:'test';code:'Z09';rawPayload:string;declarationId:string;sourceVersion:string;sourceDigest:string;sourceReference:string;
 classification:'death'|'bankruptcy'|'other_masterdata';selection:DeathSelection;fixtureRegistrationId:string;runId:string;expectedOutcome:'positive'|'negative';expectedDiagnosticCodes:string[]}
export type ClassifiedCustomerEventFixtureHeld={status:'held';missing:string[]}
export function certificationCustomerLifeEventContext(input:{basis:ClassifiedCustomerEventFixtureBasis;companyId:string;rawPayload:string;intentId:string;routeId:string}):DeathStatusValidationContext{
 const b=input.basis
 if(b.status!=='authorized'||b.sourceKind!=='independently_classified_fixture'||b.authorizesBusinessEffect!==false||b.companyId!==input.companyId||b.environment!=='test'||b.code!=='Z09'||b.rawPayload!==input.rawPayload)throw new Error('customer_event_certification_basis_invalid')
 return bindDeathStatusSourceContext({kind:'customer_life_event',direction:'outbound',code:'Z09',companyId:b.companyId,environment:'test',rawPayload:b.rawPayload,
  sourceEventId:b.fixtureRegistrationId,sourceRevision:b.sourceVersion,sourceDigest:b.sourceDigest,businessContext:b.classification,bilateralCapabilityVerified:false,
  selection:copyDeathSelection(b.selection),intentId:input.intentId,routeId:input.routeId,
  certification:{sourceKind:b.sourceKind,declarationId:b.declarationId,fixtureRegistrationId:b.fixtureRegistrationId,runId:b.runId,expectedOutcome:b.expectedOutcome,expectedDiagnosticCodes:b.expectedDiagnosticCodes,authorizesBusinessEffect:false}})
}
export async function prepareCustomerLifeEventCertificationContext(input:{companyId:string;actorUserId:string;rawPayload:string;runId:string;stepNo:number;expectedOutcome:'positive'|'negative';intentId:string;routeId:string}):Promise<DeathStatusValidationContext|ClassifiedCustomerEventFixtureHeld|undefined>{
 const{data,error}=await supabaseService.rpc('ediel_customer_event_certification_basis_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_run_id:input.runId,p_step_no:input.stepNo,p_raw_payload:input.rawPayload,p_expected_outcome:input.expectedOutcome})
 if(error)throw error
 if(data===null)return undefined
 if(data?.status==='held'&&Array.isArray(data.missing)&&data.missing.every((v:unknown)=>typeof v==='string'))return data
 if(data?.runId!==input.runId||data?.expectedOutcome!==input.expectedOutcome)throw new Error('customer_event_certification_basis_invalid')
 return certificationCustomerLifeEventContext({basis:data,companyId:input.companyId,rawPayload:input.rawPayload,intentId:input.intentId,routeId:input.routeId})
}
