import {expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createDecisionOriginalNativeFixture,decisionNativeSql as sql,decisionUser,literal,hash,signSyntheticDecisionOriginalPolicy} from './helpers/ediel-decision-original-native-fixture'

const classes=['life_event_classification_source_original_bytes','life_event_classification_receipt_original_bytes','life_event_classification_revocation_original_bytes'] as const

it('installed classification-copy namespaces preserve actual STABLE owner and private VOLATILE source barrier',()=>{
 const result=sql<{classes:string[];ownerVolatility:string;helperVolatility:string;privateExecute:number;publicRead:number}>(`SELECT jsonb_build_object('classes',(SELECT jsonb_agg(retention_class ORDER BY retention_class) FROM gridex_ediel_retention.decision_evidence_catalog WHERE retention_class=ANY(ARRAY[${classes.map(literal).join(',')}])), 'ownerVolatility',(SELECT provolatile FROM pg_proc WHERE oid='gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)'::regprocedure),'helperVolatility',(SELECT provolatile FROM pg_proc WHERE oid='gridex_ediel_retention.classification_copy_source_current_v1(uuid,uuid)'::regprocedure),'privateExecute',(SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role']) role WHERE has_function_privilege(role,'gridex_ediel_retention.classification_copy_source_current_v1(uuid,uuid)','EXECUTE')),'publicRead',(SELECT count(*) FROM unnest(ARRAY['anon','authenticated','service_role']) role WHERE has_table_privilege(role,'gridex_ediel_retention.classification_copy_revocations','SELECT')))`)
 expect(result).toEqual({classes:[...classes].sort(),ownerVolatility:'s',helperVolatility:'v',privateExecute:0,publicRead:0})
},30000)

it('actual GoTrue class-scoped original reads reject absent/foreign classification without new source effects or copy receipts',async()=>{
 // Actual protected raw/blob intake and GoTrue identities; the source remains
 // unclassified and unapproved. No private accepted classification is seeded.
 const password=randomUUID()+'Aa1!',f=await createDecisionOriginalNativeFixture(password),own=await decisionUser(f.companyId,['ediel.retention.read','ediel.retention.record_decision_evidence'],password),foreign=await decisionUser(f.foreignCompanyId,['ediel.retention.read','ediel.retention.record_decision_evidence'],password),target=randomUUID()
 const before=sql(`SELECT jsonb_build_object('classifications',(SELECT count(*) FROM gridex_customer_life_events.inbound_classifications WHERE company_id=${literal(f.companyId)}),'transitions',(SELECT count(*) FROM gridex_customer_life_events.transitions WHERE company_id=${literal(f.companyId)}),'copies',(SELECT count(*) FROM gridex_ediel_retention.classification_copy_revocations WHERE company_id=${literal(f.companyId)}),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.decision_evidence_tombstones WHERE company_id=${literal(f.companyId)}),'sourceRetained',(SELECT raw_payload IS NOT NULL FROM public.ediel_messages WHERE id=${literal(f.sourceMessageId)}))`)
 for(const retentionClass of classes){
  const parameters={p_company_id:f.companyId,p_actor_user_id:own.id,p_retention_class:retentionClass,p_target_id:target,p_include_document:false}
  const missing=await own.client.rpc('ediel_read_retention_decision_original_v1',parameters);expect(missing.error?.message).toContain('decision_evidence_original_scope_required');expect(missing.data).toBeNull()
  const wrong=await foreign.client.rpc('ediel_read_retention_decision_original_v1',{...parameters,p_actor_user_id:foreign.id});expect(wrong.error).not.toBeNull();expect(wrong.data).toBeNull()
 }
 expect(sql(`SELECT to_jsonb(gridex_ediel_retention.classification_copy_source_current_v1(${literal(f.companyId)},${literal(randomUUID())}))`)).toBe(false)
 // The full original owner body is still false without a committed source.
 expect(sql(`SELECT to_jsonb(gridex_customer_life_events.owner_proof_consistent_v1('{}','{}',${literal(f.sourceMessageId)}))`)).toBe(false)
 const after=sql(`SELECT jsonb_build_object('classifications',(SELECT count(*) FROM gridex_customer_life_events.inbound_classifications WHERE company_id=${literal(f.companyId)}),'transitions',(SELECT count(*) FROM gridex_customer_life_events.transitions WHERE company_id=${literal(f.companyId)}),'copies',(SELECT count(*) FROM gridex_ediel_retention.classification_copy_revocations WHERE company_id=${literal(f.companyId)}),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.decision_evidence_tombstones WHERE company_id=${literal(f.companyId)}),'sourceRetained',(SELECT raw_payload IS NOT NULL FROM public.ediel_messages WHERE id=${literal(f.sourceMessageId)}))`)
 expect(after).toEqual(before)
 console.log(JSON.stringify({kind:'classification_copy_native',classesExecuted:classes,proof:'actual installed ACL/volatility and GoTrue negative scoped reads only',allThreePositiveNativeAccepted:false,realLegalAuthority:false}))
},90000)

