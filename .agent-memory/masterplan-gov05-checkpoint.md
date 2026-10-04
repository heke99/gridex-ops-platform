# GOV-05 / AT-GOV-05: coherent inbound guide evidence

Inventory base: `643ea134788e96fe9c6782b43730d6e0671fd98f` (tree `599119e71c25b9f5921c2c404d1c8a07ef291d0a`). Inventory/ownership: GitHub #491 comments 5984623767 and 5984720533. The candidate incorporates actual main `56192d16d1eac7fb0e716a3e2770bac8e58be115` (#507), preserving its product, OPS-02 coverage and shared-memory changes without conflict. Final packet diff: three test files, this checkpoint and only the GOV-05/AT-GOV-05 coverage rows; no product, source authority, database or shared handover delta. Any later main advance requires its own integration review.

## Complete card and executed evidence

The frozen rule requires the nearest preceding valid guide during the two-week inbound transition, subject to superior rules; one complete compatible package and a logged interpretation; no favorable single-check blending or UNH-only revision authority.

- `ediel-guide-transition-selection.test.ts`: actual guide-only selection uses the preceding complete package on October 1 and 14, stops on October 15, and does not fall back merely because functional object knowledge fails. Actual runtime report assertions retain the selected preceding guide and admission date. The existing October 15 case now also asserts the current guide, actual association and admission date in the runtime report.
- `ediel-accepted-guide-package.test.ts`: selected guide, UTILTS profile, processability and source trace use one revision; current and preceding packages have the same `E5SE5A` association. Old/future/outbound-incompatible candidates are held.
- `ediel-canonical-rule-pack-evidence-identity.test.ts`: actual registry consumer retains named original snapshots and opaque versions, holds scope/version/witness mismatches, and rejects registered guide/revision/profile mismatches despite an unchanged UNH association. Only the protected RPC result port is substituted.
- Reused inventory contrasts: recorded receipt/Stockholm admission date rather than DTM137; invalid/missing time holds; the S08 superior live-use restriction remains separate from historical replay; actual direct UTILTS consumers retain guide selection. No favorable functional-error fallback or newly inferred guide authority was introduced.

All existing assertions are retained. The only behavioral assertion addition is current-guide logging in an existing test. The three reused suites carry `GOV-05, AT-GOV-05` tags; their 23 cases pass.

Actual call path: `guideRegistry` → `messagePolicy` → canonical whole-policy/UTILTS guide validation → `runtimeDecision` report. The inbound coordinator stores the canonical report and selected policy; subsequent UTILTS consumers retain that policy. No changes overlap GOV-06's time handoff or OPS-05's registry catch.

## Source and verification limits

Original T §1.4 page 4 is locally present and SHA256-verified: `5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951`. The frozen U25A4 binary (`0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be`) has not been recovered. Its frozen source annex remains the recorded authority; no newer PDF replaces it and this packet claims no original-binary custody.

Inventory on the exact base passed 66 cases in eight guide/time/package/identity/source/ACK/direct-runtime files and 58 cases in four policy/source-facts/journal/SMTP-persistence files. The reused guide-governance script passed 98 cases. Separate original-source-basis and transport-journal scripts passed 23 and 15 embedded PostgreSQL checks. Embedded SQL uses synthetic rows and finite upstream ports; it is not native/RLS/full-replay, genuine TGT or market-delivery evidence. The named protected registry RPC is substituted in the tagged identity suite.

Own verification uses Node 22 and the repository's CI loopback-network preload. Scoped tests, test TypeScript, lint, frozen-spec integrity and the supported tag gate are the relevant packet checks. No GOV-04 approval is implied: its actual sender boundary/history proof and any source-qualified bilateral exception remain separately coordinated.

Executed candidate checks after incorporating actual main `56192d16`: 23/23 owned cases in the three files above; `npx tsc --noEmit -p tsconfig.tests.json` PASS; scoped ESLint PASS; `node scripts/check-ediel-masterplan-v2.cjs` PASS (33 original files, 121 rules, 231 contracts); `node scripts/ediel-masterplan-test-coverage.cjs` PASS (74 approved IDs, 82 tagged green, zero tagged failing; GOV-05/AT remain unapproved); `git diff --check` PASS. Main coverage is byte-identical (`122aea1dbac878f2cf65616f785612074ed58a1b8a89cfcc03bc3834582e9c92`). No coverage is promoted by these green checks alone.

## Independent complete-card verdict

Root independently approved GOV-05 and AT-GOV-05 on the exact published code/test freeze `9ce24ba46aec8ed1686258701ff45606918de66b`, tree `f3d89f3655d1dac91ceec65516aa7e21c2cc498d`; public receipt [#491 comment 5984843391](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5984843391). Its fresh 51/51 in six actual suites include all 23 owned cases plus 28 time/direct/execution contrasts. The review covers original T §1.4, complete compatible packages, selected interpretation logging, the inclusive 14-day boundary, no functional-error fallback and no UNH-only revision authority. The substituted RPC/native/U-binary-custody limits above remain explicit. Only after that independent verdict are GOV-05 marked VERIFIED and AT-GOV-05 marked PASSED; all other main rows remain unchanged.

Final approval-only checks: frozen-spec integrity PASS (33 originals/121 rules/231 contracts); supported tag gate PASS (76 approved/82 tagged green/zero tagged failing); exact coverage comparison to main confirms only GOV-05/AT-GOV-05 changed; diff check PASS. The reviewed code/test bytes are unchanged. GitHub checks must complete on the final PR head before root performs any guarded main merge; #491's merge window remains in force.
