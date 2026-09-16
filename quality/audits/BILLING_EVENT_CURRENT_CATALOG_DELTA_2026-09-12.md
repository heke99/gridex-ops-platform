# Task 12 — actual observed-catalog admission delta

2026-09-12. **BLOCKED for the unchanged full normal + Partner API + portfolio fixture profile.** The new receipt closes the original event/export/outbox/pricing metadata gaps and verifies all requested retained objects unchanged, but exposes concrete compatibility-validator, portfolio publication-revision and policy-helper dependencies. No reduced profile, omitted reached sink or source-only trigger installation is admitted.

This is local read-only assessment of the receipt **root actually executed**, not a new database action. Only this report and `task-12-observed-catalog-delta-pins.json` were written. All earlier report/pins/query/review files remain frozen. No SQL execution, fixture/application/permanent-test changes, root-memory/Git edits, installs, external tools or subagents were used. Existing bounded Supabase/source-ACL, Postgres prerequisite and verification-before-completion skill routing continues; no full baseline audit was restarted.

## Actual input and precise query delta

| Input | Bytes / SHA-256 |
|---|---|
| quality/audits/BILLING_EVENT_CURRENT_CATALOG_OBSERVATION_2026-09-12.json | 5,163,485 / `63a84e0aa7e98503cd95c58e0a36b963e54b77dc273a4f3863ba5dd52ca9aa2b` |
| Executed SQL embedded in that receipt | 22,780 / `77d7844dfee874d3e6fd5d87756362eb19974f64250001dd56bfd024ba3e1f76` |
| Final prepared query, **not** substituted for executed SQL | 22,980 / `88422a5b622a623e4b1aa3095d02e6b44612c145394c1dec452d89e13886c1bf` |
| New delta selectors/pins | `c3c09e2ea1bf5f0f4feea8ee3231ad26b3755cbf10f8697916749dc2ecb1b839` |

The final query adds exactly one 200-byte output line: `session_context`, containing `search_path`, `current_user`, `session_user` and `server_version_num`. Removing that line from final884 reproduces executed77d **byte for byte**. No table, column, trigger, function, dependency, ACL, FK, policy, type or sequence projection changed. The executed receipt lacks those four session diagnostics; it already includes server_version, database, roles, schemas and ledger identity. This is not a material missing fixture-input edge, particularly because all retained objects compare exactly. **No rerun solely to add session_context is required.** Do not claim the unobserved execution role/search_path values.

Receipt metadata: observed 13:54:42Z on the reported gridex-ops-dev project `piidsfebjqjmnepdpnas`, PostgreSQL17.6, ledger279/tail20260904222450. It contains 23 relations, 40 functions, 5,397 direct object dependencies, 29 direct parent-key projections, one textual sequence configuration and no named missing relations/functions. Governance classification rows and ledger count/tail were root-authorized metadata exceptions; no business rows or application RPCs were read. Runtime-to-project binding remains UNPROVED, and this receipt is not historical source-selection authority.

## Retained projections: exact equality, not inferred similarity

The companion records raw receipt SHA, exact JSON pointer and UTF-8 byte span/hash plus canonical parsed-object hash for each of 23 tables, 40 functions and one sequence. It records explicit current/prior selectors for all 30 required comparisons. Offsets are zero-based, start inclusive/end exclusive. Equality includes complete metadata objects, including definitions, registrations, ACL, constraints and array order.

| Required comparison | Result |
|---|---|
| 13 retained relations | **13/13 exact parsed-object equality** to corresponding wave1/wave2 objects |
| 17 named retained functions | **17/17 exact parsed-object equality** to corresponding wave1/wave2 objects |
| All overlapping functions, including extra previously captured trigger/internal functions | 25/25 exact equality; this is supplemental to the named17 |
| roles / memberships / default_acls / ledger | Each equals both prior waves exactly |

Retained relations are customer_invoices, billing_underlays, audit_logs, webhook_deliveries, domain_events, webhook_subscriptions, companies, customers, customer_contracts, customer_sites, metering_points, contract_price_snapshots and auth.users. Functions are the exact17 identified in the frozen query/review; the selectors avoid matching overloads by name alone. These results permit reusing those observed object projections in the declared current-state composition; they do not give native behavior or complete effect-closure acceptance.

## Original missing inputs now supplied

