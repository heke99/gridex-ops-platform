#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
const logsDir = path.join(artifactDir, 'logs')
fs.mkdirSync(logsDir, { recursive: true })

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageScripts = pkg.scripts || {}
const validModes = new Set(['smoke', 'full', 'runtime', 'all'])
const requested = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1]
  || process.env.GRIDEX_E2E_MODE
  || 'smoke'
if (!validModes.has(requested)) {
  console.error(`Unknown E2E mode ${JSON.stringify(requested)}. Use smoke, full, runtime or all.`)
  process.exit(2)
}

const npmStep = (id, category, script, description) => ({
  id,
  category,
  kind: 'npm',
  script,
  description,
})
const nodeStep = (id, category, file, args, description) => ({
  id,
  category,
  kind: 'node',
  file,
  args: args || [],
  description,
})

// The smoke suite is intentionally fast enough for every push while still
// touching every production boundary through existing Gridex regression gates.
const smoke = [
  nodeStep('tenant-platform-contract', 'tenant', 'scripts/gridex-tenant-platform-e2e-contract-regression.cjs', [], 'Locks canonical tenant, invitation, lifecycle and website intake invariants.'),
  npmStep('migrations', 'database', 'db:migrations:check', 'Migration integrity, public contracts and generated schema types.'),
  npmStep('tenant-model', 'tenant', 'tenant:multitenant:static', 'Canonical multi-tenant model and isolation contract.'),
  npmStep('tenant-source-of-truth', 'tenant', 'gridex:tenant-source-of-truth-regression', 'Tenant source-of-truth and scoping invariants.'),
  npmStep('test-production-separation', 'safety', 'gridex:test-production-separation-regression', 'Test/prod separation and outbound safety.'),
  npmStep('website-intake', 'customer_intake', 'gridex:multitenant-website-application-flow-regression', 'Multi-tenant website customer application flow.'),
  npmStep('route-readiness', 'ediel', 'gridex:production-route-readiness-regression', 'Production route materialization, send guard and tenant route isolation.'),
  npmStep('edifact-customer-flow', 'ediel', 'gridex:tenant-customer-edifact-completion-regression', 'Tenant customer EDIFACT completion flow.'),
  npmStep('metering', 'metering', 'gridex:multi-metering-values-regression', 'Multi-metering-value persistence and tenant mapping.'),
  npmStep('billing', 'billing', 'gridex:multi-site-billing-underlay-regression', 'Multi-site billing underlay flow.'),
  npmStep('portal-api', 'customer_portal', 'gridex:customer-portal-multi-site-api-regression', 'Customer portal multi-site API behavior.'),
  npmStep('rbac', 'security', 'security:rbac', 'RBAC and tenant access safety.'),
  npmStep('api-boundaries', 'api', 'api:error-boundaries', 'Canonical external API error boundaries.'),
  npmStep('typecheck', 'quality', 'typecheck', 'Application TypeScript correctness.'),
]

