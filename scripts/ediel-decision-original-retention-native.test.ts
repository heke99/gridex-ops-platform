import {expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {createDecisionOriginalNativeFixture,decisionNativeSql as sql,hash,literal,signSyntheticDecisionOriginalPolicy,completedReviewReasonClass,completedReviewReasonPermission,completedReviewReasonMarker,createCompletedReviewReasonNativeFixture,signSyntheticCompletedReviewReasonPolicy,waitForReviewReasonBoundary,withObservedReviewReasonLock,signSyntheticCompletedWitnessDisposition,createCompletedWitnessDispositionNativeFixture} from './helpers/ediel-decision-original-native-fixture'

// Explicit private-owner scope for synthetic setup/readback only; product JWT calls retain their actors.
const retentionSql=<T>(query:string)=>sql<T>(`BEGIN;SET LOCAL ROLE gridex_ediel_retention_owner;${query};COMMIT;`)

it('actual installed six-class custody has private table ACL, preserved native guards and explicit unassigned current keys',()=>{
 expect(sql(`SELECT jsonb_build_object('classes',(SELECT count(*)>=6 FROM gridex_ediel_retention.decision_evidence_catalog),'app_table_read',has_table_privilege('authenticated','gridex_ediel_retention.decision_evidence_policies','SELECT'),'service_purge',has_function_privilege('service_role','public.ediel_purge_decision_evidence_retention_v1(uuid,uuid,uuid)','EXECUTE'),'role_assigned',(SELECT count(*) FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE p.key IN(SELECT permission_key FROM gridex_ediel_retention.decision_evidence_catalog)))`)).toEqual({classes:true,app_table_read:false,service_purge:false,role_assigned:0})
},30000)
it('actual GoTrue/JWT archive and separate review erase only bound old decision bytes, retaining original source and immutable history',async()=>{
 const f=await createDecisionOriginalNativeFixture(randomUUID()+'Aa1!'),document=Buffer.from('SYNTHETIC native decision-original policy; no real legal competence'),parameters={p_company_id:f.companyId,p_policy_id:''},submission={p_company_id:f.companyId,p_actor_user_id:f.actor.id,p_retention_class:f.basis.retentionClass,p_target_id:f.targetId,p_document_base64:document.toString('base64'),p_issuer_receipt:signSyntheticDecisionOriginalPolicy(f.companyId,f.issuerId,f.basis,document)}
 const pending=await f.actor.client.rpc('ediel_submit_decision_evidence_retention_v1',submission);expect(pending.error).toBeNull();expect(pending.data.issuerQualified).toBe(true);parameters.p_policy_id=pending.data.policyId
 expect((await f.actor.client.rpc('ediel_review_decision_evidence_retention_v1',{...parameters,p_actor_user_id:f.actor.id,p_outcome:'approve',p_reason:'SYNTHETIC self review denied'})).error).not.toBeNull()
 expect((await f.actor.client.rpc('ediel_review_decision_evidence_retention_v1',{...parameters,p_actor_user_id:f.reviewer.id,p_outcome:'approve',p_reason:'SYNTHETIC actor spoof denied'})).error).not.toBeNull()
 const reviewed=await f.reviewer.client.rpc('ediel_review_decision_evidence_retention_v1',{...parameters,p_actor_user_id:f.reviewer.id,p_outcome:'approve',p_reason:'SYNTHETIC current separate native review'});expect(reviewed.error).toBeNull();expect(reviewed.data.status).toBe('approved')
 const readOriginal={p_company_id:f.companyId,p_actor_user_id:f.readonly.id,p_retention_class:f.basis.retentionClass,p_target_id:f.targetId,p_include_document:false}
 expect((await f.readonly.client.rpc('ediel_read_retention_decision_original_v1',readOriginal)).data).toMatchObject({bytesAvailable:true,documentBase64:null,documentHash:f.sourceHash})
 expect((await f.readonly.client.rpc('ediel_read_retention_decision_original_v1',{...readOriginal,p_include_document:true})).error).not.toBeNull()
 expect((await f.foreign.client.rpc('ediel_read_retention_decision_original_v1',{...readOriginal,p_actor_user_id:f.foreign.id})).error).not.toBeNull()
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.reviewer.id)},${literal(f.companyId)},'ediel.retention.review','deny',true)`)
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...parameters,p_actor_user_id:f.actor.id})).error).not.toBeNull()
 expect(sql(`SELECT to_jsonb(document_bytes IS NOT NULL) FROM gridex_ediel_retention.blob_decisions WHERE id=${literal(f.targetId)}`)).toBe(true)
 sql(`DELETE FROM public.user_permission_overrides WHERE user_id=${literal(f.reviewer.id)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.retention.review'`)
 const complete=await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...parameters,p_actor_user_id:f.actor.id});expect(complete.error).toBeNull();expect(complete.data).toMatchObject({status:'purged',targetId:f.targetId,sourceHash:f.sourceHash,bytesAvailable:false,replay:false})
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...parameters,p_actor_user_id:f.actor.id})).data.replay).toBe(true)
 const after=await f.readonly.client.rpc('ediel_read_retention_decision_original_v1',readOriginal);expect(after.error).toBeNull();expect(after.data).toMatchObject({bytesAvailable:false,documentBase64:null,documentHash:f.sourceHash,documentByteLength:f.sourceDocument.length,authority:'none'});expect(after.data.purgedAt).toBeTruthy()
 expect({...retentionSql<Record<string,unknown>>(`SELECT jsonb_build_object('bytes',d.document_bytes,'receipt',gridex_ediel_retention.blob_receipt_v1(d),'revoked',(SELECT count(*) FROM gridex_ediel_retention.blob_revocations WHERE decision_id=d.id)) FROM gridex_ediel_retention.blob_decisions d WHERE id=${literal(f.targetId)}`),...sql<Record<string,unknown>>(`SELECT jsonb_build_object('raw',(SELECT raw_payload IS NOT NULL FROM public.ediel_messages WHERE id=${literal(f.sourceMessageId)}),'audit',(SELECT count(*) FROM public.audit_logs WHERE entity_id=${literal(f.targetId)} AND action='ediel.retention.decision_original_bytes_removed'))`)}).toEqual({bytes:null,receipt:null,revoked:1,raw:true,audit:1})
 const readPolicy=await f.readonly.client.rpc('ediel_read_decision_evidence_policy_v1',{...parameters,p_actor_user_id:f.readonly.id,p_include_document:false});expect(readPolicy.error).toBeNull();expect(readPolicy.data).toMatchObject({documentHash:hash(document),currentQualified:false,bytesAvailable:true,authority:'none'})
 console.log(JSON.stringify({kind:'decision_original_native',mechanismOnly:true,source:'actual raw capture and protected unapproved original archive; no market source/accepted owner seeded',legalAuthority:'synthetic competence; not real issuer/deadline',classesExecuted:['blob_retention_decision_original_bytes'],allSixNativeAccepted:false}))
},90000)

