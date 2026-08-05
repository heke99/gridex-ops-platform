# Gridex OPS — Skill Inventory

## Scope

This report records the Agent Skills present on `audit/gridex-ops-full-integrity-review`, the evidence used to identify them, and how they were applied during the integrity audit. Skills are review instructions; they are not proof that runtime behavior passed.

## Current result

- Installed skill directories: **35**
- Readable `SKILL.md` files: **35/35**
- Mandatory v3 skill paths missing: **0**
- Previously missing recommended skills now installed: **4**
- Invalid installed skills found: **0**
- Skills blocked from use because of malicious or unclear scripts: **0 found by manual source inspection**
- Automated `skill-scanner`: **not installed; manual non-executing review used**

## Newly installed v3 skills

| Skill | Branch path | Upstream source | Pinned source commit | SHA-256 (`skills-lock.json`) | Status | Applied phases |
|---|---|---|---|---|---|---|
| `doubt-driven-development` | `.agents/skills/doubt-driven-development/SKILL.md` | `addyosmani/agent-skills` | `f03b4a84b08b76608bbab3133e56e49e361f230b` | `f6094460ebc9512285c85790e49f612081b9dd6a2b77d874fe2d960ef50a9ef1` | `available` | high-stakes claims, isolation/auth/API conclusions, final readiness challenge |
| `performance-optimization` | `.agents/skills/performance-optimization/SKILL.md` | `addyosmani/agent-skills` | `f03b4a84b08b76608bbab3133e56e49e361f230b` | `3881a49f910607b36f4fb1f9f17b4ef703293c6073986bcfa9f7839d44680aba` | `available` | performance evidence discipline, N+1/pagination/cache review, no unmeasured optimization |
| `documentation-and-adrs` | `.agents/skills/documentation-and-adrs/SKILL.md` | `addyosmani/agent-skills` | `f03b4a84b08b76608bbab3133e56e49e361f230b` | `7464fd2950b99fb00bbf65cab27653e0a049eef00c98927713ffdfe232a9daa9` | `available` | v3 report completion, source-of-truth drift, decision-documentation review |
| `sql-optimization-patterns` | `.agents/skills/sql-optimization-patterns/SKILL.md` | `wshobson/agents` | `c4b82b0ad771190355eb8e204b1329732a18449a` | `19ff8ce86d20aa39cace441e15d23feb9b91be5fbed95526b5bd9ee3bffb6411` | `available` | PostgreSQL query/index review and EXPLAIN-based verification requirements |

The source directories for the three Addy Osmani skills contain only `SKILL.md`. The SQL skill's `SKILL.md` references an optional upstream `references/details.md`; the navigation-level skill is installed and sufficient for this audit, while the optional worked-example reference was not executed or treated as evidence.

## Safety and external dependencies

The four newly installed Markdown skills were read before use. They do not embed credentials, execute code on load, or require payment by themselves.

Potential external dependencies arise only when following optional procedures:

- `doubt-driven-development` can offer Gemini CLI, Codex CLI, or manual cross-model review. Each invocation requires separate explicit user authorization, working tooling and possibly credentials/cost. No external CLI was invoked by this autonomous audit.
- `performance-optimization` references Lighthouse, browser profiling, RUM and APM. These may require browsers, monitoring services or usage-based plans. No metric was claimed without a run.
- `sql-optimization-patterns` references `EXPLAIN ANALYZE`, statistics and maintenance commands. Destructive or locking examples such as `VACUUM FULL` were not executed.
- `documentation-and-adrs` requires no external service.

## Installed skill inventory

The complete installed set is recorded in `skills-lock.json`. Each entry includes upstream source, path and a computed SHA-256. The four v3 additions also pin an exact upstream commit.

### Core mapping

| Audit area | Skills used |
|---|---|
| Repository discovery and evidence | `acquire-codebase-knowledge`, `source-driven-development`, `quality-playbook` |
| API and contracts | `api-and-interface-design`, `api-design-principles`, `openapi-spec-generation`, `error-handling-patterns` |
| Authentication and authorization | `auth-implementation-patterns`, `security-and-hardening`, `security-threat-model`, `threat-model-analyst`, `doubt-driven-development` |
| Supabase/PostgreSQL and isolation | `supabase`, `supabase-postgres-best-practices`, `sql-optimization-patterns` |
| Bug analysis and fixes | `code-review`, `code-review-and-quality`, `find-bugs`, `debugging-and-error-recovery`, `test-driven-development`, `incremental-implementation` |
| Next.js/UI | `nextjs-app-router-patterns`, `vercel-react-best-practices`, `web-design-guidelines` |
| Performance | `performance-optimization`, `vercel-react-best-practices`, `sql-optimization-patterns` |
| Dependencies and delivery | `sast-configuration`, `secrets-management`, `ci-cd-and-automation`, `deployment-pipeline-design`, `observability-and-instrumentation` |
| Documentation | `documentation-and-adrs` |

## Doubt-cycle application

The v3 supplement applied a bounded adversarial review to these non-trivial claims:

1. **Claim:** installing the four skills from the selected upstream commits does not change production behavior.  
   **Contract:** only `.agents/skills/**` and `skills-lock.json` may change during installation.  
   **Result:** valid; no production source, migration, dependency manifest or workflow changed.
2. **Claim:** previous `NOT_READY` status should not be upgraded solely because the hardening workflow is green.  
   **Contract:** v3 requires full build/lint/test/OpenAPI/live and deployment-dependent evidence or explicit blockers.  
   **Result:** valid; readiness remains conservative.
3. **Claim:** performance and SQL findings cannot be promoted to verified defects without measurements or query plans.  
   **Contract:** measure first and require runtime/EXPLAIN evidence.  
   **Result:** valid; existing performance risks remain open/unverified rather than being invented as fixed defects.

Cross-model review was not invoked. The skill requires separate authorization for every external CLI invocation; autonomous execution therefore used the documented degraded local adversarial pass and records that limitation.

## Integrity limitations

- The SHA-256 values are the installer-compatible hashes recorded by independently generated public `skills-lock.json` files for the exact upstream skill paths; existing Gridex entries from the same sources match those public lock values. The audit did not obtain a local raw-byte checkout to recompute every installed skill hash independently.
- Manual source inspection found no executable payload in the four new skills. A dedicated `skill-scanner` result is unavailable.
- A skill being `available` means its instructions can be read; it does not mean every recommended external tool or check ran.