it('actual own customer original producer and separate JWT review erase decision bytes while canonical customer data stays retained',async()=>{
 const password=randomUUID()+'Aa1!',f=await createDecisionOriginalNativeFixture(password),customerId=randomUUID(),kind='customer_retention_decision_original_bytes',actor=await decisionUser(f.companyId,['ediel.retention.submit','ediel.retention.purge','ediel.retention.customer_fields','ediel.retention.record_decision_evidence'],password),reviewer=await decisionUser(f.companyId,['ediel.retention.review','ediel.retention.record_decision_evidence'],password)
 sql(`INSERT INTO public.customers(id,company_id,status,first_name,last_name,full_name,email) VALUES(${literal(customerId)},${literal(f.companyId)},'archived','SYNTHETIC','PERSON','SYNTHETIC PERSON','synthetic@example.invalid')`)
 const original=Buffer.from('SYNTHETIC unapproved own customer-retention decision'),archived=await actor.client.rpc('ediel_submit_customer_retention_v1',{p_company_id:f.companyId,p_actor_user_id:actor.id,p_customer_id:customerId,p_document_base64:original.toString('base64'),p_issuer_receipt:null})
 expect(archived.error).toBeNull();expect(archived.data.issuerQualified).toBe(false)
 const targetId=archived.data.decisionId,read=await reviewer.client.rpc('ediel_read_retention_decision_original_v1',{p_company_id:f.companyId,p_actor_user_id:reviewer.id,p_retention_class:kind,p_target_id:targetId,p_include_document:true})
 expect(read.error).toBeNull();expect(Buffer.from(read.data.documentBase64,'base64')).toEqual(original)
 const basis={retentionClass:kind,targetId,sourceHash:read.data.documentHash,targetMetadataHash:read.data.targetMetadataHash},document=Buffer.from('SYNTHETIC separate decision-original policy only'),pending=await actor.client.rpc('ediel_submit_decision_evidence_retention_v1',{p_company_id:f.companyId,p_actor_user_id:actor.id,p_retention_class:kind,p_target_id:targetId,p_document_base64:document.toString('base64'),p_issuer_receipt:signSyntheticDecisionOriginalPolicy(f.companyId,f.issuerId,basis,document)})
 expect(pending.error).toBeNull();expect(pending.data.issuerQualified).toBe(true)
 const policyId=pending.data.policyId,review=await reviewer.client.rpc('ediel_review_decision_evidence_retention_v1',{p_company_id:f.companyId,p_actor_user_id:reviewer.id,p_policy_id:policyId,p_outcome:'approve',p_reason:'SYNTHETIC independent customer decision-original review'})
 expect(review.error).toBeNull();expect(review.data.status).toBe('approved')
 const complete=await actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{p_company_id:f.companyId,p_actor_user_id:actor.id,p_policy_id:policyId});expect(complete.error).toBeNull();expect(complete.data).toMatchObject({status:'purged',targetId,sourceHash:hash(original),bytesAvailable:false,replay:false})
 expect(sql(`SELECT jsonb_build_object('bytes',d.document_bytes,'receipt',gridex_ediel_retention.customer_receipt_v1(d),'customerRetained',(SELECT email='synthetic@example.invalid' FROM public.customers WHERE id=${literal(customerId)}),'history',(SELECT count(*) FROM gridex_ediel_retention.customer_revocations WHERE decision_id=d.id)) FROM gridex_ediel_retention.customer_decisions d WHERE id=${literal(targetId)}`)).toEqual({bytes:null,receipt:null,customerRetained:true,history:1})
 console.log(JSON.stringify({kind:'customer_decision_original_native',classesExecuted:[kind],mechanismOnly:true,issuerAuthority:'explicit synthetic competence',allAdditionalNativeAccepted:false}))
},90000)
