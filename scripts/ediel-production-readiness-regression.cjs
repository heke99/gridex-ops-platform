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

console.log('ediel production readiness regression passed')
