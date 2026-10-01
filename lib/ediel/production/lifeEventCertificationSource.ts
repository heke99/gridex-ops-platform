import {supabaseService} from '@/lib/supabase/service'
import {bindDeathStatusSourceContext,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {copyDeathSelection,type DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'

/** Separate authentic workbook classification plus the SAME registered test
 * original; neither a fixture outcome nor literal E34/Z41 supplies that fact. */
export type ClassifiedCustomerEventFixtureBasis={status:'authorized';sourceKind:'independently_classified_fixture';authorizesBusinessEffect:false;
 companyId:string;environment:'test';code:'Z09';rawPayload:string;declarationId:string;sourceVersion:string;sourceDigest:string;sourceReference:string;
 classification:'death'|'bankruptcy'|'other_masterdata';selection:DeathSelection;fixtureRegistrationId:string;runId:string;expectedOutcome:'positive'|'negative';expectedDiagnosticCodes:readonly string[];registeredCase?:Readonly<{roleCode:string;caseCode:string;suite:string;revision:string;stepNo:number}>}
export type ClassifiedCustomerEventFixtureHeld={status:'held';missing:string[]}
export function certificationCustomerLifeEventContext(input:{basis:ClassifiedCustomerEventFixtureBasis;companyId:string;rawPayload:string;intentId:string|null;routeId:string}):DeathStatusValidationContext{
 const b=input.basis
 if(b.status!=='authorized'||b.sourceKind!=='independently_classified_fixture'||b.authorizesBusinessEffect!==false||b.companyId!==input.companyId||b.environment!=='test'||b.code!=='Z09'||b.rawPayload!==input.rawPayload)throw new Error('customer_event_certification_basis_invalid')
 return bindDeathStatusSourceContext({kind:'customer_life_event',direction:'outbound',code:'Z09',companyId:b.companyId,environment:'test',rawPayload:b.rawPayload,
  sourceEventId:b.fixtureRegistrationId,sourceRevision:b.sourceVersion,sourceDigest:b.sourceDigest,businessContext:b.classification,bilateralCapabilityVerified:false,
  selection:copyDeathSelection(b.selection),intentId:input.intentId,routeId:input.routeId,
  certification:{sourceKind:b.sourceKind,declarationId:b.declarationId,fixtureRegistrationId:b.fixtureRegistrationId,runId:b.runId,expectedOutcome:b.expectedOutcome,expectedDiagnosticCodes:b.expectedDiagnosticCodes,authorizesBusinessEffect:false}})
}
export async function prepareCustomerLifeEventCertificationContext(input:{companyId:string;actorUserId:string;rawPayload:string;runId:string;stepNo:number;expectedOutcome:'positive'|'negative';intentId:string|null;routeId:string}):Promise<DeathStatusValidationContext|ClassifiedCustomerEventFixtureHeld|undefined>{
 const{data,error}=await supabaseService.rpc('ediel_customer_event_certification_basis_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_run_id:input.runId,p_step_no:input.stepNo,p_raw_payload:input.rawPayload,p_expected_outcome:input.expectedOutcome})
 if(error)throw error
 if(data===null)return undefined
 if(data?.status==='held'&&Array.isArray(data.missing)&&data.missing.every((v:unknown)=>typeof v==='string'))return data
 if(data?.runId!==input.runId||data?.expectedOutcome!==input.expectedOutcome)throw new Error('customer_event_certification_basis_invalid')
 return certificationCustomerLifeEventContext({basis:data,companyId:input.companyId,rawPayload:input.rawPayload,intentId:input.intentId,routeId:input.routeId})
}

/** Resolve outcome only from the actual unique source registration, before
 * national diagnostics. The caller cannot choose a negative exception. */
export async function prepareCustomerLifeEventCertificationDraftContext(input:{companyId:string;actorUserId:string;rawPayload:string;runId:string;stepNo:number;intentId:string|null;routeId:string}):Promise<DeathStatusValidationContext|ClassifiedCustomerEventFixtureHeld|undefined>{
 const{data,error}=await supabaseService.rpc('ediel_customer_event_certification_preparation_basis_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_run_id:input.runId,p_step_no:input.stepNo,p_raw_payload:input.rawPayload})
 if(error)throw error
 if(data===null)return undefined
 if(data?.status==='held'&&Array.isArray(data.missing)&&data.missing.every((v:unknown)=>typeof v==='string'))return data
 if(data?.runId!==input.runId||!['positive','negative'].includes(data?.expectedOutcome))throw new Error('customer_event_certification_basis_invalid')
 return certificationCustomerLifeEventContext({basis:data,companyId:input.companyId,rawPayload:input.rawPayload,intentId:input.intentId,routeId:input.routeId})
}

const originals=new WeakSet<object>()
function freezeOriginal<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freezeOriginal(child)}return value}
export type SourceQualifiedCustomerEventTestOriginal=Readonly<{basis:ClassifiedCustomerEventFixtureBasis;rawPayload:string}>
export function isQualifiedCustomerEventTestOriginal(value:unknown):value is SourceQualifiedCustomerEventTestOriginal{return !!value&&typeof value==='object'&&originals.has(value)}
export async function prepareCustomerEventTestOriginal(input:{companyId:string;actorUserId:string;runId:string;stepNo:number}):Promise<SourceQualifiedCustomerEventTestOriginal|ClassifiedCustomerEventFixtureHeld|undefined>{
 const{data,error}=await supabaseService.rpc('ediel_customer_event_certification_original_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_run_id:input.runId,p_step_no:input.stepNo})
 if(error)throw error;if(data===null)return undefined
 if(data?.status==='held'&&Array.isArray(data.missing)&&data.missing.every((v:unknown)=>typeof v==='string'))return data
 if(data?.status!=='authorized'||data?.sourceKind!=='independently_classified_fixture'||data?.authorizesBusinessEffect!==false||data?.companyId!==input.companyId||data?.runId!==input.runId||data?.environment!=='test'||data?.code!=='Z09'||!data?.rawPayload||!['positive','negative'].includes(data?.expectedOutcome)||data?.registeredCase?.roleCode!=='supplier'||data?.registeredCase?.stepNo!==input.stepNo||!data?.registeredCase?.caseCode||!data?.registeredCase?.suite||!data?.registeredCase?.revision)throw Error('customer_event_certification_basis_invalid')
 const basis=freezeOriginal({...data,selection:copyDeathSelection(data.selection),expectedDiagnosticCodes:[...data.expectedDiagnosticCodes],registeredCase:{...data.registeredCase}}),result=Object.freeze({basis,rawPayload:basis.rawPayload});originals.add(result);return result
}