// Full is the release/nightly certificate. It composes the authoritative
// domain regressions already maintained in the repository instead of creating
// a second implementation of the business logic.
const fullOnly = [
  npmStep('runtime-readiness', 'database', 'db:runtime-readiness:check', 'Runtime database/schema readiness.'),
  npmStep('production-migration-readiness', 'database', 'db:migrations:production-readiness', 'Production migration readiness and drift checks.'),
  npmStep('canonical-onboarding', 'tenant', 'verify:canonical-onboarding', 'Canonical onboarding, authorization scopes, customer numbers and EDIEL onboarding readiness.'),
  npmStep('canonical-production-hardening', 'platform', 'ops:canonical-production-hardening', 'Canonical production hardening invariants.'),
  npmStep('emergency-access', 'security', 'ops:emergency-access-regression', 'Emergency/break-glass access safety.'),
  npmStep('runtime-consistency', 'platform', 'ops:canonical-runtime-consistency', 'Runtime consistency across production boundaries.'),

  npmStep('contract-lifecycle', 'contract', 'gridex:contract-lifecycle-repair-regression', 'Contract lifecycle and repair behavior.'),
  npmStep('contract-tenant-lifecycle', 'contract', 'gridex:contract-tenant-lifecycle-completion-regression', 'Contract behavior follows tenant lifecycle.'),
  npmStep('contract-delete-graph', 'contract', 'gridex:contract-delete-graph-completion-regression', 'Safe contract deletion graph and historical blockers.'),
  npmStep('contract-go-live', 'contract', 'verify:contract-go-live:static', 'Complete contract go-live static certificate.'),
  npmStep('contract-channel-publication', 'contract', 'verify:contract-channel-publication:static', 'Channel publication and API documentation sync.'),
  npmStep('contract-commercial-selection', 'pricing', 'verify:contract-commercial-selection:static', 'Commercial selection, pricing and build consistency.'),
  npmStep('customer-legal-package', 'legal', 'verify:customer-legal-package', 'Customer legal package, POA and acceptance contract.'),

  npmStep('website-full', 'customer_intake', 'verify:multitenant-website-application-flow:static', 'Website application API, review, continuation and tenant isolation.'),
  npmStep('website-quote-integrity', 'pricing', 'gridex:website-quote-integrity-regression', 'Quote/pricing integrity at the website boundary.'),
  npmStep('website-poa', 'legal', 'gridex:website-api-power-of-attorney-regression', 'Website/API power-of-attorney flow.'),
  npmStep('website-ops-chain', 'customer_intake', 'gridex:website-application-ops-chain-regression', 'Website application through OPS operational chain.'),
  npmStep('automatic-customer-intake', 'customer_intake', 'gridex:automatic-customer-intake-foundation-regression', 'Automatic customer intake foundation.'),
  npmStep('customer-intake-hardening', 'customer_intake', 'gridex:customer-intake-completion-hardening-regression', 'Customer intake completion and failure recovery.'),
  npmStep('price-area-assurance', 'pricing', 'gridex:price-area-assurance-regression', 'Price-area assurance and location trust boundary.'),
  npmStep('customer-info-chain', 'facility', 'gridex:customer-info-z01-chain-regression', 'Customer information and facility Z01 chain.'),
  npmStep('facility-preflight', 'facility', 'gridex:z01-facility-preflight-regression', 'Facility preflight before outbound operations.'),
  npmStep('missing-facility-blocker', 'facility', 'gridex:z01-missing-facility-controlled-blocker-regression', 'Missing facility fails closed rather than guessing.'),
  npmStep('manual-facility-workflow', 'facility', 'gridex:facility-lookup-manual-workflow-regression', 'Manual facility lookup workflow.'),
  npmStep('automatic-facility-edifact', 'facility', 'gridex:automatic-facility-lookup-edifact-dispatch-regression', 'Automatic facility lookup through EDIFACT dispatch.'),
  npmStep('inbound-facility-recognition', 'facility', 'gridex:inbound-facility-recognition-regression', 'Inbound facility information is recognized and linked canonically.'),

  npmStep('route-runtime-selection', 'ediel', 'gridex:route-runtime-selection-regression', 'Runtime route selection.'),
  npmStep('route-matrix', 'ediel', 'gridex:ediel-route-matrix-regression', 'EDIEL route matrix completeness.'),
  npmStep('ack-chain', 'ediel', 'gridex:ack-chain-regression', 'CONTRL/APERAK acknowledgment lifecycle.'),
  npmStep('inbound-tenant-resolution', 'ediel', 'gridex:edifact-inbound-tenant-resolution-regression', 'Inbound EDIFACT resolves to the correct tenant.'),
  npmStep('shared-mailbox-resolution', 'ediel', 'gridex:shared-mailbox-tenant-resolution-regression', 'Shared mailbox messages retain tenant isolation.'),
  npmStep('ediel-full-business-pipeline', 'ediel', 'gridex:ediel-intent-pipeline-full-regression', 'EDIEL intents, PRODAT support, supplier switch, ACK, UTILTS, reconciliation and eSett XML.'),
  npmStep('supplier-business', 'operations', 'gridex:supplier-business-full-regression', 'Supplier/ombud business operations and automation.'),

  npmStep('invoice-customer-number', 'billing', 'gridex:invoice-partner-customer-number-regression', 'Invoice/customer-number canonical linkage.'),
  npmStep('ediel-metering-billing-automation', 'billing', 'gridex:ediel-automation-metering-billing-regression', 'EDIEL automation through metering and billing.'),
  npmStep('settlement-export', 'billing', 'gridex:production-settlement-export-regression', 'Production settlement/export flow.'),
  npmStep('metering-billing-rls', 'billing', 'gridex:rls-multisite-metering-billing-regression', 'RLS isolation for metering and billing.'),
  npmStep('automation-idempotency', 'automation', 'gridex:automation-idempotency-multisite-regression', 'Automation is idempotent across multi-site customers.'),
  npmStep('messages-visibility', 'operations', 'gridex:messages-operations-visibility-regression', 'Operations/messages visibility and tenant scoping.'),
  npmStep('communication-source-of-truth', 'communications', 'gridex:communication-source-of-truth-regression', 'Communication status/source-of-truth.'),
  npmStep('mail-recipient-resolution', 'communications', 'gridex:manual-email-recipient-resolution-regression', 'Tenant-aware mail recipient resolution.'),
  npmStep('platform-contract-api-mail', 'communications', 'gridex:platform-tenant-contracts-api-mail-regression', 'Platform, tenant, contracts, API and mail integration boundary.'),
  npmStep('website-webhooks', 'webhooks', 'gridex:website-api-webhook-regression', 'Website API webhook contract.'),

  npmStep('api-docs', 'api', 'api:docs', 'OpenAPI documentation generation/validation.'),
  npmStep('api-compatibility', 'api', 'api:compatibility', 'Backwards compatibility of public API.'),
  npmStep('api-release', 'api', 'api:release:verify', 'External API release contract.'),
  npmStep('api-runtime-parity', 'api', 'api:runtime:parity', 'Runtime routes match the canonical API contract.'),
  npmStep('api-error-registry', 'api', 'api:error-registry', 'Public API errors remain canonical and documented.'),
  npmStep('api-performance-tenant-gates', 'api', 'api:performance-tenant-gates', 'API performance and tenant gates.'),
  npmStep('rate-limits', 'security', 'gridex:rate-limit-regression', 'API rate limit contract.'),
  npmStep('system-health', 'release', 'gridex:system-health-regression', 'System health regression.'),
  npmStep('supabase-advisors', 'security', 'gridex:supabase-advisors-hardening-regression', 'Supabase advisor/security hardening.'),

  npmStep('lint', 'quality', 'lint', 'Lint and code-quality gate.'),
  npmStep('typecheck-scripts', 'quality', 'typecheck:scripts', 'E2E/operations script TypeScript correctness.'),
  npmStep('typecheck-tests', 'quality', 'typecheck:tests', 'Test TypeScript correctness.'),
  npmStep('unit-integration-tests', 'quality', 'test', 'Repository Vitest suite.'),
  npmStep('production-dependency-audit', 'security', 'security:audit-production', 'High-severity production dependency audit.'),
  npmStep('build', 'release', 'build', 'Production Next.js build.'),
]

