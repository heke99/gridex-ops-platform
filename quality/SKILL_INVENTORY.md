# Skill inventory — v2 supplement

## Scope

This report supplements the existing repository-wide integrity review. It does not repeat findings already documented in `quality/CODEBASE.md`, `quality/ARCHITECTURE.md`, `quality/BUGS.md`, `quality/SECURITY.md`, `quality/PERFORMANCE.md`, `quality/LARGE_FILES.md`, `quality/TEST_BASELINE.md`, or `quality/TEST_RESULTS.md`.

- Repository: `heke99/gridex-ops-platform`
- Branch: `audit/gridex-ops-full-integrity-review`
- Supplement start commit: `1028bdde8f944ee69154d761e7cdc00c0afd3756`
- Inventory source: branch-local `skills-lock.json`, branch tree, and direct UTF-8 reads of every installed `SKILL.md`
- Hash source: branch-local `skills-lock.json` field `computedHash`
- Installed skill files directly readable: **31/31**
- Mandatory v2 skill paths missing: **0**
- Recommended skill paths missing: **4**

The branch-local lock records a SHA-256-shaped `computedHash` for every installed skill. The connector-only environment did not recompute these hashes from raw bytes, so the status below means **recorded and source-traceable in the repository lock**, not independently rehashed during this supplement.

## Interpretation rules

- `available`: the exact branch path exists and the Markdown file was read successfully.
- `missing`: an exact read of the requested branch path returned not found.
- A local Markdown skill does not itself require an API key and does not itself create a separate charge.
- Credentials and possible costs belong to execution tools or external services, not to the Markdown instructions. Examples include GitHub, Supabase, Vercel, email providers, live EDIEL/provider endpoints, monitoring platforms, and external AI runtimes.
- Skills are review instructions, not evidence that code, builds, migrations, RLS, OpenAPI, or live integrations work.

Phase codes used below:

- `K`: repository and architecture mapping
- `A`: API, OpenAPI, auth, error and configuration review
- `D`: database, RLS and tenant review
- `S`: security, secrets, SAST and dependency review
- `T`: tests, regression design and verification
- `P`: performance, React/Next.js and large-file review
- `C`: CI/CD, deployment and observability review
- `R`: evidence handling, final quality control and reporting

## Installed and readable skills

All installed rows below have the exact local path `.agents/skills/<skill>/SKILL.md`, are local and cost-free as Markdown instructions, and have status `available`. Unless a license is explicitly present in the local file, the license is reported as `not stated locally`; no upstream license is guessed.

