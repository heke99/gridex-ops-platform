# Checkpoint — ENV-06 / ENV-10 (PRODAT BGM/CCI layout)

- Agent: Claude session zealous-brown (`https://claude.ai/code/session_018XcifVPYh8kYT29K8p6RbS`)
- Branch: `claude/zealous-brown-1okb98`, worktree `/home/user/gridex-ops-platform`, base main `01b11f5`
- Date: 2026-10-05
- Claim: #530 comment 5991462511 (ENV-06, AT-ENV-06, ENV-10, AT-ENV-10)
- Status: locally verified; PR pending (see "Next action")

## Verified defects (reproduced on 01b11f5 before the fix)

1. ENV-06: inbound PRODAT `CCI++Z13` + `CAV+L` (Gridex alias) was fully accepted as Z22.
   `resolveProdatSubtype` accepts aliases; field 223 had no wire code list.
2. ENV-06: inbound wire 223 that is unknown (`ZZZ`), belongs to another BGM function (`Z96` in Z01) or is
   absent ended in `manual_review` without a negative APERAK, although it is the sender's own field content.
3. ENV-10: generic AST `cciCavMap` read the qualifier from element 2 and fell back to element 3 for every
   non-PRODAT family, so a UTILTS `CCI++E02` (PRODAT slot) was read as E02.
4. ENV-10: legacy UTILTS planning rules in `fieldMatrix.ts` used `CCI++E02/E12/Z01` (PRODAT C502 slot):
   a correct UTILTS `CCI+++E02` was reported `UTILTS_FIELD_254_MISSING`, while the wrong slot passed.

## Fix

- `lib/ediel/prodat/prodat26AFieldMatrix.ts`: field 223 gets per-BGM-function `allowedValues` = exact
  three-character reason codes from `PRODAT_SUBTYPE_RULES` (no aliases).
- `lib/ediel/prodat/prodatReasonCodeRejection.ts` (new): qualifies `prodat_subtype_unknown|not_allowed`
  policy failures as ERC41/42 on field 223 via the existing field matrix + diagnostic projection.
  `prodat_bilateral_capability_required` is not matched (stays local evidence / internal review).
- `lib/ediel/core/runtimeDecision.ts`: calls the above next to the existing field-202 qualification.
  (Composition lives in `lib/ediel/prodat/` because the normative-authority guard forbids core importing
  the PRODAT matrix.)
- `lib/ediel/core/canonicalEdifactAst.ts`: `cciCavMap` is family-bound (UTILTS → element 3, else 2; no fallback).
- `lib/ediel/rulebook/fieldMatrix.ts`: CCI path locator honours `CCI++Q` (C502) vs `CCI+++Q` (C240);
  UTILTS planning paths corrected to `CCI+++…`.

## Verification (2026-10-05, Node 22.22.0)

- `npx vitest run __tests__/ediel-env-06-env-10-prodat-cci-layout.test.ts` → 14/14 PASS.
  With only the `lib/` changes reverted: 8 FAIL / 6 PASS (the 6 are pre-existing correct behaviours kept
  as guards: Z22/Z23 accept, BGM+Z01L → CONTRL negative, bilateral gate local, renderer, header refusal,
  PRODAT C502 field-matrix path).
- Full `npx vitest run` (first pass, before the guard refactor): 1 fail / 10335 pass — the failure was
  `ediel-normative-authority-boundary` (core imported the PRODAT matrix); fixed by moving composition
  into `lib/ediel/prodat/prodatReasonCodeRejection.ts`; guard test PASS afterwards. Second full run: see
  PR / commit message.
- `npm run typecheck`, `npm run typecheck:tests`, `eslint` on changed files → PASS.
- Mocks: rule-pack registry and Supabase service are mocked (no DB in these unit paths); the decisions
  asserted are produced by the real runtime decision, field matrix, AST and renderer code.

## Residuals / handed to other owners (not fixed here)

- Supabase migrations `20260813124500_…` and `20260813130500_…` seed UTILTS rule-pack rows with the old
  `CCI++E02/CAV` text. These rows are evidence-only (`fieldRuleRegistry.ts` never uses them as semantics);
  applied migrations are not rewritten.
- Observation for the UTILTS field owner (unverified as a defect): canonical UTILTS policy passes
  `UtiltsFieldRule` objects (no `requirement`, path `SG7/CCI+++…`) through `validateFieldMatrixPayload`,
  where they are inert. UTILTS field requirements appear to be enforced by the UTILTS runtime instead;
  needs owner confirmation.

## Next action

Commit, push, open PR, post READY on #530; drive CI green; then RELEASE/MERGED per contract.
