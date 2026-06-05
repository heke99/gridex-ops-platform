# Current Task

## Status

Completed as a broader decision-engine batch. This is stronger than the earlier foundation patch, but the official PRODAT Excel field matrix is still a required future input for exhaustive field validation.

## Goal

Build the remaining core decision-engine pieces so PRODAT/UTILTS ACK decisions come from one reusable backend decision node instead of scattered UI/test shortcuts.

## Scope completed

- Added `lib/ediel/decisionEngine.ts`.
- Added central PRODAT APERAK decision logic.
- Added central UTILTS response decision logic for APERAK vs UTILTS_ERR.
- Added portal validation feedback parser for A902 expected/actual mismatch.
- Added reusable ACK lifecycle decision helper:
  - correct final ACK => `already_sent_success`
  - conflicting final ACK => `blocked_final_ack_exists`
  - replaceable draft/prepared/queued/failed => `supersede_replaceable`
  - otherwise => `create_new`
- Wired generic ACK recommendation logic into the decision node.
- Routed legacy PRODAT APERAK helper through the new decision node.
- Updated production inbound classification to surface the PRODAT decision-node reason.
- Added regression coverage for Z14N, invalid Z14, invalid Z18, portal feedback and final ACK lifecycle.

## Important implemented rules

- Correct Z14N is a business denial, not an APERAK error.
- Correct Z14N => positive APERAK.
- Invalid/unclassified Z14 => negative APERAK with permission-status error.
- Z18 missing permission end reason => negative APERAK with ERC 41 / FTX 324.
- Z15 invalid status/reason => negative APERAK with ERC 42 / FTX 322 or 324.
- Portal feedback where expected A902 is 40/41/42 but actual is 100 forces negative APERAK decision.
- Production Z14/Z15/Z18 without safe process/permission link requires manual review instead of guessing.
- AGT UE1/UE2 UTILTS is separated from TGT U3 and can select UTILTS_ERR.

## Changed files in this patch

- `lib/ediel/decisionEngine.ts`
- `lib/ediel/ackDecision.ts`
- `lib/ediel/prodat/prodatAperak.ts`
- `lib/ediel/inbound/productionInboundDecisionEngine.ts`
- `scripts/ediel-rule-regression.cjs`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/ai-context/11_CURRENT_TASK.md`
- `docs/ai-context/12_KNOWN_RISKS_AND_REGRESSIONS.md`
- `docs/ai-context/14_VALIDATION_CHECKLIST.md`
- `docs/ai-context/19_DECISION_ENGINE_RULES.md`

## Validation performed

- `tsc --noEmit --pretty false` was attempted.
- Filtered changed-file diagnostics showed no TypeScript errors for the changed files.
- Full project typecheck/build could not be completed in sandbox because dependencies are not installed.
- Regression script was updated but cannot run in sandbox until dependencies are installed.

## Next required local commands

```bash
npm install
npm run typecheck
npm run ediel:rule-regression
npm run ediel:production-readiness-regression
npm run ediel:routing-security-regression
npm run ediel:inbound-tenant-resolution-regression
npm run build
```

## Remaining known external dependency

Official PRODAT Excel field matrix:

- `Uppgifter i PRODAT 26-A 16-B april 2026`

Until that Excel is imported, the engine can enforce architecture, decision separation, known permission rules, ACK lifecycle and core TGT/AGT regressions, but not every detailed PRODAT field rule.
