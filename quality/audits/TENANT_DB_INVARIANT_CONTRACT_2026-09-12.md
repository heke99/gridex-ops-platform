# Point83: tenantDb ownership and conflict contract

2026-09-12, bounded follow-up to PERM04. **Two wrapper invariant defects are confirmed; no currently reachable user exploit through either defect was established.** There are three runtime importer files, eleven scoped query call sites (three inserts, three selects, five updates), two explicitly unscoped query call sites, and **zero wrapper upsert/delete callers**. No existing scoped update supplies `company_id`.

The full wrapper and all three runtime importer files were reviewed. Repository-wide TypeScript/JavaScript import/type/use searches also found the prior audit proof and ratchet documentation, which are not application callers. No source, SQL, memory, workflow, or production change was made. Concurrent billing work was preserved. Parent audit skill routing applies: code review, tenant integrity, variant analysis, false-positive checking and evidence before completion. This report narrows the helper contract; it does not certify all transitive Ediel authorization or native point83 integrity.

## Actual wrapper contract

`lib/supabase/tenantDb.ts` imports the service client from `lib/supabase/service.ts`, which creates it with `serviceRoleKey`. The wrapper checks only that company is a nonempty trimmed string. It performs no authentication, membership, lifecycle, permission or table classification check. Its caller must resolve an authorized company before construction.

| Method | Actual behavior | Boundary |
|---|---|---|
| `select` | Adds `.eq('company_id', scopedCompanyId)` | Parent-row filtering; joined relationship ownership remains a schema/query concern |
| `insert` | Copies each row and overwrites its `company_id` with scope | Prevents choosing another inserted owner, but does not validate referenced customer/request IDs |
| `update` | Forwards patch unchanged, then filters existing rows by scoped company | **Permits a patch changing ownership after selecting the old owner** |
| `delete` | Filters existing rows by scoped company | No current runtime caller |
| `upsert` | Stamps company on proposed rows, forwards options unchanged, no tenant filter/conflict validation | **Does not ensure the conflicting existing row belongs to scope** |
| `unscoped` | Returns original service client | Explicit escape hatch, not authorization; two current callers manually filter company |

Type signatures return `unknown` builders; current callers either await inserts or cast a small query interface. This typing friction explains why the render gateway uses the escape hatch, but does not grant it independent authority.

## Complete current caller inventory

All line numbers refer to inspected source and may shift with later edits. No caller passes custom select options, upsert options, or `company_id` in a scoped update.

| File/function | Table and operations | Scope and caller-controlled data |
|---|---|---|
| `lib/onboarding/inboundEdielLinking.ts::applyInboundProdatZ02ToCustomerInfoRequest` at353 | `customer_info_request_events.insert` for missing customer/site linkage | Company comes from inbound message; candidate request lookup already filters this company. No supplied event id/company; request/customer IDs come from selected request; event fields are explicit |
| Same at435 | Same insert for canonical verification blocked/needs review | Same scope/source; explicit payload from canonical response job; no insert options |
| Same at454 | Same insert for verified atomic apply | Same scope; canonical correlation/payload/freshness/atomic-apply gates precede success event |
| `lib/ediel/outbox/projectSentSources.ts::projectSentMessageDeadlines` at67 | `ediel_messages.update` | Company from canonical sent message; adds message id. Explicit deadline/timestamp/actor fields, no ownership patch |
| `projectOutboundRequest` at93/114 | `outbound_requests.select`, `.update` | Company plus linked request id; missing/cross-tenant read rejects; terminal/unexpected state guards; update includes only status/time/failure/actor fields |
| `projectGridOwnerDataRequest` at137/158 | `grid_owner_data_requests.select`, `.update` | Company plus linked request id; same missing/state guards; explicit status/time/failure/actor fields |
| `projectCustomerInfoRequest` at184/208/229 | `customer_info_requests.select`, two conditional `.update` sites | Company plus message id for lookup, limit2 to reject ambiguity; update by selected id. Explicit status/time/blocker/action/actor fields only |
| `lib/ediel/intent/renderGateway.ts::ensureProdatZ01FacilityIdentifier` at132 | `unscoped().from('customer_sites').select` | Explicit `.eq('company_id', db.companyId).eq('id', siteId)`; missing/exception yields non-renderable facility guard |
| `renderAndQueueCustomerMasterdataZ01` at332 | `unscoped().from('ediel_messages').update` | Explicit company+message-id filter; patch constructed from intent id, route-profile id and optional operation id; no ownership patch |

