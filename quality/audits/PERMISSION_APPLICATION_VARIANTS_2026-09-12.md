# Remaining application permission variants — bounded source closure

Date: 2026-09-12. Source examined at recovery HEAD `02577f8c` (shared workspace; no application edits by this task). This follows the residuals in `task-5-report.md`. Fixed shared guards and the point-84 six API routes are excluded from this review. No production queries, SQL execution, migrations, application changes, memory updates, workflow changes, commits, or pushes were performed.

## Result

Four application paths remain reachable. Three admit an explicit/loaded B target after checking permissions for selected A; the fourth loses the canonical selected company and can resolve a different default when the cookie is absent. Ordinary active membership in B does not imply the action's named permission in B. Service-client writes make the application check material.

| Path | Established effect | Evidence level | Smallest fix interface |
| --- | --- | --- | --- |
| CIS `assertEntityCompanyAccess` | `updatePartnerExportStatusAction` updates a B `partner_exports` row using A's `partner_exports.write` | Actual action, helper, scope, guards, and DB function; fake DB mutation observed | Pass the original `GuardResult` into the loaded-entity helper and bind nonempty row company to `guard.companyId` for ordinary actors before domain calls |
| Ediel `createEdielPortalTestCustomerAction` | A's three permissions admit B and reach a service-client `grid_owners` insert for B | Actual action, parsers, graph, graph data builder, first graph helper, and `makeServerClient`; fake first-write boundary observed | Replace membership-only submitted company check with the corrected scoped action helper and the same `allOf` requirement |
| Customer profile loaded-company helpers | `saveCustomerProfileImpl` updates B customer and creates its primary contact using A's `masterdata.write` | Actual implementation, actor helper, scope and guards; both fake mutations observed | Return/retain the original guard, load the row, bind its nonempty company before writes; use that binding for all four public actions |
| `lib/tenant/entityGuards.ts` | With no cookie, canonical permission company A can differ from unsorted membership default B; actual internal-note action inserts a B note using A's permission | Actual scope, entity helper, action and guards; fake note mutation observed; email send boundary also reached | Add `companyId` to `TenantGuard`; compare ordinary row company directly with nonempty `guard.companyId`; preserve authoritative platform bypass |

`lib/contracts/permissions.ts::isContractSuperAdmin` ignores the authoritative platform boolean, but the historical company-scoped platform-role scenario is **not a confirmed reachable current exploit**. See its separate disposition below. Do not count a forged contradictory guard object as a production reproduction.

## CIS: full loaded-entity path

`app/admin/cis/actions.ts:513` checks `partner_exports.write` with `requireAdminActionAccess`, discards that guard, obtains the actor through the request auth client, and loads `partner_exports.company_id` in `assertEntityCompanyAccess`. That helper calls `assertUserCanOperateCompany(actor, B)`, which verifies membership and writable company lifecycle but does not compare the original permission company or evaluate the named key for B. `lib/cis/db-data.ts:658` then performs `supabaseService.from('partner_exports').update(...).eq('id', exportId)`. It accepts no authorized company input. An audit insert follows. Actual React consumers include `app/admin/partner-exports/page.tsx:166` and `app/admin/billing/_components.tsx:425`.

The complete four-consumer interface of this particular helper is:

| Action | Permission requirement | Entity used to load B | Downstream first write / additional check |
| --- | --- | --- | --- |
| `updateOutboundRequestStatusAction`, line 378 | Existing array of `switching.write`, `metering.write`, `billing_underlay.write` (retain its current requirement semantics) | `outbound_requests` | `lib/cis/db-outbound.ts:556`: service update by id; queued/prepared/sent repeat company lifecycle check |
| `updatePartnerExportStatusAction`, line 513 | `partner_exports.write` | `partner_exports` | `lib/cis/db-data.ts:658`: service update by id |
| `ingestMeteringValueAction`, line 575 | `metering.write` | `customers` | `lib/cis/db-data.ts:744`: service replace/insert `metering_values`; validates graph consistency and company operational state |
| `ingestBillingUnderlayAction`, line 644 | `billing_underlay.write` | `customers` | `lib/cis/db-data.ts:885`: service insert `billing_underlays`; validates graph consistency and company operational state |

