# Current Task

## Status

Completed as a foundation patch. Not all future Ediel rulebook work is complete.

## Goal

Build the first production-safe Ediel decision-engine foundation so ACK decisions are based on payload, context, rule profile and business state rather than direct test-case shortcuts.

## Scope completed

- Added/updated generic Ediel classification for PRODAT, UTILTS, CONTRL, APERAK and UTILTS_ERR.
- Added rule-profile selection foundation.
- Added PRODAT permission classification for Z13/Z14/Z15/Z18 variants.
- Added handling that treats correct Z14N as a valid business denial, not automatic negative APERAK.
- Added broader UTILTS classification foundation.
- Hardened ACK lifecycle/idempotency so already-sent correct ACKs are treated as success and opposite final ACKs are blocked/manual.
- Added tenant-safe UI status mapping helper.
- Updated AI context documentation and changelog for future Cursor/Codex work.

## Changed files in this patch

- `app/admin/ediel/system-tests/actions.ts`
- `lib/ediel/classify.ts`
- `lib/ediel/core/kernel.ts`
- `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- `lib/ediel/orchestrator.ts`
- `lib/ediel/rulebook/ruleProfileSelector.ts`
- `lib/ediel/statusUi.ts`
- `docs/ai-context/05_PRODAT_RULES.md`
- `docs/ai-context/06_UTILTS_RULES.md`
- `docs/ai-context/07_ACK_CONTRL_APERAK_UTILTS_ERR_RULES.md`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

## Not completed in this patch

- Full PRODAT Excel field-matrix import from `Uppgifter i PRODAT 26-A 16-B april 2026`.
- Portal validation report parser.
- Full UI refactor for all tenant/superadmin status views.
- Complete regression suite for every PRODAT and UTILTS message family.
- Full production dry-run UI for every rule profile.

## Rules preserved

- Test case codes are verification context, not production rules.
- CONTRL remains syntax/technical ACK.
- APERAK remains application/business ACK.
- UTILTS_ERR remains functional/process error response for UTILTS where required.
- A correct Z14N can produce positive APERAK.
- Invalid/unlinked Z14 can produce negative APERAK or manual review.
- Already-sent final ACKs must not be resent or silently replaced with opposite outcome.
- Tenant isolation must be preserved.

## Validation status

Sandbox validation could not run full build because dependencies are not installed in the extracted environment.

Observed:

- `npm run build` cannot start when `next` is not installed.
- TypeScript checks are blocked by missing framework/package types such as Next.js, React, Supabase and Node types.

Required local/Vercel validation:

- `npm install`
- `npm run typecheck`
- `npm run build`
- `npm run ediel:rule-regression` if available
- `npm run ediel:production-readiness-regression` if available
- `npm run ediel:routing-security-regression` if available
- `npm run ediel:inbound-tenant-resolution-regression` if available

## Next task recommendation

Run the patch locally, then test the current AGT/TGT flow that failed:

1. inbound PRODAT Z14 parsed
2. positive CONTRL generated/sent
3. positive or negative APERAK selected by engine/profile, not free UI choice
4. correct ACK already sent shows success/already_sent
5. old/wrong draft ACK is superseded
6. final opposite ACK is blocked/manual review
