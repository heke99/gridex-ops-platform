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
// The parser now routes safe applies through the ONE canonical facility
// completion path (completeFacilityLookupAndRunNextSteps), which clears
// blockers, refreshes the intake orchestrator and runs the next-step engine.
ok(parser.includes('completeFacilityLookupAndRunNextSteps'), 'parser triggers the canonical completion + next-step engine after a safe apply')
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

// 14) Check 1 hotfix: contact-channel save must NOT use unsafe partial-index upsert.
const contactActions = read('app/admin/network-owners/[id]/contact-channels/actions.ts')
ok(!contactActions.includes('.upsert('), 'contact-channel save does not use PostgREST upsert against partial unique indexes')
ok(contactActions.includes('.is("company_id", null)') && contactActions.includes('.maybeSingle()') && contactActions.includes('.insert('), 'contact-channel save uses explicit select -> update/insert')
ok(contactActions.includes('EMAIL_RE') && contactActions.includes('Ogiltig e-postadress'), 'contact-channel save validates e-mail format with Swedish error')
ok(contactActions.includes('innan kontaktvägen aktiveras'), 'contact-channel save blocks enabling without a valid e-mail')

// 15) Issue A: dispatch_status must not use the disallowed 'outbound_created'.
const facilityDispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
ok(!facilityDispatch.includes("'outbound_created'"), "facility dispatch no longer writes disallowed dispatch_status 'outbound_created'")

// 16) Manual operations mailbox: SEPARATE concept from grid_owner_contact_channels and from the Ediel mailbox.
const mailboxMigration = read('supabase/migrations/20260626130000_gridex_manual_communication_mailboxes.sql')
ok(mailboxMigration.includes('create table if not exists public.manual_communication_mailboxes'), 'migration creates manual_communication_mailboxes (separate from ediel_mailboxes)')
ok(mailboxMigration.includes('manual_communication_mailboxes_no_plaintext_smtp_secret_check') && mailboxMigration.includes('manual_communication_mailboxes_no_plaintext_imap_secret_check'), 'manual mailbox forbids plaintext passwords (env-only secret references)')
ok(mailboxMigration.includes('manual_communication_mailboxes_default_uidx') && mailboxMigration.includes('manual_communication_mailboxes_override_uidx'), 'manual mailbox has platform-default + tenant-override partial unique indexes')
ok(mailboxMigration.includes('gridex_user_is_platform_admin') && mailboxMigration.includes('enable row level security'), 'manual mailbox is platform-only via RLS (credentials not tenant-readable)')
ok(mailboxMigration.includes('leverantorsbyte@gridex.se'), 'manual mailbox seeds the configurable default leverantorsbyte@gridex.se')
ok(mailboxMigration.includes('blocked_missing_manual_mailbox'), 'migration widens request status with blocked_missing_manual_mailbox')
ok(!/\bdrop table\b/i.test(mailboxMigration) && !/\bdelete from\b/i.test(mailboxMigration), 'manual mailbox migration is non-destructive')

// 17) Resolver: tenant override -> platform default by purpose; Ediel sender is reserved.
const mailboxResolver = read('lib/email/manualOperationsMailbox.ts')
ok(mailboxResolver.includes('resolveManualOperationsMailbox') && mailboxResolver.includes('CHANNEL_TO_MAILBOX_TYPE'), 'resolver maps channel -> manual mailbox purpose')
ok(mailboxResolver.includes('isEdielReservedSender') && mailboxResolver.includes('ediel@gridex.se'), 'resolver treats ediel@gridex.se as a reserved (non-manual) sender')
ok(mailboxResolver.includes('manual_communication_mailboxes'), 'resolver reads manual_communication_mailboxes (not ediel_mailboxes, not grid_owner_contact_channels)')

// 18) Outbound: orchestrator sends FROM the manual mailbox, never ediel@; blocks distinctly when missing.
ok(orchestrator.includes('resolveManualOperationsMailbox'), 'orchestrator resolves the manual operations mailbox for the sender')
ok(orchestrator.includes('blocked_missing_manual_mailbox') && orchestrator.includes('Manuell e-postbrevlåda saknas'), 'orchestrator blocks with the Swedish missing-manual-mailbox message')
ok(orchestrator.includes('blocked_missing_grid_owner_contact') && orchestrator.includes('blocked_missing_poa'), 'orchestrator keeps distinct missing-contact and missing-POA states')
ok(!orchestrator.includes('MANUAL_GRID_OWNER_FROM_EMAIL'), 'orchestrator no longer hardcodes an env sender (uses manual mailbox)')

