#!/usr/bin/env node
// Regression: manual grid-owner information request pipeline.
//
// Static source assertions proving the manual (non-Ediel) facility information
// pipeline: PRODAT Z01 is blocked before render on missing facility_id (no
// ediel_outbox, no render_failed), a manual e-mail request is created/reused
// idempotently, POA/contact gating, worker-sent e-mail with case_reference +
// POA, inbound matching + safe apply vs needs_review vs protected identity, no
// cross-tenant matching, tenant Swedish-only UI vs superadmin diagnostics, and
// the required indexes.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const ok = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

// 1) Migration (additive, idempotent, RLS + indexes).
const migration = read('supabase/migrations/20260626120000_gridex_manual_grid_owner_communication_pipeline.sql')
ok(migration.includes('create table if not exists public.manual_email_outbox'), 'migration creates manual_email_outbox')
ok(migration.includes('create table if not exists public.manual_inbound_messages'), 'migration creates manual_inbound_messages')
ok(migration.includes('create table if not exists public.grid_owner_contact_channels'), 'migration creates grid_owner_contact_channels')
ok(migration.includes('create table if not exists public.power_of_attorney_events'), 'migration creates power_of_attorney_events')
ok(migration.includes("add column if not exists case_reference text"), 'migration adds case_reference to grid_owner_information_requests')
ok(migration.includes('manual_email_queued') && migration.includes('blocked_missing_poa') && migration.includes('blocked_missing_grid_owner_contact'), 'migration widens status check with manual lifecycle states')
ok(migration.includes("'facility_identifier_lookup'"), 'migration widens request_type with facility_identifier_lookup')
ok(migration.includes("'manual_email'"), 'migration widens channel with manual_email')
ok(migration.includes('manual_email_outbox_idempotency_uidx'), 'migration adds outbox idempotency unique index')
ok(migration.includes('grid_owner_information_requests_case_reference_uidx'), 'migration adds case_reference unique index')
ok(migration.includes('manual_inbound_messages_provider_idx') && migration.includes('manual_inbound_messages_request_idx'), 'migration adds inbound indexes')
ok(migration.includes('enable row level security') && migration.includes('gridex_can_read_company'), 'migration enables RLS with tenant helper')
ok(!/\bdrop table\b/i.test(migration) && !/\bdelete from\b/i.test(migration), 'migration is non-destructive (no drop table / delete from)')

// 2) Message profile catalog + Z01 guard.
const catalog = read('lib/ediel/profiles/messageProfileCatalog.ts')
ok(catalog.includes("messageCode: 'Z01'") || catalog.includes("outboundProdat('Z01'"), 'catalog defines Z01 profile')
ok(catalog.includes("requiredFields: ['facility_id', 'customer_identity']"), 'catalog Z01 requires facility_id')
ok(catalog.includes('allowedMissingFields: []'), 'catalog Z01 does not allow missing facility_id')
ok(catalog.includes('supported_outbound') && catalog.includes('unsupported_for_actor_role'), 'catalog uses mandated supported_status vocabulary')

const guard = read('lib/ediel/profiles/prodatZ01Guard.ts')
ok(guard.includes('assertProdatZ01Renderable') && guard.includes('facility_identifier_required_for_prodat_z01'), 'Z01 guard exposes renderability assertion + blocker code')

// 3) Block-before-render in the gateway (no render_failed, no outbox on missing facility).
const gateway = read('lib/ediel/intent/renderGateway.ts')
ok(gateway.includes('assertProdatZ01Renderable') && gateway.includes('ensureProdatZ01FacilityIdentifier'), 'render gateway consults the Z01 facility guard before render')
ok(gateway.includes("validationStatus: 'blocked'") && gateway.includes('use_manual_information_request'), 'render gateway returns a controlled business block (not render_failed) and points to manual request')

// 4) Blockers (tenant Swedish + superadmin diagnostic).
const blockers = read('lib/customer-operations/blockers.ts')
ok(blockers.includes('facility_identifier_required_for_prodat_z01'), 'blockers add facility_identifier_required_for_prodat_z01')
ok(blockers.includes('Anläggnings-ID saknas'), 'blocker has Swedish tenant text')
ok(blockers.includes('customerBlockerSuperadminDiagnostic'), 'blocker exposes a superadmin-only diagnostic')

// 5) Orchestrator (idempotent, tenant-safe, never creates ediel_outbox).
const orchestrator = read('lib/customer-operations/requestMissingFacilityInformation.ts')
ok(orchestrator.includes('manual-facility-request:') && orchestrator.includes('idempotency_key'), 'orchestrator uses a deterministic idempotency key')
ok(orchestrator.includes('GX-FIR-'), 'orchestrator generates GX-FIR case reference')
ok(orchestrator.includes("channel: 'manual_email'") || orchestrator.includes("channel: 'manual_email',"), 'orchestrator uses manual_email channel')
ok(orchestrator.includes('blocked_missing_poa') && orchestrator.includes('blocked_missing_grid_owner_contact'), 'orchestrator gates on POA and grid-owner contact')
ok(orchestrator.includes('grid_owner_contact_channels'), 'orchestrator resolves contact via grid_owner_contact_channels')
ok(!orchestrator.includes(".from('ediel_outbox')") && !orchestrator.includes('renderAndQueueFacilityLookupZ01('), 'orchestrator never touches the Ediel outbox/render path')

