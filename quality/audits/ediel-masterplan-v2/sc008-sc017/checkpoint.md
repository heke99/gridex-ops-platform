# SC-008 / SC-017 bounded proof packet

Branch: `codex/ediel-sc008-sc017-proof-20261004`, isolated checkout
`/workspace/gridex-masterplan-sc008-sc017`, base main
`56192d16d1eac7fb0e716a3e2770bac8e58be115`.
Owner claim: #491 comment5985236532. Status: implemented and locally verified;
independent complete-scenario approval is pending. No coverage or common memory
rows were changed. Root owns promotion after independent review.

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
  This packet changes only the ESCO native file's first tag comment; its entire
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
approval. Next: publish this exact bounded packet to the trusted origin, send
the commit/PR to root, and await independently assigned complete SC-008/SC-017
review before any coverage promotion or merge.
