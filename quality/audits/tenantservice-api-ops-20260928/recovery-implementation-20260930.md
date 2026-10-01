# Tenantservice/API/OPS recovered implementation

Status: **IN_PROGRESS; candidate native/HTTP/browser/CI qualification pending**. This report supersedes the earlier local delivery checkpoint for the recovered task only. All original T01–T55/U01–U20 requirements remain. No complete phase or requirement is accepted by the number of passing tests.

## Preserved source and ownership

Remote predecessors independently checked: main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`, draft418 `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8`, draft422 `cc90678d45602d37db7f8edf9713597c66fee28a`. The fixed backup branches remain unchanged. Existing CI logs were read; they qualify their own tested checkout/merge trees, not this later candidate.

Recovered old delivery HEAD `da45651ae13b05c2552954fe949fa3e50cbad5bd` and165 relevant dirty/untracked files,12,327,099 bytes, copied into an isolated checkout with SHA256/byte checks. Original checkouts and unpushed histories remain unchanged. The local integration branch is `codex/tenantservice-recovery-integration-20260930`. Root alone integrates, updates common contracts/generated artifacts/workflows/memory and publishes without force to existing draft422. The published notifier migration is reused byte-for-byte; its OPS/API ancestry must both remain in the candidate.

Bounded ownership: address adapter/form/SQL/native; writer/RPC ACL fences/native; support expired-session read, closed intake and journey; billing initializer/country projection and selected-resource capability UI; site form/command/native; isolated older-schema upgrade/backup/restore fixtures. Independent reviews inspect separate owners' changes. No agent mutates a hosted database or resets a shared fixture.

## Confirmed defects and repairs under qualification

- The restored address writer persisted table DML and a separate audit, then returned no revision to a UI that requires a confirmed result. A new service-only address-book command supplies resource/session/permission checks, revision, idempotency and transactional audit/result/event/outbox. Actual browser and native postchecks are prepared for a winning creation, competing draft and subsequent edit.
- Authenticated table writer grants could avoid command permission/current-session/revision checks. A forward migration removes table and column write ACLs and fences every installed overload of the bounded legacy writer RPC names. The archive definer allowed tenant-free resolution/dry-run; actual archival success on the dumped schema was not established because its legacy archive relation may be absent. Native denial/effect-snapshot proof is pending.
- The site form used raw authenticated site DML followed by separate address/provenance/workflow/audit work. Its replacement must preserve current selected-resource authority, site revision and normalized address provenance, with local result/audit/intent atomicity.
- Billing initialization inferred email distribution from invoice_email and forced country SE, and a prerequisite invoice_email column was missing on canonical replay. Initialization now preserves explicit legacy country/invoice destination and the configured tenant delivery method; equal contract copies remain explicit. Customer country projection/guard is included in the correction.
- Billing final/replay returns now recheck actual session/client wall-clock expiry after the last local effect writes. Genuine two-connection late-audit blockers for both OPS and delegated API are prepared; their database execution is pending.
- Platform role alone enabled editors whose SQL requires actual company membership/permission. Selected-customer live capability projection makes these controls read-only when the current command would deny them.
- OPS support list reads did not check an existing session's elapsed not_after clock; the new service-only read gate runs before support/customer/publication queries. This is an expiry consistency defect, not evidence that GoTrue ignores deleted sessions.
- Fresh attachment intake allowed a publicly closed case when its internal state remained open. The closed-publication predicate preserves authorized completed replay. Browser journey and native afterchecks now include private quarantine, phone attribution, independently authorized staff billing, public response and revocation.

## Executed local evidence

Node22.23.3 matches the repository engine. Source checkpoints, rather than an uncreated future commit, identify the local results. The frozen runtime passed the complete local suite: **6,714 tests in454 files**, prescribed4GiB app typecheck, test typecheck and script typecheck. Full lint reported0 errors and101 existing warnings; later owned site/billing/address/support changes passed their scoped lint. RBAC24/24 and service-role ratchet passed. Production dependency audit passed with zero findings. Next/package lock/installed version16.3.8 were checked against official GHSA-vcvr-r3jv-pc5j (affected>=16.2.0,<16.3.6; fixed16.3.6); no version change was made merely on a prior report.

Paired release2026-09-30.2 finalization produced identical bytes on repeated same-input execution. Historical immutable releases were not edited. The dynamic registry/OpenAPI path normalizer was corrected for both bracket and brace parameters. Materialization, API docs, compatibility and local release verification passed. Served deployed bytes are a separate, pending boundary.

Focused adapter/action/pure regressions passed at their recorded checkpoints, including the missing-address RED and corrected revision return, billing initializer RED/GREEN, expired support read/closed intake and site direct-writer RED/GREEN. These results do not establish native transaction, real HTTP or interactive browser success. Newly prepared fixtures remain unexecuted until disposable CI.

Independent review additionally reproduced equivalent-uppercase UUID commands falsely reporting unconfirmed completion and site manual hints being dropped or misprojected after save. Normalization and all-outcome evidence/display corrections passed address85/85 and independently reviewed site36/36 tests. Site candidate conflicts now return a clear review notice while retaining the verified canonical address. Existing supplier-switch/readiness continuation consumers remain a separate integration gap; durable local intent is not immediate completion.

Migration integrity passed663 files/567 timestamp groups. Every published OPS baseline SQL file remains byte-identical. Ten new forward migrations are pinned to their actual frozen bytes. Upgrade/restore **plan-only** preflight passed the real baseline/archive/checksum checks; this is not a database upgrade or restore result. Current generated types/schema remain authentic prior OPS evidence and require new actual-candidate capture before the unchanged parity gates can pass.

## Environment and remaining evidence

Cached Supabase CLI2.101.0 is available; local Docker/psql are absent. Use the existing disposable GitHub CI Supabase stack for canonical replay, real SQL roles/two-connection lock waits, real Auth/HTTP/form actions and authentic schema/type generation. No manually authored generated schema/type edits are permitted. Upgrade/restore starts from pinned older OPS schema with representative existing synthetic data; backups/fixture fingerprints stay in RUNNER_TEMP and are never uploaded.

GitGuardian ggshield1.55.0 cannot authenticate: formal secret scan is **BLOCKED_AUTH**, not passed. Source preservation excludes environment files, keys, raw assertions and private fixture/log artifacts. Real issuer enrollment, verified telephone identity/risk policy, scanner verdict delivery, tenant website deployment and partner dispatch remain concrete external configuration boundaries. Missing dependencies must reject safely and must not block independent implementation.

Compatibility under investigation: the existing Ediel portal test graph uses service-role requests and directly inserts registered/billing book addresses. The new guard correctly denies that unmarked path; it needs a current-session command/canonical integration before this workflow can be called functional. No service-marker exception is granted. This does not concern the separately retained case/event gates or authorize Ediel activation.

No main merge, production migration, real customer communication, key rotation or Ediel activation. Draft418/422 stay open;310/421 are unchanged. After candidate qualification, record published head, actual tested checkout/tree, positive and negative proof and exact remaining work per original requirement, then continue the next feasible masterplan package.