it('actual JWT same-review retirement crosses signed PG time, consumes separate metadata authority and preserves sibling/source history',async()=>{
 const f=await createCompletedReviewReasonNativeFixture(randomUUID()+'Aa1!'),purge={...f.parameters,p_actor_user_id:f.actor.id}
 const before=()=>retentionSql<{selected:Record<string,unknown>;sibling:Record<string,unknown>;sourcePolicy:Record<string,unknown>;original:Record<string,unknown>}>(`SELECT jsonb_build_object('selected',(SELECT to_jsonb(r) FROM gridex_ediel_retention.decision_evidence_reviews r WHERE id=${literal(f.sourceReviewId)}),'sibling',(SELECT to_jsonb(r) FROM gridex_ediel_retention.decision_evidence_reviews r WHERE id=${literal(f.siblingReviewId)}),'sourcePolicy',(SELECT to_jsonb(p) FROM gridex_ediel_retention.decision_evidence_policies p WHERE id=${literal(f.sourcePolicyId)}),'original',(SELECT to_jsonb(d) FROM gridex_ediel_retention.blob_decisions d WHERE id=${literal(f.targetId)}))`)
 const sourceBefore=before(),rawBefore=sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.sourceMessageId)}`)
 const read={p_company_id:f.companyId,p_actor_user_id:f.readonly.id,p_retention_class:completedReviewReasonClass,p_target_id:f.sourceReviewId,p_include_document:false}
 expect((await f.readonly.client.rpc('ediel_read_retention_decision_original_v1',read)).data).toMatchObject({targetId:f.sourceReviewId,documentHash:hash(Buffer.from(f.sourceReason)),bytesAvailable:true,documentBase64:null})
 expect((await f.foreign.client.rpc('ediel_read_retention_decision_original_v1',{...read,p_actor_user_id:f.foreign.id})).error).not.toBeNull()
 expect((await f.readonly.client.rpc('ediel_read_retention_decision_original_v1',{...read,p_include_document:true})).error).not.toBeNull()
 expect((await f.readonly.client.rpc('ediel_purge_decision_evidence_retention_v1',{...f.parameters,p_actor_user_id:f.readonly.id})).error).not.toBeNull()
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...purge,p_actor_user_id:f.reviewer.id})).error).not.toBeNull()
 const conflicting=await f.actor.client.rpc('ediel_submit_decision_evidence_retention_v1',{p_company_id:f.companyId,p_actor_user_id:f.actor.id,p_retention_class:completedReviewReasonClass,p_target_id:f.sourceReviewId,p_document_base64:f.metadataDocument.toString('base64'),p_issuer_receipt:signSyntheticDecisionOriginalPolicy(f.companyId,f.issuerId,f.metadataBasis,f.metadataDocument,{retainUntil:f.clock.boundary,journalRetainUntil:f.clock.witnessUntil})})
 expect(conflicting.error?.message).toContain('decision_evidence_original_policy_conflict')
 for(const kind of ['byte-only operation','missing witness fields'] as const){
  const document=Buffer.from('SYNTHETIC independent negative underlay: '+kind)
  const receipt=kind==='byte-only operation'?signSyntheticDecisionOriginalPolicy(f.companyId,f.issuerId,f.metadataBasis,document,{retainUntil:f.clock.boundary,journalRetainUntil:f.clock.witnessUntil}):signSyntheticCompletedReviewReasonPolicy(f.companyId,f.issuerId,f.metadataBasis,document,{issuedAt:f.clock.issuedAt,expiresAt:f.clock.expiresAt,retainUntil:f.clock.boundary,journalRetainUntil:f.clock.witnessUntil,witnessFields:[]})
  const unqualified=await f.actor.client.rpc('ediel_submit_decision_evidence_retention_v1',{p_company_id:f.companyId,p_actor_user_id:f.actor.id,p_retention_class:completedReviewReasonClass,p_target_id:f.sourceReviewId,p_document_base64:document.toString('base64'),p_issuer_receipt:receipt})
  expect(unqualified.error).toBeNull();expect(unqualified.data.issuerQualified).toBe(false)
  const invalidParameters={p_company_id:f.companyId,p_policy_id:unqualified.data.policyId}
  expect((await f.reviewer.client.rpc('ediel_review_decision_evidence_retention_v1',{...invalidParameters,p_actor_user_id:f.reviewer.id,p_outcome:'approve',p_reason:'SYNTHETIC wrong operation or absent witness authority'})).data.status).toBe('held')
  expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...invalidParameters,p_actor_user_id:f.actor.id})).data.status).toBe('held')
 }
 expect(sql(`SELECT to_jsonb(clock_timestamp()<${literal(f.clock.boundary)}::timestamptz)`)).toBe(true)
 const early=await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',purge);expect(early.error).toBeNull();expect(early.data.status).toBe('held');expect(before()).toEqual(sourceBefore)
 waitForReviewReasonBoundary(f.clock.boundary)
 const completed=await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',purge);expect(completed.error).toBeNull();expect(completed.data).toMatchObject({status:'purged',targetId:f.sourceReviewId,sourceHash:hash(Buffer.from(f.sourceReason)),replay:false,bytesAvailable:false,authority:'none'})
 expect(before()).toEqual({...sourceBefore,selected:{...sourceBefore.selected,reason:completedReviewReasonMarker}})
 expect(sql(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.sourceMessageId)}`)).toEqual(rawBefore)
 expect((await f.readonly.client.rpc('ediel_read_retention_decision_original_v1',read)).data).toMatchObject({targetId:f.sourceReviewId,documentHash:hash(Buffer.from(f.sourceReason)),documentByteLength:Buffer.byteLength(f.sourceReason),bytesAvailable:false,documentBase64:null})
 const policyRead=await f.readonly.client.rpc('ediel_read_decision_evidence_policy_v1',{...f.parameters,p_actor_user_id:f.readonly.id,p_include_document:false});expect(policyRead.error).toBeNull();expect(policyRead.data).toMatchObject({revoked:true,issuerQualified:false,currentQualified:false,bytesAvailable:true})
 const sourceRead=await f.readonly.client.rpc('ediel_read_decision_evidence_policy_v1',{p_company_id:f.companyId,p_actor_user_id:f.readonly.id,p_policy_id:f.sourcePolicyId,p_include_document:false});expect(sourceRead.error).toBeNull();expect(sourceRead.data.reviews.find((r:{reviewId:string})=>r.reviewId===f.sourceReviewId).reason).toBe(completedReviewReasonMarker);expect(sourceRead.data.reviews.find((r:{reviewId:string})=>r.reviewId===f.siblingReviewId).reason).toBe(sourceBefore.sibling.reason)
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',purge)).data.replay).toBe(true)
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{p_company_id:f.companyId,p_actor_user_id:f.actor.id,p_policy_id:f.sourcePolicyId})).data.replay).toBe(true)
 for(const mutation of [`UPDATE gridex_ediel_retention.decision_evidence_reviews SET reason=${literal(f.sourceReason)} WHERE id=${literal(f.sourceReviewId)}`,`UPDATE gridex_ediel_retention.decision_evidence_reviews SET outcome='held' WHERE id=${literal(f.sourceReviewId)}`,`DELETE FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=${literal(f.sourceReviewId)}`,`TRUNCATE gridex_ediel_retention.decision_evidence_reviews CASCADE`])expect(()=>retentionSql(mutation)).toThrow(/received_source_evidence_is_append_only/)
 // Retention rows are private-owner readback; public audit rows stay a separate postgres read.
 const retained=retentionSql<{policies:unknown;reviews:unknown;revocations:unknown;tombstones:unknown;policyIds:string[]|null;tombstone:{journal_retain_until:string;journal_purpose_reference:string}}>(`SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('receiptUtf8',convert_from(decode(p.issuer_receipt->>'payloadBase64','base64'),'UTF8'),'documentUtf8',convert_from(p.document_bytes,'UTF8'))) FROM gridex_ediel_retention.decision_evidence_policies p WHERE company_id=${literal(f.companyId)} AND retention_class=${literal(completedReviewReasonClass)}),'reviews',(SELECT jsonb_agg(to_jsonb(r)) FROM gridex_ediel_retention.decision_evidence_reviews r JOIN gridex_ediel_retention.decision_evidence_policies p ON p.id=r.policy_id WHERE p.company_id=${literal(f.companyId)} AND p.retention_class=${literal(completedReviewReasonClass)}),'revocations',(SELECT jsonb_agg(to_jsonb(r)) FROM gridex_ediel_retention.decision_evidence_revocations r JOIN gridex_ediel_retention.decision_evidence_policies p ON p.id=r.policy_id WHERE p.company_id=${literal(f.companyId)} AND p.retention_class=${literal(completedReviewReasonClass)}),'tombstones',(SELECT jsonb_agg(to_jsonb(t)) FROM gridex_ediel_retention.decision_evidence_tombstones t WHERE company_id=${literal(f.companyId)} AND retention_class=${literal(completedReviewReasonClass)}),'policyIds',(SELECT jsonb_agg(id::text) FROM gridex_ediel_retention.decision_evidence_policies WHERE company_id=${literal(f.companyId)} AND retention_class=${literal(completedReviewReasonClass)}),'tombstone',(SELECT to_jsonb(t) FROM gridex_ediel_retention.decision_evidence_tombstones t WHERE policy_id=${literal(f.policyId)}))`)
 const audits=sql<unknown>(`SELECT jsonb_agg(to_jsonb(a)) FROM public.audit_logs a WHERE company_id=${literal(f.companyId)} AND (entity_id=${literal(f.sourceReviewId)} OR entity_id=ANY(${literal('{'+(retained.policyIds??[]).join(',')+'}')}::text[]))`)
 const facts={stored:{policies:retained.policies,reviews:retained.reviews,revocations:retained.revocations,tombstones:retained.tombstones,audits},tombstone:retained.tombstone}
 expect(JSON.stringify(facts.stored)).not.toContain(f.sourceReason);expect(new Date(facts.tombstone.journal_retain_until).getTime()).toBe(new Date(f.clock.witnessUntil).getTime());expect(facts.tombstone.journal_purpose_reference).toBe('SYNTHETIC separately finite selected metadata witnesses only')
 console.log(JSON.stringify({kind:'completed_review_reason_native',targetId:f.sourceReviewId,prospectiveBoundary:f.clock.boundary,actualPgBoundaryObserved:true,separateFiniteWitnessUntil:f.clock.witnessUntil,mechanismOnly:true,legalAuthority:'synthetic; no real issuer/deadline',financialPreservation:'Existing qualified DB05 preservation evidence remains separate; no new financial proof claimed'}))
},120000)