`getCustomerExportContext` in `lib/cis/db-shared.ts:253` resolves customer/site/metering-point/contract tenant consistency. `requireContextCompanyId` rejects a missing/conflicting graph. Neither takes the original permission context; a fully B-owned graph passes these checks. All four are source-confirmed instances of the same gap; only the export action was dynamically exercised here. Outbound status synchronization can fail after its initial write; this does not retroactively authorize or roll back that write.

The helper currently returns null for a row whose company is null. Reject missing ownership in a fix. No separate null-company exploit is claimed here: the current schema, admissible target rows and every later branch were not dynamically tested for that variant.

Recommended bounded fix: retain each original guard and pass it into the private helper. Bind row ownership to that guard, preserve membership/lifecycle checks and the existing per-status additional lifecycle check, and where practical pass the resulting company to domain update filters. Do not merely call generic permission resolution again without an explicit target. Service-layer id-only updates are worth giving a company parameter, but that is secondary to the missing authorization binding.

## Ediel: the client alias is significant

`app/admin/ediel/actions.part-4.ts:608` is exported through the actions facade and is wired by `components/admin/ediel/EdielProductionProdatPanel.tsx:584`. It checks `allOf: masterdata.write, switching.write, communication.write` for A, calls membership/lifecycle-only `assertUserCanOperateCompany` for submitted B, then calls `createEdielPortalTestCustomerGraph`.

Despite its name, `lib/ediel/flows/shared.ts:312::makeServerClient` returns **`supabaseService`**, documented for scheduled/domain flows. `lib/supabase/service.ts` creates that client with the service-role key. This is not the request-cookie client. The graph (`lib/ediel/portalTestCustomer.ts:1237`) directly ensures grid owner, communication route/profile, customer, registered/billing addresses, billing contact, site, metering point, power of attorney and switch request. It does not call a named-permission RPC for the supplied actor. Existing graph rows and data-validation prerequisites still apply.

The actual-module probe provides valid manual test data, uses the actual manual data builder (external spreadsheet lookup returns null, its supported manual-input case), selects no existing grid owner, and observes the actual first `grid_owners.insert` payload with `company_id: B`. It deliberately throws at that fake write boundary; it does **not** claim the entire graph or any external Ediel transmission completed. The inspected first write has no actor permission check other than its caller. The authenticated platform-only grid-owner policy in `20260601184500_ediel_runtime_hardening_rls_route_history.sql:49` cannot refute this service-client path. Later graph foreign keys and relationship triggers constrain ownership, not the actor's A-versus-B named permission.

The corrected company-scoped action helper is already available. Use it with the submitted company and the original three-key requirement, then retain deliberate operational lifecycle restrictions. This must preserve legitimate platform authority and valid B-selected actors who hold the B keys.

## Customer profile: retain the guard across row loading

`getActorUserId` in `app/admin/customers/[id]/profile-actions.part-1.ts:147` calls the generic `masterdata.write` guard then returns only a separately loaded auth id. Four public action implementations use this helper and load an entity company through a service client before checking membership:

| Implementation | Loaded-company check | Resulting service mutation |
| --- | --- | --- |
| `saveCustomerProfileImpl`, part-1 line 198 | line 281 | Customer fields, primary contact update/insert |
| `closeCustomerLifecycleImpl`, part-1 line 416 | line 450 | Customer terminate/move-out state, sites/points, conditional contract events and switch/task effects |
| `markCustomerAsTestDataImpl`, part-2 line 198 | line 217 | Customer and related site/metering test-data flags |
| `archiveCustomerImpl`, part-2 line 342 | line 368 | Mandatory archive of customer, then best-effort related graph handling |

`components/admin/customers/CustomerProfileCard.tsx` wires save, close and the profile action facade; these are active server-action entry points. The observed save case uses a nonarchived private customer, valid first/last names, B membership and active B. It completes both B customer and contact fake writes; selecting B, where `masterdata.write` is absent, denies before a write. Paused B and absent B membership also deny. Thus this is cross-company permission reuse, not an assertion that every lifecycle/membership guard is absent.

