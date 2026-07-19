/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 } }

const customerApplications = read('lib/website/customerApplications.ts')

const resendWebhookEvents = read('lib/email/resendWebhookEvents.ts')
assert(!resendWebhookEvents.includes(`log.event_key === 'contract.application_received'
    ? ['contract.confirmation_sent', 'contract.cooling_off_sent']`), 'application_received provider webhook must not infer legal sent events')
assert(resendWebhookEvents.includes("emitCommunicationSentDomainEvents(sentLog)"), 'Resend sent webhook must emit only actual sent communication domain events')
const emailDomainEvents = read('lib/email/emailDomainEvents.ts')
assert(emailDomainEvents.includes("'contract.confirmation_sent'") && emailDomainEvents.includes("'contract.cooling_off_sent'"), 'email sent domain events must be tied to canonical legal mail event keys')
assert(!emailDomainEvents.includes("'contract.application_received'"), 'application_received must not emit confirmation/cooling legal sent events')
assert(customerApplications.includes('contractLegalMailEvidenceReady'), 'website application must separate legal-mail readiness from switch readiness')
assert(customerApplications.includes('legal_email_pending'), 'legal mail failures must have precise warnings')
assert(customerApplications.includes("const contractLifecycleEvents = ['contract.application_received']"), 'website application must not emit confirmation/cooling sent webhooks before actual mail send')
assert(customerApplications.includes('normalizeRawApplication'), 'customer applications must normalize simplified payloads')
assert(customerApplications.includes('status: 422'), 'validation errors must return 422')
assert(customerApplications.includes('error_stage'), 'customer applications must expose error_stage')
assert(customerApplications.includes('communication_failed'), 'email failures must become warnings')
assert(customerApplications.includes('webhook_delivery_pending'), 'webhook failures must become warnings')
assert(customerApplications.includes('idempotent: true'), 'idempotency response must include full data')

const route = read('app/api/v1/website/customer-applications/route.ts')
assert(route.includes('error_stage'), 'route audit metadata must log error_stage')
assert(route.includes('error_code'), 'route audit metadata must log error_code')

const migration = read('supabase/migrations/20260609183000_batch_8_admin_operations_website_email_webhooks.sql')
assert(migration.includes('raw_payload'), 'migration must add raw_payload')
assert(migration.includes('sender_mode'), 'migration must add sender_mode')
assert(migration.includes('fallback_allowed'), 'migration must add fallback_allowed')
assert(migration.includes('manual_status'), 'migration must add webhook manual_status')

const websitePage = read('app/admin/website-applications/page.tsx')
assert(websitePage.includes('/admin/website-applications'), 'website applications page missing')
assert(websitePage.includes('error_stage'), 'website applications page must show error stage')

const webhookPage = read('app/admin/webhooks/deliveries/page.tsx')
assert(webhookPage.includes('resendWebhookDeliveryAction'), 'webhook deliveries page must support resend')
assert(webhookPage.includes('sendWebhookTestEventAction'), 'webhook deliveries page must support test events')

const companyPage = read('app/admin/companies/[id]/page.tsx')
assert(companyPage.includes('tenantReadiness'), 'company page must include tenant readiness')
assert(companyPage.includes('Sender mode'), 'company page must show sender mode')

const customerPage = read('app/admin/customers/[id]/page.tsx')
assert(customerPage.includes('CustomerWebsiteTraceabilityCard'), 'customer page must include website traceability card')
assert(customerPage.includes('Capway/debtor'), 'customer page must show Capway/debtor reference')

const docs = read('app/developers/customer-portal-api/page.tsx')
assert(docs.includes('422'), 'developer docs must document 422 validation errors')
assert(docs.includes('contract.confirmation_sent'), 'developer docs must document communication events')
// The docs were rewritten in Swedish: the duplicate policy is now the
// documented 409 duplicate_application semantics for committed applications.
assert(docs.includes('duplicate_application'), 'developer docs must warn about duplicate legal emails')

if (process.exitCode) process.exit(process.exitCode)
console.log('OK: Batch 8 operations regression passed')