| Surface | Actual observed definitions and consequence |
|---|---|
| invoice_provider_events /58632 | 18 columns; company, matched item, GUID, idempotency hash and environment remain nullable. Environment has the nullable-compatible CHECK. Status includes processing, attempt_count is nonnegative. PK id, company/id unique and **nonpartial** company/provider/environment/hash unique are present and valid. Company/item composite FK exists. No custom triggers. No completion-receipt columns are present yet |
| Claim function /133799 | Actual full SETOF event body and ACL now observed; SECURITY DEFINER postgres, search_path public, service_role EXECUTE=true, anon/authenticated=false. Existing age/status/SKIP LOCKED and null-start-time semantics remain as designed |
| invoice_export_items /58593 | 57 columns, 3 actual custom triggers: sent guard132557, chain179613, locked-run guard346047. Actual canonical/company FKs and request/idempotency/provider-invoice unique indexes retained. GUID index remains nonunique. Status CHECK includes all original and retry/review states; no GUID uniqueness redesign |
| invoice_export_runs /58561 | 25 columns; billing_month checks, original state/environment/finance checks, idempotency/payload_hash and bookkeeping fields. No custom triggers |
| pricing_runs /58195 | 22 columns. Same-company underlay/customer graph, status and energy-flow checks, unique active success/locked run per underlay, company/id key. INSERT energy-flow inheritance137342 reads the exact same-company underlay; UPDATE/DELETE locked guard132513 remains. Portfolio FK parents now observed |
| event_outbox /47528 | 17 columns, company-required CHECK despite nullable column flag, company/event composite FK. **Both** expression destination uniqueness and non-null named destination uniqueness coexist and are valid. Default max_attempts is8; provider fanout must explicitly preserve required12. Actual only custom trigger is retirement suppressor345213, matching internal/customer-onboarding-orchestrator; webhook_fanout_v1 is not its suppressing branch |
| Partner emitter /344927 | Full body, signature, owner/config and ACL now observed. It reads tenant/customer references, writes domain_events and matching direct webhook_deliveries, with real digest and subscription filtering. Its direct service_role EXECUTE=false is real; do not add a grant to make fixture setup convenient. The registered invoice trigger344931 is SECURITY DEFINER owned by postgres and calls this helper in that owner context |
| Portal/public references | Required 5 portal trigger registrations and full shapes are unchanged. Partial company/item uniqueness and company/provider/public-reference uniqueness remain. All existing snapshot/chain/reference behavior is retained |
| Settlement audit sink /138323 | Full 15-column table and append-only trigger138349 now supplied; id is **GENERATED ALWAYS identity**, not a missing default. Its sequence138322 configuration max is exact text9223372036854775807, start/min/increment/cache1, cyclefalse. No current counter value was read or needed |

All new roots are postgres-owned, RLS enabled/FORCE disabled. invoice_provider_events and event_outbox have only postgres/service table ACL entries and service-all policies. invoice_export_items/runs, pricing_runs, partner_exports and price_plan_versions explicitly grant authenticated/service privileges; RLS remains distinct. portfolios, portfolio_monthly_settlements and portfolio_settlement_audit_log give authenticated SELECT only and service full table privileges. Preserve all object-specific ACLs and observed role attributes; never import a blanket grant or permission07 candidate. Private locked-run helper346047 is invoker with empty search_path and postgres-only explicit EXECUTE. Preserve that observation and verify the real trigger/RPC context natively; helper ACL alone is not permission to infer a failed apply path or broaden grants.

The current nullable event environment resolves the **observed-state** missing-identity fixture question. It does not explain how July12 historical NOT NULL ceased to apply, and does not resolve historical source admission. Likewise coexistence of both outbox indexes is now observed fact for this profile, not selected-history proof.

## Concrete newly reached gaps

### A. Required compatibility parent INSERT reaches an unobserved validator

Unchanged portal39121 still has both `customer_invoices_partner_export_id_fkey` → partner_exports(id) and `customer_invoices_company_export_item_fkey` → invoice_export_items(company_id,id). The full profile's three export aliases therefore require the compatible partner_exports row with the same UUID; this does not disappear because metadata collection now found the table.

