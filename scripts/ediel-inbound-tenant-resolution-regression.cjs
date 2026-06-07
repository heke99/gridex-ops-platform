#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  }
}

const sharedResolver = read('lib/ediel/tenant/resolveInboundTenant.ts')
const inboundProcessor = read('lib/inbound-mail/edielInboundProcessor.ts')
const emailParser = read('lib/inbound-mail/edielEmailParser.ts')
const matcher = read('lib/inbound-mail/inboundMatcher.ts')
const poller = read('lib/inbound-mail/edielMailboxPoller.ts')
const ackProcessing = read('lib/ediel/flows/inboundAckProcessing.ts')
const statusUpdater = read('lib/inbound-mail/inboundStatusUpdater.ts')
const runtimeFlow = read('lib/ediel/flows/inboundProcessing.ts')
const actions = read('app/admin/ediel/actions.ts')
const detailsPage = read('app/admin/ediel/messages/[id]/page.tsx')


assert(emailParser.includes('normalizeEdifactMessageCode'), 'inbound parser must normalize technical ACK message_code fallbacks')
assert(emailParser.includes("family === 'CONTRL'") && emailParser.includes("return 'CONTRL'"), 'CONTRL must always get message_code=CONTRL')
assert(emailParser.includes("family === 'APERAK'") && emailParser.includes("return 'APERAK'"), 'APERAK must have a non-null fallback message_code')
assert(emailParser.includes("family === 'UTILTS_ERR'") && emailParser.includes("return 'ERR'"), 'UTILTS_ERR must have a non-null ERR code fallback')
assert(emailParser.includes("tag === 'UCI'") && emailParser.includes("pushRecord(references, 'UCI'"), 'CONTRL UCI reference must be parsed for outbound correlation')
assert(emailParser.includes("tag === 'UCM'") && emailParser.includes("pushRecord(references, 'UCM'"), 'CONTRL UCM message reference must be parsed for outbound correlation')
assert(statusUpdater.includes('parsedMessageCode(input.parsed)'), 'all inbound ediel_messages inserts must use normalized non-null message_code')
assert(poller.includes('diagnosticMessageCode(row.message_family, row.message_code)'), 'diagnostic/unresolved ediel_message inserts must normalize message_code')
assert(poller.includes('let stored: { id: string; deduped: boolean } | null = null'), 'IMAP polling must continue per-message when one store fails')
assert(poller.includes('försöker rad-för-rad så IMAP-synk inte stoppas') && poller.includes('hoppar över raden och fortsätter IMAP-synk'), 'diagnostic inserts must not stop the full IMAP sync')
assert(matcher.includes("'UCI', 'UCM', 'ACW', 'TN', 'LI'"), 'inbound matcher must use CONTRL/APERAK reference qualifiers')
assert(ackProcessing.includes('nestedPayloadReferenceValues'), 'inbound ack processing must read nested parsed_payload.references')
assert(statusUpdater.includes('related_message_id: matchedOutboundEdielMessageId'), 'matched outbound ediel_message must be linked via related_message_id')
assert(statusUpdater.includes("input.outboundMatch.entityType === 'outbound_request'"), 'outbound_requests updates must only run for outbound_request matches')
assert(sharedResolver.includes('resolveInboundTenantFromIdentifiers'), 'shared inbound tenant resolver export is missing')
assert(sharedResolver.includes('transportEdielId') && sharedResolver.includes('marketActorEdielId'), 'resolver must separate transport and market actor Ediel IDs')
assert(sharedResolver.includes('subaddress_required') && sharedResolver.includes('subaddressMatches'), 'resolver must respect optional/required subaddress configuration')
assert(sharedResolver.includes('Flera tenant-träffar hittades med samma bolag'), 'same-company duplicate actor settings must be warning-only')
assert(inboundProcessor.includes('tenantResolution: tenant.shared'), 'inbound-mail import must persist shared tenant resolution')
assert(statusUpdater.includes('routing_unresolved_manual_review'), 'unresolved tenant routing must become manual review, not technical syntax failure')
assert(statusUpdater.includes('Ingen negativ CONTRL') || statusUpdater.includes('inte automatiskt skapa negativ CONTRL'), 'unresolved tenant routing must not auto-create negative CONTRL')
assert(runtimeFlow.indexOf('resolveInboundTenantForMessage') < runtimeFlow.indexOf('applyCanonicalRuntimeDecision'), 'tenant resolution must run before canonical runtime')
assert(runtimeFlow.includes('runtimeTenantResolutionSource') && runtimeFlow.includes('persisted'), 'runtime diagnostics must show persisted tenant-resolution source')
assert(runtimeFlow.includes('params.sourceMessage.message_family === "PRODAT"'), 'PRODAT application response plan must be allowed to create APERAK')
assert(actions.includes('recalculateInboundAckAction'), 'admin recalculate ACK action is missing')
assert(actions.includes('superseded') || actions.includes('Superseded'), 'recalculate action must supersede old draft/prepared/queued ACKs')
assert(detailsPage.includes('Tenant resolution') && detailsPage.includes('Räkna om ACK / runtime'), 'message detail UI must expose tenant diagnostics and recalculation')

if (process.exitCode) process.exit(process.exitCode)
console.log('ediel inbound tenant-resolution regression checks passed')
