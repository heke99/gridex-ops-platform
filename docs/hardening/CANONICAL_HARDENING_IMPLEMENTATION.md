# Canonical production hardening – implementation report

## Release decision

**NO-GO.** This delivery implements the highest-risk P0 protections and the additive canonical database foundations, but the complete Definition of Done cannot be claimed until staging migrations, authenticated RLS, full build/tests and real SMTP/IMAP/S/MIME/Ediel flows have been executed successfully.

## Implemented in this delivery

### Permissions and server actions

- Added explicit Ediel guards for read, test write, send, manual attestation, production activation/pause and profile changes.
- Added `requireAllPermissionsServer` so all-of and any-of semantics are no longer mixed.
- Removed `communication.read` as an alternative permission from the reviewed mutating Ediel, AGT, TGT, system-test, import and actor-testing actions.
- Added a static regression that fails when a reviewed write action reintroduces read-as-write permission semantics.

### Tenant scope and test/production isolation

- Made tenant scope explicit in the reviewed Ediel test-run and message attachment paths.
- Test runs capture a tenant-specific configuration snapshot.
- Test evidence rejects missing tenant, cross-tenant linkage, non-test environment, `test_flag != 1` and messages created before run start.
- Import mode now attaches only to the selected AGT or TGT path; production/default import creates no automatic test attachment.
- The unsafe historical message sync is limited to messages already linked to the same tenant and run.

### Evidence and transport semantics

- `prepared`, `queued` and `validated` are no longer accepted as sent evidence.
- Machine `passed` is committed through `canonical_record_actor_test_evidence`.
- Direct/manual `passed` is rejected.
- Manual verification is a separate request/approval flow with reason, evidence reference, requester, separate approver and immutable attempt.
- Added tenant-qualified foreign keys for run/message, attempt/message and attestation/attempt relations.
- Added immutable terminal attempts and a current-results view.

### Canonical lifecycle and production state foundations

- Added a fail-closed tenant operation decision RPC.
- Added an idempotent tenant lifecycle transition RPC with row locking, state version, canonical audit, domain event and outbox.
- Added `ediel_production_state` and a canonical production transition RPC.
- Updated the reviewed production actions to delegate to canonical RPCs rather than directly writing production flags on `companies`.
- Production prepare/live/resume is bound to the current configuration snapshot, readiness check and non-expired dry run.
- `ignorePaused` bypass usage was removed from the reviewed production actions.

### Configuration snapshots

- Added immutable tenant configuration snapshots and SHA-256 hash.
- Snapshot payload covers company identity, actor profiles, routes, mailbox bindings, certificates, active test configurations, active rule versions and engine version.
- Route/profile/mailbox/certificate/active-test-configuration changes create a new snapshot and stale old test/readiness/dry-run evidence.
- A configuration change blocks an existing prepared/live production state until readiness and dry run are repeated.

### Workers and outbound traffic

- Added operation-policy checks after claim and immediately before transport in the reviewed Ediel, email and webhook workers.
- Blocked rows are retained as `blocked_tenant_state` with reason, timestamp and tenant-status snapshot.

### Provisioning and access foundations

- Added idempotent tenant provisioning requests, provisioning jobs, capability defaults and onboarding task seeding.
- Added atomic tenant membership/user-role RPC with last-owner/last-admin invariants.
- Authorization is derived from database roles; a client-supplied actor role is not trusted.
- Owner assignment/modification is restricted to an owner or platform administrator.
- New active access requires an existing non-banned Auth user and active user profile.
- Invitation acceptance is blocked for non-operational tenant states on both insert and update.

### Migration and CI controls

- Added six forward-only migrations; no historical migration was edited.
- Updated the migration checksum manifest and retained all existing legacy collision allowlisting.
- Added static, DB-fixture and authenticated-RLS regression scripts.
- Replaced actor-test misuse of tenant pause/reactivation audit event names with Ediel test-specific events.
- Added preflight/quarantine reporting and conditional validation of `NOT VALID` constraints.

## Reviewed actions now delegating to canonical RPCs

- `saveActorProfileAction` → `canonical_save_ediel_actor_profile`
- `prepareProductionAction` → `canonical_transition_ediel_production`
- `activateLiveEdielAction` → `canonical_transition_ediel_production`
- `pauseProductionEdielAction` → `canonical_transition_ediel_production`
- `resumeProductionEdielAction` → `canonical_transition_ediel_production`
- `approveFirstLiveSendAction` → `canonical_approve_first_live_send`
- Machine evidence completion → `canonical_record_actor_test_evidence`
- Manual attestation request → `canonical_request_actor_test_attestation`
- Manual attestation approval → `canonical_approve_actor_test_attestation`

## Legacy fields retained as projections

The following fields remain for backward compatibility and must not be treated as independent truth after cutover:

- `companies.is_active`
- `companies.is_paused`
- `companies.live_ediel_enabled`
- `companies.ediel_production_enabled`
- `companies.production_status`
- `companies.ediel_production_status`
- `companies.live_approved_at`
- `companies.ediel_production_enabled_at`
- `ediel_actor_settings.application_reference`
- `ediel_actor_settings.default_application_reference`
- Existing mutable `actor_test_results` rows, which remain a compatibility projection over immutable attempts.

## Remaining work before GO

- Apply all new migrations to an isolated staging clone and resolve every preflight blocker without guessing tenant ownership.
- Wire every remaining company lifecycle UI/API write to `canonical_transition_tenant_lifecycle`; this delivery creates the RPC but does not prove every legacy lifecycle caller has cut over.
- Wire all company creation and user-management callers to the new provisioning/access RPCs; only the canonical foundation is delivered here.
- Consolidate the existing application readiness implementation into the requested single database `canonical_company_readiness(company_id, target_state)` contract. Current production actions use the hardened existing readiness service plus snapshot binding.
- Review every outbound worker beyond Ediel/email/webhooks, especially customer automation, facility lookup and any provider-specific transport worker.
- Migrate the remaining parallel actor-profile writers in `app/admin/companies/[id]/ediel-actions.ts` and `app/admin/ediel/settings/actions.ts` to a partial-update-safe canonical profile RPC. They still write legacy profile rows directly and therefore are not yet transactionally equivalent to `saveActorProfileAction`.
- Complete the caller cutover for the legacy company creation/invitation flow, which still supports temporary-password provisioning and direct rollback writes.
- Execute full dependency install, lint, typecheck, test and Next.js build.
- Execute authenticated RLS, concurrency, rollback, SMTP, IMAP, S/MIME and real AGT/TGT portal verification.
