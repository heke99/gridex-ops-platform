# DB-02 / AT-DB-02 independent Ediel inventory

Status: PARTIAL; no implementation or approval. Source frozen at actual main
`56192d16d1eac7fb0e716a3e2770bac8e58be115`, 2026-10-04. Branch:
`codex/ediel-db02-tenant-parent-inventory-20261004`.

Root assigned a bounded whole-card review, not a general database audit. Scope
registration: [491/5985015284](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985015284).
Owner/file proposal: [491/5985115747](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985115747).
Only this independent checkpoint is committed. No product, migration, test,
tag, generated artifact, shared memory or coverage row changes.

## Exact frozen contract

DB-02 applies to **Tenantägda relationer**, trigger **Insert/update**, source
SYS, owner **DB constraints / RPC**.

- Condition: "Verifiera tenant+id-referenser, unika idempotensnycklar och
  tillämpliga datum-/aktörsrelationer."
- Pass: "Förhindra korskoppling och motstridiga aktiva perioder med
  constraints/RPC."
- Failure: "Frontendvalidering och ett UUID utan kontroll av parent räcker
  inte."
- Activation: implementation and behavioral tests are required; the document
  itself does not grant production approval.

AT-DB-02 requires insert/update with both fulfilled and relevant failing or
boundary conditions. Its expected and prohibited effects repeat the complete
condition/pass and failure above. Frozen cards remain unchanged.

## Effect inventory on actual source

| Literal effect | Actual database/caller owner | Existing asserting evidence and limits | Result |
| --- | --- | --- | --- |
| Tenant + actual parent reference, including writes | `gridex_guard_meter_reading_series_tenant` / `gridex_guard_meter_reading_value_tenant` in `20260813124500_ediel_utilts_transactional_persistence_v1.sql:128`; both BEFORE INSERT/UPDATE. `gridex_assert_tenant_reference` in `20260713100000_ediel_completion_and_platform_contract.sql:750` checks the actual relation, communication route and optional certificate parent. Composite customer/site/meter/contract references also exist in `20260801143000_canonical_multitenant_platform_hardening.sql`; service assignment/evidence links in `20260930143025_ediel_service_assignment_grants_v1.sql`. | Retained genuine original-source intake case rejects a current authenticated actor's foreign-company and claimed-actor writes with zero effects. Fresh finite service commands enforce actual command ownership, with upstream authority ports declared synthetic. The retained transport-query-plan native test uses correct-parent fixtures and verifies query/catalogue isolation; it does **not** attempt an invalid-parent INSERT, so it is not that negative proof. | Real scoped enforcement exists; FK counts alone do not refute it. No exhaustive all-table or every-edge claim. |
| Unique idempotency keys and replay binding | Actual service administration command key/scope/version handling; original-source archive RPC uses its immutable retained artifact and exact submission. | Existing service administration script: 48 checks PASS, including replay and changed-input conflict. Retained genuine intake case repeats the same authenticated submission, returns the same artifact and preserves effects. | Protected in the examined live owners; no new duplicate implementation. |
| Applicable dates and actor relations | Service assignment/grant checks and current owned actor/profile/source evaluation. Actual identity reader validates explicit/evidence per-row intervals, roles and delegation. | Fresh 45 unit behaviors include half-open microsecond validity, future/expired roles, hostile scope, ambiguous actor/delegation and send/readiness isolation. Retained genuine service-evidence tests exercise current actor/representation/issuer revocation and period denies. | Existing protection is real, but profile date ordering is missing at its database write boundary. |
| Prevent contradictory active periods | `ediel_reserve_production_contract_origin_v1` in `20260930221158_ediel_source_qualified_switch_correction_binding.sql:198` locks the owned point, verifies current source/intent/request scope and holds overlapping owned contract periods before inserting. Profile EDIEL-006 in `20260827134553_tenant_integrity_auditor_v1.sql:378` merely reports overlapping currently active rows after the write. | Exact installed profile DDL probe: overlap INSERT and overlap-producing UPDATE both succeed. Actual explicit and evidence identity readers also accept the resulting two active profiles. Adjacent half-open periods pass. Existing source-contract code refutes the global claim that no RPC period protection exists; its concurrency or every-period behavior is not newly qualified here. | Confirmed narrow profile gap; whole-card approval blocked. |
| Database/RPC prevention, not frontend or UUID-only assurance | Actual profile FK checks a real company and same-start uniqueness is database enforced, but no profile interval-order or overlap trigger/constraint is installed. Auditor runs after writes. | Exact DDL foreign-company and duplicate-start writes reject (positive controls). Reversed interval write succeeds. Read-time evidence rejection is not a database write guard. | AT prohibited shortcut would remain if these reads/audits were substituted for the missing write invariant. |

## Confirmed profile write and reader graph

The actual table comes from
`20260713100000_ediel_completion_and_platform_contract.sql:351`, and current
`supabase/schema.sql:118113` agrees. It has NOT NULL start, nullable end,
company FK, environment/market checks, unique
`(company_id,environment,market,valid_from)`, and tenant-qualified candidate
key `(company_id,id)`. There is no table write trigger or interval constraint.

Source-owned writers found: identity setup/backfill INSERT in
`20260827193000_canonical_ediel_tenant_identity_and_legacy_route_cleanup.sql:31`,
the two subsequent validity-correction UPDATE migrations, and native fixture
INSERTs in `scripts/helpers/ediel-normal-switch-native-fixture.ts:83` and
`scripts/fixtures/ediel-service-evidence-native.ts:54`. No ordinary application
profile administration writer was found in the bounded trace. No hosted write,
production exploit or cross-tenant leak was exercised.