// 19) Worker guards against the Ediel sender (no silent fallback to ediel@gridex.se).
ok(worker.includes('isEdielReservedSender'), 'worker refuses to send manual e-mail from the Ediel reserved sender')
ok(worker.includes('MANUAL_EMAIL_ALLOW_EDIEL_SENDER'), 'worker only allows the Ediel sender behind an explicit emergency override')

// 20) Worker route hides raw provider diagnostics from the HTTP response.
ok(cron.includes('scanned: result.scanned') && cron.includes('console.error'), 'manual email cron route returns counts only and logs provider errors (tenant-hidden)')

// 21) Check 4: manual mailbox IMAP poller routes GX-FIR replies to manual ingestion (Ediel mailbox untouched).
const manualPoller = read('lib/inbound-mail/manualMailboxPoller.ts')
ok(manualPoller.includes('ingestManualInboundEmail') && manualPoller.includes('ImapFlow'), 'manual poller polls IMAP and calls manual inbound ingestion')
ok(manualPoller.includes('extractCaseReference') && manualPoller.includes('manual_communication_mailboxes'), 'manual poller matches GX-FIR and polls manual_communication_mailboxes only')
ok(!manualPoller.includes(".from('ediel_outbox')") && !manualPoller.includes('parseInboundEmailContent') && !manualPoller.includes(".from('ediel_messages')"), 'manual poller never creates Ediel rows or parses EDIFACT')
const manualInboundCron = read('app/api/internal/manual-inbound/cron/route.ts')
ok(manualInboundCron.includes('MANUAL_INBOUND_CRON_SECRET') && manualInboundCron.includes('CRON_SECRET') && manualInboundCron.includes('timingSafeEqual'), 'manual inbound cron route is internal-secret protected')
ok(manualInboundCron.includes('runManualInboundMailEngine'), 'manual inbound cron drives the manual mailbox engine')
ok(read('vercel.json').includes('/api/internal/manual-inbound/cron'), 'manual inbound cron is scheduled in vercel.json')

// 22) Check 3: tenant customer card reads manual request summaries (Swedish, no provider internals).
const summary = read('lib/customer-operations/manualRequestSummary.ts')
ok(summary.includes('listManualGridOwnerRequestSummaries') && summary.includes('grid_owner_information_requests'), 'manual request summary loader reads grid_owner_information_requests')
ok(summary.includes('E-post köad') && summary.includes('E-post skickad') && summary.includes('Väntar på svar från nätägaren') && summary.includes('Svar mottaget') && summary.includes('Uppgifter kompletterade') && summary.includes('Behöver granskning'), 'manual summary maps tenant Swedish statuses')
ok(!summary.includes('provider_message_id') && !summary.includes('body_html') && !summary.includes('body_text') && !summary.includes('parsed_payload'), 'manual summary excludes provider/raw fields (lightweight + tenant-safe)')
const customerPage = read('app/admin/customers/[id]/page.tsx')
ok(customerPage.includes('listManualGridOwnerRequestSummaries') && customerPage.includes('manualRequests={manualRequestSummaries}'), 'customer card page loads + passes manual request summaries')
const businessCard = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
ok(businessCard.includes('manualRequests') && businessCard.includes('Begäran till nätägare'), 'customer card renders the manual request status panel')

// 23) Superadmin manual mailbox UI exists, platform-admin gated, env-only secrets, no plaintext.
const mailboxPage = read('app/admin/manual-mailboxes/page.tsx')
ok(mailboxPage.includes('requirePlatformAdminAccess') && mailboxPage.includes('manual_communication_mailboxes'), 'manual mailbox UI page is platform-admin gated')
ok(mailboxPage.includes('Manuell kommunikationsbrevlåda') && mailboxPage.includes('Avsändaradress') && mailboxPage.includes('secret reference'), 'manual mailbox UI uses the required Swedish labels')
const mailboxActions = read('app/admin/manual-mailboxes/actions.ts')
ok(mailboxActions.includes('requirePlatformAdminActionAccess') && mailboxActions.includes('validateSecretReference'), 'manual mailbox actions are platform-admin gated and validate secret references')
ok(mailboxActions.includes('Lösenord får inte sparas') && !mailboxActions.includes('.upsert('), 'manual mailbox actions reject plaintext passwords and avoid unsafe upsert')

// 24) Ediel mailbox stays Ediel-only (separate poller file; manual poller does not touch it).
ok(fs.existsSync(path.join(root, 'lib/inbound-mail/edielMailboxPoller.ts')), 'Ediel mailbox poller remains a separate engine (Ediel-only)')
ok(!manualPoller.includes('edielMailboxPoller') && !manualInboundCron.includes('runInboundEdielMailEngine'), 'manual inbound path does not invoke the Ediel mail engine')

console.log('Manual grid-owner information request regression passed')
