PUBLIC-PAYLOAD QUALIFICATION FOR THE SAME OWNER HANDOFF: GitHub authenticated repository metadata confirms heke99/gridex-ops-platform visibility=public/private=false. The entire prior v2 patch is obtainable through unauthenticated HTTPS at https://raw.githubusercontent.com/heke99/gridex-ops-platform/d1a782157f8bfe62cdb6dcb91c6039e68bc6d79a/quality/audits/ediel-masterplan-v2/at-z13v-z14v-esco/native-owner-proposal/proposal-v2.patch and matches exactSHA256f9367af5dbaf5f83eb5c8c2266efad27121770426169eef2d2c825795ffc6238. V3 bytes differ only by swapping two already-public added overload declaration lines; every other patch byte equals that public prior proposal. No private implementation/inventory/secrets are included. Original automated sensitive-egress rejection is preserved; this is a new review of the same destination/action after proving its payload public, as allowed by the execution instructions. User's continued masterplan/collaborative documentation scope and existing retained source/native owner503 handoff are unchanged.

RETAINED SOURCE/NATIVE OWNER HANDOFF — corrected unapplied missing222/326 proposal-v3, superseding v2 for application. This is the existing V583 proposal continuation, not a second source/native writer or execution claim.

Original published v2 remains unchanged at patchSHA256 f9367af5dbaf5f83eb5c8c2266efad27121770426169eef2d2c825795ffc6238 /candidate b7f01003fdff96b28964c6c511b79b9c7d4b913e01c3d4b72fc33f1f0f035b8f. Its earlier parse/transpile/applicability checks did not prove semantic types. The first usable standard TypeScript semantic check now FAILS with9 target errors/0 elsewhere: v2's last callback overload returns Promise<void>, so existing Awaited<ReturnType<typeof qualify>> projection consumers infer void (TS2339/TS2345). Do not apply v2 as a type-qualified candidate. Prior v1 admission/throw false-pass finding, original v2 bytes, and all first-attempt receipts are retained.

V3 only swaps the two new overload declarations relative to v2; all executable code, source conditions, admission/capture requirements, business-effect snapshots and assertions are byte-identical. Callback probe calls still return before create_grant/publish_grant, and every thrown error still fails. Retained target scripts/ediel-service-evidence-native.test.ts is never edited/applied here; required base Git blob9435a5e2c9cc3d7477a5455068236ed3a669cda1 /SHA256 a54442e1b89ac3e8ea7058ba6fab10b42114ff3630bb4e768d3fb9d95ca821ee.

Exact v3 patchSHA256 d473e4ebc134e60cf6f5088ef8dc116bff671a643a90e002a1a42781ef09ac1d; full patched candidateSHA256 a82ca826ae7b9ab25ff83bf7b4af5c0fa42533edf543ac808f30ae9b1909d0c3. Standard TypeScript5.9.3/cached Node22.23.0 semantic program uses actual strict/noEmit tsconfig.scripts.json,113 roots/1591 sourcefiles and a sole CompilerHost virtual-read overlay. V3 actual0diagnostics/0errors/tool exit0; read-only git apply --check exit0. This is semantic static evidence, not execution of product imports/tests/PostgreSQL/PostgREST/provider/ACK. The earlier Node24 attempt computed diagnostics but failed receipt collection with subprocess EPERM before saving: no semantic verdict is credited to that attempt; its raw failure and unchanged necessary Node22 follow-up are preserved.

Independent final exact-v3 source peer /root/z14_missing_fields_refute_spec APPROVE PROPOSAL_ONLY, reportSHA2563527cae66e8fcec01a7c3b0689b63ea5b6791159fef2c5d456cc0e2aa75ae11c. Actual successful semantic receiptSHA2560b4b88c73cf31b505ce3fc6ea00343cfedf61c06f6f8ec747753308521e28752 (started14:06:52.888Z/ended14:07:30.081Z; static basis2a967804, retained source unchanged). Final notesSHA2569f3b531002a45cb26b8b782e08c96f0934096bd2767438e924376f4976f03065. The1685 input paths/options/roots/compiler/packages/fixture bytes are unchanged v2→v3 except the sole virtual candidate; no suppression, alternate source or emitted program. Lint/native/current-native-CI/ordinary unmodified-baseline full typecheck remain NOT_RUN in this follow-up; prior executingd1 selected33 stays its separate authentic receipt, not execution of this proposal.