| Skill | SHA-256 recorded in `skills-lock.json` | Upstream source | License visible locally | External execution dependency | Applied phases | Status |
|---|---|---|---|---|---|---|
| `acquire-codebase-knowledge` | `06b7a3d0bb44b70b470247aacc2ffffe37c8ce64cc3f9178be6f392c81cb6d22` | `github/awesome-copilot` | not stated locally | repository read access | K, R | available |
| `api-and-interface-design` | `3cf54553433e55875c664baf78f9c769820bdfac155f09bf2989d70e20e6e147` | `addyosmani/agent-skills` | not stated locally | runtime/API access only for live proof | A, R | available |
| `api-design-principles` | `19715a3a3ff7bf7b1e2ab1cb631ebe810d5b050ed6b3ab0c358e39e5e2e6d33a` | `wshobson/agents` | not stated locally | none for review | A | available |
| `auth-implementation-patterns` | `f97118b792830d928ce691a44d0f38fb55a2032e2fa15b22b482c229d2853e87` | `wshobson/agents` | not stated locally | auth/runtime credentials only for live proof | A, D, S | available |
| `ci-cd-and-automation` | `578b098a7d2352ccdac8b8abdc40eb6803538e81cf8382f138da6188a655087c` | `addyosmani/agent-skills` | not stated locally | GitHub Actions/CI access | C, T | available |
| `code-review` | `f0604d278cfd4eac4dac29eb297a5c6b6ebfb9f020235e8aafbe2eff0e42a147` | `getsentry/skills` | not stated locally | repository read access | K, A, D, S, P, R | available |
| `code-review-and-quality` | `ae7a873053c84dd5a76f70c05a21efc4095017e95b8f5db778eb826809859cac` | `addyosmani/agent-skills` | not stated locally | repository/CI access for execution | S, T, R | available |
| `code-simplifier` | `ff9cb10181e31daf1f1644754c491601a7849dff4b4536a1d0ec4f97f680348e` | `getsentry/skills` | not stated locally | none for review | P, R | available |
| `debugging-and-error-recovery` | `1a119d27e8f1d27ed6317adf3115826336491346780dcb7d7a7a7f79fe3ffe10` | `addyosmani/agent-skills` | not stated locally | executable test/runtime environment for reproduction | A, T | available |
| `deployment-pipeline-design` | `57b928db2182b0fae02581e95a3b77f0354d2b1f5a48dd12eadf2f0ddbb34db8` | `wshobson/agents` | not stated locally | GitHub/Vercel deployment access | C | available |
| `e2e-testing-patterns` | `6daed3254a84348588532aca327ec82a57cafefd7c97c50e75879788f7c1a18d` | `wshobson/agents` | not stated locally | browser/runtime/test credentials | T | available |
| `error-handling-patterns` | `73f0570edd3ddc740ba5411932a67954df375530bbffbe7fa0cecd8e59b0711e` | `wshobson/agents` | not stated locally | none for source review | A, T | available |
| `find-bugs` | `7bf00be700d1d205b747126aa96d3587bbc2855cd09897614676e179eebe35ed` | `getsentry/skills` | not stated locally | repository and runtime access for reproduction | K, A, D, S, P | available |
| `incremental-implementation` | `d83e705bd54b0a4b02a75cdda0a3f2a28b935286e31eb945e13aafe079c87b59` | `addyosmani/agent-skills` | not stated locally | Git write access | R | available |
| `nextjs-app-router-patterns` | `b4fea42eecf1f803155ef7fa133d5286ee8f2dbba3e616954e9e43c6f0ffc144` | `wshobson/agents` | not stated locally | Next.js build/runtime for proof | K, A, P | available |
| `nodejs-backend-patterns` | `b63b54d09c77cec0e84cdd42424c12909785f14bdb286c835c45420b885ff1f3` | `wshobson/agents` | not stated locally | Node runtime for execution | A, C, T | available |
| `observability-and-instrumentation` | `9bfc314353e4a55d691faca5b1a894e38a9897d88aabff34ea2c6a039d86bf8d` | `addyosmani/agent-skills` | not stated locally | monitoring/runtime access where configured | A, C, S | available |
| `openapi-spec-generation` | `d062c891d58ef7e38c56360d4c325aff70247d1b5880b8b299098d7e51e38294` | `wshobson/agents` | not stated locally | API/runtime access for live parity | A, T | available |
| `quality-playbook` | `995cfa79a5e410a2675a828da08fc2377f5ee7182d210787ae4bece43bad3857` | `github/awesome-copilot` | not stated locally | local toolchain and CI for full execution | K, T, R | available |
| `refactor` | `87789a786b96f99ba0680e89345a975106e10e7db1071c7cdc2e76d507c449d6` | `github/awesome-copilot` | not stated locally | tests/build needed before safe refactor | P, R | available |
| `sast-configuration` | `6169b0d02b289a8264010f9601ceb4f57b0ca1e9d463f2f8936b2d88a58267b8` | `wshobson/agents` | not stated locally | SAST engine/CI if executed | S, C | available |
| `secrets-management` | `ca8d6e0507564a438424b9408922f469ceb20827d6f60d845c103df8e5ac11e7` | `wshobson/agents` | not stated locally | secret stores/platform credentials | A, S, C | available |
| `security-and-hardening` | `a0246e67cf8f8a18687a7736442738318b1997715fbdf53dfcf767082c51cca5` | `addyosmani/agent-skills` | not stated locally | runtime/security tooling for dynamic proof | A, D, S | available |
| `security-threat-model` | `b3ad2dc0b2eee1f189680fdb8cf3b17853f12ab3403d389393f4237ebc6f9821` | `openai/skills` | not stated locally | none for source threat model | S | available |
| `source-driven-development` | `235fb43569e9b21ec5d209818ff1ad3da9682be33c4e464ffa89ed348e7094a0` | `addyosmani/agent-skills` | not stated locally | source access | K, A, D, S, T, P, C, R | available |
| `supabase` | `886743d08edece523e48b5c6c737afa29029503bdd3b28a722795712cedfcd91` | `supabase/agent-skills` | not stated locally | Supabase credentials for live operations | D, S, T | available |
| `supabase-postgres-best-practices` | `e14e276241805c97dbcfe40dcbea1a3035269cc7293cac4b1832dda41a835e60` | `supabase/agent-skills` | MIT | database access for live plans/metrics | D, S, P | available |
| `test-driven-development` | `133428ac28fa75cf6f8cf5dafea8d603022852ce59a0520620784c7e3dc7e519` | `addyosmani/agent-skills` | not stated locally | executable test environment | T, R | available |
| `threat-model-analyst` | `a4fd18bc3ddceade98533df503cd8d4906d96feaf3720d16d4d038544ca769eb` | `github/awesome-copilot` | not stated locally | none for source analysis | S | available |
| `vercel-react-best-practices` | `ca7b0c0c6e5f2750043f7f0cd72d16ac4e2abc48f9b5500d047a4b77a2506212` | `vercel-labs/agent-skills` | MIT | Next.js runtime/build for measurement | P | available |
| `web-design-guidelines` | `f3bc47f890f42a44db1007ab390709ec368e4b8c089baee6b0007182236ac474` | `vercel-labs/agent-skills` | not stated locally | browser/UI runtime for full validation | P | available |

