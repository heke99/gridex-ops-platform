### Spec Compliance

- ✅ **Static SPEC compliant for BASE a7cf4215 → HEAD aa8e05d6.** The forward restores the original event relation without rewriting legacy rows, enforces case/company/customer ownership, closes browser table/RPC access, and moves status/event/audit into one transaction (`supabase/migrations/20260923180557_restore_customer_case_events_atomic_status.sql:3–58,80–145`; `lib/customer-cases/db.ts:381–391`). No Critical or Important source defect identified in this scoped review.
- ⚠️ **Task acceptance remains pending native evidence.** The new SQL, Data API negatives, rollback injections, populated-schema replay and protected browser have not executed in the supplied receipt; genuine generated contracts and ordinary exact-head CI remain controller gates (`quality/audits/ediel-masterplan-v2/e035-source-ledger/ediel-case-schema-fix5-20260923.md:43–46`). Static approval does not establish replay/browser success or whole-E035 completion.
- ✅ The package changes one new forward/manifest entry, the existing helper, bounded tests and evidence documents; no historical migration, generated schema/types, PR310 implementation, retained native assertion, source ledger or retry evidence is altered (`scripts/migration-history-manifest.json:440`; review package file list and full diff).

### Strengths

- ✅ Ownership is enforced below the service-role boundary: required ownership columns, the composite customer FK and validated three-column case FK reject mismatched existing or future events (`supabase/migrations/20260923180557_restore_customer_case_events_atomic_status.sql:17–43`). The original event field/default/check contract matches `supabase/migrations/20260520_batch_5_cases_audit_email_ux.sql:100–115`.
- ✅ The locked case supplies company/customer attribution and previous status; the optional source restriction is inside the locking query. All three writes share the RPC transaction, with no exception swallowing or follow-on business dispatch (`supabase/migrations/20260923180557_restore_customer_case_events_atomic_status.sql:80–137`).
- ✅ Authorization checks actual active profile, selected-company membership and writable company, then company-scoped permission; canonical platform Support access retains the membership/company requirements, and actual Ediel-source rows reject platform mutation even when the optional source is omitted (`supabase/migrations/20260923180557_restore_customer_case_events_atomic_status.sql:88–109`).
- ✅ Native additions compare complete case/event/audit snapshots after rejected requests and both event/audit insertion failures; they exercise real anonymous/authenticated HTTP denial, service-role FK rejection, Support/platform behavior and populated migration preservation (`scripts/ediel-case-view-native.test.ts:159–261`). Existing post-browser source/ACK/supply/billing/outbound assertions remain intact (`scripts/ediel-case-view-native.test.ts:94–115`).
- ✅ HTTP-boundary unit coverage uses the installed client and real helper with fetch stubbed, asserting one correctly scoped RPC and no fallback mutation after rejection (`__tests__/customer-case-status-transaction.test.ts:3–34`). It does not claim to prove SQL atomicity.

### Issues

#### Critical (Must Fix)

- None identified in the reviewed scope.

#### Important (Should Fix)

- None identified statically. Unexecuted native/browser/generated-contract gates above remain acceptance blockers, not evidence of a proven source defect.

#### Minor (Nice to Have)

- `lib/customer-cases/db.ts:109`: the implementation receipt reports an existing unused `_customers` lint warning (`quality/audits/ediel-masterplan-v2/e035-source-ledger/ediel-case-schema-fix5-20260923.md:38`). Output is not pristine; this pre-existing warning is unrelated to the atomic repair and is not a round-5 blocker.

### Assessment

- **Task quality: Approved statically; native acceptance withheld.** The missing schema and partial-write boundary have a coherent minimal repair, and the new assertions target the named failure modes. Authentic execution must establish its operational correctness before task acceptance.
- **Named-risk check — service-role invoker ACL and auth helpers:** checked existing generated grants for every referenced public table and both helpers (`supabase/schema.sql:111190,111647–111648,111741,115776,116356,116546,119326`), current canonical platform identity/auth-user checks (`supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql:390–432`) and current company-scoped resolver (`supabase/migrations/20260902100000_rpc_surface_and_permission_scope_corrections.sql:108–155,198–199`). No new direct `auth.users` invoker read or privilege escalation is introduced. Runtime catalog confirmation remains part of native qualification.
- **Named-risk check — legacy populated schema/FKs:** checked the original event definition (`supabase/migrations/20260520_batch_5_cases_audit_email_ux.sql:100–115`) and established case/customer composite FK (`supabase/schema.sql:87077–87081`). The forward preserves legacy fields/data, supplies the omitted customer FK conditionally and validates case ownership. The reported hosted catalog preflight was not independently rerun.
- **Named-risk check — existing Support versus Ediel authority:** checked both actual callers (`app/admin/customer-cases/actions.ts:51–67`; `app/admin/ediel/operational-cases/actions.ts:14–39`), platform guard behavior (`lib/admin/guards.ts:248–272`) and membership-based selected-company scope (`lib/tenant/scope.ts:110–178`). All actual status callers supply an actor; Support still omits expectedSource, while Ediel supplies it and independently denies platform mutation.
- **Named-risk check — audit context and rollback assertions:** checked the installed canonical audit normalizer (`supabase/migrations/20260727040000_contract_security_energy_direction_api_completion.sql:657–730`). The inserted actor/entity/old/new fields yield the asserted audit context. The diff cuts off the enclosing native test and its SQL helper, so inspected only `scripts/ediel-case-view-native.test.ts:1–46,90–116` to verify isolated psql transactions, ON_ERROR_STOP, JSON parsing and retained post-browser invariants; failure exits close the connection and roll back the legacy-corruption transaction.
- **Review checks:** read supplied brief/report/template/full diff; performed focused read-only checks for the four named risks. No reported test rerun, source edit, git-state mutation, hosted operation or deployment; only this requested review report was written.
