# Task 1 implementer report

Status: **DONE_WITH_CONCERNS — source implemented, runtime NOT_RUN**.

Base: `fff486f822001d35970f163507b10e17c3692f58` in `/workspace/gridex-ediel-at-z01l-z01lk-supplier-20261005`, branch `codex/ediel-at-z01l-z01lk-supplier-20261005`, root claim #5305994688282. The actual current-base implementation is authoritative. Historical `87cb025d37cedd0361ef3581daac73fb8b326c28` blueprints and their hashes are retained under the root-owned `baseline.json`; they are not a runtime receipt at this base.

## Changed paths and ownership

- NEW `__tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts`.
- Assigned ignored `.superpowers/sdd/2026-10-05-z01l-z01lk-supplier/task-1-report.md` (this file).

No previous test, helper, product, native, schema, coverage, shared memory or dependency file was edited. No dependency installation, Git mutation/commit/publication, external message, delegated agent, database, transport, native stack or activation was invoked. Root owns metadata, checkpoints, scope/diff checks, independent review, publication and exact-head CI.

## Requirements retained verbatim

Expected L: "23-DDQ-PRODAT; BGM=Z01; fält223=Z22; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering."

Expected LK: "23-DDQ-PRODAT; BGM=Z01; fält223=Z23; CONTRL; Z02 eller negativ APERAK. AB kan begäras men positiv APERAK är ingen startspärr.; Skapa uppgiftsärende och bevakning; ingen leveransaktivering."

Shared prohibited: "Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas."

The header tags only AT-Z01L-SUPPLIER / AT-Z01LK-SUPPLIER as unapproved component candidates and states finite boundaries and retained whole effects. Whole acceptance/rule approval remains unchanged; all cases below are authored assertions, **not executed findings**.

## Implemented cases: 9 (0 executed locally)

One parameterized fixture uses exactly:

```ts
const profiles = [
  { variant: 'L', reason: 'Z22', process: 'supplier_switch_existing_site', expected: 'L' },
  { variant: 'LK', reason: 'Z23', process: 'move_in', expected: 'LK' },
] as const
```

For each of L and LK:

1. Fresh ordinary success: actual preparation, prerequisite check, intent validation/upsert/load, customer export/source decode, actual site/process resolution/mapping, actual national rendering/envelope/tokenizer, same-draft WeakMap source binding, actual shared/kernel finalization, rulepack normalization/original witness consumption, real message/reference/event/link/status/outbox adapters. Captures the message insert's actual raw bytes and requires equality with the actual owner-witness input and persisted message; verifies the same actual message ID in result, intent, request, outbound response, events, references and queued outbox. No original replay assertion is duplicated.
2. Change only own selected point `ediel_reference` from `735123456789012345` to `73512345678901234`: source and resolver reads must precede the strict renderer facility refusal, outer `render_failed` and exact Swedish cause. Diagnostic intent remains validated/failed/not_queued; no finalized message/reference/event/outbox mutations.
3. Change only the scoped native customer response to `{status:'held',missing:['end_user_address']}`: actual decoder cause `customer_masterdata_source_held:end_user_address`, outer `render_failed`; no process-switch read, no physical effects, permitted failed-intent/request/outbound diagnostics.
4. Change only own request payload actorRole to `energy_service_company`: actual pre-render intent `prodat_actor_role_not_allowed`; blocked/failed/failed intent diagnostics, customer source not reached, no physical effects.

Ninth case: own LK customer with the sibling L site. Current `z01Prerequisites` rejects this before rendering with `site_customer_matches:false` and nested `blocker_code:'request_site_customer_mismatch'`. Actual preparation exposes outer `facility_or_metering_point_missing` and retains that cause in `blockerDetails.prerequisite_evidence`. It must not create an intent, read customer source/process-switch rows, finalize or queue. This follows root's explicit actual-base amendment; no fake grant or bypass was added to reach the later pure-resolver gate.

## Discriminating data and physical oracle

L and LK have distinct UUID namespaces for company/customer/site/point/contract/switch/request/operation/intent/outbound/message/source/route/rulepack. Each fixture also retains a **newer same-company, other-customer L sibling**, with its own point, grid area, annual sentinels, document/LI/interchange/message references and stored original raw bytes. Selection applies every actual predicate, ordering and limit before projecting requested columns. Positive source mapping has coherent own switch metadata/request_type and signed-contract/readiness/POA/document/scoped authorization facts. LK has explicit own `move_in`, not merely a site date.

Own switch day is `2027-07-15`, contract day `2027-07-16`, site move-in day `2027-07-17`, request timestamp `2026-10-05T12:00:00Z`; stale caller day `2030-01-01` is deliberately different. The runtime source `asOf` is the same instant rendered by Date as `2026-10-05T12:00:00.000Z`.