it.each(['actor permission','reviewer permission','receipt expiry'] as const)('actual blocked metadata retirement rechecks %s after the same target lock wait',async(control)=>{
 const f=await createCompletedReviewReasonNativeFixture(randomUUID()+'Aa1!',6,control==='receipt expiry'?2:120)
 waitForReviewReasonBoundary(f.clock.boundary)
 let denyAt:string|undefined
 if(control!=='receipt expiry'){
  const user=control==='actor permission'?f.actor.id:f.reviewer.id,permission=control==='actor permission'?completedReviewReasonPermission:'ediel.retention.review'
  denyAt=sql<string>(`SELECT to_jsonb(clock_timestamp()+interval '1 second')`)
  sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from) VALUES(${literal(f.companyId)},${literal(user)},${literal(permission)},'deny',true,${literal(denyAt)}::timestamptz)`)
 }
 const before=retentionSql(`SELECT to_jsonb(r) FROM gridex_ediel_retention.decision_evidence_reviews r WHERE id=${literal(f.sourceReviewId)}`)
 const result=await withObservedReviewReasonLock(f.sourceReviewId,async()=>await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...f.parameters,p_actor_user_id:f.actor.id}),()=>{if(denyAt)waitForReviewReasonBoundary(denyAt)})
 if(control==='receipt expiry'){expect(result.error).toBeNull();expect(result.data.status).toBe('held');expect(sql(`SELECT to_jsonb(clock_timestamp()>=${literal(f.clock.expiresAt)}::timestamptz)`)).toBe(true)}else expect(result.error).not.toBeNull()
 expect(retentionSql(`SELECT to_jsonb(r) FROM gridex_ediel_retention.decision_evidence_reviews r WHERE id=${literal(f.sourceReviewId)}`)).toEqual(before)
 expect(sql(`SELECT jsonb_build_object('tombstones',(SELECT count(*) FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=${literal(f.policyId)}),'revocations',(SELECT count(*) FROM gridex_ediel_retention.decision_evidence_revocations WHERE policy_id=${literal(f.policyId)}),'audit',(SELECT count(*) FROM public.audit_logs WHERE entity_id=${literal(f.sourceReviewId)} AND action='ediel.retention.completed_review_reason_retired'))`)).toEqual({tombstones:0,revocations:0,audit:0})
},120000)

it.each(['scheduled class deny','expiring class allow'] as const)('actual JWT reason body read refuses %s after an observed selected-review lock wait',async(control)=>{
 const f=await createCompletedReviewReasonNativeFixture(randomUUID()+'Aa1!'),read={p_company_id:f.companyId,p_actor_user_id:f.reviewer.id,p_retention_class:completedReviewReasonClass,p_target_id:f.sourceReviewId,p_include_document:true}
 const current=await f.reviewer.client.rpc('ediel_read_retention_decision_original_v1',read);expect(current.error).toBeNull();expect(current.data.documentBase64).toBe(Buffer.from(f.sourceReason).toString('base64'))
 const boundary=sql<string>(`SELECT to_jsonb(clock_timestamp()+interval '1 second')`)
 if(control==='expiring class allow'){
  sql(`DELETE FROM public.user_permissions WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer.id)} AND permission_key=${literal(completedReviewReasonPermission)};INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_to) VALUES(${literal(f.companyId)},${literal(f.reviewer.id)},${literal(completedReviewReasonPermission)},'allow',true,${literal(boundary)}::timestamptz)`)
 }else{
  sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from) VALUES(${literal(f.companyId)},${literal(f.reviewer.id)},${literal(completedReviewReasonPermission)},'deny',true,${literal(boundary)}::timestamptz)`)
 }
 const blocked=await withObservedReviewReasonLock(f.sourceReviewId,async()=>await f.reviewer.client.rpc('ediel_read_retention_decision_original_v1',read),()=>waitForReviewReasonBoundary(boundary))
 expect(blocked.error?.message).toContain('decision_evidence_current_class_grant_required');expect(blocked.data).toBeNull();expect(JSON.stringify(blocked)).not.toContain(Buffer.from(f.sourceReason).toString('base64'))
 const fresh=await f.reviewer.client.rpc('ediel_read_retention_decision_original_v1',read);expect(fresh.error?.message).toContain('decision_evidence_current_class_grant_required');expect(fresh.data).toBeNull()
 expect(retentionSql(`SELECT to_jsonb(reason) FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=${literal(f.sourceReviewId)}`)).toBe(f.sourceReason)
},120000)