New observed partner_exports33693 has five custom triggers, all enabled O. Operational41311, timestamp20523 and critical-audit42266 → audit_logs/normalizer192996 are already covered. `gridex_partner_exports_status_guard_2()`38727 is now fully observed. **`gridex_partner_exports_guard()`38705 unconditionally calls `public.gridex_validate_partner_export_payload(new.export_kind,coalesce(new.payload,'{}'::jsonb))` on INSERT/UPDATE.** Actual column types are text/jsonb. No full definition/ACL for `gridex_validate_partner_export_payload(text,jsonb)` exists in the retained six observations or new receipt. The caller is PL/pgSQL, so the omission from direct pg_depend function edges does not make this call absent.

This is required for a legal compatible parent seed, not an optional billing export service path. The real parent also requires customer_id, export_kind and nonblank target_system; default payload{} cannot be presumed valid. There is an open-per-underlay/export-kind partial unique index and same-company customer composite FK. Do not bypass the validator, invent a payload contract, set the alias NULL, drop the old FK, or seed an existing portal with a different graph to avoid this edge. The validator's current body/ACL is the next missing input.

### B. Portfolio/price-version seeds reach publication revisions and their sinks

Actual new registrations show `gridex_public_catalog_dependency_revision_trigger_v1()`345166 on:

- portfolios AFTER INSERT/DELETE/UPDATE;
- portfolio_monthly_settlements AFTER INSERT/DELETE/UPDATE;
- price_plan_versions AFTER INSERT/DELETE/UPDATE.

All are enabled O. Helper345166 is fully observed (and unchanged from older observations), SECURITY DEFINER postgres with public/pg_catalog/pg_temp search_path. For these table-name branches it obtains new/old company_id, then **calls `public.gridex_bump_contract_publication_revision(company,'website',reason,entity)` and again for 'api'**. The full profile needs real nonnull-company portfolio/version/settlement parents, so these setup INSERT calls cannot be avoided by taking a false branch or by suppressing registrations.

The called `gridex_bump_contract_publication_revision(uuid,text,text,text)` body/ACL is absent from all supplied observations. Complete historical July22 body was used only to identify the next catalog names: it declares/UPSERTs `public.contract_publication_revisions`, inserts `contracts.publication.changed` domain events and, for matching subscriptions, direct webhook_deliveries. Those current effects must be checked against the returned current helper body; source text is **not** installed or promoted to current metadata. The reached revision table has no full observation. Domain_events/subscriptions/deliveries already have observed complete metadata, but setup event/delivery baselines must include any real revision effects; deleting them to make expected counts simple would conceal a reached sink.

The full metadata for `public.price_plans` is also missing. It is a **required nonnull parent** of price_plan_versions.price_plan_id through both id and same-company composite FKs. Existing direct key projections prove the referenced keys, not a complete valid nonempty parent shape or seed trigger closure. Read its full current table/trigger metadata; do not construct a minimal fake price_plans table. This is the remaining portfolio parent edge, not a request to audit pricing calculations or add a monthly settlement workflow.

Settlement INSERT separately reaches the now-pinned audit helper138347 → audit_log138323 and identity sequence138322. Supply a valid nonnull synthetic created_by because the audit actor column is required. Preserve actual seed audit/revision effects; they become part of the pre-apply baseline. Native insertion and rollback behavior has not been run.

### C. Portfolio policies need their real function/SQL-body dependencies for assembly

Observed portfolios, portfolio_monthly_settlements and portfolio_settlement_audit_log retain delegated SELECT policies calling **`public.gridex_portfolio_actor_has_permission(uuid,text,uuid,uuid)`**, OID138335 in the unselected direct function reference list. Its full definition/ACL is absent from the observations. Service-role BYPASSRLS during apply does not authorize dropping the actual policy or inventing a stub to install it.

The complete historical helper body identifies two finite next inputs: `public.gridex_portfolio_actor_is_superadmin(uuid)` and `public.portfolio_settlement_permission_grants`. The SQL helper reads grants user/permission/company/portfolio/validity/revocation fields; the superadmin helper reads already observed admin_users/user_roles/roles and auth role/uid. Their **current** bodies/ACLs must confirm this closure. Permission-grants metadata is missing, and the SQL function's relation/column references matter even though this event profile does not grant/revoke portfolio permissions or accept an authenticated portfolio authorization result. Request metadata only, no permission-assignment rows.

Do not pull in portfolio role templates or management RPCs just because historical files define them. If the four next actual function definitions expose a different reached edge, return that exact edge for another bounded disposition.

## Material current/source registration difference: do not reinstall the absent trigger

