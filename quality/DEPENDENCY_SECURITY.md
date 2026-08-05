# Dependency, SAST and supply-chain security — v2 supplement

## Scope and evidence rules

This report adds the dependency and supply-chain review required by the v2 prompt. It does not repeat application security or tenant findings from `quality/SECURITY.md` and `quality/BUGS.md`.

- Repository: `heke99/gridex-ops-platform`
- Branch: `audit/gridex-ops-full-integrity-review`
- Supplement start commit: `1028bdde8f944ee69154d761e7cdc00c0afd3756`
- Package manager evidence: root `package.json` and `package-lock.json`
- CI evidence: `.github/workflows/ops-hardening.yml`
- Dependency mutation performed: none
- Lockfile mutation performed: none
- `npm audit fix` performed: no

An advisory match is not treated as a verified exploitable production vulnerability without a reachable execution path, deployment scope and successful reproduction or equivalent evidence.

## Verification status

| Check | Status | Evidence/result |
|---|---|---|
| Root package manifest inspected | verified | exact audit-branch `package.json` |
| npm lockfile inspected | verified | exact audit-branch `package-lock.json` |
| Repository CI workflow inspected | verified | exact audit-branch `.github/workflows/ops-hardening.yml` |
| Root lifecycle script review | verified | no root `preinstall`, `install`, `postinstall`, `prepare` or `prepublishOnly` script was identified in the inspected root manifest |
| `npm ci` | blocked | no executable checkout/npm environment; previous package retrieval blocker remains relevant |
| `npm audit` | blocked | dependency installation/audit could not be executed |
| Dependabot open-alert retrieval | blocked | GitHub returned 403 because the repository security product is not enabled/available to the connector |
| SAST engine execution | blocked | no configured executable SAST run was available in the connector-only environment |
| Secret scan over full Git history | blocked | no authenticated local clone/history scanner |
| Current-tree source review for obvious committed credentials | partially verified | targeted source/config inspection only; not a substitute for a full scanner |
| Production dependency reachability | unverified | no built production artifact or runtime call-path trace |

## Package and lockfile posture

The project uses npm with a committed `package-lock.json`. The root manifest contains explicit quality, security, API compatibility, migration, Gridex regression and build scripts. Their existence is configuration evidence only; this supplement does not mark them passed.

The root dependency set includes application/runtime packages such as Next.js, React, Supabase clients, Zod and email/provider libraries, together with development tooling and test dependencies. Exact installed resolution remains lockfile-controlled when `npm ci` succeeds.

### Install blocker retained from the earlier audit

`zod-validation-error@4.0.2` is present in the root dependency contract and was previously associated with the unavailable package mirror/registry installation path in the audit environment. This is an environment/install blocker, not proof of a package vulnerability.

- Status: `blocked`
- Security classification: none without an advisory or reachable exploit path
- Required next step: run `npm ci` against the approved registry/mirror and preserve the complete error output if it fails
- Prohibited shortcut: do not remove or arbitrarily downgrade the package solely to make installation pass

## Advisory and reachability register

### DEP-001 — `brace-expansion` advisory range appears in the lockfile

- Status: `unverified`
- Severity: not severity-counted as an application finding until reachability is established
- Advisory reference: `GHSA-3jxr-9vmj-r5cp` and related 2026 `brace-expansion` denial-of-service advisories
- Lockfile observation: versions including `1.1.13`, `2.0.2`, `4.0.2` and `5.0.6` are present in transitive dependency trees
- Scope observation: inspected occurrences were marked `dev: true` in the lockfile
- Verified production exposure: no
- Verified attacker-controlled pattern reaching the affected expansion function: no
- Safe target: resolve through the narrowest parent dependency update that produces a non-affected version while retaining lockfile determinism
- Breaking-change risk: unknown until parent chains and test results are available
- Test plan:
  1. run `npm audit --json` after a successful `npm ci`;
  2. identify every parent chain with `npm explain brace-expansion`;
  3. confirm whether any affected version is included in the production deployment artifact;
  4. trace whether untrusted input can reach the package;
  5. apply a minimal parent update/override only after that evidence;
  6. run lint, all typechecks, tests, security regressions and production build.
- Current action: no package or lockfile change

This entry intentionally separates advisory presence from exploitation. Dev-only resolution can still affect CI or developer tooling, but it is not automatically a public runtime vulnerability.

### DEP-002 — automated GitHub dependency alert evidence unavailable

- Status: `blocked`
- Severity: Low verification gap
- Evidence: the Dependabot alerts API returned 403 because the security product was not enabled or accessible
- Impact: the audit cannot reconcile the lockfile against GitHub's current alert set from this environment
- Safe remediation: enable the relevant GitHub security product or provide read access, then export open and dismissed alerts with dismissal reasons
- Verification: compare alert package/version/range against lockfile and prove the actual reachability for each finding

