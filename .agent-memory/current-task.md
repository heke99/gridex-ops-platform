# Recovered PRODAT register continuation — single active task

Status: IMPLEMENTED_NOT_VERIFIED (final delivery).
Branch: `codex/ediel-v2-prodat-register-rules-20260917`; PR328 remains draft.
Recovery base: `2c11f276cdf30e80d234752d96c9914e7b30af5d`.

The later original complete worktree was unavailable; fourteen complete files
were recovered with matching blob hashes and the remainder reconstructed against
source and fail-first tests. Do not repeat recovery or trust historical test counts
as current qualification. See `quality/audits/ediel-masterplan-v2/f3-register-recovery-20260918.md`.

TGT source/rendering, both comparisons, source-bound facts through admin/autopilot
and send gates, snapshot precedence, expected inventory, and durable per-object
customer decisions are implemented.343 register cases pass. Local tests/typechecks pass; build hit a resource limit; final-head ordinary CI and independent review
are pending. Supabase inspection was read-only. No live market messages were sent.

Masterdata graph writes for normalization-changing or same-ID/different-agency
objects remain explicitly blocked by the existing schema. Parsing/staging retain
all identities. No broad F3 or live certification is asserted. A different actor
cannot silently resume an existing object's transaction plan.

Next action: complete qualification, publish to PR328 and review the exact head.
Fix actual CI/review findings, then guarded merge only when accepted. After the
register unit merges, begin the separate remaining110D review. PR310 remains
PAUSED at e961135199f292b8210884f07de3b616a670161a. PR327 remains MERGED as
51c73950515d771d2c2edcb97fde28ab087437a3. No schema, SQL, generated DB types, dependencies or original specification
were changed. No further authorization is needed for agreed non-production work.

Publication checkpoint:2157 application tests,343 register tests,851 retained source cases and all three TypeScript projects pass. Local build SIGKILL; ordinary CI production build and substantive review are required before merge.
