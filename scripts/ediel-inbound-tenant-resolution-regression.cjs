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
const statusUpdater = read('lib/inbound-mail/inboundStatusUpdater.ts')
const runtimeFlow = read('lib/ediel/flows/inboundProcessing.ts')
const actions = read('app/admin/ediel/actions.ts')
const detailsPage = read('app/admin/ediel/messages/[id]/page.tsx')

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
