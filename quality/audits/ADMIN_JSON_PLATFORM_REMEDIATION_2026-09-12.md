# Platform JSON request remediation — Task 10b2c / masterplan 84

Status: IMPLEMENTED, locally verified for the bounded route matrix; exact hosted CI and independent review remain required. This does not close the full API, database, or release plan.

## Source and scope

Source commit c24a56ade933856b3edbcaa4d7d239ff2e614f38, tree cce11c83f3c2751494e74d924a7f68c4e30bd977. Downloaded the owned CI source artifact 10302052906 (run 34707843251); source archive SHA256 a873cb00686ffc4c15d38374a04cb337dcd279f91b16defde22eb29dd149ad23. Reconstructed local Git tree matches exactly. Local Git history is synthetic, not upstream commit history. Dependencies are from artifact 10301238629 with unchanged package-lock.json; local Node 22.16.0.

The five routes are platform spot-price import, grid-area master import, SVK geometry import, platform energy resolution, and internal Z01 repair. Complete route paths and the relevant importer/resolver/finalizer input contracts were inspected. No database schema, financial logic, company permissions, provider authorization or immutable migration is changed.

## Reproduction and repair

The original routes accepted unknown fields, silently discarded malformed rows/values, coerced or defaulted invalid control values, and buffered unbounded JSON. In Z01 repair, a malformed dry_run value could select the real repair path instead of a dry run.

All five routes now use the existing bounded reader after platform authentication. Strict schemas reject malformed/non-object JSON, unexpected keys, wrong transport types and conflicting aliases before domain effects. Byte limits apply to received stream bytes, including a lying Content-Length. Only explicit metadata objects remain extensible.

Preserved: platform scope, route response success envelopes, domain validation and SSRF checks, valid snake/camel/Swedish aliases, the spot endpoint's intentional comma-separated area support and omitted-area default, numeric SVK controls, explicit reconciliation retry, optional empty-body default SVK import, resolver metadata, and Z01's default dry run plus explicit boolean apply. SVK numeric bounds are taken from the existing importer (layer 0–50, page 1–250, offset 0–10,000,000). Financial and network-provider services are not executed by the tests.

## Executed verification

- 129 actual-route test cases: original source 104 expected failures / 25 passes; patched routes 129 passes.
- Tests include five streaming cancellation/size cases, authorization before body consumption, no effects for invalid requests, aliases, exact type checks, and real-repair prevention for invalid dry-run values.
- Test TypeScript check and targeted ESLint pass. The test RequestInit annotation was corrected to the installed NextRequest constructor type, without casts or suppressions.
- Full local suite: 212 files / 2,080 tests PASS, explicit exit code 0; all 40 existing billing evidence cases included. The first synchronous attempts exceeded the tool window; the final tracked run completed in 59.96 seconds. No tests or timeouts were relaxed.
- No independent reviewer or production-runtime acceptance is claimed.

## Skill routing and boundaries

Applied existing plan execution, code/contract review, systematic debugging, TDD, tenant/security invariants, source-tree verification, and completion verification. Reused existing quality/audit evidence rather than restarting a repository-wide audit. Next.js route documentation was read from the installed package. No UI/refactor/paid service/hook installation is involved. Subagent and external secret-scanner execution is not available in this runtime and is not claimed.

The temporary source/tooling export workflow is removed after the source and unstarted PostgreSQL image receipts were retrieved. No production data or credentials were requested by the workflow.
