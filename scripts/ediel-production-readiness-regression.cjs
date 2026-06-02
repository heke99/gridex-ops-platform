#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = process.cwd()
const originalResolve = Module._resolveFilename

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://production-readiness-placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'production-readiness-placeholder-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'production-readiness-placeholder-service-role-key'

function existingFile(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

Module._resolveFilename = function resolveTsAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const mapped = path.join(root, request.slice(2))
    const candidate = existingFile([`${mapped}.ts`, `${mapped}.tsx`, path.join(mapped, 'index.ts'), mapped])
    if (candidate) return candidate
  }
  if (request.startsWith('.')) {
    const base = path.resolve(path.dirname(parent?.filename ?? root), request)
    const candidate = existingFile([`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base])
    if (candidate) return candidate
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

require.extensions['.ts'] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText
  module._compile(output, filename)
}

const {
  deriveProductionReadinessStatus,
  evaluateProductionSendGuardSnapshot,
} = require('../lib/ediel/productionReadiness.ts')
const { supabaseService } = require('../lib/supabase/service.ts')
const { validateEdielSendContext } = require('../lib/ediel/sendContextConsistency.ts')

const issue = {
  code: 'missing_ediel_id',
  label: 'Production Ediel-ID saknas',
  message: 'Production Ediel-ID saknas.',
  severity: 'blocking',
  area: 'actor',
}

assert.strictEqual(
  deriveProductionReadinessStatus({
    blockingIssues: [issue],
    warnings: [],
    companyStatus: 'active',
    productionStatus: 'not_ready',
    productionEnabled: false,
  }),
  'not_ready',
  'company without Ediel ID is not ready'
)

assert.strictEqual(
  deriveProductionReadinessStatus({
    blockingIssues: [],
    warnings: [],
    companyStatus: 'active',
    productionStatus: 'live',
    productionEnabled: true,
    liveApprovedAt: new Date().toISOString(),
  }),
  'live',
  'enabled live company is live'
)

assert.strictEqual(
  deriveProductionReadinessStatus({
    blockingIssues: [],
    warnings: [],
    companyStatus: 'active',
    productionStatus: 'paused',
    productionEnabled: false,
  }),
  'paused',
  'paused company stays paused'
)

assert(
  evaluateProductionSendGuardSnapshot({
    environment: 'production',
    productionEnabled: true,
    productionStatus: 'live',
    liveApprovedAt: new Date().toISOString(),
    lockLocked: true,
    readinessStatus: 'live',
    readinessCheckedAt: new Date().toISOString(),
    routeBelongsToCompany: true,
    actorBelongsToCompany: true,
    firstLiveSendApprovedAt: new Date().toISOString(),
    priorProductionSentCount: 0,
  }).some((item) => item.code === 'production_send_locked'),
  'production send is blocked when locked'
)

assert(
  evaluateProductionSendGuardSnapshot({
    environment: 'production',
    productionEnabled: true,
    productionStatus: 'live',
    liveApprovedAt: new Date().toISOString(),
    lockLocked: false,
    readinessStatus: 'not_ready',
    readinessCheckedAt: new Date().toISOString(),
    routeBelongsToCompany: true,
    actorBelongsToCompany: true,
    firstLiveSendApprovedAt: new Date().toISOString(),
    priorProductionSentCount: 0,
  }).some((item) => item.code === 'readiness_not_passed'),
  'production send is blocked when readiness failed'
)

assert.strictEqual(
  evaluateProductionSendGuardSnapshot({
    environment: 'production',
    productionEnabled: true,
    productionStatus: 'live',
    liveApprovedAt: new Date().toISOString(),
    lockLocked: false,
    readinessStatus: 'live',
    readinessCheckedAt: new Date().toISOString(),
    routeBelongsToCompany: true,
    actorBelongsToCompany: true,
    firstLiveSendApprovedAt: new Date().toISOString(),
    priorProductionSentCount: 0,
  }).length,
  0,
  'production send is allowed only when enabled, unlocked, ready and tenant-safe'
)

assert(
  evaluateProductionSendGuardSnapshot({
    environment: 'production',
    productionEnabled: true,
    productionStatus: 'live',
    liveApprovedAt: new Date().toISOString(),
    lockLocked: false,
    readinessStatus: 'live',
    readinessCheckedAt: new Date().toISOString(),
    routeBelongsToCompany: false,
    actorBelongsToCompany: true,
    firstLiveSendApprovedAt: new Date().toISOString(),
    priorProductionSentCount: 0,
  }).some((item) => item.code === 'route_company_mismatch'),
  'route profile from another company cannot be used'
)

assert(
  evaluateProductionSendGuardSnapshot({
    environment: 'production',
    productionEnabled: true,
    productionStatus: 'live',
    liveApprovedAt: new Date().toISOString(),
    lockLocked: false,
    readinessStatus: 'live',
    readinessCheckedAt: new Date().toISOString(),
    routeBelongsToCompany: true,
    actorBelongsToCompany: false,
    firstLiveSendApprovedAt: new Date().toISOString(),
    priorProductionSentCount: 0,
  }).some((item) => item.code === 'actor_company_mismatch'),
  'actor settings from another company cannot be used'
)

assert(
  evaluateProductionSendGuardSnapshot({
    environment: 'production',
    productionEnabled: true,
    productionStatus: 'live',
    liveApprovedAt: new Date().toISOString(),
    lockLocked: false,
    readinessStatus: 'live',
    readinessCheckedAt: new Date().toISOString(),
    routeBelongsToCompany: true,
    actorBelongsToCompany: true,
    firstLiveSendApprovedAt: null,
    priorProductionSentCount: 0,
  }).some((item) => item.code === 'first_live_send_not_approved'),
  'first live send requires explicit approval'
)

assert.strictEqual(
  evaluateProductionSendGuardSnapshot({
    environment: 'test',
    productionEnabled: false,
    productionStatus: 'not_ready',
    liveApprovedAt: null,
    lockLocked: true,
    readinessStatus: 'not_ready',
    readinessCheckedAt: null,
    routeBelongsToCompany: false,
    actorBelongsToCompany: false,
    firstLiveSendApprovedAt: null,
    priorProductionSentCount: 0,
  }).length,
  0,
  'test environment is not blocked by production guard'
)

function installSupabaseMock(fixtures) {
  supabaseService.from = function from(table) {
    const state = { table, filters: [], inFilter: null, limitValue: null }
    const builder = {
      select() { return builder },
      order() { return builder },
      limit(value) { state.limitValue = value; return builder },
      eq(column, value) { state.filters.push({ column, value }); return builder },
      ilike(column, value) { state.filters.push({ column, value }); return builder },
      in(column, values) { state.inFilter = { column, values }; return builder },
      maybeSingle() {
        const rows = applyFilters(fixtures[state.table] ?? [], state)
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
      then(resolve, reject) {
        const rows = applyFilters(fixtures[state.table] ?? [], state)
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
      },
    }
    return builder
  }
}

function applyFilters(rows, state) {
  let result = rows
  for (const filter of state.filters) {
    result = result.filter((row) => row[filter.column] === filter.value)
  }
  if (state.inFilter) {
    const allowed = new Set(state.inFilter.values)
    result = result.filter((row) => allowed.has(row[state.inFilter.column]))
  }
  return state.limitValue ? result.slice(0, state.limitValue) : result
}

function message(overrides = {}) {
  return {
    id: 'm1',
    company_id: 'c1',
    direction: 'outbound',
    message_standard: 'edifact',
    message_family: 'PRODAT',
    message_code: 'Z03',
    environment: 'test',
    communication_route_id: 'cr1',
    mailbox: 'ediel@example.test',
    validation_report: {},
    ...overrides,
  }
}

async function validateWithRun(runOverrides, messageOverrides = {}, routeOverrides = {}, override) {
  installSupabaseMock({
    ediel_test_run_messages: [{ ediel_message_id: 'm1', test_run_id: 'r1', created_at: '2026-01-01T00:00:00Z' }],
    ediel_test_runs: [{
      id: 'r1',
      company_id: 'c1',
      role_code: 'supplier',
      test_suite: 'PRODAT',
      test_case_code: 'L1',
      message_family: 'PRODAT',
      encryption_mode: 'smime',
      route_profile_id: 'rp1',
      environment_type: 'agt_test',
      ...runOverrides,
    }],
    ediel_route_profiles: [{
      id: 'rp1',
      company_id: 'c1',
      communication_route_id: 'cr1',
      encryption_mode: 'smime',
      mailbox: 'ediel@example.test',
      ...routeOverrides,
    }],
    ediel_mailboxes: [{ email_address: 'ediel@example.test', environment: 'test', is_active: true, encryption_mode: 'smime' }],
  })
  return validateEdielSendContext({ message: message(messageOverrides), smtpMimeModeOverride: override })
}

async function runSendConsistencyRegression() {
  let result = await validateWithRun({ encryption_mode: 'smime' })
  assert.strictEqual(result.ok, true, 'encrypted run with S/MIME route is sendable')
  assert.strictEqual(result.resolvedSmtpMimeMode, 'ediel-smime-enveloped', 'encrypted run resolves S/MIME')

  result = await validateWithRun({ encryption_mode: 'smime' }, {}, {}, 'ediel-singlepart-base64')
  assert(result.blockingIssues.some((issue) => issue.code === 'transport_security_mismatch'), 'encrypted run blocks base64 override')

  result = await validateWithRun({ encryption_mode: 'none' }, {}, { encryption_mode: 'none' })
  assert.strictEqual(result.ok, true, 'unencrypted run remains sendable on unencrypted route')
  assert.strictEqual(result.resolvedSmtpMimeMode, 'ediel-singlepart-base64', 'unencrypted run resolves base64')

  result = await validateWithRun({ company_id: 'other-company' })
  assert(result.blockingIssues.some((issue) => issue.code === 'tenant_mismatch'), 'tenant mismatch blocks send')

  result = await validateWithRun({ environment_type: 'production' })
  assert(result.blockingIssues.some((issue) => issue.code === 'environment_mismatch'), 'environment mismatch blocks send')
}

runSendConsistencyRegression().then(() => {
  console.log('ediel production readiness regression passed')
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
