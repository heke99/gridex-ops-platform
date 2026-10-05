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

## Native collection repair — 2026-10-05

Independent authentic import review PASS on `5ab2b72e`, tree
`92ca6b26dea687a614950db7cdabb9c1d98847c2`:
[535/5985640571](https://github.com/heke99/gridex-ops-platform/pull/535#issuecomment-5985640571).
Final-head OPS run `37243974742` verify, quality and upgrade jobs are SUCCESS;
its clean/native job remains pending qualification. Genuine old-source OPS run
`37241338916`, clean job `111550506356`, artifact `11318761012`, ZIP SHA256
`92b523a4cbfc6a36d372ea09f708f98b22466375de0610c44111649d51503e73`,
records DB-02 collection ENOENT, so **none of the six own cases ran**. This
cannot support a native PASS. Two other shared suite failures remain separately
owned; no full native success or approval is inferred.

The actual replay retains original SQL in HOLD and temporarily replaces the
working-tree migration files with ledger markers. The own native fixture read
the former paths during that phase. Root authorized only this native file and
the own checkpoint; scope was published before editing:
[491/5985860099](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985860099).
The repair reuses the existing correction-context native contract: `git show`
the exact current HEAD's original creation and forward SQL and verify both
SHA256 values against that same HEAD's migration history manifest. Actual
forward BEGIN/COMMIT and all six native assertion bodies remain byte-identical.
No shared helper, replay/runner/config, SQL, schema, generated capture, unit
test or coverage file changes.

An outside-git throwaway checkout removes both working-tree original files.
`vitest list` reproduces the original ENOENT and collects all six cases with
the corrected fixture. This is collection proof only: no SQL, native session,
hosted query or disposable bootstrap was executed. Script types, scoped lint,
diff and explicit product/config/unit/coverage/generated/provenance byte
equality PASS. Source input hashes are unchanged: creation
`a30b8f1566d1368daad2b04e03bce094d32494104db0bf700c31aa0bb0185f9d`,
forward
`8f40a4b9d4c36d4c1d5ec14a6af499d55e1c6510c5ba921873b714e94d702ed0`.
The independently verified capture remains qualified for the identical SQL
and capture inputs. Next: independent review of this two-file test-only delta,
publish one new head and obtain genuine six-case native results plus mandatory
actual-head gates. Own approvals remain unchanged; no local full-suite retry.

## Genuine main #518 integration — 2026-10-05

The published `d7cba77a` collection correction was independently approved before
push: [535/5985923521](https://github.com/heke99/gridex-ops-platform/pull/535#issuecomment-5985923521).
New PR workflows were blocked after genuine main advanced to
`9dc4a783a0c5e926596e3054a958c64e43efd490`. Root authorized merging that
actual main into this branch. Both DB-02 shared Z06 preimages were verified
against the primary owner's inputs; only the exact reviewed two-blob union
from `d315464b7db62c43e455bc3bf8be5e2d8d2cf194` is adopted. Grammar SHA256
`7c0c3d52f200ac4d07b45ae16d7262008c2cf83e3977135546d93858df6830fd`,
wire SHA256
`89cdd70fd5d9d14241d54d180fb58b712e419e09330b670c724bae6a2965ce24`.
Shared independent review:
[491/5986107796](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5986107796).
The primary owner's actual 18/18 result is reused within this exact-byte scope;
no independent fixture variant or duplicate run is introduced.

Main's two staff forwards, runtime checksums, three tests, provenance and
mandatory runner SQL guards enter unchanged. Fresh selected staff behavior is
45/45 PASS across those three files; test/scripts types, full migration checks,
specification 33/121/231, diff and explicit incoming/own byte equality PASS.
DB-02 SQL, history checksum, native six-case reader/assertions, unit test,
native config and coverage bytes remain exactly `d7cba77a`. All three generated
outputs and the original raw DB-02 capture receipt also remain unchanged.

The manifest retains the actual DB-02 223219 tail and complete capture/history.
Incoming main manifest history is preserved by immutable Git commit/path/blob
and SHA256 pointer (`ec3346fe4b0ebb28ca1054437f3434e3819120b6a192a9df730dd5b2ede208f3`).
`composition_capture_pending=true` explicitly requires a fresh genuine capture
of this combined prefix; neither historical capture is relabeled as current.
Next: publish this genuine merge once, inspect replacement producers, verify
and import their authentic capture as necessary, and obtain genuine six-case
native outcomes plus mandatory actual-head gates. Own coverage remains
unapproved; main merge remains held. No local full-suite retry or alternate
native bootstrap is used.

## Fresh combined-prefix capture import — 2026-10-05

Direct job API verifies capture run `37248423784`, job `111570888599`, SUCCESS
on exact `ec72b580814703f30b62adb39d2d8371665e148b`, tree
`ad0c400d4d05913c62826db28eca77aa5a49c0be`. Artifact `11320046969` ZIP SHA256
and published digest both equal
`4b2a65e85d5c7806887bc123c175a49115a39da39e8b79015f7a01d2ec2f8b41`.
Four-member set, CRC, eight exact source Git inputs, three outputs, actual
223219 replay tail and canonical fingerprint all verify. Producer is CLI
2.101.0 / PostgreSQL 17.6; timestamp `2026-10-05T00:55:48.177774+00:00`.

All three genuine generated files are byte-copied and remain unchanged from
the prior DB-02 import: types `4f5713d6`, schema `bbcdb029`, fingerprint file
`3583cfca`; canonical fingerprint remains `8c818532`. Raw receipt is imported
unchanged at `quality/audits/ediel-masterplan-v2/db02/capture-receipt-20261005.json`.
The complete original ec72 manifest is retained exactly under superseded
provenance, including earlier DB-02 history and the immutable incoming main
manifest pointer. Its SHA256 equals the producer's manifest input hash. The
new manifest records this actual captured source/tree and marks its prefix
capture fulfilled; the following metadata-only commit is not relabeled as
the captured source.

Full migration checks, specification 33/121/231, diff, output/receipt equality,
complete original-manifest preservation and source/native/unit/config/coverage
byte checks PASS. No SQL or native assertion changes. Capture explicitly records
native/browser/type-schema comparison/upgrade parity NOT_RUN. Direct OPS jobs
API still has clean/native `111570888875`, verify `111570888902` and upgrade
`111570888880` queued, with quality `111570888686` active. Six own native cases
have not executed. Next: publish this metadata/receipt checkpoint, independent
capture review, genuine six-case results and mandatory actual-head gates.
No whole-card promotion, local full retry or main merge is authorized yet.

## Source-qualified native result and three-date repair — 2026-10-05

Fresh exact-head API/artifact review on `99456309214d412b67f2222b0f69108124e94d48`
replaces the historical pending status: run `37250368328`, clean/native job
`111576581771`, artifact `11322940903`, ZIP SHA256
`63bae11e38b5fd9d7b8db5bf1e86cd96df705382df00e15dfa510c0abefe2e3e`.
Digest, CRC and genuine source SHA/tree verify. Own native result is **5 PASS /
1 FAIL / 0 SKIP**. Installed constraints, both real repeatable-read commit and
rollback cases, and both legacy preflights PASS. Combined DML fails with
`expected_sqlstate_23P01, got 23505`; entire native report is 609 PASS / 1 FAIL /
1 SKIP. Verify, quality, upgrade and other exact-head checks passed. This is not
whole-card approval. The earlier capture import independently passed:
[535/5986432283](https://github.com/heke99/gridex-ops-platform/pull/535#issuecomment-5986432283).

The original profile DDL preserves UNIQUE(company,environment,market,start).
Two scope-move fixture starts coincide with the disabled June 1 row; its safe
self-update also coincides with the empty February 1 row. The real uniqueness
guard rejects first; this does not show accepted invalid production data.
Root authorized only three dates: foreign June 2, test-environment June 3,
self-update February 2. Expected SQLSTATEs, assertions, row counts and all other
native source remain unchanged. Product SQL/history checksums do not change.
Qualified original receipt and exact before/source Git pointer plus date diff:
`quality/audits/ediel-masterplan-v2/db02/native-receipt-994563-20261005.json`.
Before-edit scope/result:
[535/5998905143](https://github.com/heke99/gridex-ops-platform/pull/535#issuecomment-5998905143).

Next: non-destructive integration of freshly fetched genuine main, preserve all
main coverage approvals and inspect generated/provenance differences, then
publish one coherent source packet with ordinary exact-head gates. A changed
capture prefix requires fresh authentic qualification. Corrected native cases
are not claimed PASS until actually executed. No duplicate artifact download,
local native bootstrap or local full-suite retry; root owns every main merge.

## Corrected native fixture on genuine main a248 — 2026-10-05

Atomic three-date repair is `a55a57c6968c112fa3eb0f31f9109a0ea37cb85e`.
Reverse substitution proves all other native bytes, assertions, SQLSTATEs and
counts equal the qualified 994 source. The genuine fetched main parent is
`a24885d52275f832307329b92bcfaef95fca8cb2`, including merged ENV-02. No
non-destructive integration reset, cherry-pick or other-owner source fix is used.

Main's full coverage file is preserved byte-for-byte; DB-02/AT-DB-02 remain
NOT_VERIFIED/NOT_EXECUTED. Migration history retains every main entry and the
unchanged own 223219 checksum; native configuration retains every main include
and exactly one own six-case include. Own production SQL, unit test and corrected
native source equal the atomic repair. The already reviewed two shared Z06
blobs still equal `d315464b`; its exact 18-case source scope is retained without
another duplicate run.

Incoming main schema/fingerprint are authentic historical baseline bytes, not
a hand-composed merge of snapshots. Types remain `4f5713d6`; incoming schema
SHA256 `df4a353f3f2bb1bfd4eb0f4be99c76ee89a65ffb98bdc345f78c6924e5e65df6`,
fingerprint file
`10a1a07a4678506462e037be4f23c8f2dab729dc560addb219892ef57830dac7`.
Incoming main capture/provenance is preserved; the complete prior own manifest
remains reachable through immutable a55 commit/path/blob/hash. Actual newest
registered replay tail is `20261005020000_ediel_production_contract_ack_confirmation.sql`.
`composition_capture_pending=true` explicitly requires fresh genuine capture of
main plus the own profile guard and corrected fixture. No earlier receipt is
relabeled as this source prefix.

Selected actual profile tests 25/25, full test/scripts types, migration checks,
scoped native/config lint, specification 33/121/231 and own diff/byte checks PASS.
Inherited main audit-log whitespace remains unchanged; own diff against main
passes. No local full/native chain or artifact re-download. Next: publish one
coherent merge head, genuine owner capture/import and actual corrected six-case
native outcome plus mandatory current-head gates. Coverage promotion and main
merge remain held under root authority.

Skill routing: Supabase boundary guidance, spec-to-code compliance, source
review, fp-check and verification-before-completion apply to this bounded
inventory. Postgres best practices/testing activate for an authorized repair.
UI/performance, supply-chain scanners, general audit/bootstrap and independent
owner implementations have no trigger in the explicitly delegated scope.

## Authentic current-prefix capture and actual six native cases — 2026-10-05

Frozen source `6a14022ed2782363068ec0fa3138915f50bba57f`, tree
`f768e93784c61de8ee77d1d82f033c4b6339868d`, produced genuine capture run
`37344181678`, job `111878502531`, artifact `11359439370` (SUCCESS). ZIP
SHA256 `19874bebfb3ee87f54de90891b0336e9a7161adf710b032f363e2dab62af28cb`
matches the published digest; four members/CRC, all eight exact source input
hashes, actual 05020000 tail, three outputs and canonical fingerprint verify.
CLI 2.101.0 / PostgreSQL 17.6 capture timestamp is `2026-10-05T17:04:54.028611+00:00`.

Raw schema, fingerprint and producer receipt are copied byte-for-byte from the
retained artifact. Types remain byte-identical and are not changed. New raw
receipt: `quality/audits/ediel-masterplan-v2/db02/capture-receipt-6a14022e-20261005.json`.
Removing only the date-order CHECK and enabled-period EXCLUDE from the captured
schema restores the entire incoming main baseline. Fingerprint changes only
constraints 4477→4479, extensions 7→8 and indexes 2921→2922. Canonical fingerprint
is `4c42c3416001eb09f6c52c6f788a555554613c0fff0ef3cec15a341c63e8b044`.
The active manifest marks this source capture fulfilled (`composition_capture_pending=false`),
retains the complete previous manifest object with its exact Git blob/SHA256,
and preserves every incoming main and earlier DB02 historical pointer. No
previous capture is relabeled as the imported child's source. Producer capture
flags remain native/browser/comparison/upgrade NOT_RUN.

Separate genuine OPS run `37344181319`, clean/native job `111878501868`, artifact
`11362023150`, ZIP SHA256
`00d6cebd563e304664988e918c014296c090b6dc9f1fcfeed2ada23898bad075`
contains exact 6a source/tree-bound native results: **own 6 PASS / 0 FAIL / 0 SKIP**;
overall 617 PASS / 0 FAIL / 1 SKIP. Installed constraints, actual DML/rollback,
both real repeatable-read commit/rollback cases and both legacy preflights ran.
Qualified receipt: `quality/audits/ediel-masterplan-v2/db02/native-receipt-6a14022e-20261005.json`.
The prior 994 5 PASS / 1 FAIL receipt remains unchanged as historical evidence.
The clean job failed later at the final committed schema/fingerprint comparison;
this authentic capture import supplies those missing generated bytes. Other
exact-source verify/quality/upgrade/tenant/targeted/browser checks succeeded.
This does not claim a green final import-head job or whole-card approval.

No product SQL, native/assertion, unit, configuration, migration-history or
coverage bytes change in this import. Full `db:migrations:check` PASS (1067
files, 970 version groups; generated types and actual tail verified),
specification integrity 33/121/231 PASS, and diff checks PASS. Raw output/receipt
byte equality, all eight source hashes, complete previous-manifest object/hash,
historical pointers and protected source/coverage bytes verify. Exactly six
paths change; generated types remain unchanged. No repeated native/full suite.
Next: local import child freeze for root independent review before push, then
ordinary mandatory final-head CI. No new native/full/capture runs, downloads,
main integration or merge; coverage promotion remains held for root approval.