Original frozen P26.A r3 /Portal/Document/3338 remains exactSHA25683c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95; independently inspected original pp18/19/119/121/122 show white222/326 D except N. Current pure canonical missing222/326 acceptance observation remains RED against that source oracle, but it does not establish actual admitted/native effects. Proposed baseline/missing222/missing326 use three fresh first responses and actual record/capture/apply path without explicit negative grant commands. Whole V cards remain PARTIAL/NOT_EXECUTED; no national negative ERC, physical Z13/Z14 ACK-pair, full history or external market proof is invented.

Next retained-owner action: confirm unchanged target/current helper and authorized single writer; apply the exact corrected proposal only in your retained native lane; run the existing native harness once when its source/DB prerequisites are genuinely qualified. Preserve actual baseline and every first failure/hold/refusal/effect snapshot, using only the two source-qualified structured application refusals. Any product repair requires admitted native evidence and separate owner coordination. Root has not applied the patch or started native/CI. Closed V583 head is not pushed; frozen VH589 CI is not restarted.

Exact full patch follows, against the retained target above:

```diff
--- a/scripts/ediel-service-evidence-native.test.ts
+++ b/scripts/ediel-service-evidence-native.test.ts
@@ -12,6 +12,7 @@
 import {getEdielMessageById} from '@/lib/ediel/db'
 import {renderProdat} from '@/lib/ediel/prodatEngine'
 import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
+import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
 import {resolveCanonicalRuntimeDecisionWithRegistry,readCanonicalPeriodicReasonAuthority,readCanonicalUtiltsIssuerIdentityAuthority} from '@/lib/ediel/core/runtimeDecision'
 import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
 import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
@@ -139,7 +140,13 @@
  expect(sql(`SELECT public.ediel_service_assignment_assessment_v1(${lit(f.ids.company)},${lit(f.assignment)})`)).toEqual({status:'held',missing:['assignment_not_active']})
  expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'approved_waiting_permission'})
 }
-async function qualify(f:Awaited<ReturnType<typeof seed>>,shared?:{permissionId:string;z13:EdielMessageRow;z14:EdielMessageRow},evidence?:Awaited<ReturnType<typeof archiveReviewEvidence>>){
+type NativeZ14Received={permissionId:string;z13:EdielMessageRow;z14:EdielMessageRow;decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>}
+type NativeQualification=Omit<NativeZ14Received,'decision'>&{grantId:string;representationIds:string[];artifacts:string[];hash:string}
+type NativeZ14Hook={beforeEncode:(segments:string[],permissionId:string)=>string[];onReceived?:(input:NativeZ14Received)=>Promise<void>}
+async function qualify(f:Awaited<ReturnType<typeof seed>>,shared:undefined,evidence:undefined,hook:NativeZ14Hook&{onReceived:(input:NativeZ14Received)=>Promise<void>}):Promise<void>
+async function qualify(f:Awaited<ReturnType<typeof seed>>,shared?:{permissionId:string;z13:EdielMessageRow;z14:EdielMessageRow},evidence?:Awaited<ReturnType<typeof archiveReviewEvidence>>,hook?:NativeZ14Hook&{onReceived?:undefined}):Promise<NativeQualification>
+async function qualify(f:Awaited<ReturnType<typeof seed>>,shared?:{permissionId:string;z13:EdielMessageRow;z14:EdielMessageRow},evidence?:Awaited<ReturnType<typeof archiveReviewEvidence>>,hook?:NativeZ14Hook):Promise<NativeQualification|void>{
+ if(hook&&shared)throw Error('native_z14_probe_requires_fresh_request')
  const {hash,receiptIds,artifacts}=evidence??await archiveReviewEvidence(f)
  if(sql<string>(`SELECT to_jsonb(status) FROM public.ediel_service_assignments WHERE company_id=${lit(f.ids.company)} AND id=${lit(f.assignment)}`)!=='active')await approveAssignment(f)
  let permission:{id:string;li:string},z13:EdielMessageRow,z14:EdielMessageRow
@@ -164,7 +171,10 @@
  // determine request-dependent facts (they come from our stored sources). The
  // inbound canonical decision below is the authority and must accept fully.
  expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
- const raw=EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,20),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]});z14=await f.insert(raw,'PRODAT','Z14',`PRODAT:Z14:${f.mode}:26.A:r3`);const decision=await resolveCanonicalRuntimeDecisionWithRegistry(z14)
+ // Probe only this fresh first response, before encode/insert/record/capture/apply.
+ const segments=hook?hook.beforeEncode([...rendered.segments],permission.id):rendered.segments
+ const raw=EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,20),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:segments}]});z14=await f.insert(raw,'PRODAT','Z14',`PRODAT:Z14:${f.mode}:26.A:r3`);const decision=await resolveCanonicalRuntimeDecisionWithRegistry(z14)
+ if(hook?.onReceived){await hook.onReceived({permissionId:permission.id,z13,z14,decision});return} // No create_grant/publish_grant in a negative probe.
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  expect(await recordReceivedSourceValidation({original:z14,validated:z14,resolvedCompanyId:f.ids.company,decision})).toMatchObject({status:'recorded'})
  await captureFreshEdielSourceRulePackEvidence(f.ids.company,z14.id)
@@ -234,6 +244,76 @@
  }finally{sql(`DROP TRIGGER ${fn} ON gridex_service_permission.request_timing_receipts;DROP FUNCTION public.${fn}()`)}
  expect(external.send).not.toHaveBeenCalled()
 })
+// P26.A r3 original pp121/122: 326 and 222 are white D except N.
+// Admission/audit records are allowed; these snapshots contain business effects only.
+it.each(['baseline','missing222','missing326'] as const)('native fresh Z14V first response %s uses actual admission and forbids malformed business effects',async variant=>{
+ const f=await seed('V')
+ const state=()=>sql<Record<string,Record<string,unknown>[]>>(`SELECT jsonb_build_object(
+  'permissions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.metering_permissions p WHERE p.company_id=${lit(f.ids.company)}),
+  'sites',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.metering_permission_sites s WHERE s.company_id=${lit(f.ids.company)}),
+  'permissionEffects',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM gridex_received_sources.permission_effect_receipts e WHERE e.company_id=${lit(f.ids.company)}),
+  'permissionTransitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id,t.permission_id),'[]') FROM gridex_received_sources.permission_effect_transitions_v1 t WHERE t.company_id=${lit(f.ids.company)}),
+  'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id),'[]') FROM public.ediel_data_access_grants g WHERE g.company_id=${lit(f.ids.company)}),
+  'supplyPeriods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.customer_supply_periods p WHERE p.company_id=${lit(f.ids.company)}),
+  'supplyTransitions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.source_message_id),'[]') FROM gridex_received_sources.supply_source_transitions t WHERE t.company_id=${lit(f.ids.company)}),
+  'supplyEffects',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM gridex_received_sources.supply_object_effect_receipts e WHERE e.company_id=${lit(f.ids.company)}),
+  'supplyActivations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.period_id),'[]') FROM gridex_received_sources.normal_supply_activations a WHERE a.company_id=${lit(f.ids.company)}),
+  'supplyContracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM public.customer_contracts c WHERE c.company_id=${lit(f.ids.company)}),
+  'switchRequests',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.supplier_switch_requests s WHERE s.company_id=${lit(f.ids.company)}))`)
+ let before:ReturnType<typeof state>|undefined
+ const beforeEncode=(segments:string[],permissionId:string)=>{
+  before=state()
+  expect(before.permissions).toHaveLength(1);expect(before.permissions[0].id).toBe(permissionId)
+  expect(['z13_sent','waiting_for_customer_approval','z13_ready']).toContain(before.permissions[0].status)
+  expect(before.permissions[0].source_z14_message_id).toBeNull();expect(before.permissions[0].inbound_z14_message_id).toBeNull()
+  for(const key of ['sites','permissionEffects','permissionTransitions','grants'])expect(before[key]).toEqual([])
+  const wire=tokenizeEdifact(segments.join("'")+"'"),frequency=wire.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z12'),timestamp=wire.segments.filter(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='693')
+  expect(wire.segments).toHaveLength(segments.length);expect(frequency).toHaveLength(1);expect(timestamp).toHaveLength(1)
+  const frequencyAt=wire.segments.indexOf(frequency[0]),timestampAt=wire.segments.indexOf(timestamp[0])
+  expect(wire.segments[frequencyAt+1].tag).toBe('CAV');expect(segmentComposite(wire.segments[frequencyAt+1],1,wire.una)[3]).toBe('D')
+  const remove=variant==='missing222'?[frequencyAt,frequencyAt+1]:variant==='missing326'?[timestampAt]:[]
+  const mutated=segments.filter((_,index)=>!remove.includes(index))
+  expect(mutated).toHaveLength(segments.length-remove.length)
+  // The unchanged encoder computes UNT from the resulting business segments.
+  return mutated
+ }
+ if(variant==='baseline'){
+  const authority=await qualify(f,undefined,undefined,{beforeEncode}),after=state()
+  expect(before).toBeDefined();expect(after.permissions[0]).toMatchObject({id:authority.permissionId,status:'active',market_state_version:Number(before!.permissions[0].market_state_version)+1})
+  expect(after.sites).toHaveLength(1);expect(after.permissionEffects).toHaveLength(1);expect(after.permissionTransitions).toHaveLength(1)
+  expect(after.grants).toHaveLength(1);expect(after.grants[0]).toMatchObject({id:authority.grantId,status:'active'})
+  for(const key of ['supplyPeriods','supplyTransitions','supplyEffects','supplyActivations','supplyContracts','switchRequests'])expect(after[key]).toEqual(before![key])
+  return
+ }
+ await qualify(f,undefined,undefined,{beforeEncode,onReceived:async({permissionId,z14,decision})=>{
+  const wire=tokenizeEdifact(z14.raw_payload!),unh=wire.segments.findIndex(s=>s.tag==='UNH'),unt=wire.segments.findIndex(s=>s.tag==='UNT')
+  expect(unh).toBeGreaterThanOrEqual(0);expect(unt).toBeGreaterThan(unh);expect(segmentComposite(wire.segments[unt],1,wire.una)[0]).toBe(String(unt-unh+1))
+  expect(decision.syntaxDecision).toBe('accepted')
+  expect(wire.segments.filter(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z12')).toHaveLength(variant==='missing222'?0:1)
+  expect(wire.segments.filter(s=>s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='693')).toHaveLength(variant==='missing326'?0:1)
+  const validation=await recordReceivedSourceValidation({original:z14,validated:z14,resolvedCompanyId:f.ids.company,decision})
+  expect(validation).toMatchObject({status:'recorded'}) // Unconfirmed is an infrastructure/evidence failure, never a passing field hold.
+  const capture=await captureFreshEdielSourceRulePackEvidence(f.ids.company,z14.id)
+  expect(capture.status).toBe('captured') // Current capture guards check identity/profile/witness, not missing 222/326.
+  // No exception is an allowed field refusal here: every P0001 and other throw fails.
+  const consumer=await applyPermissionMarketSource({actorUserId:f.ids.actor,message:z14,expectedPermissionId:permissionId}),after=state()
+  const observed={variant,sourceMessageId:z14.id,sourcePayloadSHA256:createHash('sha256').update(z14.raw_payload!,'utf8').digest('hex'),permissionId,decisions:[decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],issues:decision.issues,application:decision.prodatApplicationValidation,validation,capture,consumer}
+  console.info('native_z14_first_response_observation',JSON.stringify(observed))
+  expect(before).toBeDefined()
+  expect.soft(after,JSON.stringify(observed)).toEqual(before)
+  expect.soft(consumer.applied,JSON.stringify(observed)).toBe(false)
+  expect.soft(consumer.manifest?.some(entry=>entry.status==='applied')??false).toBe(false)
+  // The current executor's two structured application refusals are qualified by
+  // the actual recorded decision/facet; unrelated source/actor/business holds fail.
+  const application=decision.prodatApplicationValidation
+  const headerHeld=application!==undefined&&application.headerDecision!=='accepted'
+  const objectHeld=application?.objects.some(object=>object.applicationDecision!=='accepted')??false
+  const qualifiedRefusal=consumer.reason==='permission_own_application_and_global_function_required'&&(headerHeld||decision.functionalDecision!=='accepted')
+   ||consumer.reason==='expected_permission_source_scope_unavailable'&&(headerHeld||objectHeld)
+  expect.soft(qualifiedRefusal,JSON.stringify(observed)).toBe(true)
+ }})
+})
+
 it.each(['V','VH'] as const)('genuine archived/reviewed %s scope, sent Z13, native Z14, published grant, accepted storage and atomic ACK; missing approval has zero effects',async mode=>{
  const f=await seed(mode),unqualified=await f.utilts('accepted','NATIVE-ESCO-UNQUALIFIED-'+mode,'internal_review'),initial=f.effects()
  expect(unqualified.runtime.ackPlan).toMatchObject({shouldSendAperak:false,shouldSendUtiltsErr:false});expect(f.effects()).toEqual(initial)
```
