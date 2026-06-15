# Batch N — Multi-tenant Edifact, Intake, IMAP, OCR & Data Integrity Hardening Testplan

## Scope

This testplan verifies the Batch N hardening work for tenant isolation, EDIFACT inbound/outbound processing, shared IMAP polling, safe document/OCR staging, and intake readiness consistency.

## SQL / migration tests

1. Create `customer_site` for company B with a `customer_id` owned by company A. Expected: blocked with `Cross-tenant reference blocked`.
2. Create `metering_point` for company B with a `site_id` or `customer_id` owned by company A. Expected: blocked.
3. Create `customer_contract` for company B with `customer_id`, `site_id`, `customer_site_id`, or `metering_point_id` owned by company A. Expected: blocked.
4. Create `billing_underlay` for company B with contract/site/metering point owned by company A. Expected: blocked when relevant columns exist.
5. Insert two `inbound_email_messages` for different `company_id` values with the same `sender_ediel_id` and `interchange_reference`. Expected: both are allowed when `company_id` differs.
6. Run `claim_inbound_processing_jobs(null, 10, 'worker-a')` and `claim_inbound_processing_jobs(null, 10, 'worker-b')` concurrently. Expected: each job is returned once only.
7. Run `claim_ediel_outbox_items(null, null, 10, 'worker-a')` and `claim_ediel_outbox_items(null, null, 10, 'worker-b')` concurrently. Expected: each outbox item is returned once only.

## Backend tests

1. Two tenants share one platform IMAP mailbox. Tenant A receives PRODAT and tenant B receives UTILTS. Expected: both are stored independently and tenant resolution uses EDIFACT data, not mailbox ownership.
2. Same `transaction_reference` appears in two tenants. Expected: no tenant-neutral dedupe; both messages survive.
3. Unknown receiver subaddress. Expected: unresolved/manual review, not guessed tenant.
4. Wrong CMS recipientInfo in encrypted inbound PRODAT. Expected: fail closed.
5. Outbound message with missing route/certificate/sender/subaddress. Expected: blocked before SMTP send.
6. CONTRL/APERAK/UTILTS_ERR response. Expected: linked to the correct original message and the correct company_id.
7. Inbound dedupe audit/evidence. Expected: stored dedupe scope is `mailbox_only` before tenant resolution and `tenant_environment` when company_id is known.

## Website/admin tests

1. Website application includes `company_id` in the body. Expected: ignored; API client company_id is used.
2. Website application selects a contract/public offer from another tenant. Expected: blocked.
3. Cross-tenant facility/anläggnings-id conflict. Expected: blocked or manual review, no auto-link.
4. Admin tenant A attempts to create/update EDIEL routes, certificates or technical settings without platform-admin permission. Expected: blocked by existing admin guards.
5. Same intake scenario via website and admin. Expected: same readiness blockers from shared readiness engine.
6. Supplier switch with missing fullmakt/legal acceptance/facility/metering point. Expected: blocked until completed.
7. Customer number, contract snapshot and legal acceptances. Expected: created with the same company_id.

## PDF/OCR tests

1. Stage a PDF/OCR parse. Expected: row in `document_ai_extractions` with parser vendor/version/hash/confidence fields.
2. OCR misreads Ediel ID. Expected: no overwrite of actor settings/masterdata; extraction stays in `needs_review`.
3. Low confidence extraction. Expected: `needs_review`.
4. Conflict with existing masterdata. Expected: `needs_review` and conflict reason.
5. Approve/apply. Expected: requires tenant-scoped action and writes audit metadata.
6. Tenant A OCR result applied to tenant B. Expected: blocked by company_id filters and DB triggers.

## Concurrency/E2E tests

1. Run inbound-mail cron twice in parallel. Expected: each stored mail/job is processed once.
2. Run EDIFACT outbox processor twice in parallel. Expected: each outbox row is sent once.
3. Simulate stale lock. Expected: only one new claim after timeout.
4. Simulate failed send. Expected: retry can happen later without double send.
5. Simulate several tenants in same environment/shared mailbox. Expected: tenant-specific routing, dedupe and outbox behavior remain isolated.

## Manual release checklist

- Run migration `20260615_multitenant_integrity_and_claim_locks.sql` in Supabase.
- Run `npm run typecheck`.
- Run `npm run build`.
- Run existing EDIEL regression scripts before activating multi-tenant production traffic.
- Confirm existing approved PRODAT/UTILTS/APERAK/CONTRL/UTILTS_ERR test cases remain green.
- Confirm `EDIEL_PLATFORM_MAINTENANCE_SECRET` is configured only if the company-scoped maintenance endpoint is needed.
- Confirm `OPENDATALOADER_API_URL` is unset until the OpenDataLoader adapter is wired to a reviewed runtime; staging is safe either way.
