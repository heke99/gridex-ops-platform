# DB-02 / AT-DB-02 independent Ediel inventory

Status: PARTIAL; bounded repair cleared by root; no implementation or approval.
Inventory source frozen at actual main
`56192d16d1eac7fb0e716a3e2770bac8e58be115`, 2026-10-04. Branch:
`codex/ediel-db02-tenant-parent-inventory-20261004`.

Root assigned a bounded whole-card review, not a general database audit. Scope
registration: [491/5985015284](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985015284).
Owner/file proposal: [491/5985115747](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985115747).
Initial inventory publication `31c600365ac8e27f173adc673179f40a81b101e8` contains
only this checkpoint. Tests-first freeze
`c8eaa153684b398f1aeeb104fe064fce56656aa9` adds own tests, one additive
native-config include and the empty CLI scaffold. The following source freeze
implements only that new forward and its own checksum entry. Generated
artifacts, shared memory and coverage rows remain unchanged.

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

## Bounded repair clearance and tests-first freeze

Root cleared only the exact-profile exclusion and date-order CHECK, including
the narrowly required `btree_gist` dependency. Public precise scope:
[491/5985180650](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985180650).
CLI 2.101.0 version/help/new created
`20261004223219_ediel_tenant_profile_interval_guard.sql`, later than GOV-08
221605 and latest queued #503 220429. It is empty at the tests-first freeze.

Own durable `__tests__/ediel-db02-profile-periods.test.ts` executes the actual
immutable production profile DDL and real PGlite `btree_gist`, then the forward.
The empty scaffold produces **16 RED / 9 PASS, 25 cases**. Positives retain real
parent FK, disabled same-start uniqueness, adjacency, empty/disabled intervals,
same-row update and tenant/environment separation. The intended write-denial
and legacy-preflight assertions fail because enforcement is absent.

