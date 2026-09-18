# Active: Z04:319 consumption-point reference

Status: IMPLEMENTED_NOT_VERIFIED. Only this next D cell is active.

## Completed predecessor
PR330 merged to main as e4df8b58e0277bf57f3f755cd9ec8c5c4cac9527.
Tested/reviewed head831fa1fb27e91c47ff7374e5a0a6513fdb27a897; treeb10d70fad26e40a241d8eb679870076a851ae6d6.
OPS35354989775, Ediel35354989756, Browser35354989687 and FullE2E35354989676 completed SUCCESS.
Independent static source/assertion review5731278438 confirmed the final blocker repair; no test execution claimed by reviewer.
Expected-head merge and main readback verified. Do not reapply the user's original ZIP over newer corrections.

## Current bounded candidate
Z04:319 is required for actual first-register field223 Z70/D; forbidden for other valid Z04 reasons.
Unknown/duplicate/aliased reasons stay blocked. Header/party/later-register RFFZ07 cannot be hidden.
C506/1154 is at most25 decoded characters; forbidden1156/4000 values cannot supply a reference.
Source: unchanged user normative projections, P26.A r3 §2.2 p21/§2.6 p78; original full PDF not rehashed in this unit.

Fresh standalone regression62/62; unchanged retained source851/851 (848+3); immutable specification33files passes.
91 added actual-row/send Vitest cases are authored but NOT locally executed (dependencies unavailable).
Ordinary CI must establish all tests, typechecks, lint, coverage, build and replay on the published exact head.
Substantive independent review is required; never count a skipped automatic review as acceptance.

Six numeric D cells are accepted by PR330. One is a candidate;103 other numeric D cells and10parent groups remain unreviewed by these units.
Original110cell inventory is retained; full masterplan/F3–F7/live TGT and release are NOT complete.

## Safety / outstanding independent blockers
PR310 remains PAUSED at e961135199f292b8210884f07de3b616a670161a; no imports of its migrations/types/grants.
Existing main35334649693 had70/73 full-release steps pass: migration inventory, Z18 certification and installation-NAD assertions failed.
No historical migration checksum may be silently adopted. Green PR smoke is not full-main release acceptance.
No live DB/storage mutation, explicit deployment/settings changes or market messages. Authorized main merges may auto-deploy via existing Git integration.

Next: inspect live main/branch, publish this exact candidate from e4df8b58, run ordinary CI and independent review; repair/reverify before expected-head merge.
Then continue the remaining D inventory. Detailed evidence: ../../quality/audits/ediel-masterplan-v2/f3-d-z04-reference-20260918.json.
Historical logs: archive/2026-09-18-pr330-final-merged/.