Exported function entry points are used by `ediel/flows/inboundProcessing.ts`, `ediel/outbox/sendOutboxItem.ts`, `customer-operations/facilityLookupEdifactDispatch.ts` and `ediel/flows/prodatCustomerMasterdata.ts`. Those upstream call references establish actual runtime use; this bounded report does not claim a new full authorization review of those large flows. Importer bodies fully determine that no current wrapper call uses the defective upsert/update-owner constructions.

The three event inserts have tenant attribution derived from a company-filtered request. Stamping alone does not enforce relationship consistency, but this source path is not evidence of a cross-company event insert. Their single-column relationship FKs are a separate database defense-in-depth concern, not a reproduced application exploit.

## Table identity and relationship evidence

The following is migration-source evidence, not a fresh native catalog receipt. Historical foundation alternatives and selective replay mean source presence cannot be substituted for deployment verification. No primary-key rewrite to a company composite key was found for these caller tables in the reviewed migration sources.

| Table | Primary/conflict identity source | Relevant composite relationship controls and limits |
|---|---|---|
| `customer_info_request_events` | `20260520_batch_3_4_onboarding_pricing_billing_engine.sql`: global UUID `id` PK, company not null, single-column request/customer FKs | Named table appearances in later migrations concern RLS, auditing and watchdog event writes. No company-qualified request/customer FK found for this table. Existing event inserts omit id, so this is not a reachable upsert collision |
| `customer_info_requests` | Same migration: global UUID id PK. `20260801143000_canonical_multitenant_platform_hardening.sql` additionally creates `(company_id,id)` candidate uniqueness | That migration adds conditional `(company_id, parent_id)` FKs for customer/site/metering relationships. `20260821133000_site_scoped_customer_process_p0.sql` adds and validates `(company_id,customer_id,site_id)`→customer_sites. These can reject a company-only move retaining an old-tenant customer/site; they do not change the default conflict identity |
| `grid_owner_data_requests` | `02_db1_operations_ediel_billing_dedupe_and_storage.sql`: global UUID id PK, nullable company and relationship columns in foundation | `20260821133000...` adds/validates company/customer/site composite FK. A nullable relationship can make that particular composite check inapplicable; actual later constraints/catalog must be exercised before declaring a row movable |
| `outbound_requests` | Same foundation: global UUID id PK; active-source unique expression index includes company and a status predicate | `20260821133000...` adds/validates both site/customer-site company/customer composite FKs. The partial/expression business index is not an arbitrary simple-column `onConflict` contract. It does not replace the id PK |
| `ediel_messages` | Same foundation: global UUID id PK; dedup unique indexes include company and predicates/expressions. `20260615_multitenant_integrity_and_claim_locks.sql` and `20260802013000_ediel_test_evidence_v2.sql` add `(company_id,id)` unique indexes | Test-run message/step/artifact composite FKs reference company+message id; existing child rows may reject parent ownership changes. That is conditional on actual references; adding composite uniqueness alone does not make ownership immutable |
| `customer_sites` (read-only caller here) | `01_db1_schema_repair_core_helpers_and_canonical_tables.sql`: global UUID id PK; company/customer FKs. Later company/id and company/customer/id uniqueness | `20260801143000...` adds company/customer FK. `20260905141608_canonical_tenant_relationship_guards.sql` restores a trigger checking NEW customer/company consistency. It does not compare OLD company to NEW company, and is not a general no-reparenting guard |

`20260801143000...` conditionally creates its composite FKs only if tables/columns/types match. Its `NOT VALID` FKs still concern new writes; whether every intended constraint is installed and validated is a native gate. `20260905141608...` was read completely: it restores specific parent-company triggers, not a global immutable-owner trigger. RLS declarations and audit triggers found for events must not be mistaken for service-role ownership enforcement. Service-role bypasses RLS but does not bypass ordinary FKs, unique constraints, check constraints or triggers.

## Confirmed helper findings and false-positive limits

### TDB-01 / Medium helper-contract defect: update allows reassignment

`tenantDb('A').from(table).update({company_id:'B'})` sends patch B and existing-row filter A. An actual-module probe confirms both. With a synthetic row A and no prohibiting constraints, applying those constructed arguments moves the row to B. This is a genuine violation of the tenant-bound update invariant.

No current scoped update uses that field. Some real table constraints can reject the mutation, especially when a company-qualified parent/child remains in A. Therefore neither “current users can transfer Ediel rows” nor “every service-role update succeeds” is established. The helper should reject or remove forbidden ownership changes before constructing the database request, independently of table-specific defenses.

