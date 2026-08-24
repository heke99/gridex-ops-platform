#!/usr/bin/env node
// Regression: manual grid-owner information request pipeline.
//
// Static source assertions proving the manual (non-Ediel) facility information
// pipeline: PRODAT Z01 is blocked before render on missing facility_id (no
// ediel_outbox, no render_failed), a manual e-mail request is created/reused
// idempotently, POA/contact gating, worker-sent e-mail with case_reference +
// POA, all inbound e-mail is persisted, tenant/entity correlation is fail-closed,
// safe facility apply vs needs_review vs protected identity, tenant Swedish-only
// UI vs superadmin diagnostics, and the required indexes.

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

// 6) Facility automation is manual-only: the former environment switch to an
// Ediel facility lookup is intentionally removed. The Edifact path may only
// be reached for requests explicitly configured with channel='ediel'.
const automation = read('lib/customer-operations/facilityLookupAutomation.ts')
ok(automation.includes('requestMissingFacilityInformation'), 'facility automation delegates missing facility to the manual orchestrator')
ok(automation.includes('intentionally removed'), 'facility automation documents that the Ediel channel switch is removed')
ok(!automation.includes('dispatchFacilityLookupEdifact'), 'facility automation never calls the Ediel dispatch path (manual-only)')
const edifactDispatchGuard = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
ok(edifactDispatchGuard.includes("request.channel !== 'ediel'"), 'Edifact facility dispatch hard-guards on the explicitly configured ediel channel')

// 7) Worker + cron.
const worker = read('lib/email/manualEmailOutbox.ts')
ok(worker.includes('processManualEmailOutbox') && worker.includes('getEmailProvider'), 'worker sends via the configured e-mail provider abstraction')
ok(worker.includes('provider_message_id') && worker.includes('advanceLinkedRequest'), 'worker records provider id and advances the linked request')
ok(worker.includes("status: 'sending'") && worker.includes('locked_by'), 'worker locks rows before sending')
const cron = read('app/api/internal/manual-email/outbox/process/route.ts')
ok(cron.includes('processManualEmailOutbox') && cron.includes('CRON_SECRET'), 'manual email cron route exists and is secret-gated')
ok(read('vercel.json').includes('/api/internal/manual-email/outbox/process'), 'manual email cron is scheduled in vercel.json')

// 8) Templates.
const templates = read('lib/email/manualGridOwnerTemplates.ts')
ok(templates.includes('facility_information_request'), 'templates include facility information request')
ok(templates.includes('{{case_reference}}') && templates.includes('Fullmakt bifogas'), 'facility template includes case reference + POA attached note')
ok(templates.includes('Anläggnings-ID') && templates.includes('Årsenergi'), 'facility template requests the required fields in Swedish')

// 9) Inbound ingestion + tenant-first correlation. GX-FIR is strong evidence,
// not a prerequisite; all mail is persisted before matching.
const inbound = read('lib/inbound-mail/manualInboundIngestion.ts')
const correlation = read('lib/inbound-mail/manualInboundCorrelation.ts')
ok(inbound.includes('persistRawInbound') && inbound.indexOf('persistRawInbound') < inbound.indexOf('resolveManualInboundCorrelation'), 'inbound persists raw e-mail before tenant/entity correlation')
ok(inbound.includes('extractCaseReference') && inbound.includes('GX-FIR-'), 'inbound still extracts GX-FIR as strong correlation evidence')
ok(correlation.includes('request_case_reference') && correlation.includes('request_reply_reference'), 'correlation supports case-reference and reply-header request evidence')
ok(correlation.includes('tenant_mailbox') && correlation.includes('unique_facility') && correlation.includes('unique_metering_point') && correlation.includes('unique_customer_number'), 'correlation ranks tenant mailbox, facility, metering point and customer-number evidence')
ok(correlation.includes('hardAmbiguous') && correlation.includes("resolutionStatus = 'ambiguous'"), 'correlation fails closed on conflicting tenant/entity evidence')
ok(correlation.includes('grid_owner_contact_channels') && correlation.includes('senderIsCredible'), 'correlation verifies the grid-owner sender in the resolved tenant')
ok(inbound.includes('manual_inbound_messages') && inbound.includes('inbound_operation_events'), 'inbound stores raw mail and the cross-transport orchestration index')
ok(inbound.includes('FACILITY_REQUEST_TYPES') && inbound.includes('correlation.senderCredible') && inbound.includes('applyManualFacilityResponse'), 'auto-apply is restricted to credible, matched canonical facility requests')

