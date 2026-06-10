#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const ignoredDirs = new Set(['node_modules', '.next', '.git', '.vercel'])
const allowedHistorical = new Set([
  'scripts/gridex-batch-8-1-live-schema-regression.cjs',
])

function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) throw new Error(`Missing file: ${rel}`)
  return fs.readFileSync(full, 'utf8')
}

function assertContains(rel, needles) {
  const text = read(rel)
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`${rel} saknar: ${needle}`)
  }
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

const forbidden = [
  { label: 'customer_metering_points', pattern: /customer_metering_points/ },
  { label: 'website_customer_applications.metadata', pattern: /website_customer_applications\.metadata/ },
  { label: 'integration_api_requests.path', pattern: /integration_api_requests\.path/ },
  { label: 'communication_logs.event_type', pattern: /communication_logs\.event_type/ },
  { label: 'communication_logs.from_email', pattern: /communication_logs\.from_email/ },
  { label: 'communication_logs.to_email', pattern: /communication_logs\.to_email/ },
  { label: 'communication_logs.error', pattern: /communication_logs\.error(?!_message)/ },
  { label: 'company_email_settings.from_email', pattern: /company_email_settings\.from_email/ },
  { label: 'company_email_settings.from_name', pattern: /company_email_settings\.from_name/ },
  { label: 'company_email_settings.domain_verification_status', pattern: /company_email_settings\.domain_verification_status/ },
]

for (const file of walk(root)) {
  const rel = path.relative(root, file)
  if (!/\.(ts|tsx|js|cjs|mjs|md|sql)$/.test(rel)) continue
  if (allowedHistorical.has(rel)) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) {
      throw new Error(`${rel} innehåller förbjudet gammalt schema-antagande: ${rule.label}`)
    }
  }
}

assertContains('lib/website/customerApplications.ts', [
  "from('metering_points')",
  'customer_site_id: site.id',
  "readingFrequency = clean(metering?.reading_frequency) ?? 'monthly'",
  "measurementType = clean(metering?.measurement_type) ?? 'consumption'",
  'is_settlement_relevant: true',
  "data_quality_status: 'incomplete'",
  "verification_status: 'pending'",
  "onboarding_status: 'application_received'",
  'idempotent_failed',
  'incomplete_application',
  'confirmation_email_pending',
  'domain_event_pending',
  'simple_payload_normalized',
  'estimated_annual_consumption_kwh',
])

assertContains('lib/website/customerApplications.ts', [
  'facility_id: firstDefined',
  'metering_point_id: firstDefined',
  'ediel_metering_point_id: firstDefined',
  'site_facility_id: firstDefined',
  'expectsSiteOrMetering',
  'hasCompleteSiteAndMetering',
])

assertContains('lib/website/customerApplications.ts', [
  'raw_payload',
  'response_payload',
  'error_stage',
  'error_code',
  'error_message',
])

assertContains('lib/email/communicationLogs.ts', [
  'event_key',
  'template_key',
  'recipient_email',
  'sender_email',
  'reply_to_email',
  'error_message',
  'sender_mode',
  'template_version',
])

assertContains('lib/email/companyEmailSettings.ts', [
  'sender_name',
  'sender_email',
  'reply_to_email',
  'verification_status',
  'sender_mode',
  'fallback_allowed',
  'block_legal_mail_when_unverified',
  'dkim_status',
  'spf_status',
  'dmarc_status',
])

assertContains('lib/events/domainEvents.ts', [
  'event_type',
  'event_outbox',
  'event outbox enqueue skipped',
])

assertContains('lib/integrations/webhooks.ts', [
  'webhook delivery enqueue skipped because live schema is incomplete',
  'idempotency_key',
])

assertContains('lib/email/emailTemplates.ts', [
  'template_key',
  'body_html',
  'body_text',
  'language',
  'is_active',
])

assertContains('lib/admin/websiteIntegrationOps.ts', [
  'provider_customer_id',
  'provider_debtor_id',
  'provider_status',
  'dispute_count',
  'last_synced_at',
])

assertContains('app/admin/platform/api-clients/page.tsx', [
  "from('integration_api_requests')",
  'route',
])

assertContains('app/developers/customer-portal-api/page.tsx', [
  'failed idempotency ger 409 idempotent_failed',
  'public.metering_points',
  'external_customer_id krävs',
  'sender_email',
  'reply_to_email',
])

assertContains('docs/external-website-api-integration-guide.md', [
  'Batch 8.1 live-schema alignment',
  'failed idempotency ger 409 idempotent_failed',
  'public.metering_points',
  'sender_email',
  'reply_to_email',
  'debtRow amount = belopp exkl. moms',
  'vatCode = SE25',
])



assertContains('lib/email/domainVerification.ts', [
  'getOrCreateProviderDomain',
  'findDomainByName',
  'settingsPatchFromProviderResult',
  "senderMode: status === 'verified' ? 'verified_domain'",
  'blockLegalMailWhenUnverified',
])

assertContains('lib/email/providers/resendProvider.ts', [
  'partially_verified',
  'sendReady',
  'findDomainByName',
  'resend.domains.list',
  'Resend API-nyckel saknas',
])

assertContains('app/admin/companies/[id]/email-actions.ts', [
  "providerDomainId: null",
  "verificationStatus: 'not_started'",
  "senderMode: 'fallback_platform_sender'",
  'error instanceof Error ? error.message',
])

console.log('Gridex Batch 8.1 live schema regression passed.')