### TDB-02 / Medium helper-contract defect: upsert does not bind existing-row identity

With default options, or explicit `{onConflict:'id'}`, the wrapper forwards an id-based upsert with the proposed owner stamped A. For a table whose id is globally unique, a conflict can select an existing B row; merging the proposed values then attempts to change that row to A. A custom global conflict key lacking company has the same structural problem. The wrapper supplies no check against it. The actual-module probe records the stamped payload and unchanged options, then demonstrates the outcome in an explicitly declared conflict model.

**No application code currently invokes wrapper upsert.** The synthetic model is not a PostgreSQL/Supabase integration test. A real database can reject the write due to other unique constraints, FKs, immutability triggers or required columns. A globally unique id plus an additional `(company_id,id)` unique index does not make default id-conflict merging tenant-safe: the selected conflict target matters.

False positives excluded:

- Plain `insert` with B's existing global id conflicts; it does not acquire upsert semantics or overwrite B.
- `{onConflict:'company_id,id'}` selects the company-qualified identity. If only B/id exists, an attempted A/id insert collides with the separate global id PK and errors, rather than updating B.
- A supported company-qualified natural-key conflict can safely distinguish equal tenant-local keys; whether a matching unique constraint exists must be checked per table. Blindly appending `company_id` may just produce an invalid conflict target.
- `{ignoreDuplicates:true}` can suppress a collision rather than update it. It does not by itself establish that a returned/no-op result belongs to A; the generic contract should still require a tenant-safe target.
- Composite FKs preserve relationships when the relevant columns participate, not an unconditional immutable company identity. Conversely, a reference-related failure cannot be assumed absent.
- No global custom natural-key upsert was found among current wrapper callers. The custom-key fixture below is intentionally synthetic, not an allegation about a real caller table.

## Minimal fail-closed interface compatible with current valid calls

1. For update patches, perform a runtime ownership check before calling `from/update`: permit absent `company_id`; if present, require exact bound company and omit it from the update. Reject foreign, null or undefined explicit ownership. All five existing scoped update sites already omit it. A type-level exclusion is helpful but does not replace the runtime check for spreads/untyped input.
2. For upsert, reject omitted/empty/default-id and unapproved conflict targets before calling the client. There are no current callers to migrate. The smallest safe change is to leave upsert unavailable until a table-specific company-qualified conflict definition is approved. If retaining capability now, require an explicit audited allowlist of table→conflict-column tuples, including company, and non-null supplied conflict values. Preserve the target, rather than silently appending company or guessing the table PK. Do not treat `ignoreDuplicates` as an authorization bypass.
3. Preserve insert stamping and current select/delete predicates. Optionally reject a supplied mismatching insert owner instead of silently correcting it; this is compatible with all three current inserts, but is not needed to fix the two demonstrated contracts. Validate every row before any batch operation to avoid partial client calls.
4. Preserve explicit `unscoped()` as a reviewed escape hatch for current callers; its removal would be a separate migration. Document that construction requires an already-authorized company and that neither scoped nor unscoped wrappers validate relationship IDs or perform membership checks.
5. Do not attempt a read-then-upsert ownership preflight as the core fix: a separate read is not an atomic guarantee. If business logic needs merging on global identity, use a dedicated transaction/RPC with explicit ownership and conflict semantics, or a reviewed role/RLS architecture. No new RPC/role migration is prescribed by this bounded contract alone.

## Actual-module reproduction, executed locally

The command below was extracted from this report and run on Node24. It loads the complete actual wrapper via `stripTypeScriptTypes`; only its service-client import is replaced. Assertions inspect actual builder arguments. The small apply functions explicitly model conflict behavior, without claiming SQL execution.