A small local context helper should preserve `{ userId, companyId, isPlatformAdmin, ... }`, reject null row ownership, bind the loaded company to it, then apply existing lifecycle restrictions. Four callers need conversion; changing only save leaves close/archive/test-data paths. Keep archived-customer lock, confirmation strings, and best-effort archive behavior unchanged.

## Entity guard: separate default selection can disagree

`lib/tenant/entityGuards.ts:5` defines `TenantGuard` without `companyId`. `assertCompanyAccessForGuard` first honors the authoritative platform flag, then compares the row company with `requireOperationalCompanyId(guard.userId)`. It does not compare the canonical company returned with the permissions.

For ordinary users, the canonical SQL body in `20260810193450_canonical_access_provisioning_runtime_v1.sql:622–637` (renamed to the scoped implementation and used by the latest wrapper) selects active membership/assignment, owner first, then **membership.created_at**. In contrast, `lib/tenant/scope.ts:105–178` queries active-status memberships **without ORDER BY**, and selects owner or the first returned row. It also does not filter membership `is_active` or join active user-role assignments. Therefore an absent cookie does not guarantee these two computations agree. A valid two-member fixture has A created earlier, both nonowners and active, with the unordered operational query returning B first. No adversarial cookie needs to be honored: omit the cookie. The fixture's canonical response is mocked consistently with this SQL ordering; SQL itself was not executed.

Probed full actions:

- `createCustomerInternalNoteAction`, `app/admin/customers/[id]/actions.part-1.ts:944`, calls `requireCustomerMutationContext` in part-4, which calls the actual entity helper. With canonical A, no cookie and B-first membership results, the actual service insert into `customer_internal_notes` has B ownership despite B lacking `masterdata.write`.
- `resendCustomerEmailAction`, `app/admin/customers/[id]/email-actions.ts:14`, passes the same helper and reaches `sendCompanyEmail` for B despite B lacking both `customers.read` and `customers.write`. The email boundary is mocked. Source tracing continues through `lib/email/sendCompanyEmail.ts:100` to service-backed log handling and `enqueueTenantEmail` (`lib/email/emailOutbox.ts:152`), which inserts B outbox work after sender/template/content checks. No external send or provider acceptance is claimed. Worker lifecycle gating remains separate.

Controls show cookie A rejects B, cookie A permits A, cookie B rejects B's missing permission, and authoritative platform cross-company access is preserved. Thus the explicit-cookie same-target path is **not** a confirmed bypass. Fix by using `guard.companyId` directly for ordinary actors and rejecting null/missing binding. Do not simply sort the second query: it can still differ on role/membership activity filters and it needlessly re-resolves an authorization decision.

Exact direct consumer files (route dependencies listed for change-impact awareness; excluded point-84 routes were not re-audited): customer `actions.part-4.ts` through `requireCustomerMutationContext`; `switch-actions.ts` (retry/prepare/continue); `switch-create-actions.ts` (dynamic create); `email-actions.ts`; customer-contract `signature/actions.ts`; API `customer-contract-documents/[documentId]`, `customer-switch-form-options`, `customer-documents/[documentId]`, and `customer-documents/relations`. The mutation context is used by 17 actions across customer action parts 1–4 (site/metering/note/POA creation; upload/readiness/switch/onboarding/automation/task; grid-owner/authorization/customer-data/current-supplier requests; partner export/POA scope/lifecycle). Those other actions were inventoried for the common interface, not each dynamically proven through all downstream effects.

## Contract role shortcut: disposition and limits

`lib/contracts/permissions.ts:9` checks only `roles.some(isPlatformAdminRole)`. A synthetic `{roles:['platform_admin'], isPlatformAdmin:false}` returns true. Conversely `{roles:['contract_manager'], isPlatformAdmin:true}` returns false, so legitimate platform authority through `admin_users` alone can miss this role-name shortcut and fall through to delegated-role/key checks. This is an inconsistency, not by itself proof an ordinary user can obtain a contradictory context.