The actual stored own LIN group must contain exactly one `DTM+92:202707150000:203`, its own object `735123456789012345`/agency9, exact LI, `RFF+Z05:OWN`, `RFF+ANJ` and own `CCI++Z13` immediately followed by `CAV+Z22` or `CAV+Z23`. Header must contain `DTM+ZZZ:1:805`; the actual rendered minute is inverted by the existing fixed-offset reader and compared with the independently pinned instant `2027-07-14T23:00:00.000Z`. No `QTY+31` may appear anywhere. Own/sibling site and meter annual values remain unchanged.

Transport UNB parties are `12345:ZZ` / `54321:ZZ`; qualified legal NAD FR/DO are separately `23456:160:SVK` / `67890:160:SVK` with SE. The real reference allocator stays intact: own fresh UNB is persisted then consumed from the validated intent; UNH message reference is the actual allocator's `1`, distinct from sibling `2` in its separate interchange. BGM is suffix-free `Z01` with own document and actual default `9+AB`. The actual canonical stored runtime version is `26A`, physical UNH is `E2SE6A`, even though declared route decision version is stale. Qualified UD identity/name/street/postcode/city differs from mutable fallback; complete selected IT fields are checked on the own line. Actual draft defaults are CONTRL pending, positive APERAK not_required, requiresAperak false, utilts_err not_required, 30-minute ACK deadline. These defaults are neither received ACK nor watch execution evidence.

Queued outbox payload must carry actual own `processVariant` / `expectedZ02Variant`, request/intent/operation/route profile and the same stored message ID. Stale caller L/Z22/document/LI/annual values and all sibling bytes must be absent from own produced wire.

## Declared IO and code paths

**Only module replacements:**

- `@/lib/supabase/service`: finite `from` and `rpc` ports.
- Partial `@/lib/routes/routeDecisionEngine`: only `resolveEdielRoute` replaced; real `routeDecisionPayload` retained.
- Partial `@/lib/ediel/core/kernel`: only current `resolveCanonicalOutboundContext` replaced; real canonical finalizer retained.

Routing responses are scoped synthetic current-context IO; they prove neither native current actor authorization nor an authentic registry grant. Assertions bind inputs to actual company/actor/environment/request/route; real decision-backed application/version consistency stays active. Tenant wrapper, authorization checks and typed errors stay actual.

**Declared table SELECT ports:** customers, customer_contacts, customer_sites, metering_points, customer_contracts, customer_contract_lifecycle_readiness_v, powers_of_attorney, customer_authorization_documents, authorization_scopes, supplier_switch_requests, customer_supply_periods, companies, company_memberships, user_profiles, grid_owners, grid_owner_contact_channels, platform_actor_routes, company_market_party_routes, grid_owner_data_requests, outbound_requests, ediel_message_intents, ediel_messages. `customer_supply_periods` is a retained snapshot sentinel, not an assertion of a reached read.

**Declared mutations:** outbound_requests UPDATE; grid_owner_data_requests UPDATE; ediel_message_intents UPSERT/UPDATE; ediel_messages INSERT/UPDATE; ediel_business_references UPSERT; ediel_message_events INSERT; outbound_dispatch_events INSERT; ediel_outbox UPSERT. Updates require one exact existing own ID/company and a per-table lifecycle/link/status field allowlist. Inserts require own message/customer/request/intent scope where applicable. Unexpected tables, RPCs, reads/writes/operators, foreign mutations and unlisted update fields throw and remain in `unexpectedPorts`, which every case asserts empty. No wildcard business write or activation/transport callback exists.

**Declared RPC ports:**

- `gridex_actor_has_company_permission` for the exact actor/company and communication.read/write, metering.read or ediel_testing.write.
- `ediel_customer_life_event_export_projection_v1`: exact own actor/company/customer, fixed not_applicable.
- `ediel_prepare_customer_masterdata_v1`: exact own actor/company/customer/asOf/test; independent fixed qualified UD fields, source kind/reference/digest/context or the single held negative.
- BOTH `ediel_registry_dispatch_source_v1` and `ediel_registry_route_source_v1`: fixed original EL legal/wire tuple, exact own IDs/family/environment/DDQ; actual nested DTO decoders retained.
- `resolve_canonical_ediel_rule_pack_with_witness_v1`: exact electricity/PRODAT/Z01/own L-or-LK/outbound/current business date, complete synthetic activation/original snapshot data; actual source comparison/normalization retained.
- `ediel_prepare_outbound_owner_witness_v1`: fixed independent synthetic witness ID/evidence/snapshot configured from the finite pack, exact actual input scope/evidence equality and physical own wire facts asserted. The response does not echo caller evidence. Actual consumer response checks remain active. No bilateral/native certification/positive-or-negative fixture witness workflow is declared.

