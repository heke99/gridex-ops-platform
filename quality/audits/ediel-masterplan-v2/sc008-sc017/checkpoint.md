# SC-008 / SC-017 bounded proof packet

Branch: `codex/ediel-sc008-sc017-proof-20261004`, isolated checkout
`/workspace/gridex-masterplan-sc008-sc017`, base main
`56192d16d1eac7fb0e716a3e2770bac8e58be115`.
Owner claim: #491 comment5985236532. Status: independently approved for both
complete bounded code-behavior criteria at reviewed head `d1f7d5e5`. Only
SC-008/SC-017 coverage rows are promoted after root authorized publication of
the independent verdict. Common memory is untouched; root owns final CI/merge.

Skill routing: spec-to-code-compliance for the complete frozen scenarios;
using-git-worktrees for isolation; verification-before-completion for current
asserting commands and source-qualified reuse; requesting-code-review through
root's separately assigned reviewer. fp-check remains conditional on a real
production divergence. This is bounded test/evidence work: no production,
database, permission, routing, parser, validator, helper or authority change;
no UI, performance, supply-chain or repository-wide audit work.

Frozen inputs: `acceptance_tests.json:108–119` (SC-008) and:240–251 (SC-017).

| Literal effect | Asserting behavior and its boundary |
| --- | --- |
| SC-008: P holds one source with multiple objects; K can receive only its granted projection | `scripts/test-ediel-ten-07-scoped-projection.cjs` calls the actual PostgreSQL consumer. Its existing17 scoped checks use two accepted-series dependency declarations under one owner source, point-a granted and point-b ungranted. The actual consumer returns only the allowed quantity rows/window; another series, added quality/raw fields, unrelated purpose and wider period deny. It explicitly checks no foreign point, foreign99.000 value, raw payload, private observations/company field or ungranted quality leaks and preserves originals/series/values/ACK/scope history. The private upstream source/accepted-storage/review ports are finite synthetic dependencies, not a new native mixed-file intake custody claim. |
| SC-008: raw original is unavailable to K, while an authorized operator can read it | New `__tests__/ediel-sc008-owner-raw-read.test.ts` uses a declared physical two-transaction incoming row with distinct GSRNs. It calls the actual server guards, tenant scope resolver and `getEdielMessageById`, mirroring `/admin/messages/[id]` and the platform raw viewer. A known owner-message ID yields null under K's exact company filter. Owner-scoped operator and actual platform-authority context yield the intact original. Missing operational company, mismatched authenticated actor, missing operator authority and a spoofed platform role name fail before the query. Every test retains the original row unchanged. Authentication context and SDK row-query boundaries are declared substitutes; no UI-hidden-only conclusion is used. |
| SC-008: beneficiary raw/full-scope requests cannot bypass filtered delivery | Existing tagged `__tests__/ediel-beneficiary-projection-api.test.ts` calls the actual HTTP route/request parser: allowed request returns a private/no-store projection with authenticated company/actor, raw/scope overrides reject before a source read, and denied requests expose no owner diagnostics. The SQL consumer asserts allowed output and rejects ungranted raw/foreign/field/window reads. The separate14 outbound transport-copy checks are retained parent evidence, not substituted for incoming raw authorization. |
| SC-017: valid E66 correlates without an invented wire permission-id | Existing `scripts/ediel-esco-10-11-projection-native.test.ts` positive case calls genuine native archive/review, Z13/Z14 permission/grant, canonical received structure, storage and projection owners. It asserts wire lacks both actual permission UUID and synthetic permission marker; stored reception receipt binds raw hash, transaction membership, codeE66, contract version/bound time and accepted persisted contracts. The permitted derivative retains DGI/legal source provenance. Existing service-evidence29 covers genuine V/VH storage/ACK and current invalid context/revocation denial. |
| SC-017: only valid legal actor/GSRN/product/period/permission context is used | The supported ordinary tagged wrapper executes the real scoped consumer's wrong-object, wrong-product, source/receiver role, physical DSO sender, permission legal actor/DSO, permission object period/product and current source-authority denials, alongside valid allowed rows. Genuine native positive storage binds the tuple through current reviewed permission/grant owners; missing approval/revoked grant/reviewer/role/issuer facts deny with zero business/binding/ACK effects in the reused service suite. There is no invented permission-id wire-field validator. |

Source-qualified native reuse, not a fresh current-main native claim:

- GitHub run37219122360 and artifact11310821113 independently confirm native
  source `f4a0fb4398a79f5777824123142c82aeeb8338ec`.
- Exact ZIP SHA256
  `470c1eed5afd99678c2d5ab2c7fa108bc33384cc873fb5ecab5cf9cb4f820076`.
