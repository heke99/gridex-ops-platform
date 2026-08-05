# Gridex OPS — Audit Changelog

This changelog maps audit findings and audit infrastructure changes to files, commits and verification evidence. It does not replace Git history or the central bug register.

## Finding-to-change matrix

| Finding / work item | Change | Files | Commit | Verification | Status |
|---|---|---|---|---|---|
| `BUG-001` portal sync client errors became 500 | Preserve controlled `ApiInputError` status/code/message/field and keep unexpected faults generic | `app/api/v1/customer-portal/sync/route.ts`; `scripts/gridex-customer-portal-sync-error-contract-regression.cjs` | `aeaa08283e714160181cd007f2c04196d6cf88a2` | dedicated regression source added; included in expanded V3 CI matrix | `in_progress` until final matrix completes |
| `BUG-004` architecture/report drift | Document actual root layout and current audit handoff | quality architecture/codebase reports; `.agent-memory/current-task.md` | `b40f240f0dc64773c4cbdf4065661b7acbf38059`, `46effd0851f598f258f222694c0a36fedd10c2e7` | source inspection | `partially_fixed` |
| `BUG-006` missing immutable OpenAPI release material for `2026-08-05.2` | Add versioned immutable website/customer-portal snapshots | `docs/openapi/releases/2026-08-05.2/*.json` | `c39794361ec342d5e75a530136724f779f1f2b5e` | first release gate advanced and exposed missing routes | `partially_fixed` at this commit |
| `BUG-006` missing immutable version routes | Add versioned GET routes with immutable cache headers | `app/api/v1/openapi/2026-08-05.2/**/route.ts` | `f5d81c726dbe3f023f00e3f99c3a33829e5a9ac1` | `OPS hardening` run `31052844335` completed successfully | `fixed` |
| Missing four recommended audit skills | Install exact upstream-pinned Markdown skill files and update lock metadata | four `.agents/skills/**/SKILL.md`; `skills-lock.json` | `af19ecaa4dcd85928a4ec46078da5429c2bc9e55`, `b716de24a0381e52d93ffe34a67df36e5c068286` | branch file reads and lock/source comparison | `fixed` |
| Skill traceability gap | Record 35 installed skills, sources, hashes, safety and phases | `quality/SKILL_INVENTORY.md` | `cd14556b16c4f325a6aea93bb953b0d8baa9de3f` | direct file reads; manual non-executing review | `fixed` |
| V3 verification coverage gap | Add lint, script/test typecheck, portal regression, full tests, API checks and build to hardening CI | `.github/workflows/ops-hardening.yml` | `20d98ff444dc55f5847fc03ead4ed455eb0f8c9a` | final expanded run pending at time of this entry | `in_progress` |
| Missing V3 execution context | Document remote baseline, branch divergence and connector/worktree limitations | `quality/00_EXECUTION_CONTEXT.md` | `52fe33d61138f1e2d27708d6aef53e05b584de02` | GitHub metadata and compare evidence | `fixed` |
| Missing discovered project profile | Record stack, domains, boundaries and confidence | `quality/PROJECT_PROFILE_DISCOVERED.md` | `8216bc80eed9bfca52a1c6353726067651283747` | source/config/platform inspection | `fixed` |
| Missing UX/accessibility report | Record verified static controls and blocked runtime checks | `quality/FRONTEND_UX_ACCESSIBILITY.md` | `5700284b8f6a4cb8f4f51db6ea24e54214e13704` | source inspection only | `fixed` as documentation; runtime checks remain `blocked` |
| Missing deployment/observability report | Record Vercel/CI/health/error/logging controls and gaps | `quality/DEPLOYMENT_AND_OBSERVABILITY.md` | `0320742466a2b0207a07eb945ccf5b5d6e876c83` | source and workflow inspection | `fixed` as documentation; live validation remains `blocked` |

## Audit report history

### Initial audit

| Commit | Purpose |
|---|---|
| `b40f240f0dc64773c4cbdf4065661b7acbf38059` | repository baseline and initial reports |
| `aeaa08283e714160181cd007f2c04196d6cf88a2` | portal-sync error contract correction |
| `46effd0851f598f258f222694c0a36fedd10c2e7` | initial report finalization/handoff |
| `1028bdde8f944ee69154d761e7cdc00c0afd3756` | audited file-count correction |

### V2 additive supplement

| Commit | Purpose |
|---|---|
| `bc14e3a3192cdf1d5a9e1905122457c4db38963b` | verified skill inventory |
| `f14c957c3b8f504311a58c62f98f4aad183d535c` | API/environment configuration report |
| `aa3452c593475f29a578ce57d13883bde097399b` | dependency/SAST/supply-chain report |
| `0ac71e71ec0a2882289162f198b42892b0892551` | V2 verification results |
| `f55805e235abf3296aebcabdd8ba1eab21a8b844` | V2 final-review update |
| `34a15f2304778f610c920bf576383d0185c799b3` | successful hardening workflow evidence |
| `f81126bea4fbe6bf1403496840b47d1fe02becf8` | final V2 CI reconciliation |

### V3 continuation

| Commit | Purpose |
|---|---|
| `af19ecaa4dcd85928a4ec46078da5429c2bc9e55` | lock four requested skills |
| `b716de24a0381e52d93ffe34a67df36e5c068286` | install four requested skills |
| `cd14556b16c4f325a6aea93bb953b0d8baa9de3f` | update skill inventory |
| `c39794361ec342d5e75a530136724f779f1f2b5e` | materialize immutable OpenAPI release files |
| `f5d81c726dbe3f023f00e3f99c3a33829e5a9ac1` | expose immutable OpenAPI release routes |
| `20d98ff444dc55f5847fc03ead4ed455eb0f8c9a` | expand audit CI matrix |
| `52fe33d61138f1e2d27708d6aef53e05b584de02` | add V3 execution context |
| `8216bc80eed9bfca52a1c6353726067651283747` | add discovered project profile |
| `5700284b8f6a4cb8f4f51db6ea24e54214e13704` | add frontend/UX/accessibility report |
| `0320742466a2b0207a07eb945ccf5b5d6e876c83` | add deployment/observability report |

## Database and migration changes

No migration file or live database DDL/DML was added by the V3 continuation. Supabase was queried read-only for project/advisor/catalog evidence.

## Protected-branch and worktree safety

All V3 writes targeted `audit/gridex-ops-full-integrity-review`. No write targeted `main` or another protected branch. No local worktree was accessed, cleaned, reset or stashed.