`activeTenantEdielProfile` in `lib/ediel/tenant/tenantEdielIdentity.ts:36`
queries the actual company/environment/electricity/enabled scope, then accepts
any active row. `resolveCanonicalTenantEdielIdentity` and its evidence variant
feed `core/actorRegistry`, `scopedCapabilityReadiness`, `aiListFlow`, received
source reviewers/session and `tenant/resolveInboundTenant`. The explicit and
evidence paths inspect every row but do not reject two distinct active profile
IDs. Other source-specific SQL owners can require exactly one captured profile;
their guards are not a profile INSERT/UPDATE constraint.

## Executed evidence and its authority

Outside-git scratch contrast used only the exact committed profile CREATE
TABLE, all profile ADD CONSTRAINT blocks and actual owner-key index from
`schema.sql`, a synthetic companies parent and synthetic identity query ports.
The unmodified actual TypeScript resolver read rows created by that PGlite
database. **5 RED / 2 PASS**, final seven-case run: overlap INSERT, overlap
UPDATE, reversed interval INSERT and both resolver variants fail the intended
denial assertions; actual company FK/same-start uniqueness and adjacency pass.
This is finite PostgreSQL behavior, not Supabase/RLS/session/native evidence.

Fresh unchanged production-caller suites: **45/45 PASS** in
`tenant-ediel-identity-evidence`, `ediel-tenant-send-authority`,
`ediel-match-tenant-fail-closed`, and `ediel-scoped-capability-readiness`.
Existing `ediel-service-administration-sql-regression.mjs`: **48 PASS**, using
actual command functions/DDL and explicitly synthetic upstream authority ports.
These results establish existing behavior, not whole-card approval or profile
write prevention. Source-string-only integrity scripts are not counted.

Retained genuine #511 artifact `11315805392`, run `37231850192`, job
`111523098655`, ZIP SHA256
`f4c6de14b2ea27e730becd249e03df66daa13341f5d14c9fd438bcf3f1646744`
was independently inspected. Tested source was
`db5d4d7069727c7247fb4c5ecf819c338afc6515`; the cited three native test files,
normal-switch helper and all migration blobs match this main561 inventory.
Original-source intake has 3 PASS/0 SKIP, service evidence 29 PASS/0 SKIP and
transport query-plan 1 PASS/0 SKIP. Only the actual effects above are reused;
legal/network fixture ports remain synthetic. This is not a fresh full-main
native run, authentic issuer evidence, production send or universal FK proof.

## Refutation of the existing findings source

[#520](https://github.com/heke99/gridex-ops-platform/pull/520) is documentation,
not a competing implementation. Its audit-only profile overlap observation is
confirmed, and date-order write failure is additionally reproduced. Its global
composite-FK ratio and absence-of-EXCLUDE observations cannot establish absent
tenant/parent or period enforcement: actual tenant triggers, composite keys
and source-owned RPC guards above provide counterexamples. UUID FK is not by
itself sufficient, but a UUID FK plus an actual parent-company trigger can be.
This review does not weaken DB-01 #523 or claim that every UUID relation is safe.

## Smallest next package, held for root/owner clearance

Only `tenant_ediel_profiles` write validity, plus durable actual-source SQL
behavior evidence and this checkpoint. Use a CLI-created forward timestamp
later than GOV-08 `20261004221605` and reserved #503 `20261004214144`; coordinate
newer queued files first. Do not edit historical migrations, the identity
reader, TEN-09 permission resolver, P-08, grants or unrelated schema owners.

- `valid_from` remains NOT NULL; NULL `valid_to` is an unbounded end.
- Enforce `valid_to IS NULL OR valid_to >= valid_from` for enabled and disabled
  rows. Equal endpoints are empty intervals, consistent with current explicit
  identity evidence; do not invent a strictly-positive-duration rule.
- Enabled intervals use `[from,to)`; adjacent endpoints may coexist, disabled
  rows may overlap, and enabled rows may not overlap another enabled interval
  in the same company/environment/market. Future overlap matters as well.
- Re-enable and INSERT/UPDATE of enabled state, bounds or scope must recheck;
  exclude the same physical row itself and do not borrow another tenant or
  environment. Market is currently constrained to electricity.
- Concurrency must use a genuine serialized write invariant. A bare advisory
  or company-row lock followed by SELECT has READ COMMITTED snapshot limits;
  do not call it universal protection under repeatable-read. Exact-profile
  exclusion could enforce competing writes directly but adds a `btree_gist`
  dependency and cannot silently fix existing overlaps. No extension or
  isolation-policy choice is approved by this inventory.
- Do not rewrite or close historical/current rows automatically. Existing
  contradictory intervals need an explicit source-owner migration policy.

Next action: root reviews literal effects, ownership and serialized guard
design before authorizing a repair. Persist RED behavior first; source/native
qualification and independent complete-card approval precede only the two own
coverage rows. DB-02 and AT-DB-02 remain unapproved.

Skill routing: Supabase boundary guidance, spec-to-code compliance, source
review, fp-check and verification-before-completion apply to this bounded
inventory. Postgres best practices/testing activate for an authorized repair.
UI/performance, supply-chain scanners, general audit/bootstrap and independent
owner implementations have no trigger in the explicitly delegated scope.