- Actual native605 total /604 PASS /1 unrelated SKIP /0 failures/errors;
  selected ESCO projection3/3 and service-evidence29/29 have zero skips/errors.
- Fourteen relevant native test/fixture/service/storage/projection/consumer and
  receipt-owner blobs are byte-identical between that source and base561.
The technical packet changes only the ESCO native file's first tag comment; its entire
  asserting body is unchanged. Exact hashes and selected case names are in
  `verification-receipt.json`.

Current executed verification: targeted Vitest35/35 PASS across four files;
ordinary SQL wrapper2/2 PASS (17 scoped effects and separate14 copy effects);
changed-TypeScript ESLint PASS; tests TypeScript PASS; `git diff --check` PASS.
The initial wrapper invocation in the default restricted sandbox terminated
without subtest diagnostics. The same unchanged wrapper passed with child
network permission; no product/test code was changed to obtain that result.

External issuer, legal and SMTP facts remain synthetic fixture inputs. Neither
this packet nor its reused native results establish authentic external market
approval. Independently assigned complete SC-008/SC-017 review is now published
alongside this checkpoint. Exact-head mandatory CI and parent merge gates remain
required; no fresh native run or external market qualification is inferred.

Published packet: draft PR #541, initial exact head
`a6a991cd26887c8a0006f4465354dc666ddd829f`. Independent whole-scenario review
was performed by `/root/ten07_rule_review`; this owner does not self-approve.

Calendar-only integration follow-up: cherry-picked existing P-owner commit
`9433d04bfc037fae0f61710c73a5ac85eeef443d` as `ea6ff48c`. Its exact three
Git blobs match the original owner commit:

- `__tests__/ediel-z06f-native-wire-grammar.test.ts`:
  `d746c7bb74d86a9cdc2a543ac01db2254e3bc7e5`.
- `scripts/helpers/ediel-z06f-reading-followup-native-fixture.ts`:
  `342080e0de09717717aaac01bbc1ed44c433bb1a`.
- `scripts/helpers/ediel-z06f-reading-followup-native-wire.ts`:
  `7bb066f9e34f481f3bc396f611f5bb3fd1423fb0`.

The fixture avoids month-end rollover in its Z06 F reading contrast. The
focused wire grammar/calendar suite passed 9/9 after this exact reuse. All
fourteen source-qualified SC-008/SC-017 native/production/SQL blobs remain
byte-identical to the initial packet head, as do its asserting test files and
verification receipt. Only this checkpoint records the follow-up; no heavy
suite was rerun and no coverage, common memory or production source changed.

Independent final verdict: `independent-review.md`, copied byte-identically
from the separately assigned reviewer's record, SHA256
`e56c65fb579ef78099a20e3ed52e8404edf88129a39a776230e3302003fe3a94`.
It approves both complete frozen expected/prohibited contracts at exact head
`d1f7d5e53af120211c59f062e7b2f26e6243182e` / tree
`ed19b9cb038af93ab8bc633ec725debefeaa6fc5`. The reviewer independently executed
35 TS cases and 2 supported wrappers, checked all14 relevant source blobs and
all4 input hashes, and verified qualified historical native32 with zero skips.
Root authorized only SC-008/SC-017 PASSED publication; the other350 coverage
rows remain exactly unchanged. All asserting tests, relevant production/native
blobs and migrations remain unchanged after review. The original qualified
native receipt remains intact; its publication status now cites that verdict.

Independent GitHub approval publication:
https://github.com/heke99/gridex-ops-platform/pull/541#issuecomment-5985513661.
Final supported tagged gate PASS: 352 IDs /76 approved /82 tagged green /
0 tagged failing, with the CI unit loopback preload and declared child network
permission. Frozen specification integrity PASS:33 originals /121 rules /
231 acceptance contracts and all evidence references. Exact two-row coverage
delta, unchanged other350 rows, unchanged14 source blobs/all4 inputs, unchanged
production/app/migrations/tests/scripts since reviewed d1 and byte-identical
independent review were checked again before commit. Final log hash is retained
in the adjacent receipt. Parent retains required actual-head CI and merge.


## Genuine current-main integration — 2026-10-05

Root preserves the retained whole approvals while genuinely composing main8451f013. All three authoritative main Z06F calendar files and the full existing tagged TEN07 wrapper are byte-exact; the old alternative calendar fixture is superseded. Only SC008/SC017 ledger rows change, with all foreign metadata/order preserved. The actual raw-reader and projection API suites pass24/24 on this composition; frozen specification33/121/231 and own diff checks pass.

Current main has real native-reuse input changes in declared-offset preparation, explicit time anchors and shared AST parsing. Original #497 native evidence stays historical at its exact source; it is not relabeled as new-head native proof. Final ordinary clean native CI must qualify the new source. Root owns push/CI/final guard and merge; implementation owners retain their source scope.