Actual callers are `app/admin/contracts/actions.ts`, `app/admin/companies/[id]/tenant-platform-actions.ts`, and `lib/contracts/adminActions.ts`. They use `requireContractPermissionAction`, which first invokes the real generic admin action guard; no direct UI invocation of `isContractSuperAdmin` accepting user-supplied roles was found. Current canonical context rejects disabled/unconfirmed/blocked identity before roles are returned. Latest `20260902091000_company_scoped_permission_engine.sql:242` scope trigger rejects company-bound platform roles and global nonplatform roles. Raw authenticated `user_roles` writes are revoked by `20260814162500_tenant_rls_lifecycle_hardening.sql:206`. Current canonical global writer in `20260802203000_canonical_runtime_consistency_hardening.sql:587/608` inserts global role_id assignments, leaving `role` null (schema has no nonnull role default), so joined key and authoritative platform predicate agree on normal writes. The earlier claimed tenant-scoped platform-name example should not be used as a reachable current regression fixture.

One structurally possible dirty-data case remains: nonnull `user_roles.role` can disagree with joined `roles.key`; the authoritative SQL platform predicate prefers `coalesce(ur.role,r.key,r.name)`, while canonical returned roles use `role.key`. The scope trigger checks the joined role. This review did not establish an ordinary reachable writer or existing row producing the disagreement. Do not manufacture such a row in a fake DB and label it exploited. A bounded hardening change could make `isContractSuperAdmin` consume the authoritative boolean/shared context helper, preserving delegated pricing/contract role requirements for ordinary actors; its tests should separate reachable platform authority from synthetic corruption defense.

Downstream SQL does not simply trust the TypeScript shortcut: e.g. publish channel (`lib/contracts/channelPublication.ts:183`) invokes service RPC `gridex_publish_contract_channel`, whose latest full body is `20260731152000_public_contract_publication_graph_repair.sql:1101` and calls `gridex_assert_contract_permission` for contracts/pricing publish. Delete preview (`lib/contracts/adminRepository.ts:85`) calls `gridex_preview_delete_unused_contract_v2` (`20260727143000_contract_delete_runtime_completion.sql:171`) with its own permission assertion. `gridex_assert_contract_permission` delegates to `gridex_contract_actor_has_permission`, latest body `20260727010000_contract_flow_integrity_completion.sql:53`; that checks actor/service identity, active platform roles/admin_users, or `gridex_has_permission`. These are not proof of company-specific permission denial: the assertion has no company argument and underlying global resolver semantics are documented separately in `rls77-permissions78-native-contract.md`. This bounded role-shortcut review does not declare the entire contract command authorization surface closed.

## Reproduction and acceptance boundary

The appended Node 24 probe runs actual TypeScript bodies with `stripTypeScriptTypes` and VM dependency injection; Node22 hosted acceptance should use equivalent Vitest fixtures. **29 cases passed**, comprising 18 profile/CIS/Ediel scenarios, five email scenarios, five internal-note scenarios, and one synthetic contract-helper characterization. Mocked boundaries are auth/RPC responses, service reads/writes, cache/cookies, revalidation, audit/operation side effects, external spreadsheet lookup and email. The Ediel case stops intentionally at its first observed fake DB write. No native RLS, database trigger, PostgREST, browser/Next transport, full Ediel graph, external email, or downstream command execution is represented as tested.

For a fix, invert the currently admitted ordinary A→B cases to denial before the first service mutation/send/RPC, retain same-company positives and authoritative platform controls, add reverse A/B roles, null guard/row ownership, and no-cookie canonical binding. Keep scope distinct from native resolver/CRUD/storage acceptance in the companion contract report.

Save the appendix as a temporary `.mjs` and run from repository root with Node >=24; its JSON output contains synthetic data only. The working copy used here was `/tmp/permission-application-variants-probe.mjs`, with output `/tmp/permission-application-variants-probe.json`. These temporary files are not application implementation.

## Reproducible probe appendix