// 10) Parser (safe apply vs needs_review vs protected identity, then next-step engine).
const parser = read('lib/customer-operations/manualFacilityResponseParser.ts')
ok(parser.includes('needs_review') && parser.includes("outcome: 'applied'"), 'parser supports both safe apply and needs_review outcomes')
ok(parser.includes('protected_identity'), 'parser blocks auto-apply for protected identity')
ok(parser.includes('manually_verified_by_grid_owner'), 'parser marks facility data as manually verified by grid owner')
ok(parser.includes('completeFacilityLookupAndRunNextSteps'), 'parser triggers the canonical completion + next-step engine after a safe apply')
ok(parser.includes('isValidFacilityId') && parser.includes('confidence'), 'parser validates facility id format + confidence before applying')

// 11) Tenant UI.
const facilityPage = read('app/admin/facility-requests/page.tsx')
ok(facilityPage.includes('operationalStatusLabel') && facilityPage.includes('channelLabel'), 'tenant facility page maps operational status + channel to Swedish')
ok(facilityPage.includes('facility_identifier_lookup'), 'tenant facility page includes manual request type')
ok(facilityPage.includes('Ärendenummer') && facilityPage.includes('Fullmakt'), 'tenant facility page shows case reference + POA badge')

// 12) Superadmin UI.
const channelsPage = read('app/admin/network-owners/[id]/contact-channels/page.tsx')
ok(channelsPage.includes('requirePlatformAdminAccess') && channelsPage.includes('grid_owner_contact_channels'), 'superadmin contact-channels page is platform-admin gated')
const channelsActions = read('app/admin/network-owners/[id]/contact-channels/actions.ts')
ok(channelsActions.includes('requirePlatformAdminActionAccess') && channelsActions.includes('upsertGridOwnerContactChannelAction'), 'superadmin contact-channels actions are platform-admin gated')
const diagnostics = read('app/admin/manual-requests/page.tsx')
ok(diagnostics.includes('requirePlatformAdminAccess') && diagnostics.includes('provider_message_id'), 'superadmin manual-request diagnostics surface exists with technical fields')
ok(diagnostics.includes('Inkommande korrelationskö') && diagnostics.includes('tenant_resolution_method') && diagnostics.includes('entity_resolution_method'), 'superadmin diagnostics surface unresolved tenant/entity correlation')

// 13) Package script entry.
ok(read('package.json').includes('gridex:manual-grid-owner-information-request-regression'), 'package script exposes regression command')

// 14) Contact-channel save must NOT use unsafe partial-index upsert.
const contactActions = read('app/admin/network-owners/[id]/contact-channels/actions.ts')
ok(!contactActions.includes('.upsert('), 'contact-channel save does not use PostgREST upsert against partial unique indexes')
ok(contactActions.includes('.is("company_id", null)') && contactActions.includes('.maybeSingle()') && contactActions.includes('.insert('), 'contact-channel save uses explicit select -> update/insert')
ok(contactActions.includes('EMAIL_RE') && contactActions.includes('Ogiltig e-postadress'), 'contact-channel save validates e-mail format with Swedish error')
ok(contactActions.includes('innan kontaktvägen aktiveras'), 'contact-channel save blocks enabling without a valid e-mail')

// 15) dispatch_status must not use the disallowed 'outbound_created'.
const facilityDispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
ok(!facilityDispatch.includes("'outbound_created'"), "facility dispatch no longer writes disallowed dispatch_status 'outbound_created'")