## Missing recommended skills

| Skill | Exact requested path | SHA-256 | Read result | Replacement coverage | Status |
|---|---|---|---|---|---|
| `doubt-driven-development` | `.agents/skills/doubt-driven-development/SKILL.md` | unavailable | exact path not found | evidence gates in `source-driven-development`, `quality-playbook`, `code-review-and-quality`, and the v2 prompt; not treated as identical | missing |
| `performance-optimization` | `.agents/skills/performance-optimization/SKILL.md` | unavailable | exact path not found | partial coverage from `supabase-postgres-best-practices`, `vercel-react-best-practices`, `nextjs-app-router-patterns`, and `code-simplifier` | missing |
| `documentation-and-adrs` | `.agents/skills/documentation-and-adrs/SKILL.md` | unavailable | exact path not found | partial coverage from repository documentation rules, `source-driven-development`, and `quality-playbook` | missing |
| `sql-optimization-patterns` | `.agents/skills/sql-optimization-patterns/SKILL.md` | unavailable | exact path not found | partial coverage from `supabase-postgres-best-practices` | missing |

These four paths are recommended rather than mandatory in the v2 prompt. Their absence is therefore recorded but does not by itself block this documentation-only supplement. It does prevent claiming that their exact procedures were used.

## Credentials and possible cost

No installed Markdown skill required a separate API key or produced a direct charge. The following external execution contexts can require credentials and may incur provider cost depending on the account and workload:

- GitHub repository writes and GitHub Actions
- Supabase database, Auth, Storage, Cron and management operations
- Vercel preview/staging/production deployments
- live EDIEL and market/provider integrations
- email delivery providers such as Resend or Mailgun
- monitoring or error-reporting services when enabled
- external AI runtimes used to interpret the skill instructions

## Verification limitation

`quality-playbook`, TDD, E2E, SAST, CI/CD and deployment skills describe executable checks. The current connector-only environment could inspect source and repository state but could not run the full local Node/npm toolchain. Their instructions were applied to evidence classification and report structure; their executable checks remain documented as `blocked` where no successful run exists.