#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
fs.mkdirSync(artifactDir, { recursive: true })

const baseUrl = String(process.env.GRIDEX_E2E_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
const serviceKey = String(process.env.GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')
const actorUserId = String(process.env.GRIDEX_E2E_ACTOR_USER_ID || '').trim()
const confirmedStaging = process.env.GRIDEX_E2E_CONFIRM_STAGING === 'YES'
const allowMutation = process.env.GRIDEX_E2E_ALLOW_MUTATION === 'YES'
const targetKind = String(process.env.GRIDEX_E2E_TARGET || '').toLowerCase()

function fail(message) {
  console.error(message)
  process.exit(2)
}

if (!baseUrl || !serviceKey || !actorUserId) {
  fail('Runtime tenant E2E requires GRIDEX_E2E_SUPABASE_URL, GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY and GRIDEX_E2E_ACTOR_USER_ID.')
}
if (!confirmedStaging || !allowMutation || targetKind !== 'staging') {
  fail('Runtime tenant E2E is mutating and staging-only. Set GRIDEX_E2E_TARGET=staging, GRIDEX_E2E_CONFIRM_STAGING=YES and GRIDEX_E2E_ALLOW_MUTATION=YES.')
}
if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production' && process.env.GRIDEX_E2E_PRODUCTION_CONTEXT === 'YES') {
  fail('Runtime tenant E2E refuses to mutate a production execution context.')
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function request(method, relativePath, body) {
  const response = await fetch(`${baseUrl}${relativePath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try { payload = JSON.parse(text) } catch { payload = text }
  }
  if (!response.ok) {
    const error = new Error(`${method} ${relativePath} failed with HTTP ${response.status}`)
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

async function rpc(name, args) {
  return request('POST', `/rest/v1/rpc/${name}`, args)
}

async function company(companyId) {
  const query = new URLSearchParams({
    id: `eq.${companyId}`,
    select: 'id,name,slug,status,lifecycle_state_version,customer_number_prefix',
    limit: '1',
  })
  const rows = await request('GET', `/rest/v1/companies?${query.toString()}`)
  return Array.isArray(rows) ? rows[0] ?? null : null
}

function unwrapObject(payload) {
  if (Array.isArray(payload)) return payload[0] ?? null
  return payload && typeof payload === 'object' ? payload : null
}

function requireField(payload, field, label) {
  const row = unwrapObject(payload)
  const value = row?.[field]
  if (!value) throw new Error(`${label} did not return ${field}: ${JSON.stringify(payload)}`)
  return value
}

async function provisionTenant(input) {
  const command = {
    name: input.name,
    slug: input.slug,
    organization_number: input.orgNumber,
    customer_number_prefix: input.prefix,
    primary_contact_email: input.email,
    primary_contact_name: 'Gridex E2E',
    phone: null,
    website: null,
    industry: 'electricity_supplier',
    metadata: { e2e: true, run_id: input.runId },
    actor_user_id: actorUserId,
    idempotency_key: input.idempotencyKey,
  }
  const first = await rpc('canonical_provision_company', { p_command: command })
  const firstId = requireField(first, 'company_id', 'canonical_provision_company')
  const repeated = await rpc('canonical_provision_company', { p_command: command })
  const repeatedId = requireField(repeated, 'company_id', 'canonical_provision_company idempotent replay')
  if (firstId !== repeatedId) throw new Error(`Tenant provisioning idempotency failed: ${firstId} != ${repeatedId}`)
  const row = await company(firstId)
  if (!row) throw new Error(`Provisioned tenant ${firstId} was not readable from companies.`)
  return row
}

async function transition(companyId, targetStatus, reason, suffix) {
  const before = await company(companyId)
  if (!before) throw new Error(`Tenant ${companyId} disappeared before transition to ${targetStatus}.`)
  const expected = Number(before.lifecycle_state_version)
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error(`Invalid lifecycle_state_version for ${companyId}.`)
  const payload = await rpc('canonical_transition_tenant_lifecycle', {
    p_company_id: companyId,
    p_target_status: targetStatus,
    p_expected_state_version: expected,
    p_reason: reason,
    p_actor_user_id: actorUserId,
    p_idempotency_key: `gridex-e2e:${companyId}:${targetStatus}:v${expected}:${suffix}`,
  })
  const result = unwrapObject(payload)
  if (result?.ok === false) throw new Error(`Lifecycle transition ${before.status} -> ${targetStatus} rejected: ${JSON.stringify(result)}`)
  const after = await company(companyId)
  if (!after || after.status !== targetStatus) {
    throw new Error(`Lifecycle transition expected ${targetStatus}, got ${after?.status ?? 'missing'}. Payload: ${JSON.stringify(payload)}`)
  }
  return after
}

async function createInvitation(companyId, runId) {
  const email = `gridex-e2e-${runId}@example.invalid`
  const command = {
    company_id: companyId,
    actor_user_id: actorUserId,
    email,
    full_name: 'Gridex E2E Tenant Admin',
    membership_role: 'company_admin',
    role_key: 'company_admin',
    source: 'gridex_tenant_runtime_e2e',
    idempotency_key: `gridex-e2e-invite:${companyId}:${runId}`,
  }
  const first = await rpc('canonical_create_tenant_invitation', { p_command: command })
  const invitationId = requireField(first, 'invitation_id', 'canonical_create_tenant_invitation')
  const repeated = await rpc('canonical_create_tenant_invitation', { p_command: command })
  const repeatedId = requireField(repeated, 'invitation_id', 'canonical_create_tenant_invitation idempotent replay')
  if (invitationId !== repeatedId) throw new Error(`Invitation idempotency failed: ${invitationId} != ${repeatedId}`)
  return { invitationId, email }
}

async function expectInvitationBlocked(companyId, runId) {
  try {
    const payload = await rpc('canonical_create_tenant_invitation', {
      p_command: {
        company_id: companyId,
        actor_user_id: actorUserId,
        email: `gridex-e2e-paused-${runId}@example.invalid`,
        full_name: 'Paused tenant write probe',
        membership_role: 'company_admin',
        role_key: 'company_admin',
        source: 'gridex_tenant_runtime_e2e_paused_probe',
        idempotency_key: `gridex-e2e-paused-invite:${companyId}:${runId}`,
      },
    })
    const result = unwrapObject(payload)
    if (result?.invitation_id || result?.ok === true) {
      throw new Error(`Paused tenant accepted a new invitation write: ${JSON.stringify(result)}`)
    }
    return { blocked: true, mode: 'canonical_result', code: result?.code ?? null }
  } catch (error) {
    if (error?.status && Number(error.status) >= 400) {
      return { blocked: true, mode: 'http_error', status: error.status }
    }
    throw error
  }
}

function runContractRoundtrip(companyId) {
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/gridex-contract-staging-roundtrip.mjs'],
    {
      cwd: root,
      env: {
        ...process.env,
        SUPABASE_URL: baseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
        GRIDEX_CONTRACT_TEST_COMPANY_ID: companyId,
        GRIDEX_CONTRACT_TEST_ACTOR_ID: actorUserId,
        GRIDEX_CONTRACT_TEST_CONFIRM_STAGING: 'YES',
        VERCEL_ENV: 'preview',
      },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    },
  )
  if (child.status !== 0) {
    throw new Error(`Contract staging roundtrip failed for tenant ${companyId}: ${(child.stderr || child.stdout || '').slice(-4000)}`)
  }
  return (child.stdout || '').trim().split('\n').slice(-3)
}

const startedAt = new Date().toISOString()
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const evidence = {
  run_id: runId,
  started_at: startedAt,
  target: 'staging',
  safety: {
    production_mutation_allowed: false,
    hard_delete_allowed: false,
    invitation_recipient_domain: 'example.invalid',
  },
  checks: [],
  tenants: {},
}

async function check(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    evidence.checks.push({ name, status: 'passed', duration_ms: Date.now() - started, detail: detail ?? null })
    console.log(`PASS ${name}`)
    return detail
  } catch (error) {
    evidence.checks.push({
      name,
      status: 'failed',
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

try {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase()
  const tenantA = await check('provision tenant A idempotently', () => provisionTenant({
    runId,
    name: `GRIDEX E2E Operational ${suffix}`,
    slug: `gridex-e2e-operational-${suffix}`,
    orgNumber: `E2E-A-${suffix}`,
    prefix: `EA${suffix.slice(-6).toUpperCase()}`,
    email: `gridex-e2e-owner-a-${suffix}@example.invalid`,
    idempotencyKey: `gridex-e2e-provision-a:${runId}`,
  }))
  evidence.tenants.operational = { id: tenantA.id, initial_status: tenantA.status }

  const activeA = tenantA.status === 'active'
    ? tenantA
    : await check('activate tenant A through canonical lifecycle', () => transition(tenantA.id, 'active', 'Gridex runtime E2E activates tenant', 'activate-a'))
  evidence.tenants.operational.active_status = activeA.status

  await check('create tenant A durable admin invitation idempotently', () => createInvitation(tenantA.id, runId))
  await check('create/read/delete canonical contract for tenant A', () => runContractRoundtrip(tenantA.id))

  await check('pause tenant A', () => transition(tenantA.id, 'paused', 'Gridex runtime E2E pause guard', 'pause-a'))
  await check('paused tenant rejects new writes', () => expectInvitationBlocked(tenantA.id, runId))
  await check('reactivate tenant A', () => transition(tenantA.id, 'active', 'Gridex runtime E2E reactivation', 'reactivate-a'))
  await check('replayed invitation stays idempotent after reactivation', () => createInvitation(tenantA.id, runId))
  await check('close tenant A terminally', () => transition(tenantA.id, 'closed', 'Gridex runtime E2E terminal close', 'close-a'))

  await check('closed tenant A cannot reactivate', async () => {
    try {
      await transition(tenantA.id, 'active', 'This transition must be rejected', 'illegal-reactivate-a')
    } catch (error) {
      return { rejected: true, error: error instanceof Error ? error.message : String(error) }
    }
    throw new Error('Closed tenant was incorrectly reactivated.')
  })

  const tenantB = await check('provision tenant B for safe tombstone flow', () => provisionTenant({
    runId,
    name: `GRIDEX E2E Disposable ${suffix}`,
    slug: `gridex-e2e-disposable-${suffix}`,
    orgNumber: `E2E-B-${suffix}`,
    prefix: `EB${suffix.slice(-6).toUpperCase()}`,
    email: `gridex-e2e-owner-b-${suffix}@example.invalid`,
    idempotencyKey: `gridex-e2e-provision-b:${runId}`,
  }))
  evidence.tenants.disposable = { id: tenantB.id, initial_status: tenantB.status }
  await check('move tenant B to pending_deletion', () => transition(tenantB.id, 'pending_deletion', 'Gridex runtime E2E test-only retirement', 'delete-b-1'))
  const tombstone = await check('tombstone tenant B without hard delete', () => transition(tenantB.id, 'deleted_test_only', 'Gridex runtime E2E terminal tombstone', 'delete-b-2'))
  evidence.tenants.disposable.final_status = tombstone.status

  evidence.status = 'passed'
  evidence.finished_at = new Date().toISOString()
  fs.writeFileSync(path.join(artifactDir, 'gridex-tenant-runtime-e2e.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log('Gridex runtime tenant E2E passed: canonical provisioning -> idempotency -> invitation -> contract -> pause guard -> reactivation -> terminal lifecycle -> tombstone.')
} catch (error) {
  evidence.status = 'failed'
  evidence.finished_at = new Date().toISOString()
  evidence.error = error instanceof Error ? error.message : String(error)
  fs.writeFileSync(path.join(artifactDir, 'gridex-tenant-runtime-e2e.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.error(error)
  process.exit(1)
}