Current price_plan_versions58040 has exactly two custom triggers: price_plan_versions_locked_immutable →137042 and trg_gridex_catalog_rev_price_plan_version →345166. **No price_plan_versions_sync_portfolio_monthly_prices trigger is registered.** The queried helper bodies137855/137856 still exist, but neither is a direct current seed/apply trigger through this relation.

The frozen source preparation identified the historical synchronizer registration and discussed a no-array branch. Current metadata supersedes that registration assumption only for this observed-state profile: do **not** install the source-only trigger or require a fabricated branch to turn it off. No monthly-price materialization call occurs from the observed version trigger graph. portfolio_monthly_prices is therefore not added to the next catalog allowlist on the basis of helper existence alone. This is preserving actual current topology, not reducing the profile or suppressing a trigger.

## Finite next required inputs

One new root-owned read-only catalog/governance metadata SELECT can be limited to the following **3 public relations and 4 exact signatures**, plus direct table-bound triggers/metadata dependencies. This report does not author or execute that query.

| Kind | Exact requested identity | Reached reason |
|---|---|---|
| Relation | public.contract_publication_revisions | Actual portfolio revision trigger calls missing bump helper; full source body identifies this UPSERT sink/rowtype |
| Relation | public.price_plans | Actual price_plan_versions required id/company parent; nonempty seed shape/effects not in key-only projection |
| Relation | public.portfolio_settlement_permission_grants | Real delegated-policy helper's source-identified SQL relation dependency; metadata only |
| Function | public.gridex_validate_partner_export_payload(text,jsonb) | Actual unconditional compatibility-parent trigger call; signature follows observed argument types |
| Function | public.gridex_bump_contract_publication_revision(uuid,text,text,text) | Actual revision-trigger website/api calls; current body/ACL and downstream effects missing |
| Function | public.gridex_portfolio_actor_has_permission(uuid,text,uuid,uuid) | Actual retained portfolio policy expression; identity/ACL/body missing |
| Function | public.gridex_portfolio_actor_is_superadmin(uuid) | Source-identified direct dependency of prior helper; confirm against actual body |

For each relation, request the same full table projection as executed77d (columns/types/defaults/identity/generated expressions, checks/FKs/indexes, triggers/enabled state/rules, policies, owner/RLS/FORCE, schema/table/column ACL/effective access). Return exact direct parent-key metadata, direct trigger-function definitions and direct pg_depend references, without recursive expansion. For each named function, return the same complete function projection and explicit missing-signature assertion. If the inferred validator exact signature is absent, report that absence and same schema/name overload identity metadata; do not call an overload or guess its body.

Retain role/schema/default-ACL metadata and authorized metadata-only classification/ledger count/tail context. Sequence **configuration only**, with bigint values as text, if directly owned/referenced by these roots; never read counters. No customer rows, portfolio permission assignments, custom function execution, business RPC, broad inbound expansion, DDL/DML or installs. Direct helper/body dependencies are re-assessed after collection; this three-table/four-function list is the next finite frontier, not an assertion of transitive closure before seeing the bodies. Root must continue to bind the resulting receipt to the exact actually executed SQL/hash.

## Admission decision and verification limits

The earlier missing core metadata and emitter are now resolved as current observations. Full author admission nevertheless remains **BLOCKED** on A–C: missing validator; revision helper/sink and actual price-plan parent; delegated-policy helper/assembly support. The unchanged full normal/Partner/portfolio requirements and real compatibility/portfolio/setup effects stay in scope. The source-history conflicts, actual forward migration identity20260912052509 and service-only new RPC requirements are unchanged. Source state/numeric/credit/cancellation semantics were not redesigned.

Preserve the contract addendum's event fence → discovery → shared underlay mutex/row → optional pricing run → item reload/revalidation → portal → real sinks order. Separate coordinated dispatch/native cases and all rollback/replay/tenant/ACL gates remain unexecuted. Successful metadata collection cannot close those implementation/native requirements.

Local verification for this delta: receipt byte/hash and embedded executed-query hash; exact200-byte query difference; 13 table/17 function full-object equality (25 total overlapping functions); context equality; 64 current raw object span/hash pins and30 paired comparison selectors; absence checks for the stated missing functions/tables across the retained observations; complete actual bodies for new reached trigger/helper paths and narrow full-source body reads used only for next-name discovery. No database/native behavior is asserted from these local checks.