The earlier outside-git proposed DDL passes **23 finite checks** on real
PostgreSQL 17.5/PGlite with the bundled extension, including legacy rollback.
Official [Supabase extension catalog](https://supabase.com/docs/guides/database/extensions)
lists `btree_gist`; [PG17 btree_gist](https://www.postgresql.org/docs/17/btree-gist.html)
supports UUID/text equality; [PG17 ranges](https://www.postgresql.org/docs/17/rangetypes.html)
documents `tstzrange` for these actual timestamptz columns and the exclusion
pattern. Current Supabase changelog was checked: the 17.11 btree_gist reindex
notice concerns float/NaN indexes, not these UUID/text/range keys; no extension
version pin is introduced.

`scripts/ediel-db02-profile-periods-native.test.ts` is added to the existing
mandatory native config. It asserts installed constraints, actual write and
rollback boundaries, two real repeatable-read sessions with an observed
transaction-ID lock (first commit denies the rival, first rollback permits it),
and legacy preflight against an isolated exact-source profile table. Synthetic
tenant/profile data is explicit. Genuine execution remains pending; local
psql/Supabase is unavailable, so no local native or concurrent PASS is claimed.

Source implementation: the transactional table lock and source-owner
preflight precede the extension install, ordered-date CHECK and partial GiST
exclusion. It contains no row mutation, new table/function, grant or reader
change. Source receipt:
[491/5985253813](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985253813).
Own 25 cases plus unchanged 45 cases: **70/70 PASS**. Tests/scripts TypeScript
and scoped ESLint PASS. Migration integrity: **1060 files / 963 groups PASS**;
spec integrity **33 originals / 121 rules / 231 contracts PASS**; diff PASS.
The registration helper computed the new checksum; old entries/order were
preserved so the manifest delta contains only that new entry. Genuine capture
and native behavior, followed by independent review, are still pending.

## Smallest authorized next package

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
- The exact-profile exclusion is the concurrency boundary, with `btree_gist`
  UUID/text equality and `tstzrange('[)')` overlap. An ordered-date CHECK and
  preflight run under a transactional profile-table lock. Genuine two-session
  proof is required; a bare lock/count is not substituted.
- Do not rewrite or close historical/current rows automatically. Existing
  contradictory intervals need an explicit source-owner migration policy.

Next action: publish the frozen source for root review, then genuine source
capture and mandatory native/concurrency/legacy proof. Independent complete-card
approval precedes only the two own coverage rows. No local full-suite retry
after the earlier auto-review rejection; actual-head required GitHub gates
provide that qualification. DB-02 and AT-DB-02 remain unapproved.

## Authentic capture import — 2026-10-04

Draft [#535](https://github.com/heke99/gridex-ops-platform/pull/535) froze at
`6bda67d7d3f7c1c38979f121f84450eda8063cfc`, tree
`f736f47c835f2b11c04fb4b9c5ebe54bdb5cb4aa`. Root directed exact reuse of the
primary owner's pure calendar fixture correction
`9433d04bfc037fae0f61710c73a5ac85eeef443d`; its 3 files are byte-identical to
that correction and its 9 unit cases PASS. The DB-02 production migration and
six native tests remain byte-identical to source freeze `c40cc2a2`.
Independent source/native-design review:
[491/5985330137](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985330137),
fresh 70/70 plus 48 finite commands PASS, no blocking source/design finding;
whole-card approval still awaits genuine native behavior. Tagged gate remains
74 existing approved / 82 green / 0 failing; own coverage is unchanged.

Capture-only run **37241338925**, job **111550506410**, artifact
**11317019099**, is SUCCESS on that exact 6bda source/tree. Downloaded ZIP
SHA256 and published artifact digest both equal
`30aab743fa6ccfcd9d4db71efc02de77d11cdf63732d3c2b47f51873d7bf5df0`.
All four members pass CRC; all eight captured input hashes match the frozen
Git blobs, all three output hashes match their bytes, and canonical fingerprint
recalculation matches the receipt. Producer used PostgreSQL **17.6**, CLI
**2.101.0**, with actual replay tail
`20261004223219_ediel_tenant_profile_interval_guard.sql`, SHA256
`8f40a4b9d4c36d4c1d5ec14a6af499d55e1c6510c5ba921873b714e94d702ed0`.

Captured bytes are imported unchanged into the three generated paths:

| Output | SHA256 |
| --- | --- |
| `supabase/database.types.ts` | `4f5713d630d848363dfa5d76c87adc9bb4c52a4dfb3fb3b4f53068f9606279c4` |
| `supabase/schema.sql` | `bbcdb02901e684b23f384fb96489413fa6d2b1c707b0c6ea5ce2a2a83b218d80` |
| `supabase/schema.fingerprint.json` | `3583cfcaf7caf0523cb4fbd324ffd452ef8e23e0a953fcc302a37b7eb345bd4b` |

Canonical fingerprint:
`8c8185324f6b11a1cb286a300b34c118291d87deb7db00c649cc4b3461f9ed87`.
Types remain byte-identical. Actual schema diff is only the profile CHECK and
EXCLUDE. Fingerprint sections add 2 constraints, 1 index and 1 extension;
application function/grant and other sections remain unchanged. No manual
schema, fingerprint, generated-type or migration-tail editing occurred.
Raw receipt is byte-identical at
`quality/audits/ediel-masterplan-v2/db02/capture-receipt-20261004.json`.
The current type manifest takes its tail/hashes/provenance from the genuine
receipt and preserves the complete original manifest under historical
provenance, including the original capture/package attribution.
Import checks PASS: full `db:migrations:check` (integrity, public-contract
legal migration, database contract hardening, generated types), specification
33/121/231, diff and explicit captured-output/product/test/config/coverage
byte equality. No generated-type declaration changed, so previous source type
checks retain their exact declaration scope; mandatory final-head CI remains.

The capture producer explicitly records native/browser/type-schema comparison
and upgrade parity **NOT_RUN**. It is a baseline receipt, not whole-card or
production approval. Separate old-head OPS quality/upgrade jobs are green,
while its clean/native job remains in progress; they do not qualify the new
import head. No DB-02 production/native test or coverage bytes change in this
import. Next: publish the checked import, independent provenance review and
mandatory actual-head gates; retain all six native expectations and wait for
their genuine results before approval. Cancel only superseded own queued runs
after replacement producers exist; do not cancel active native evidence or
other owners' runs. #491 merge pause remains in force.

Skill routing: Supabase boundary guidance, spec-to-code compliance, source
review, fp-check and verification-before-completion apply to this bounded
inventory. Postgres best practices/testing activate for an authorized repair.
UI/performance, supply-chain scanners, general audit/bootstrap and independent
owner implementations have no trigger in the explicitly delegated scope.
