#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(rel) {
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) throw new Error(`Required production source is missing: ${rel}`)
  return fs.readFileSync(file, 'utf8')
}

function requireAll(sourceName, source, invariants) {
  const failures = []
  for (const [label, needle] of invariants) {
    if (!source.includes(needle)) failures.push(`${sourceName}: ${label} (${JSON.stringify(needle)})`)
  }
  return failures
}

const companyActions = read('app/admin/companies/actions.ts')
const invitationFlow = read('lib/auth/companyInvitationFlow.ts')
const lifecycle = read('lib/tenant/lifecycle.ts')
const websiteApplicationRoute = read('app/api/v1/website/customer-applications/route.ts')

const failures = [
  ...requireAll('company actions', companyActions, [
    ['tenant provisioning must use the canonical RPC', "rpc('canonical_provision_company'"],
    ['tenant lifecycle must use the canonical transition RPC', "rpc('canonical_transition_tenant_lifecycle'"],
    ['company creation must seed email configuration', 'seedDefaultCompanyEmailConfiguration'],
    ['company creation must seed onboarding readiness tasks', 'seedCompanyOnboardingTasks'],
    ['company invitations must use the shared invitation flow', 'provisionCompanyInvitation'],
    ['test deletion must inspect delete blockers', 'getCompanyDeleteBlockers'],
    ['test deletion must use a terminal tombstone', "status: 'deleted_test_only'"],
    ['test deletion must explicitly preserve history', 'hardDeletePerformed: false'],
  ]),
  ...requireAll('invitation flow', invitationFlow, [
    ['invitation creation must use the canonical RPC', "rpc('canonical_create_tenant_invitation'"],
    ['invitation acceptance must use the shared access grant path', 'acceptCompanyInvitationAccess'],
    ['acceptance must be idempotent', 'tenant-invitation-accept:'],
    ['provider delivery must be separated from the durable intent', 'leased provisioning worker'],
    ['the logged-in identity must match the invitation e-mail', 'Den inloggade användaren matchar inte inbjudans e-postadress.'],
  ]),
  ...requireAll('tenant lifecycle', lifecycle, [
    ['paused tenants must not be writable', "return status === 'active' || status === 'onboarding'"],
    ['paused must remain visible for history/read access', "status === 'paused'"],
    ['closed must be terminal', 'closed: []'],
    ['deleted_test_only must be terminal', 'deleted_test_only: []'],
    ['pause semantics must stop API/webhooks/sales/automation/outbound', 'API, webhooks, försäljning, automation och outbound stoppas'],
  ]),
  ...requireAll('website customer application API', websiteApplicationRoute, [
    ['website writes must require the website_applications.write scope', "['website_applications.write']"],
    ['website intake must enforce tenant readiness', 'loadTenantWebsiteFlowReadiness'],
    ['payload must be bound to authenticated tenant context', 'bindPayloadToTenant'],
    ['website intake must support idempotency keys', "request.headers.get('idempotency-key')"],
    ['website intake must schedule usage telemetry off the response-critical path', 'scheduleUsageEvent'],
  ]),
]

if (failures.length > 0) {
  console.error('Gridex tenant platform E2E contract regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Gridex tenant platform E2E contract regression passed.')
console.log('Locked invariants: canonical provisioning/invitations/lifecycle, fail-closed pause, tombstone deletion, tenant-bound website intake and idempotency.')