// 16) Manual operations mailbox: separate from contact channels and Ediel.
const mailboxMigration = read('supabase/migrations/20260626130000_gridex_manual_communication_mailboxes.sql')
ok(mailboxMigration.includes('create table if not exists public.manual_communication_mailboxes'), 'migration creates manual_communication_mailboxes (separate from ediel_mailboxes)')
ok(mailboxMigration.includes('manual_communication_mailboxes_no_plaintext_smtp_secret_check') && mailboxMigration.includes('manual_communication_mailboxes_no_plaintext_imap_secret_check'), 'manual mailbox forbids plaintext passwords (env-only secret references)')
ok(mailboxMigration.includes('manual_communication_mailboxes_default_uidx') && mailboxMigration.includes('manual_communication_mailboxes_override_uidx'), 'manual mailbox has platform-default + tenant-override partial unique indexes')
ok(mailboxMigration.includes('gridex_user_is_platform_admin') && mailboxMigration.includes('enable row level security'), 'manual mailbox is platform-only via RLS')
ok(mailboxMigration.includes('leverantorsbyte@gridex.se'), 'manual mailbox seeds the configurable default leverantorsbyte@gridex.se')
ok(mailboxMigration.includes('blocked_missing_manual_mailbox'), 'migration widens request status with blocked_missing_manual_mailbox')
ok(!/\bdrop table\b/i.test(mailboxMigration) && !/\bdelete from\b/i.test(mailboxMigration), 'manual mailbox migration is non-destructive')

// 17) Resolver: tenant override -> platform default by purpose; Ediel sender is reserved.
const mailboxResolver = read('lib/email/manualOperationsMailbox.ts')
ok(mailboxResolver.includes('resolveManualOperationsMailbox') && mailboxResolver.includes('CHANNEL_TO_MAILBOX_TYPE'), 'resolver maps channel -> manual mailbox purpose')
ok(mailboxResolver.includes('isEdielReservedSender') && mailboxResolver.includes(".from('ediel_mailboxes')"), 'resolver loads reserved Ediel senders from server configuration')
ok(mailboxResolver.includes('manual_communication_mailboxes'), 'resolver reads manual_communication_mailboxes')

// 18) Outbound uses manual mailbox, never Ediel sender.
ok(orchestrator.includes('resolveManualOperationsMailbox'), 'orchestrator resolves the manual operations mailbox for the sender')
ok(orchestrator.includes('blocked_missing_manual_mailbox') && orchestrator.includes('Manuell e-postbrevlåda saknas'), 'orchestrator blocks with the Swedish missing-manual-mailbox message')
ok(orchestrator.includes('blocked_missing_grid_owner_contact') && orchestrator.includes('blocked_missing_poa'), 'orchestrator keeps distinct missing-contact and missing-POA states')
ok(!orchestrator.includes('MANUAL_GRID_OWNER_FROM_EMAIL'), 'orchestrator no longer hardcodes an env sender')

// 19) Worker guards against the Ediel sender.
ok(worker.includes('isEdielReservedSender'), 'worker refuses to send manual e-mail from the Ediel reserved sender')
ok(!worker.includes('MANUAL_EMAIL_ALLOW_EDIEL_SENDER'), 'no emergency override can re-enable the Ediel sender for manual e-mail')

// 20) Worker route hides raw provider diagnostics from the HTTP response.
ok(cron.includes('scanned: result.scanned') && cron.includes('console.error'), 'manual email cron route returns counts only and logs provider errors')

// 21) Manual mailbox poller persists every mail. No GX-FIR-only drop remains.
const manualPoller = read('lib/inbound-mail/manualMailboxPoller.ts')
ok(manualPoller.includes('ingestManualInboundEmail') && manualPoller.includes('ImapFlow'), 'manual poller polls IMAP and calls manual inbound ingestion')
ok(manualPoller.includes('manual_communication_mailboxes') && manualPoller.includes('mailboxCompanyId'), 'manual poller passes tenant-specific mailbox scope only as evidence')
ok(manualPoller.includes('inReplyTo') && manualPoller.includes('references'), 'manual poller preserves RFC reply correlation headers')
ok(!manualPoller.includes('if (!extractCaseReference(email))'), 'manual poller no longer requires GX-FIR before ingestion')
ok(manualPoller.includes('Do not mark failed messages as Seen') && manualPoller.includes('messageFlagsAdd'), 'manual poller marks Seen only after successful ingestion')
ok(!manualPoller.includes(".from('ediel_outbox')") && !manualPoller.includes('parseInboundEmailContent') && !manualPoller.includes(".from('ediel_messages')"), 'manual poller never creates Ediel rows or parses EDIFACT')
const manualInboundCron = read('app/api/internal/manual-inbound/cron/route.ts')
ok(manualInboundCron.includes('MANUAL_INBOUND_CRON_SECRET') && manualInboundCron.includes('CRON_SECRET') && manualInboundCron.includes('timingSafeEqual'), 'manual inbound cron route is internal-secret protected')
ok(manualInboundCron.includes('runManualInboundMailEngine'), 'manual inbound cron drives the manual mailbox engine')
ok(read('vercel.json').includes('/api/internal/manual-inbound/cron'), 'manual inbound cron is scheduled in vercel.json')