```js
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
function mod(path, names, deps={}) {
 const source=stripTypeScriptTypes(readFileSync(path,'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm,'').replace(/^export /gm,'');
 const ctx=vm.createContext({console,Error,URL,FormData,...deps});
 vm.runInContext(`${source}\nglobalThis.result={${names.join(',')}}`,ctx,{filename:path}); return ctx.result;
}
const roles=mod('lib/rbac/roleKeys.ts',['normalizeRoleKey','resolveRoleKey','isPlatformAdminRole']);
const life=mod('lib/tenant/lifecycle.ts',['isCompanyWritableInTenantWorkspace','isCompanyVisibleInTenantWorkspace']);
const access=mod('lib/admin/accessModel.ts',['hasPermissionRequirement']);
const perms=['partner_exports.write','masterdata.write','customers.read','switching.write','communication.write'];
function fixture({selected='A',cookie=selected,target='B',status='active',member=true,platform=false}={}) {
 const writes=[],calls=[];
 const memberships=['B','A'].filter(x=>member||x!==target).map(company_id=>({company_id,membership_role:'admin',status:'active',companies:{id:company_id,name:company_id,status:company_id===target?status:'active'}}));
 const db={rpc:async()=>({data:platform?['platform_admin']:['custom_role']}),from:table=>{
  const q={table,filters:{},mode:'read'};
  const chain={select:()=>chain,eq:(k,v)=>{q.filters[k]=v;return chain},in:()=>chain,order:()=>chain,limit:()=>chain,
   update:v=>{q.mode='update';q.values=v;return chain},insert:v=>{q.mode='insert';q.values=v;return chain},
   single:()=>finish(true),maybeSingle:()=>finish(true),then:(a,b)=>finish(false).then(a,b)};
  async function finish(single){
   calls.push({...q}); if(q.mode!=='read')writes.push({...q});
   let data=single?{id:`row-${target}`,company_id:target,status:'draft',email:'synthetic@example.test',template_key:'test',recipient_email:'synthetic@example.test',...q.values}:[];
   if(table==='grid_owners') { if(q.mode==='read') data=null; else throw Error('synthetic-stop-after-first-grid-owner-write'); }
   if(table==='company_memberships')data=memberships;
   if(table==='companies')data={id:target,status};
   if(table==='customer_contacts'&&q.mode==='read')data=null;
   return {data,error:null};
  } return chain;
 }};
 const cookies=async()=>({get:()=>cookie?{value:cookie}:undefined});
 const scope=mod('lib/tenant/scope.ts',['listOperationalCompaniesForUser','requireOperationalCompanyId','assertUserCanOperateCompany'],{...roles,...life,cache:x=>x,cookies,ADMIN_SELECTED_COMPANY_COOKIE:'company',supabaseService:db});
 const auth=async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})},rpc:async()=>({data:{authorized:true,user_id:'actor',selected_company_id:selected,is_platform_admin:platform,roles:['custom_role'],permissions:selected==='A'?perms:['billing.read']}})});
 const guard=mod('lib/admin/guards.ts',['requireAdminActionAccess','isPlatformAdminContext'],{...roles,...life,...access,...scope,cache:x=>x,cookies,ADMIN_SELECTED_COMPANY_COOKIE:'company',createSupabaseServerClient:auth,redirect:p=>{throw Error('redirect:'+p)}});
 const common={...guard,...scope,supabaseService:db,createSupabaseServerClient:auth,revalidatePath:()=>{},logAdminActionAndUsage:async()=>{},logUsageEvent:async()=>{},MASTERDATA_PERMISSIONS:{WRITE:'masterdata.write'}};
 const profile=mod('app/admin/customers/[id]/profile-actions.part-1.ts',['saveCustomerProfileImpl'],common);
 const cisDb=mod('lib/cis/db-data.ts',['updatePartnerExportStatus'],{supabaseService:db});
 const cis=mod('app/admin/cis/actions.ts',['updatePartnerExportStatusAction'],{...common,...cisDb,syncCustomerOperationsForCustomer:async()=>{}});
 const entity=mod('lib/tenant/entityGuards.ts',['loadCustomerTenantContext'],common);
 const mutationContext=mod('app/admin/customers/[id]/actions.part-4.ts',['requireCustomerMutationContext'],{...common,...entity});
 const notes=mod('app/admin/customers/[id]/actions.part-1.ts',['createCustomerInternalNoteAction'],{...common,...mutationContext});
 const sends=[];
 const email=mod('app/admin/customers/[id]/email-actions.ts',['resendCustomerEmailAction'],{...common,...entity,sendCompanyEmail:async x=>sends.push(x),redirect:p=>{throw Error('redirect:'+p)}});
 const form=obj=>{const f=new FormData();for(const[k,v]of Object.entries(obj))f.set(k,v);return f};
 const parsers=mod('app/admin/ediel/actions.part-1.ts',['formString','parseEdielTestSuite','parseEdielTestRoleCode'],{EDIEL_TEST_SUITES:['PRODAT'],EDIEL_TEST_ROLE_CODES:['supplier']});
 const flow=mod('lib/ediel/flows/shared.ts',['makeServerClient'],{supabaseService:db});
 const graph=mod('lib/ediel/portalTestCustomer.ts',['createEdielPortalTestCustomerGraph'],{getEdielTgtTestDataForCase:()=>null,EDIEL_TGT_TESTSYSTEM_EDIEL_ID:'synthetic'});
 const ediel=mod('app/admin/ediel/actions.part-4.ts',['createEdielPortalTestCustomerAction'],{...common,...parsers,...flow,...graph});
 return {writes,calls,sends,scope,guard,note:()=>notes.createCustomerInternalNoteAction(form({customer_id:`row-${target}`,body:'Synthetic note'})),ediel:()=>ediel.createEdielPortalTestCustomerAction(form({companyId:target,testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'SYNTHETIC',agreementStartDateTime:'202609120000',powerOfAttorneyReference:'synthetic',customerName:'Test User',customerPersonalNumber:'200001010000',customerEmail:'synthetic@example.test',facilityId:'735000000000000001',gridAreaId:'AAA'})),profile:()=>profile.saveCustomerProfileImpl(form({customer_id:`row-${target}`,first_name:'Test',last_name:'User',customer_type:'private'})),cis:()=>cis.updatePartnerExportStatusAction(form({export_id:`row-${target}`,customer_id:`customer-${target}`,status:'acknowledged'})),email:()=>email.resendCustomerEmailAction(form({customer_id:`row-${target}`,log_id:'log'}))};
}
const results=[];
for(const path of ['profile','cis','ediel']) {
 for(const [label,settings,allowed] of [
  ['selected A, target A',{target:'A'},true],['selected A, target B',{},true],
  ['selected B, target B, missing key',{selected:'B'},false],['selected A, B paused',{status:'paused'},false],
  ['selected A, B absent membership',{member:false},false],['platform cross-company',{platform:true},true]]) {
   const f=fixture(settings);let error=null;try{await f[path]()}catch(e){error=e.message}
   assert.equal(f.writes.length>0,allowed,`${path} ${label}: ${error}`);
   results.push({path,label,writeCount:f.writes.length,firstWrite:f.writes[0]??null,error});
 }
}
for(const [label,settings,allowed]of [
 ['cookie A permits A',{target:'A'},true],['cookie A denies B',{},false],['no cookie: canonical A, unsorted operational B',{cookie:null},true],['cookie B denies B lacking key',{selected:'B'},false],['platform cross-company',{platform:true},true]]) {
 const f=fixture(settings);try{await f.email()}catch(e){assert.match(e.message,/redirect:/)}
 assert.equal(f.sends.length>0,allowed,label);results.push({path:'actual email action + actual entity/scope helpers',label,sendBoundaryCount:f.sends.length,target:f.sends[0]?.companyId});
 const n=fixture(settings);let error=null;try{await n.note()}catch(e){error=e.message}assert.equal(n.writes.some(x=>x.table==='customer_internal_notes'),allowed,label);results.push({path:'actual internal-note action + actual entity/scope helpers',label,writes:n.writes,error});
}
const contract=mod('lib/contracts/permissions.ts',['isContractSuperAdmin'],roles);
assert.equal(contract.isContractSuperAdmin({roles:['platform_admin'],isPlatformAdmin:false}),true);
assert.equal(contract.isContractSuperAdmin({roles:['contract_manager'],isPlatformAdmin:true}),false);
results.push({path:'contract helper',syntheticFlagContradiction:true,reachableWriterNotEstablished:true});
console.log(JSON.stringify({caseCount:results.length,results},null,2));
```
