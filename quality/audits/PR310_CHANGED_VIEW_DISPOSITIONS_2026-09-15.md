# PR310 changed-view dispositions — 2026-09-15

The source-intent review covers **all five changed relation rows**, with a concrete PRESERVE decision for each selected source definition. Acceptance still requires an exact source-derived native definition witness. The five rows are not covered by the existing 31-added-view witness or by the three unchanged control views.

The companion JSON retains both artifact pins, every exact reference/replay relation hash, the five complete source queries, the five reference dump queries, 26 source/caller file pins, and the nine added plus 71 ordinal-only changed output-column entries. Every record has `schemaAcceptance=false`; `sourceIntentReviewed=true` means the specified source behavior was reviewed, not that an arbitrary observed hash was approved. No database, migration, runtime, type, workflow, existing audit or shared-memory file was changed for this review.

## Exact artifact scope

The five changed rows are identical in these independent retained artifacts:

| Artifact | ZIP SHA256 | Member SHA256 |
|---|---|---|
| `pr310-schema-9f1ba7ae.zip` | `0ee862d06ee0e4f33208aa33ceefe8ce5afa8c5e8ca1c9cd186f006c7364f2af` | `aaee3685f99130f0d451ba6fe4829134873882ecf0053a38505a4b1005bf9772` |
| `pr310-schema-8d5b3e46.zip` | `ef32946e5e9e5afd67cc0ca5d4b750755ceeb858c05298c8ba5585494228dd1b` | `a6d2aca25f48ae9ce52a7af092d02ae7a5ddab71271d3d99a39170e965aa4fac` |

Both members are `full-schema-reference-diff.json`, with 144 foundation, 514 timestamp and four forward applications. Both explicitly report `schemaAccepted=false`. Their reference projection hash is `e404dd6b8493da3332e15fde7622ef22098157d7933d98c0bc0d3992e3818106`; replay projection hash is `8517999aa05f2403937d47f4ca171435488b73f53d651e5926d6c466096707e9`. These historical four-forward artifacts do not stand in for the later full promoted-forward gate.

The immutable source snapshot remains `supabase/schema.sql`, SHA256 `b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30`.

| Public view | Reference relation SHA256 | Replay relation SHA256 |
|---|---|---|
| `canonical_internal_contract_offers_v` | `aadde51bb9922e39da02a7e8ea38c2fc69654835c3d561fc576a4a4d33293c22` | `b9d34d5a7c4e39b8ec5185ed3af7e3b9b2ae5e73991e5bb36271597127376eb6` |
| `customer_contract_lifecycle_readiness_v` | `21e1f686f94f0fbb1ea1f438f2a2d349283ccafaa41ff8c8ecca1f0eaaaa5190` | `7007d704402744b49c4384e7746a69ce815094d90c88e88ed2fc2d2741aa7840` |
| `ediel_active_actor_settings_v` | `3af082a6fe9722b7465b1874544387959876e8943811be3e3b5fb4718431fdf4` | `2fa2efcf9a78065b47e662640eacb69fc48de021137b5adf011a6d82b3595aaf` |
| `ediel_unresolved_messages` | `5aa790541d805f3a84596b721cf1b8f3c625587ea456bb28bdf41ef12b98949f` | `854b17bd878c1e6a590f654ba8d0fad3826d4ef7b56903bd72382216372fc573` |
| `platform_go_live_readiness_v` | `4e8e80b86a9b99bb77762f2c488381142032d7481dc4afe4b6a7ad442d750ff5` | `949f5f409c90bb3c05257b4a71c33b047e5f5aad77f95277fa60f96bb56e5623` |

All five changed-field lists contain only `view_definition`. Their expected retained shape is an ordinary view, RLS/FORCE flags false, `reloptions=["security_invoker=true"]`, and no partition key. No relation-grant addition, removal or change exists for any of the five in either artifact. This establishes unchanged compared ACL rows, not a new proof of effective role access.

## Source decisions

### Canonical internal contract offers

**PRESERVE the final July28 channel read model.** The complete selected query is `20260728190000_contract_channel_permission_publication_completion.sql:914–1253`. It preserves separate internal, website and API permissions and channel states; tenant and assignment validity; approved, locked product versions; published versions; snapshot hashes; and the website graph-integrity/API-client conditions. The reference query at `schema.sql:50651–50902` carries those same source concepts. The precise deparsed equality must be checked by the witness, not inferred from matching predicate names.

The source intentionally uses `offer.*` in the CTE and `source.*` in the public projection. Replay therefore exposes three source-authored offer fields omitted from the reference view: `last_versioned_at` and `version_note`, added by `20260519_final_saas_hardening.sql:277–294`, and `metadata`, added by `20260521_batch3_pricing_billing_audit_roles_completion.sql:18`. The exact artifact has three added columns and 69 old columns whose only change is ordinal. It has no removed output column or changed output type/nullability/default.

Actual service-client consumers select by name: `lib/customer-contracts/db.ts:538–620` applies company/lifecycle filters and uses `currently_sellable`; `lib/billing/pricingEngine.ts:43–60` reads pricing-list fields by company; `app/admin/companies/[id]/TenantPlatformControls.tsx:491–506` queries the selected offer's ID and lifecycle status. These callers support preserving named fields and channel behavior. They do not prove every endpoint's authorization or a complete publication/business transaction.

### Customer contract lifecycle readiness

**PRESERVE the exact July18 readiness predicates and explicit public output.** `20260718160000_v5_signature_switch_readiness_hardening.sql:424–539` ties evidence to the exact company/customer/contract/site graph, including legal documents and acceptances, signed archived PDF hash, facility and metering data, power of attorney, start date, withdrawal and export state. There are no added, removed or changed public output columns for this view.