type CompletedFixture=Awaited<ReturnType<typeof createCompletedReviewReasonNativeFixture>>
function completedWitnessGraph(f:CompletedFixture){
 return retentionSql(`SELECT jsonb_build_object(
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM gridex_ediel_retention.decision_evidence_policies p WHERE company_id=${literal(f.companyId)}),
 'reviews',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM gridex_ediel_retention.decision_evidence_reviews r JOIN gridex_ediel_retention.decision_evidence_policies p ON p.id=r.policy_id WHERE p.company_id=${literal(f.companyId)}),
 'revocations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.policy_id) FROM gridex_ediel_retention.decision_evidence_revocations r JOIN gridex_ediel_retention.decision_evidence_policies p ON p.id=r.policy_id WHERE p.company_id=${literal(f.companyId)}),
 'tombstones',(SELECT jsonb_agg(to_jsonb(t) ORDER BY policy_id) FROM gridex_ediel_retention.decision_evidence_tombstones t WHERE company_id=${literal(f.companyId)}),
 'audits',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a WHERE company_id=${literal(f.companyId)}))`)
}
function readCompletedWitness(f:CompletedFixture,port:'policy'|'original',includeDocument=true){
 return port==='policy'
  ?f.reviewer.client.rpc('ediel_read_decision_evidence_policy_v1',{p_company_id:f.companyId,p_actor_user_id:f.reviewer.id,p_policy_id:f.policyId,p_include_document:includeDocument})
  :f.reviewer.client.rpc('ediel_read_retention_decision_original_v1',{p_company_id:f.companyId,p_actor_user_id:f.reviewer.id,p_retention_class:'decision_evidence_policy_original_bytes',p_target_id:f.policyId,p_include_document:includeDocument})
}

