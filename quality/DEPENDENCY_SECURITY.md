# Gridex OPS — Dependency, SAST and Supply-Chain Security

## Verdict

`blocked` from complete supply-chain verification.

The repository has a deterministic npm lockfile, successful clean installs in CI and a passing repository production-security audit in prior/focused hardening runs. Full advisory reachability, SAST, license inventory, provenance and complete secret-history scanning remain incomplete.

## Package and lockfile controls

Verified:

- npm is the package manager;
- `package-lock.json` is present;
- CI uses `npm ci` with Node.js 22;
- clean installation succeeds in GitHub Actions;
- no root `preinstall`, `install`, `postinstall`, `prepare` or `prepublishOnly` lifecycle script was identified in the inspected root manifest;
- no automatic `npm audit fix --force` or mass dependency rewrite was performed.

The expanded V3 workflow runs `npm run security:audit-production` after API and contract checks.

## Dependency advisory evidence

Earlier lockfile inspection identified advisory-range `brace-expansion` versions in development dependency trees. This was not promoted to Critical or High because:

- inspected occurrences were transitive/dev-side;
- the installed dependency tree and exact public-runtime reachability were not independently proven with `npm explain` in this connector session;
- no attacker-controlled production call path was established.

Required follow-up:

```bash
npm audit --json
npm explain brace-expansion
npm ls brace-expansion
```

Then map each advisory to the actual runtime/build/test path before selecting the narrowest compatible upgrade.

## SAST and secret scanning

| Control | Status | Evidence/blocker |
|---|---|---|
| Repository production security script | included in expanded CI; prior hardening run passed | project-specific static checks, not general SAST |
| General SAST | `blocked` | no repository-approved scanner execution available |
| Current-tree secret scan | `blocked` | no complete scanner run |
| Full Git-history secret scan | `blocked` | no authenticated local clone/history scanner |
| Dependabot alert reconciliation | `blocked` | API returned 403/security product unavailable |
| License scan | `blocked` | no approved license inventory command run |
| SBOM/provenance | `unverified` | no generated SBOM/attestation inspected |

No secret value was added by the audit. Reports contain names of environment variables only.

## GitHub Actions

Observed third-party actions:

- `actions/checkout@v4`
- `actions/setup-node@v4`

Status: `unverified` hardening gap.

Mutable major tags are common but do not provide immutable provenance. After the expanded workflow is green, pin each action to a reviewed commit SHA and retain the human-readable version in a comment or dependency-management policy.

No compromise was verified.

## Installed Agent Skills

The four requested V3 skills were installed as Markdown-only instruction files and recorded in `skills-lock.json` with upstream source, pinned source commit and SHA-256:

- `doubt-driven-development`
- `performance-optimization`
- `documentation-and-adrs`
- `sql-optimization-patterns`

Manual source inspection found no embedded credential, auto-executing script or direct payment requirement. `skill-scanner` was not installed, so automated skill scanning remains unavailable. No external Gemini/Codex CLI was invoked.

## Generated and vendored content

Verified contract-generation/release mechanisms include:

- current OpenAPI snapshots;
- generated TypeScript definitions;
- release manifests/checksums;
- immutable version snapshots and routes;
- compatibility/release scripts.

V3 found and fixed incomplete materialization of version `2026-08-05.2`. This is tracked as `BUG-006`.

`.patch-backups` and other historical/generated copies increase search noise and can preserve stale vulnerable patterns. They were not treated as executable source without build/import evidence. Their retention policy should be documented and reviewed before deletion.

## Parser and deserialization boundaries

Reviewed API helpers use bounded JSON parsing and explicit validation in key paths. The portal-sync controlled-error regression is now part of CI. Full repository coverage of archive, XML/EDIEL, MIME/mail, PDF and file-upload parsers remains incomplete and should be included in SAST/fuzzing or targeted negative tests.

## Safe remediation rules

For every future dependency finding:

1. identify exact direct/transitive package and installed version;
2. establish production, build or test reachability;
3. identify the smallest safe target version;
4. review breaking changes and lockfile delta;
5. run typecheck, lint, full tests, build and domain regressions;
6. avoid uncontrolled force upgrades;
7. record advisory, exposure and verification in this report/change log.

## Required next steps

1. Run `npm audit --json`, `npm explain` and approved reachability analysis in a controlled checkout.
2. Enable/access Dependabot alerts or document the chosen equivalent.
3. Run approved SAST and current-tree/full-history secret scans.
4. Produce an SBOM and license inventory if required by deployment/compliance policy.
5. Pin GitHub Actions to immutable reviewed commits.
6. Review historical backup/generated directories for execution and retention policy.

## Readiness impact

Supply-chain controls support further testing but remain insufficient for production certification.