// 22) Tenant customer card reads manual request summaries (no provider internals).
const summary = read('lib/customer-operations/manualRequestSummary.ts')
ok(summary.includes('listManualGridOwnerRequestSummaries') && summary.includes('grid_owner_information_requests'), 'manual request summary loader reads grid_owner_information_requests')
ok(summary.includes('E-post köad') && summary.includes('E-post skickad') && summary.includes('Väntar på svar från nätägaren') && summary.includes('Svar mottaget') && summary.includes('Uppgifter kompletterade') && summary.includes('Behöver granskning'), 'manual summary maps tenant Swedish statuses')
ok(!summary.includes('provider_message_id') && !summary.includes('body_html') && !summary.includes('body_text') && !summary.includes('parsed_payload'), 'manual summary excludes provider/raw fields')
const customerPage = read('app/admin/customers/[id]/page.tsx')
ok(customerPage.includes('listManualGridOwnerRequestSummaries') && customerPage.includes('manualRequests={manualRequestSummaries}'), 'customer card page loads + passes manual request summaries')
const businessCard = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
ok(businessCard.includes('manualRequests') && businessCard.includes('Begäran till nätägare'), 'customer card renders the manual request status panel')

// 23) Superadmin manual mailbox UI exists, platform-admin gated, env-only secrets.
const mailboxPage = read('app/admin/manual-mailboxes/page.tsx')
ok(mailboxPage.includes('requirePlatformAdminAccess') && mailboxPage.includes('manual_communication_mailboxes'), 'manual mailbox UI page is platform-admin gated')
ok(mailboxPage.includes('Manuell kommunikationsbrevlåda') && mailboxPage.includes('Avsändaradress') && mailboxPage.includes('secret reference'), 'manual mailbox UI uses the required Swedish labels')
const mailboxActions = read('app/admin/manual-mailboxes/actions.ts')
ok(mailboxActions.includes('requirePlatformAdminActionAccess') && mailboxActions.includes('validateSecretReference'), 'manual mailbox actions are platform-admin gated and validate secret references')
ok(mailboxActions.includes('Lösenord får inte sparas') && !mailboxActions.includes('.upsert('), 'manual mailbox actions reject plaintext passwords and avoid unsafe upsert')

// 24) Ediel mailbox stays Ediel-only.
ok(fs.existsSync(path.join(root, 'lib/inbound-mail/edielMailboxPoller.ts')), 'Ediel mailbox poller remains a separate engine (Ediel-only)')
ok(!manualPoller.includes('edielMailboxPoller') && !manualInboundCron.includes('runInboundEdielMailEngine'), 'manual inbound path does not invoke the Ediel mail engine')

// 25) Cross-transport inbound operations foundation.
const inboundMigration = read('supabase/migrations/20260824190000_gridex_inbound_operations_foundation.sql')
ok(inboundMigration.includes('create table if not exists public.inbound_operation_events'), 'inbound foundation creates cross-transport inbound_operation_events')
ok(inboundMigration.includes('source_transport') && inboundMigration.includes('tenant_resolution_status') && inboundMigration.includes('business_event_fingerprint'), 'inbound operation index carries transport, tenant resolution and business fingerprint')
ok(inboundMigration.includes('in_reply_to') && inboundMigration.includes('reference_message_ids') && inboundMigration.includes('correlation_evidence'), 'manual inbound rows retain reply/correlation evidence')
ok(inboundMigration.includes('enable row level security') && inboundMigration.includes('gridex_can_read_company'), 'inbound operation events are tenant-read-safe and service/platform-write gated')
ok(!/\bdrop table\b/i.test(inboundMigration) && !/\bdelete from\b/i.test(inboundMigration), 'inbound foundation is forward-only/non-destructive')

const webhook = read('app/api/webhooks/manual-inbound/route.ts')
ok(webhook.includes('inReplyTo') && webhook.includes('messageReferences') && webhook.includes('reference_message_ids'), 'signed inbound webhook preserves reply references')

console.log('Manual grid-owner information request regression passed')
