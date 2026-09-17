# Single active task — PRODAT register overlays

Status: IN_PROGRESS (source mapping and acceptance design only).
Branch: `codex/ediel-v2-prodat-register-rules-20260917`.
Base: merged main `51c73950515d771d2c2edcb97fde28ab087437a3`.

Establish the exact first-register/register-2+ rules from the locked P26.A §2.2 and annex 2, then reproduce the affected parser, matrix, builder and consumer behavior. Preserve field 314's global sequence separately from field 258's per-object register index. No new runtime changes or executable register evidence exist at this checkpoint.

Finish the register unit through tests, normal exact-head CI, substantive review and guarded merge before beginning the remaining national dependent-condition unit. A false dependent condition must not automatically mean forbidden; source-specific optional/forbidden and unknown outcomes need separate evidence.
