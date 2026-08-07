# Remediation plan

Do not merge audit reports as remediation. Create one branch/PR per finding or tightly coupled finding group from latest `origin/main`. No automatic merges.

| Order | Finding ID | Severity | Action | Suggested branch | Dependency | Verification requirement |
|---:|---|---|---|---|---|---|
| 1 | `GRIDEX-AUD-001` | High | Replace global customer-document storage policies with company/customer/path-scoped policies and separate CRUD permissions. | `remediation/gridex-ops-aud-001-document-storage-isolation` | Canonical path/consumer inventory | SQL + Supabase Storage two-tenant CRUD, inactive/suspended, platform/service tests, staging app smoke, log review. |
| 2 | `GRIDEX-AUD-002` | High | Canonicalize all quote hash inputs and preserve hash-version/evidence compatibility. | `remediation/gridex-ops-aud-002-quote-canonicalization` | Contract compatibility decision | Unit fixtures, create/read/validate/application E2E, external tenant compile, exact error/OpenAPI checks. |
| 3 | `GRIDEX-AUD-003` | High | Build immutable complete migration inventory/ledger/manifest mapping and clean replay proof. | `remediation/gridex-ops-aud-003-migration-provenance` | Non-production branch access | Zero/baseline replay, schema/RLS/function/index/type fingerprint, rollback/forward-fix drill. |
| 4 | `GRIDEX-AUD-004`, `007` | Medium | Protect main and make complete exact-head workflows required. | `remediation/gridex-ops-aud-004-ci-protection` | Repository admin permission | Deliberately failing PR fixtures prove each gate blocks; deployment environment approvals. |
| 5 | `GRIDEX-AUD-006` | Medium | Repair deterministic fingerprint derivation/atomic EDIEL cache refresh. | `remediation/gridex-ops-aud-006-ediel-fingerprint` | Provider fixture | Missing/invalid/valid/retry tests, no partial state, worker/app smoke, redacted logs. |
| 6 | `GRIDEX-AUD-005` | Medium | Reduce OTP expiry and test auth UX/security. | `remediation/gridex-ops-aud-005-otp-expiry` | Auth admin and non-prod test users | Fresh/expired/reused OTP across signup/login/reset/invite; production rollback value recorded. |
| 7 | `GRIDEX-AUD-009` | Medium | Implement log field allowlists/redaction, retention and access controls. | `remediation/gridex-ops-aud-009-log-privacy` | Log provider inventory/legal retention | Captured test logs contain safe IDs but no secrets/PII/payloads; incident export test. |
| 8 | `GRIDEX-AUD-008` | Medium | Profile and optimize grid-owner view/completion RPC. | `remediation/gridex-ops-aud-008-grid-owner-performance` | Representative non-prod data | Before/after plans, latency variance, freshness, role/RLS and concurrency tests. |
| 9 | `GRIDEX-AUD-010` | Medium likely | Trace and deduplicate auth/session resolution safely. | `remediation/gridex-ops-aud-010-auth-call-amplification` | Browser/server tracing | Calls/navigation, role revocation freshness, logout and cross-tenant cache tests. |
| 10 | `GRIDEX-AUD-011` | Medium blocked | Obtain read-only staging/production and Vercel evidence; run parity/post-deploy checks. | `verification/gridex-ops-production-parity` | Authorized credentials/change window | No mutation; ledger/schema/Auth/OpenAPI/deployed SHA and critical role/quote/portal checks. |
| 11 | `GRIDEX-AUD-012` | Low | Regenerate verified agent memory from current source/release state. | `docs/gridex-ops-agent-memory-freshness` | Release metadata | CI freshness check; human review. |
| 12 | `GRIDEX-AUD-013` | Low likely | Characterize and incrementally split customer application orchestration. | `refactor/gridex-ops-application-orchestration` | Findings 001/002 stabilized | Full characterization, idempotency, two-tenant, legal/POA/email side-effect tests; no mixed behavior change. |
| 13 | `GRIDEX-AUD-015` | Informational | Classify global reference/RBAC tables and narrow any sensitive exposure. | `hardening/gridex-ops-global-reference-classification` | Data owner approval | Column classification and read/write role matrix. |
| 14 | `GRIDEX-AUD-014` | Informational | Close stale advisor rows and automate current-catalog validation. | `chore/gridex-ops-advisor-validation` | None | Advisor output mapped to `to_regclass`, current indexes/policies and consumer query. |

## Required sequence rules

- Stabilize tenant document isolation and quote correctness before broad refactors.
- Reconcile migration provenance before any production database remediation.
- Never weaken RLS or expose service role for performance.
- Never modify immutable OpenAPI/releases or historical migrations in place.
- Use forward fixes for applied database changes.
- Run exact-head CI after the final evidence commit.
- Production closure requires post-deploy tests and log inspection; staging success alone is insufficient.

## Initial success criteria

The next production release should not proceed until findings 001-004 have approved remediation/verification, inherited `GRIDEX-OPS-BL-002` production status is known, and the deployed SHA/database/OpenAPI/client versions can be proven as one release.