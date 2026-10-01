// Real local legal-company/signature/GoTrue/source producer. Only the remote legal
// issuer competence/key/representation is an explicitly synthetic boundary.
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {createLegalSourceStageFixture,type LegalSourceStageScope} from './ediel-legal-source-stage-native-fixture'
import {createBilateralSourceOperator} from './ediel-bilateral-customer-native-fixture'
import {nativeSql as sql,literal} from './ediel-normal-switch-native-fixture'
import type {AiPurposeSourceSubmission} from '@/lib/ediel/production/aiPurposeSource'
export const aiPurposeOperatorPermissions=['communication.read','communication.write','communication.send','customers.read','customers.write','contracts.read','contracts.write','ediel.ai_purpose.review']
export async function createAiPurposeSourceFixture(provider:(email:string)=>void){
 const f=await createLegalSourceStageFixture(provider)
 return {...f,...await attachAiPurposeSourceFixture(f)}
}
export async function attachAiPurposeSourceFixture(f:LegalSourceStageScope){
 const uploader=await createBilateralSourceOperator(f.companyId,aiPurposeOperatorPermissions),reviewer=await createBilateralSourceOperator(f.companyId,aiPurposeOperatorPermissions),reader=await createBilateralSourceOperator(f.companyId,['communication.read','customers.read','contracts.read']),keyId=randomUUID(),representationId=randomUUID(),secret=Buffer.alloc(32,31),competence=createHash('sha256').update('SYNTHETIC LEGAL PURPOSE COMPETENCE ONLY').digest('hex')
 sql(`INSERT INTO gridex_ai_purpose_sources.issuer_keys(id,company_id,environment,list_type,purpose,registry_version,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to) VALUES(${literal(keyId)},${literal(f.companyId)},'test','AI','ediel_list_export','SYNTHETIC LEGAL REGISTRY VERSION1','SYNTHETIC ISSUER COMPETENCE ONLY',${literal(competence)},decode('${secret.toString('hex')}','hex'),'2020-01-01','2099-01-01');INSERT INTO gridex_ai_purpose_sources.representations(id,company_id,environment,issuer_key_id,legal_actor_id,list_type,purpose,legal_authority_reference,legal_authority_hash,valid_from,valid_to) VALUES(${literal(representationId)},${literal(f.companyId)},'test',${literal(keyId)},${literal(f.actorUserId)},'AI','ediel_list_export','SYNTHETIC LEGAL REPRESENTATION ONLY',${literal(competence)},'2020-01-01','2099-01-01')`)
 const clause={locator:'page1 synthetic legal-purpose clause',quote:'The synthetic legal issuer authorizes this exact AI export purpose and original-source retention.'},policy={environment:'test' as const,listType:'AI' as const,purpose:'ediel_list_export' as const,gdprBasis:'SYNTHETIC legal basis only; not a real legal approval',retentionDays:30,retentionUntil:new Date(Date.now()+31*86400000).toISOString().slice(0,10),validFrom:new Date(Math.floor((Date.now()-3600000)/60000)*60000).toISOString(),validUntil:new Date(Math.floor((Date.now()+3600000)/60000)*60000).toISOString()}
 function submission(reference:string,bytes:Buffer,withReceipt=true):AiPurposeSourceSubmission{
  const base={...policy,source:{bytesBase64:bytes.toString('base64'),mimeType:'application/pdf' as const,reference,version:'1'}},claims=sql<Record<string,unknown>>(`SELECT gridex_ai_purpose_sources.claims_v1(${literal(f.companyId)},${literal(base)}::jsonb)`),payload=Buffer.from(JSON.stringify({format:'ediel_ai_purpose_receipt_v1',receiptId:randomUUID(),claims,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceReference:reference,sourceVersion:'1',registryVersion:'SYNTHETIC LEGAL REGISTRY VERSION1',clause,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+7200000).toISOString()}))
  return {...base,...(withReceipt?{issuerReceipt:{keyId,representationId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',secret).update(payload).digest('hex')}}:{})}
 }
 const pdf=(label:string)=>Buffer.from(`%PDF-1.7\nSYNTHETIC ${label}\n${clause.quote}\n%%EOF`)
 return {companyId:f.companyId,actorUserId:f.actorUserId,receiver:f.receiver,uploader,reviewer,reader,keyId,representationId,clause,policy,submission,pdf}
}