Key real paths: flows/prodatCustomerMasterdata.ts; flows/routeDecisionContext.ts; flows/shared.ts; intent/intentEngine.ts; intent/renderGateway.ts; intent/renderers/customerMasterdataZ01.ts; customer-operations/z01Prerequisites.ts; customer-operations/customerSiteProcessContext.ts; cis/db-shared.ts and actual db-data/db-outbound adapters; production/customerMasterdataSource.ts/customerLifeEventExport.ts; actor-registry/registryMarketSource.ts; prodat/customerMasterdataDraft.ts/customerMasterdataAuthority.ts/z01LegalParties.ts/z01WireReferences.ts; prodat profile/date/field/envelope logic; rulebook canonical registry/validator; core/kernel.ts/kernelLegacy.ts/outboundOwnerWitness.ts; ediel/db.ts; outbox/createOutboxItem.ts.

Snapshots include both customers' activated_at, sites/current supplier/grid/annual facts, both point annual values, contracts/readiness, POA/document/scopes, switch draft/unconfirmed state, and supply-period draft/future start/actual_start_date null/market_start_at null/version0. Sibling source/lifecycle/original bytes must remain identical. Denied business-table mutations plus explicit absence of Z03/Z04 writes cover only observed finite application ports, not native triggers.

## Actual commands and results

All source discovery used bounded `rg`, source reads, `git status --short`/read-only diff inspection. No source or Git state was mutated by those commands. Node version command returned `v24.19.0`. Initial dependency presence check produced no DEPS_PRESENT marker.

Final targeted availability command (exit 0):

```sh
if test -d node_modules; then npm test -- --run __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts; else printf '%s\n' 'NOT_RUN: npm test -- --run __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts (node_modules absent; no executable tests)'; fi
```

Output: `NOT_RUN: npm test -- --run __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts (node_modules absent; no executable tests)`.

Syntax command (exit 0, rerun after final source edits):

```sh
node --experimental-vm-modules --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {SourceTextModule} from 'node:vm';
const file='__tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts';
new SourceTextModule(stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'}),{identifier:file});
console.log('SYNTAX_OK: '+file+' (imports not linked; no tests executed)');
JS
```

Output: `SYNTAX_OK: __tests__/ediel-at-z01l-z01lk-supplier-profile.test.ts (imports not linked; no tests executed)`. Node also emits expected ExperimentalWarning for TypeScript stripping and VM Modules. This proves parsing only; no imports linked, typecheck, Vitest test, consumer execution, build, native test or full-profile check ran locally. Root's exact-new-head CI is required.

## Self-review and remaining concerns

Skill routing: dispatched-subagent exemption in using-superpowers respected; executing-plans and verification-before-completion used within root-owned isolation/delivery. Test-driven-development reviewed: only a new test, no production fix and no claimed red/green cycle. Spec-to-code-compliance and quality-playbook inventories inspected, broad audit/delegation not activated for this single bounded author task. Supabase skill reviewed for port/authorization limits; no Supabase feature, schema or service integration was changed, no external documentation/network/database/CLI action needed within this task. UI/Next performance, schema/database tuning, scanners, branch finishing and shared metadata ownership remain outside this author scope.

Self-review followed current real source rather than historical defaults. Corrected authored expectations to actual BGM AB, ZZ transport qualifier, canonical stored26A/physicalE2SE6A, actual gateway failed render leaving outbox not_queued, actual 30-minute ACK deadline, and projection handling of space-separated SELECT columns. Read trace records projected columns/rows, predicates, null ordering, limits and all lifecycle writes. Fixed witness is independent and compared with exact input evidence. No opaque DTO/WeakMap binding/finalizer was replaced or JSON-cloned across its real boundary. Business and sibling snapshots discriminate observed changes; no blanket "zero writes" assertion hides permitted diagnostic writes.

**Source assumption correction:** historical LK note's claim that plain export reaches the resolver on wrong customer/site omitted the stronger earlier actual prerequisite check. Root confirmed and amended the task. The implemented coupled case therefore asserts the real prerequisite gate and nested cause, not an unreachable later exception. This is a consumer setup correction, not a production defect or source change. Positive LK still requires actual resolver/mapper/source reads and physical/queue LK agreement.

**Verification concern:** all nine new runtime assertions remain unexecuted locally. Syntax cannot establish source qualification, complete valid fixture shape, real coupled reach, type correctness or assertion green. No green result is invented; root must publish and obtain fresh exact-head CI, and resume this author for any authentic obstruction/failure.

**Whole-proof limits:** native source custody/sealing/issuer authorization, RLS/current actor grants, atomic database source snapshots, native insert/outbox guards and triggers, every wrong direction/role/binding case and every R/D/parent/register counterexample; durable post-send request/watch/timer behavior; actual CONTRL and positive/negative APERAK intake; actual own LI/parties/object/grid/customer/variant Z02 correlation and consumer nonmutation; later separate Z03/Z04 readiness/activation all remain unproved. operationId is not a resolver row selector; collected readiness blockers are not all renderer refusal gates; payload requested_start_date is not authoritative switch source. No whole AT/TEN/P/ENV approval or market/native/send readiness follows from this suite.