```sh
node --input-type=module <<'NODE'
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const calls=[];
const service={from(table){
  function operation(method,values,options){
    const call={table,method,values,options,filters:[]}; calls.push(call);
    const query={eq(k,v){call.filters.push([k,v]);return query;}};
    return query;
  }
  return {update:v=>operation('update',v), insert:v=>operation('insert',v),
    select:(v,o)=>operation('select',v,o), delete:()=>operation('delete'),
    upsert:(v,o)=>operation('upsert',v,o)};
}};
const source=stripTypeScriptTypes(readFileSync('lib/supabase/tenantDb.ts','utf8'))
  .replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const context=vm.createContext({supabaseService:service});
vm.runInContext(source+'\nglobalThis.actual=tenantDb;',context);
const db=context.actual(' A ');
assert.equal(db.companyId,'A');
assert.throws(()=>context.actual(' '));
const table=db.from('synthetic');
table.update({company_id:'B',value:'changed'});
const update=calls.at(-1);
assert.equal(update.values.company_id,'B');
assert.equal(update.filters[0][0],'company_id');
assert.equal(update.filters[0][1],'A');
const own={id:'a',company_id:'A'};
if(update.filters.every(([k,v])=>own[k]===v))Object.assign(own,update.values);
assert.equal(own.company_id,'B');
function mergeModel(rows,call){
  const proposed=call.values;
  const keys=(call.options?.onConflict??'id').split(',');
  const hit=rows.find(row=>keys.every(key=>row[key]===proposed[key]));
  if(hit){
    if(!call.options?.ignoreDuplicates)Object.assign(hit,proposed);
    return;
  }
  if(rows.some(row=>row.id===proposed.id))throw Error('23505 global id PK');
  rows.push({...proposed});
}
for(const options of [undefined,{onConflict:'id'}]){
  table.upsert({id:'foreign',company_id:'B',value:'changed'},options);
  const call=calls.at(-1); assert.equal(call.values.company_id,'A');
  assert.equal(call.options,options); assert.equal(call.filters.length,0);
  const rows=[{id:'foreign',company_id:'B',value:'original'}];
  mergeModel(rows,call); assert.equal(rows[0].company_id,'A');
}
table.upsert({id:'new',key:'shared',value:'changed'},{onConflict:'key'});
const globalRows=[{id:'foreign',company_id:'B',key:'shared'}];
mergeModel(globalRows,calls.at(-1)); assert.equal(globalRows[0].company_id,'A');
table.upsert({id:'foreign',value:'changed'},{onConflict:'company_id,id'});
const compositeRows=[{id:'foreign',company_id:'B',value:'original'}];
assert.throws(()=>mergeModel(compositeRows,calls.at(-1)),/23505/);
assert.equal(compositeRows[0].company_id,'B');
table.upsert({id:'new',key:'shared'},{onConflict:'company_id,key'});
const tenantRows=[{id:'foreign',company_id:'B',key:'shared'}];
mergeModel(tenantRows,calls.at(-1)); assert.equal(tenantRows.length,2);
assert.equal(tenantRows[0].company_id,'B'); assert.equal(tenantRows[1].company_id,'A');
table.upsert({id:'foreign'},{ignoreDuplicates:true});
const ignoreRows=[{id:'foreign',company_id:'B'}];
mergeModel(ignoreRows,calls.at(-1)); assert.equal(ignoreRows[0].company_id,'B');
const input=[{id:'one',company_id:'B'},{id:'two'}];
table.insert(input); const inserted=calls.at(-1).values;
assert(inserted.every(row=>row.company_id==='A'));
assert.equal(input[0].company_id,'B'); assert(!('company_id' in input[1]));
table.select('id'); assert.equal(calls.at(-1).filters[0][1],'A');
table.delete(); assert.equal(calls.at(-1).filters[0][1],'A');
assert.equal(db.unscoped(),service);
console.log('PASS actual wrapper arguments + explicit conflict-model cases; no database/provider calls.');
NODE
```

Regression acceptance after a fix: reject a foreign/null/undefined update owner before any client invocation; allow existing valid update payloads; keep select/delete filters and immutable input stamping; reject default/id/global/malformed/unapproved upsert targets before client invocation; test arrays atomically; preserve explicit approved composite conflict options. Run `__tests__/ediel-post-send-source-projection.test.ts` and the relevant render-gateway/inbound regressions in the dependency-equipped hosted quality lane. No Vitest execution is claimed locally.

Native prerequisites: schema/catalog assertions for global id PKs, company-qualified candidate keys, composite FK presence/validation and relevant triggers; synthetic A/B fixtures; update owner reassignment with/without children; default/id and supported company-qualified upsert under the actual PostgREST/service-role interface; unique-conflict rollback; relationship-negative inserts; concurrent upsert race. A SQL transaction test and a client/PostgREST test answer different questions. These should use isolated fixtures and zero production/customer operations. Point83 remains open until its wider integrity gates are actually executed.

Verification receipt: embedded actual-module harness extracted and executed successfully, exit0. `git diff --check` passed; no native database or Vitest execution. This SDD file is ignored by Git and requires explicit inclusion for publication.