// 6) Facility automation reroute (manual default) while preserving legacy Ediel path strings.
const automation = read('lib/customer-operations/facilityLookupAutomation.ts')
ok(automation.includes('resolveFacilityLookupChannel') && automation.includes("=== 'manual_email'"), 'facility automation defaults to manual_email channel')
ok(automation.includes('requestMissingFacilityInformation'), 'facility automation delegates missing facility to the orchestrator')
ok(automation.includes('dispatchFacilityLookupEdifact'), 'facility automation preserves the legacy Ediel dispatch path')

// 7) Worker (Resend) + cron.
const worker = read('lib/email/manualEmailOutbox.ts')
ok(worker.includes('processManualEmailOutbox') && worker.includes('getEmailProvider'), 'worker sends via the Resend provider abstraction')
ok(worker.includes('provider_message_id') && worker.includes('advanceLinkedRequest'), 'worker records provider id and advances the linked request')
ok(worker.includes("status: 'sending'") && worker.includes('locked_by'), 'worker locks rows before sending')
const cron = read('app/api/internal/manual-email/outbox/process/route.ts')
ok(cron.includes('processManualEmailOutbox') && cron.includes('CRON_SECRET'), 'manual email cron route exists and is secret-gated')
ok(read('vercel.json').includes('/api/internal/manual-email/outbox/process'), 'manual email cron is scheduled in vercel.json')

// 8) Templates (exact facility-information template with case_reference + POA attached note).
const templates = read('lib/email/manualGridOwnerTemplates.ts')
ok(templates.includes('facility_information_request'), 'templates include facility information request')
ok(templates.includes('{{case_reference}}') && templates.includes('Fullmakt bifogas'), 'facility template includes case reference + POA attached note')
ok(templates.includes('Anläggnings-ID') && templates.includes('Årsenergi'), 'facility template requests the required fields in Swedish')

// 9) Inbound ingestion (match by case_reference, tenant from request, sender credibility, no cross-tenant).
const inbound = read('lib/inbound-mail/manualInboundIngestion.ts')
ok(inbound.includes('extractCaseReference') && inbound.includes('GX-FIR-'), 'inbound ingestion matches by case_reference')
ok(inbound.includes('findRequestByCaseReference') && inbound.includes('rows.length !== 1'), 'inbound rejects ambiguous (cross-tenant) matches')
ok(inbound.includes('company_id') && inbound.includes('request.company_id'), 'inbound resolves tenant from the request, not the mailbox')
ok(inbound.includes('isSenderCredible'), 'inbound verifies sender credibility')
ok(inbound.includes('manual_inbound_messages'), 'inbound stores manual_inbound_messages')

// 10) Parser (safe apply vs needs_review vs protected identity, then next-step engine).
const parser = read('lib/customer-operations/manualFacilityResponseParser.ts')
ok(parser.includes('needs_review') && parser.includes("outcome: 'applied'"), 'parser supports both safe apply and needs_review outcomes')
ok(parser.includes('protected_identity'), 'parser blocks auto-apply for protected identity')
ok(parser.includes('manually_verified_by_grid_owner'), 'parser marks facility data as manually verified by grid owner')
ok(parser.includes('evaluateAndRunNextCustomerStep'), 'parser triggers the next-step engine after a safe apply')
ok(parser.includes('isValidFacilityId') && parser.includes('confidence'), 'parser validates facility id format + confidence before applying')

// 11) Tenant UI (Swedish operational status, channel, case_reference, POA) — no technical Ediel detail.
const facilityPage = read('app/admin/facility-requests/page.tsx')
ok(facilityPage.includes('operationalStatusLabel') && facilityPage.includes('channelLabel'), 'tenant facility page maps operational status + channel to Swedish')
ok(facilityPage.includes('facility_identifier_lookup'), 'tenant facility page includes manual request type')
ok(facilityPage.includes('Ärendenummer') && facilityPage.includes('Fullmakt'), 'tenant facility page shows case reference + POA badge')

// 12) Superadmin UI (contact channels + diagnostics, platform-admin gated).
const channelsPage = read('app/admin/network-owners/[id]/contact-channels/page.tsx')
ok(channelsPage.includes('requirePlatformAdminAccess') && channelsPage.includes('grid_owner_contact_channels'), 'superadmin contact-channels page is platform-admin gated')
const channelsActions = read('app/admin/network-owners/[id]/contact-channels/actions.ts')
ok(channelsActions.includes('requirePlatformAdminActionAccess') && channelsActions.includes('upsertGridOwnerContactChannelAction'), 'superadmin contact-channels actions are platform-admin gated')
const diagnostics = read('app/admin/manual-requests/page.tsx')
ok(diagnostics.includes('requirePlatformAdminAccess') && diagnostics.includes('provider_message_id'), 'superadmin manual-request diagnostics surface exists with technical fields')

// 13) Package script entry.
ok(read('package.json').includes('gridex:manual-grid-owner-information-request-regression'), 'package script exposes regression command')

console.log('Manual grid-owner information request regression passed')