// New prospective W controls. The original eight Source6 cases above are kept
// byte-for-byte. Synthetic signed legal facts do not create real legal credit.
it.each(['policy','original'] as const)('actual JWT %s witness disclosure stops at the first PG observation at-or-after signed W after a real selected-review lock wait',async port=>{
 const f=await createCompletedReviewReasonNativeFixture(randomUUID()+'Aa1!',6,120,3)
 waitForReviewReasonBoundary(f.clock.boundary)
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...f.parameters,p_actor_user_id:f.actor.id})).data.status).toBe('purged')
 expect(sql<boolean>(`SELECT to_jsonb(clock_timestamp()<${literal(f.clock.witnessUntil)}::timestamptz)`)).toBe(true)
 const before=await readCompletedWitness(f,port);expect(before.error).toBeNull();expect(before.data.documentBase64).toBe(f.metadataDocument.toString('base64'))
 const graph=completedWitnessGraph(f)
 const blocked=await withObservedReviewReasonLock(f.sourceReviewId,async()=>await readCompletedWitness(f,port),()=>waitForReviewReasonBoundary(f.clock.witnessUntil))
 expect(sql<boolean>(`SELECT to_jsonb(clock_timestamp()>=${literal(f.clock.witnessUntil)}::timestamptz)`)).toBe(true)
 expect(blocked.error?.code).toBe('42501');expect(blocked.error?.message).toContain('completed_review_witness_disclosure_ended');expect(blocked.data).toBeNull()
 for(const includeDocument of [false,true]){const after=await readCompletedWitness(f,port,includeDocument);expect(after.error?.code).toBe('42501');expect(after.data).toBeNull()}
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...f.parameters,p_actor_user_id:f.actor.id})).data.replay).toBe(true)
 expect(completedWitnessGraph(f)).toEqual(graph)
},120000)

