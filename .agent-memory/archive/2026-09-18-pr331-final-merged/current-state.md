# Active: PR331 Z04:319 — fixture-corrected candidate

Status: IMPLEMENTED_NOT_VERIFIED. Read live PR331 before continuing.

Initial head acbab21f failed Ediel/OPS/FullE2E; Browser passed. Its static independent review5731951173 found no production defect but did not execute tests. The correction supplies real field213 QTY in test fixtures and a valid Z04 subtype in the complete-facts catalog, retaining all assertions and adding wrong-subtype/register-prerequisite controls. Production modules and thresholds are unchanged from acbab.

Fresh local2594/2594 application tests in238files with unchanged coverage thresholds;913/913 source cases (62new+851retained), all3TypeScript projects, lint0errors/99warnings and quality/RBAC/budgets pass. The initial concurrent app-typecheck exited137; separate unchanged-source retry passed. Dependencies were recovered from an existing same-lockfile artifact. New exact-head CI/build/replay and independent rereview still REQUIRED.

Evidence: ../quality/audits/ediel-masterplan-v2/f3-d-z04-fixture-qualification-20260918.md and companion JSON. The initial source-only audit is historical. Do not reapply the original ZIP or earlier candidate over this follow-up.

## Completed predecessor
PR330 merged to main as e4df8b58e0277bf57f3f755cd9ec8c5c4cac9527.
Tested/reviewed head831fa1fb27e91c47ff7374e5a0a6513fdb27a897; treeb10d70fad26e40a241d8eb679870076a851ae6d6.
OPS35354989775, Ediel35354989756, Browser35354989687 and FullE2E35354989676 completed SUCCESS.
Independent static source/assertion review5731278438 confirmed the final blocker repair; no test execution claimed by reviewer.
Expected-head merge and main readback verified. Do not reapply the user's original ZIP over newer corrections.

## Current bounded scope
Z04:319 requires actual first-register Z70/D and forbids other valid Z04 reasons. Unknown reasons stay blocked; malformed/header/party/later-register references are protected. Source: unchanged frozen primary projections P26.A r3 p21/p78. Six D cells accepted by330, one candidate,103 others and10parent groups outside acceptance. Full masterplan remains NOT_COMPLETE.

## Safety / outstanding independent blockers
PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a; no imports of its migrations/types/grants.
Issue332 preserves main35334649693 and fresh35358260956, both70/73: migration inventory, Z18 certification and installation-NAD assertions failed.
No historical migration checksum may be silently adopted. Green PR smoke is not full-main release acceptance.
No live DB/storage mutation, explicit deployment/settings changes or market messages. Authorized main merges may auto-deploy via existing Git integration.

Next: inspect live main/branch; fast-forward the existing PR331 branch from acbab21f with this follow-up (main base e4df8b58). Run new-head ordinary CI and independent review; repair/reverify before expected-head merge.
Then continue the remaining D inventory; the initial source-only audit remains historical.
Historical logs: archive/2026-09-18-pr330-final-merged/.