The query expands `c.*`, then `e.*`, then `s.*` internally while explicitly selecting its public output. Underlying historical column ordering and additional fields can therefore change the CTE's deparsed text without changing the output signature. That is a source-causal explanation requiring exact witness confirmation; this report does not claim to have recovered the observed full deparsed row from its hash.

Lines 541–542 explicitly revoke public/anon/authenticated and grant the service role; the asserting function immediately below is also service-only. `lib/customer-operations/customerSiteProcessContext.ts:255–279` and `switchReadiness.ts:247–280` query with the service client and constrain company, customer, site and contract. They fail readiness when the view is missing or the exact graph does not match. The disposition preserves those predicates and the service-only classification.

### Active actor settings

**PRESERVE the selected May21 tenant/role ranking transition. This is a semantic change.** `20260521_batch_1_2_live_readiness_and_automation_hardening.sql:63–113` explicitly requires one active actor per company, environment and actor role. It uses `row_number()` partitioned by those three fields, ordered by active state and descending update/create timestamps, and selects rank one.

The reference at `schema.sql:55713–55743` has the older unranked active/date-validity filter. The selected May21 source excludes `is_active IS NULL` and omits the old valid-from/valid-to predicate. Those differences are explicit historical source behavior and must not be described as equivalent filtering or merely the addition of `runtime_rank`. No new tie-break ordering is invented here.

The existing `canonical-residual-readiness-transitions.py:20–84` changes only the outer projection to preserve the old 28 named columns, including metadata, and append rank. It guards the old preimage and retains the view's OID, owner, ACL and options. The audit query is extracted from that exact reconstruction, not from a rewritten live view. `canonical-residual-readiness-native.py:82–124` already defines original-shape rejection, bad-preimage rollback, two-company/multi-role ranking and metadata-preservation controls. Their source can be reused; this review is not a fresh execution receipt.

`lib/ediel/config.ts:219–282` uses the service client. The tenant path queries the table directly with company scope and rejects ambiguity. Its global table-query error fallback uses this view with `company_id IS NULL`, environment and an ambiguity check. This limited fallback usage does not justify changing the explicit source ranking or adding cross-company fallback.

### Unresolved Ediel messages

**PRESERVE the guarded compatibility projection.** `20260605160000_ediel_backend_automation_foundation.sql:336–350` checks the relation kind and source-table existence, then creates/replaces the view with `SELECT * FROM public.ediel_unresolved_items`. It does not add a tenant join, mutation, filtering or automatic resolution.

The five added view columns are `raw_sender`, `raw_receiver`, `raw_interchange_reference`, `raw_message_type` and `suggested_company_id`. They were explicitly added before this view by `20260601070000_ediel_production_readiness_hardening.sql:148–156` and repeated in `20260601093000_ediel_actor_identity_source_of_truth.sql:190–198`. Only `created_by` and `updated_at` shift ordinal among existing view outputs. The June11 generic public-view hardening preserves invoker execution and removes public/anon grants.

An exact-name search of `app` and `lib` found no direct caller of this compatibility name. That does not establish that the view is unused outside those directories or authorize its removal. The source-authored compatibility projection remains the disposition; underlying table policy and effective-access acceptance remain separate.

### Platform go-live readiness

**PRESERVE the June15 explicit readiness output and July9 service-only invoker hardening.** `20260615203000_platform_go_live_route_resolver_message_center.sql:194–248` uses company-scoped production actor/BRP and route checks, shared production mailbox, published legal/pricing and verified sender checks, and the exact `gridex_resolve_ediel_route_for_process` call. Its lateral actor and BRP queries expand `SELECT *`, but its public output is explicit and has no observed column delta.

`20260709162000_advisor_security_invoker_views.sql:27–64` explicitly includes this view, sets invoker execution, revokes public/anon/authenticated, and grants service SELECT. This supersedes the earlier June15 authenticated grant. `lib/ediel/platformGoLive.ts:658–684` reads it using the service client, with an existing fallback if no view rows are available. The comparison contains no grant change; this disposition does not reopen client access or claim that view readiness authorizes production message delivery.

## Exact completion condition

The existing comparator, `scripts/sql/gridex-db-parity-introspect.sql:12–19`, captures **`pg_get_viewdef(c.oid, true)`** and sorted reloptions. The raw definitions in `schema.sql` are pg_dump source text; their whitespace, parentheses and schema qualification are not asserted to equal the pretty runtime deparser. The artifacts retain relation hashes rather than full relation rows. Accordingly the JSON marks both observed full rows as absent and does not claim offline full-row reconstruction.

For each of the five, an admitted complete owned native replay must compile the pinned source query into a fresh temporary invoker view, capture both the actual view and the witness using the actual comparator, normalize only the temporary namespace/name to the fixed public identity, and require complete row equality plus the exact replay hash above. Historical `SELECT *` expansion must be frozen where later additions would otherwise enlarge a witness; copying the live view definition into its own witness is not source verification. Unknown predicates, different source expansions, changed security options or an uncovered sixth changed view must fail closed.

The witness must roll back all temporary objects and preserve the full catalog, rows and actual ledger. The immutable reference must independently retain its exact source hash and comparator hashes. Underlying relations, helper functions, effective ACL/RLS, all promoted forwards and the final cleaned native schema report remain separate acceptance gates. The existing 31-added-view witness and three unchanged control views cannot satisfy this five-row condition.

Local validation checked both exact artifact sets, all source/query hashes, all nine additions and 71 ordinal-only output changes, and zero grant deltas. PostgreSQL/native source-witness execution was unavailable locally. No high-confidence new source-intent defect was identified in these five definitions; no complete native schema or generated-type acceptance is claimed.