it.each(['policy','original'] as const)('actual JWT %s witness reader rechecks its current namespace class after an observed selected-review lock wait',async port=>{
 const f=await createCompletedReviewReasonNativeFixture(randomUUID()+'Aa1!')
 waitForReviewReasonBoundary(f.clock.boundary)
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...f.parameters,p_actor_user_id:f.actor.id})).data.status).toBe('purged')
 expect((await readCompletedWitness(f,port)).error).toBeNull()
 const key=port==='policy'?completedReviewReasonPermission:'ediel.retention.decision_policy_evidence',boundary=sql<string>(`SELECT to_jsonb(clock_timestamp()+interval '1 second')`)
 sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from) VALUES(${literal(f.companyId)},${literal(f.reviewer.id)},${literal(key)},'deny',true,${literal(boundary)}::timestamptz)`)
 const graph=completedWitnessGraph(f)
 const denied=await withObservedReviewReasonLock(f.sourceReviewId,async()=>await readCompletedWitness(f,port),()=>waitForReviewReasonBoundary(boundary))
 expect(denied.error?.code).toBe('42501');expect(denied.data).toBeNull();expect((await readCompletedWitness(f,port)).error?.code).toBe('42501');expect(completedWitnessGraph(f)).toEqual(graph)
},120000)

it('actual final metadata audit failure rolls back reason retirement and all linked witnesses before later successful retry',async()=>{
 const f=await createCompletedReviewReasonNativeFixture(randomUUID()+'Aa1!'),name='db05_witness_audit_'+randomUUID().replaceAll('-','')
 waitForReviewReasonBoundary(f.clock.boundary)
 const graph=completedWitnessGraph(f),purge={...f.parameters,p_actor_user_id:f.actor.id}
 sql(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_final_metadata_audit_failure';END$$;CREATE TRIGGER ${name} BEFORE INSERT ON public.audit_logs FOR EACH ROW WHEN(NEW.company_id=${literal(f.companyId)}::uuid AND NEW.action='ediel.retention.completed_review_reason_retired') EXECUTE FUNCTION public.${name}()`)
 try{
  const aborted=await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',purge);expect(aborted.error?.message).toContain('synthetic_final_metadata_audit_failure');expect(aborted.data).toBeNull();expect(completedWitnessGraph(f)).toEqual(graph)
  expect(retentionSql(`SELECT to_jsonb(reason) FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=${literal(f.sourceReviewId)}`)).toBe(f.sourceReason)
 }finally{sql(`DROP TRIGGER ${name} ON public.audit_logs;DROP FUNCTION public.${name}()`)}
 const retried=await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',purge);expect(retried.error).toBeNull();expect(retried.data).toMatchObject({status:'purged',replay:false})
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',purge)).data.replay).toBe(true)
},120000)

