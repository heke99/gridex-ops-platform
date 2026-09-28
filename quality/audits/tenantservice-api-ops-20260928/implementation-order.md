# Tenantservice implementation order — working checkpoint

This is a dependency order, not P0–P8 acceptance. The 75 original T/U requirements remain in `requirements.csv` with their full meaning.

| Package | User behavior | Necessary boundary and proof | External limit |
| --- | --- | --- | --- |
| P0/P1 | The correct tenant and customer are selected; disabled access stops new writes and replays. | Inventory gaps and threat model; signed assertion in API; active OPS/Auth context and DB grants. | Real issuer, enrollment, recovery and revocation authority not configured. |
| P2a | Staff and a delegated customer change allowed contact details and see one saved revision. | Shared transactional RPC with tenant/customer/actor/revision checks; primary relation, canonical fields, command result, audit and outbox; negative native/API/browser tests. | API remains fail-closed until issuer and customer binding exist. |
| P2b/P3 | Facility and billing changes cannot create split results or rewrite historical invoices. | Move remaining writers onto bounded commands; shared effective billing resolver and partner sync jobs; concurrent lock and replay tests. | Real partner delivery not enabled. |
| P4 | Customer web, phone and OPS use the same case and history. | Explicit publication, messages and attachments; operator identity evidence and channel-specific attribution; tenant-isolated browser and DB tests. | No real customer communication. |
| P5/P6 | OPS actions work and API behavior is accurately documented. | Classify actual UI handlers, verify persistence and access; versioned OpenAPI, client parity and isolated reference flow. | Published release requires its own acceptance. |
| P7/P8 | The verified package is safe to roll out tenant by tenant. | Security, performance, migration/upgrade, backfill, rollback and incident evidence. | Production migration, traffic and merge require separate authority. |

## Active diagnosis and P2a choice

OPS `36446849064`, job `109011261352`, on `c9d9ac47` failed 3/382 native tests in the document-reference suite. The `before_append/delete` trace showed `recordedAt=15:57:08.435088` and JS `startedAt=15:57:08.435Z`; the SQL requires `started >= recorded_at`. The later two failures were downstream `unconfirmed` captures. A targeted test reproduced the submillisecond rejection; the bounded application correction on `4d336b6a2486fb82967d23687e6c53a0023c4339` is locally green (16/16, app/test typecheck and scoped lint). Exact-head OPS run `36449390788` passed verify `109019928308`, quality-release-gates `109019927821` and clean-migration-replay `109019928221`. Tenant integrity `36449390849`, public browser/quality `36449390539`, Ediel `36449390582` and full E2E `36449390625` passed; crawler `36449390708` was skipped. This resolves the observed replay failure, not the tenantservice acceptance matrix.

P2a candidate uses `canonical_command_results`, `canonical_audit_events`, `canonical_domain_events` and `canonical_event_outbox` in the same PostgreSQL transaction. The primary-contact revision is checked under a locked customer row. OPS uses the authenticated server actor plus selected tenant permission; API uses the verified customer assertion and active account/client. Both invoke the same SQL command with different checked actor modes. The OPS profile form no longer writes contact fields and the API profile-update route directs contact-only requests to the command with `expected_contact_revision`. Mixed contact/facility/other-profile requests are rejected. Secondary contacts, other legacy writers, legal identity, billing and facility data remain outside P2a and must be handled before full P2 acceptance. The SQL fixture covers phone-only, parity, tenant/customer/contact mismatch, stale revision, rollback after late audit collision, committed replay and revocation; it awaits clean replay and generated type/schema parity. There is no real issuer configuration.

## Verification boundary

The first P2a candidate passed 13 focused mock/contract tests, app/test typecheck, scoped lint, migration checksum integrity and public API contract static check on Node 22. These do not prove SQL execution, concurrent transactions, generated schema parity, browser behavior or production access. Exact commit/run IDs and any failures belong in the subsequent checkpoint after automatic CI.
