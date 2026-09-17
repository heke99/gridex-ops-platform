# Current state — F3-D published and code-qualified

Updated: 2026-09-17. Active item: final qualification/merge of PR #324.
Branch: `codex/ediel-v2-prodat-references-20260917`; base main `5a741b2c6e108d2db08b24aab9c0e6c4b71b1862`.
Code-qualified head: `c343dfd155586b653989281c6bc07f621a5dbcce`, tree `800c68dcfc0f883ba9dae151f89016293d363d29`.

The saved candidate was published with exactly matching tree bytes. The separate
source-transfer helper is NOT part of PR324 and is not qualification evidence.
All four ordinary workflows on c343dfd1 completed SUCCESS: OPS35207689478,
Ediel35207689453, Browser35207689469, FullE2E35207689487. They execute the21
actual-module consumer cases, full types/tests/lint/API/RBAC/audit/build/budgets
and existing-main replay. Fresh local source tests439/439 and immutable spec
33files/121rules/231contracts pass. Source/DB mocks and public browser checks
are not live market, full grammar or paused-PR310 certification.

This documentation update must itself pass normal exact-head CI before merge.
Read PR324's actual current head, checks, reviews and merge status; do not assume
this checkpoint's earlier code SHA is the latest head. No merge recorded here yet.
After merge continue the remaining NAD/BGM/DTM projection work from actual main,
not from a stale branch. Original saved-checkpoint details remain in Git history
and the historical part of f3-reference-fields.md.

PR310 stays PAUSED at `e961135199f292b8210884f07de3b616a670161a`; recovery ref
`backup/pr310-paused-20260916-e9611351` unchanged. No SQL, types, grants,
production DB/storage mutation or external market message was performed.