// New physical-disposition native oracles below. The preceding thirteen
// Source6/W oracles remain unchanged. These cases are SOURCE ONLY until the
// existing producer admits this exact source/GEN/input/output binding.
it('actual JWT physical leaf disposition respects W, current independent approval, finite R and irreversible read refusal',async()=>{
 const f=await createCompletedWitnessDispositionNativeFixture(randomUUID()+'Aa1!'),params={...f.parameters,p_actor_user_id:f.actor.id},before=completedWitnessGraph(f)
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',params)).data.status).toBe('held');expect(completedWitnessGraph(f)).toEqual(before)
 waitForReviewReasonBoundary(f.clock.witnessUntil)
 const effect=await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',params);expect(effect.error).toBeNull();expect(effect.data).toEqual({status:'disposed',replay:false,authority:'none'})
 expect(retentionSql(`SELECT to_jsonb(reason) FROM gridex_ediel_retention.decision_evidence_reviews WHERE id=${literal(f.sourceReviewId)}`)).toBe('')
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',params)).data).toEqual({status:'disposed',replay:true,authority:'none'})
 const payload=JSON.parse(Buffer.from(f.dispositionReceipt.payloadBase64,'base64').toString('utf8')) as {R:string};waitForReviewReasonBoundary(payload.R)
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',params)).data).toEqual({status:'expired',authority:'none'});expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',params)).data).toEqual({status:'unavailable',authority:'none'})
 for(const port of ['policy','original'] as const)expect((await readCompletedWitness(f,port)).error).not.toBeNull()
 expect((await f.reviewer.client.rpc('ediel_read_retention_decision_original_v1',{p_company_id:f.companyId,p_actor_user_id:f.reviewer.id,p_retention_class:completedReviewReasonClass,p_target_id:f.sourceReviewId,p_include_document:true})).error?.code).toBe('42501')
},120000)
it.each(['actor','reviewer'] as const)('actual physical disposition rechecks %s class after an observed source-review wait without erasing fields',async control=>{
 const f=await createCompletedWitnessDispositionNativeFixture(randomUUID()+'Aa1!');waitForReviewReasonBoundary(f.clock.witnessUntil)
 const user=control==='actor'?f.actor.id:f.reviewer.id,boundary=sql<string>(`SELECT to_jsonb(clock_timestamp()+interval '1 second')`),before=completedWitnessGraph(f)
 sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from) VALUES(${literal(f.companyId)},${literal(user)},${literal(completedReviewReasonPermission)},'deny',true,${literal(boundary)}::timestamptz)`)
 const result=await withObservedReviewReasonLock(f.sourceReviewId,async()=>await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...f.parameters,p_actor_user_id:f.actor.id}),()=>waitForReviewReasonBoundary(boundary))
 expect(result.error||result.data.status==='held').toBeTruthy();expect(completedWitnessGraph(f)).toEqual(before)
},120000)
it.each(['foreign tenant','wrong session','missing class'] as const)('actual physical phase review denies %s without new phase authority',async control=>{
 const f=await createCompletedReviewReasonNativeFixture(randomUUID()+'Aa1!');waitForReviewReasonBoundary(f.clock.boundary);expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',{...f.parameters,p_actor_user_id:f.actor.id})).data.status).toBe('purged')
 const receipt=signSyntheticCompletedWitnessDisposition(f)
 if(control==='missing class')sql(`DELETE FROM public.user_permissions WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.reviewer.id)} AND permission_key=${literal(completedReviewReasonPermission)}`)
 const result=await f.reviewer.client.rpc('ediel_review_completed_witness_disposition_v1',{...f.parameters,p_company_id:control==='foreign tenant'?f.foreignCompanyId:f.companyId,p_actor_user_id:control==='wrong session'?f.actor.id:f.reviewer.id,p_outcome:'approve',p_receipt:receipt});expect(result.error).not.toBeNull();expect(retentionSql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.completed_witness_phase_authorizations_v1 WHERE company_id=${literal(f.companyId)}`)).toBe(0)
},120000)
it('actual final physical delete failure rolls back all36 fields, replay projection and operational phase before retry',async()=>{
 const f=await createCompletedWitnessDispositionNativeFixture(randomUUID()+'Aa1!');waitForReviewReasonBoundary(f.clock.witnessUntil)
 const name='db05_physical_'+randomUUID().replaceAll('-',''),before=completedWitnessGraph(f),params={...f.parameters,p_actor_user_id:f.actor.id}
 sql(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_late_physical_failure';END$$`);retentionSql(`CREATE TRIGGER ${name} AFTER DELETE ON gridex_ediel_retention.decision_evidence_policies FOR EACH ROW WHEN(OLD.id=${literal(f.policyId)}::uuid) EXECUTE FUNCTION public.${name}()`)
 try{const result=await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',params);expect(result.error?.message).toContain('synthetic_late_physical_failure');expect(completedWitnessGraph(f)).toEqual(before);expect(retentionSql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.completed_witness_replays_v1 WHERE company_id=${literal(f.companyId)}`)).toBe(0)}finally{retentionSql(`DROP TRIGGER ${name} ON gridex_ediel_retention.decision_evidence_policies`);sql(`DROP FUNCTION public.${name}()`)}
 expect((await f.actor.client.rpc('ediel_purge_decision_evidence_retention_v1',params)).data).toEqual({status:'disposed',replay:false,authority:'none'})
},120000)