## SAST posture

The repository contains a SAST instruction skill, but an installed skill is not an executed scanner. No successful CodeQL, Semgrep or equivalent current-branch run was available as evidence in this supplement.

| Area | Source review | Executed scanner status | Required next evidence |
|---|---|---|---|
| TypeScript/Next.js application | prior repository audit plus targeted v2 review | blocked | current-branch CodeQL/Semgrep or equivalent result |
| SQL/migrations | prior Supabase/catalog review | blocked for SAST | migration/static SQL scan plus database regression suite |
| Shell/Node scripts | package and workflow inspection | blocked | shell/script scanner and command-path review |
| Secrets in current tree | targeted inspection only | blocked for full scanner | secret scan of current tree |
| Secrets in Git history | not verified | blocked | authenticated full-history secret scan and rotation record for any hit |

No statement is made that the repository is free from hard-coded secrets or SAST findings. The available evidence only supports that no new credential was introduced by this documentation supplement.

## GitHub Actions and CI supply chain

The inspected hardening workflow uses:

- `actions/checkout@v4`
- `actions/setup-node@v4`
- Node 22
- `npm ci`
- repository quality/security/API/database/build commands

### SUPPLY-001 — third-party actions use mutable major tags

- Status: `open`
- Severity: Low supply-chain hardening opportunity
- Evidence: `checkout` and `setup-node` are referenced by major version tags rather than immutable commit SHAs
- Verified compromise: no
- Risk: upstream tag movement or account compromise can change executed workflow code without a repository diff
- Safe remediation: pin each action to a reviewed immutable commit SHA and retain a comment with the human-readable release version; use a controlled update mechanism
- Breaking-change risk: low but non-zero; runner behavior and cache semantics must be verified
- Test plan: run the complete hardening workflow on the audit branch after pinning and compare logs/artifacts
- Current action: no workflow change, because the executable CI baseline is not available and this is not a verified active compromise

## Registry, provenance and lifecycle scripts

| Control | Status | Notes |
|---|---|---|
| Committed npm lockfile | verified | supports deterministic resolution when registry content is available |
| Root custom lifecycle scripts | verified absent in inspected manifest | transitive package lifecycle scripts still require installation-time observation |
| `.npmrc` policy | unverified | no canonical registry/provenance policy was established by this supplement |
| Package provenance/signatures | unverified | no install/provenance command was executed |
| Registry allowlist | unverified | package mirror behavior was previously a blocker |
| Automatic `npm audit fix` | not used | avoids uncontrolled dependency/lockfile rewrites |
| Dependency overrides | source-inspection required | no change made; each override must be tied to a parent chain and test plan |
| Vendored/generated code | partially reviewed | complete provenance and regeneration proof remains part of blocked toolchain checks |

## Secret-management boundary

The repository uses environment variables and database-held per-company/provider configuration for multiple secrets. The dedicated `quality/API_CONFIGURATION.md` lists the known configuration classes and exposure rules.

Dependency and supply-chain verification specifically requires:

- no secrets in `NEXT_PUBLIC_*` values;
- no service-role key in client bundles;
- no production credentials in fixtures, generated examples, logs or workflow files;
- immutable and least-privilege CI credentials;
- secret rotation after any confirmed disclosure;
- provider-specific webhook secret rotation without accepting an indefinite fallback.

These controls were not all dynamically proven in this supplement.

## Required safe verification sequence

Run only in an approved checkout/CI environment:

```bash
npm ci
npm audit --json
npm explain brace-expansion
npm run lint
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm test
npm run db:migrations:check
npm run security:rbac
npm run api:compatibility
npm run api:release:verify
npm run api:runtime:parity
npm run ops:hardening-regression
npm run gridex:production-route-readiness-regression
npm run gridex:rls-multisite-metering-billing-regression
npm run security:audit-production
npm run build
```

Add the repository-approved SAST and secret-scanning commands when configured. Preserve exit codes, tool versions, registry identity, lockfile hash, complete finding identifiers and artifact scope.

## Credentials and possible cost

The Markdown skills did not require separate credentials or create a direct charge. Executable verification can require:

- GitHub Actions/security products and associated plan/minute usage
- approved npm registry or package mirror access
- Supabase/Vercel preview or staging credentials
- commercial SAST, secret-scanning or monitoring products if selected
- external provider test traffic for end-to-end call-path verification

## Verdict

Dependency and supply-chain readiness remains **blocked from full verification**. The branch has a deterministic npm lockfile and a broad hardening workflow, but no current successful install/audit/SAST/build evidence is available. A transitive `brace-expansion` advisory-range presence is recorded conservatively as `unverified`, not as a proven production exploit. No dependency or lockfile changes were made.