const runtime = [
  nodeStep('fresh-tenant-runtime', 'runtime_tenant', 'scripts/gridex-tenant-runtime-e2e.mjs', [], 'Staging-only new-tenant canonical lifecycle and contract roundtrip.'),
]

function mergeUnique(...groups) {
  const seen = new Set()
  return groups.flat().filter((step) => {
    if (seen.has(step.id)) return false
    seen.add(step.id)
    return true
  })
}

const steps = requested === 'smoke'
  ? smoke
  : requested === 'full'
    ? mergeUnique(smoke, fullOnly)
    : requested === 'runtime'
      ? runtime
      : mergeUnique(smoke, fullOnly, runtime)

function secretValues() {
  const explicitNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'RESEND_API_KEY',
    'CRON_SECRET',
    'OPENAI_API_KEY',
  ]
  return explicitNames.map((name) => process.env[name]).filter((value) => typeof value === 'string' && value.length >= 8)
}

const secrets = secretValues()
function redact(input) {
  let output = String(input || '')
  for (const secret of secrets) output = output.split(secret).join('[REDACTED]')
  output = output
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]')
    .replace(/\b(sk[-_][A-Za-z0-9_-]{12,})\b/g, '[REDACTED]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1[REDACTED]@')
  return output
}

function slug(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function runStep(step) {
  if (step.kind === 'npm' && !Object.prototype.hasOwnProperty.call(packageScripts, step.script)) {
    return {
      ...step,
      status: 'failed',
      exit_code: 127,
      duration_ms: 0,
      log_file: null,
      error: `Required package.json script is missing: ${step.script}`,
    }
  }
  if (step.kind === 'node' && !fs.existsSync(path.join(root, step.file))) {
    return {
      ...step,
      status: 'failed',
      exit_code: 127,
      duration_ms: 0,
      log_file: null,
      error: `Required E2E script is missing: ${step.file}`,
    }
  }

  const started = Date.now()
  const command = step.kind === 'npm' ? 'npm' : process.execPath
  const args = step.kind === 'npm' ? ['run', step.script] : [step.file, ...(step.args || [])]
  console.log(`\n=== [${step.category}] ${step.id}: ${step.description} ===`)
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, GRIDEX_E2E_PARENT_MODE: requested },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const duration = Date.now() - started
  const combined = redact(`${result.stdout || ''}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`)
  const logName = `${String(results.length + 1).padStart(2, '0')}-${slug(step.id)}.log`
  const logPath = path.join(logsDir, logName)
  fs.writeFileSync(logPath, combined)

  const exitCode = typeof result.status === 'number' ? result.status : 1
  const status = exitCode === 0 ? 'passed' : 'failed'
  console.log(`${status.toUpperCase()} ${step.id} (${Math.round(duration / 100) / 10}s)`)
  if (status === 'failed') {
    const tail = combined.split('\n').slice(-30).join('\n')
    console.error(tail)
  }
  return {
    ...step,
    status,
    exit_code: exitCode,
    signal: result.signal || null,
    duration_ms: duration,
    log_file: path.relative(root, logPath),
    error: result.error ? redact(result.error.message) : null,
  }
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const results = []
const startedAt = new Date().toISOString()
for (const step of steps) results.push(runStep(step))
const finishedAt = new Date().toISOString()
const passed = results.filter((row) => row.status === 'passed').length
const failed = results.filter((row) => row.status === 'failed').length
const totalDuration = results.reduce((sum, row) => sum + row.duration_ms, 0)
const categories = {}
for (const row of results) {
  categories[row.category] ||= { passed: 0, failed: 0 }
  categories[row.category][row.status] += 1
}

const report = {
  schema_version: 1,
  suite: 'gridex-full-production-e2e',
  mode: requested,
  started_at: startedAt,
  finished_at: finishedAt,
  duration_ms: totalDuration,
  status: failed === 0 ? 'passed' : 'failed',
  summary: { total: results.length, passed, failed },
  categories,
  safety: {
    ci_self_modifies_repository: false,
    production_mutation_allowed: false,
    runtime_mutation_requires_explicit_staging_opt_in: true,
    logs_redact_known_secrets: true,
  },
  results,
}
fs.writeFileSync(path.join(artifactDir, 'gridex-e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`)

const md = [
  '# Gridex full production E2E report',
  '',
  `- Mode: \`${requested}\``,
  `- Status: **${report.status.toUpperCase()}**`,
  `- Passed: ${passed}/${results.length}`,
  `- Failed: ${failed}/${results.length}`,
  `- Started: ${startedAt}`,
  `- Finished: ${finishedAt}`,
  '',
  '| Domain | Step | Status | Duration | Evidence |',
  '|---|---|---:|---:|---|',
  ...results.map((row) => `| ${row.category} | ${row.id} | ${row.status} | ${(row.duration_ms / 1000).toFixed(1)}s | ${row.log_file || row.error || '-'} |`),
  '',
  '## Safety contract',
  '',
  '- CI never edits production data or commits fixes by itself.',
  '- Runtime tenant mutation is staging-only and requires three explicit opt-ins.',
  '- Test tenant retirement uses lifecycle tombstones; no business history is hard-deleted.',
  '- Failures are localized to domain/step and full redacted logs are uploaded as CI artifacts.',
  '',
]
fs.writeFileSync(path.join(artifactDir, 'gridex-e2e-report.md'), `${md.join('\n')}\n`)

const junitCases = results.map((row) => {
  const failure = row.status === 'failed'
    ? `<failure message="${xmlEscape(row.error || `exit ${row.exit_code}`)}">See ${xmlEscape(row.log_file || 'E2E report')}</failure>`
    : ''
  return `<testcase classname="gridex.e2e.${xmlEscape(row.category)}" name="${xmlEscape(row.id)}" time="${(row.duration_ms / 1000).toFixed(3)}">${failure}</testcase>`
}).join('')
const junit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="gridex-full-production-e2e" tests="${results.length}" failures="${failed}" time="${(totalDuration / 1000).toFixed(3)}">${junitCases}</testsuite>\n`
fs.writeFileSync(path.join(artifactDir, 'gridex-e2e-junit.xml'), junit)

console.log(`\nGridex E2E ${report.status}: ${passed}/${results.length} passed, ${failed} failed.`)
console.log('Evidence: e2e-artifacts/gridex-e2e-report.md, .json, JUnit XML and per-step redacted logs.')
if (failed > 0) process.exitCode = 1
