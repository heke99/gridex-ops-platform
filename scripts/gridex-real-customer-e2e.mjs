#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
fs.mkdirSync(artifactDir, { recursive: true })

const baseUrl = String(process.env.GRIDEX_E2E_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
const serviceKey = String(process.env.GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')
const companyId = String(process.env.GRIDEX_E2E_REAL_COMPANY_ID || '').trim()
const customerId = String(process.env.GRIDEX_E2E_REAL_CUSTOMER_ID || '').trim()
const expectedSiteId = String(process.env.GRIDEX_E2E_REAL_SITE_ID || '').trim()
const expectedContractId = String(process.env.GRIDEX_E2E_REAL_CONTRACT_ID || '').trim()
const expectedCustomerNumber = String(process.env.GRIDEX_E2E_REAL_CUSTOMER_NUMBER || '').trim()
const requireLegal = process.env.GRIDEX_E2E_REAL_REQUIRE_LEGAL !== 'NO'
const requireBilling = process.env.GRIDEX_E2E_REAL_REQUIRE_BILLING === 'YES'
const confirmed = process.env.GRIDEX_E2E_REAL_CUSTOMER_CONFIRM === 'YES'
const targetKind = String(process.env.GRIDEX_E2E_TARGET || '').toLowerCase()

function fail(message) {
  console.error(message)
  process.exit(2)
}

if (!baseUrl || !serviceKey || !companyId || !customerId) {
  fail('Real-customer E2E requires the staging Supabase URL/service key plus GRIDEX_E2E_REAL_COMPANY_ID and GRIDEX_E2E_REAL_CUSTOMER_ID.')
}
if (targetKind !== 'staging' || !confirmed) {
  fail('Real-customer E2E is staging-only. Set GRIDEX_E2E_TARGET=staging and GRIDEX_E2E_REAL_CUSTOMER_CONFIRM=YES.')
}
if (process.env.GRIDEX_E2E_ALLOW_OUTBOUND === 'YES') {
  fail('Real-customer E2E refuses outbound traffic. Do not enable GRIDEX_E2E_ALLOW_OUTBOUND.')
}
if (process.env.VERCEL_ENV === 'production') {
  fail('Real-customer E2E refuses to run in a production Vercel context.')
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  Accept: 'application/json',
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

async function rows(table, filters = {}) {
  const params = new URLSearchParams({ select: '*' })
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, `eq.${value}`)
  }
  params.set('limit', '100')
  const response = await fetch(`${baseUrl}/rest/v1/${table}?${params.toString()}`, { headers })
  if (!response.ok) throw new Error(`${table} read failed with HTTP ${response.status}`)
  const payload = await response.json()
  if (!Array.isArray(payload)) throw new Error(`${table} did not return a row array`)
  return payload
}

function assertScoped(row, table) {
  if (!row || typeof row !== 'object') throw new Error(`${table} returned an invalid row`)
  if ('company_id' in row && row.company_id !== companyId) throw new Error(`${table} escaped the expected tenant boundary`)
  if ('customer_id' in row && row.customer_id !== customerId) throw new Error(`${table} points to the wrong customer`)
}

function assertSingle(list, label) {
  if (list.length !== 1) throw new Error(`${label} expected exactly one row, found ${list.length}`)
  return list[0]
}

const evidence = {
  schema_version: 1,
  started_at: new Date().toISOString(),
  target: 'staging',
  mode: 'persistent-real-test-customer',
  safety: {
    mutating: false,
    outbound_allowed: false,
    pii_written_to_artifact: false,
  },
  fixture: {
    company_fingerprint: fingerprint(companyId),
    customer_fingerprint: fingerprint(customerId),
    site_fingerprint: expectedSiteId ? fingerprint(expectedSiteId) : null,
    contract_fingerprint: expectedContractId ? fingerprint(expectedContractId) : null,
  },
  checks: [],
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
  const customer = await check('real customer resolves exactly once inside expected tenant', async () => {
    const found = await rows('customers', { id: customerId, company_id: companyId })
    const row = assertSingle(found, 'customers')
    assertScoped(row, 'customers')
    if (expectedCustomerNumber && row.customer_number !== expectedCustomerNumber) {
      throw new Error('customer_number does not match the protected fixture value')
    }
    return { customer_number_present: Boolean(row.customer_number), status: row.status ?? null }
  })

  const sites = await check('customer sites point forward to the real customer and back to the same tenant', async () => {
    const found = await rows('customer_sites', { customer_id: customerId, company_id: companyId })
    if (found.length < 1) throw new Error('No customer_sites rows found for the real test customer')
    for (const row of found) assertScoped(row, 'customer_sites')
    if (expectedSiteId && !found.some((row) => row.id === expectedSiteId)) throw new Error('Protected site fixture is not linked to the real test customer')
    return { count: found.length, expected_site_present: expectedSiteId ? true : null }
  })

  const contracts = await check('contracts point forward to the real customer and back to the same tenant', async () => {
    const found = await rows('contracts', { customer_id: customerId, company_id: companyId })
    if (found.length < 1) throw new Error('No contracts rows found for the real test customer')
    for (const row of found) assertScoped(row, 'contracts')
    if (expectedContractId && !found.some((row) => row.id === expectedContractId)) throw new Error('Protected contract fixture is not linked to the real test customer')
    return { count: found.length, expected_contract_present: expectedContractId ? true : null }
  })

  if (requireLegal) {
    await check('legal acceptances remain tenant/customer scoped', async () => {
      const found = await rows('customer_legal_acceptances', { customer_id: customerId, company_id: companyId })
      if (found.length < 1) throw new Error('No customer_legal_acceptances rows found for a fixture that requires legal completion')
      for (const row of found) assertScoped(row, 'customer_legal_acceptances')
      return { count: found.length }
    })

    await check('powers of attorney remain tenant/customer scoped', async () => {
      const found = await rows('powers_of_attorney', { customer_id: customerId, company_id: companyId })
      if (found.length < 1) throw new Error('No powers_of_attorney rows found for a fixture that requires legal completion')
      for (const row of found) assertScoped(row, 'powers_of_attorney')
      return { count: found.length }
    })
  }

  if (requireBilling) {
    await check('billing underlays remain tenant/customer scoped', async () => {
      const found = await rows('billing_underlays', { customer_id: customerId, company_id: companyId })
      if (found.length < 1) throw new Error('No billing_underlays rows found for a fixture that requires billing completion')
      for (const row of found) assertScoped(row, 'billing_underlays')
      return { count: found.length }
    })

    await check('invoices remain tenant/customer scoped', async () => {
      const found = await rows('invoices', { customer_id: customerId, company_id: companyId })
      if (found.length < 1) throw new Error('No invoices rows found for a fixture that requires billing completion')
      for (const row of found) assertScoped(row, 'invoices')
      return { count: found.length }
    })
  }

  // Prevent accidental inclusion of raw fixture rows in evidence. These references
  // intentionally stay in memory only and are never serialized.
  void customer
  void sites
  void contracts

  evidence.status = 'passed'
  evidence.finished_at = new Date().toISOString()
  fs.writeFileSync(path.join(artifactDir, 'gridex-real-customer-e2e.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log('Gridex real-customer E2E passed: persistent staging customer graph is tenant-safe, referentially consistent, and no outbound traffic was permitted.')
} catch (error) {
  evidence.status = 'failed'
  evidence.finished_at = new Date().toISOString()
  evidence.error = error instanceof Error ? error.message : String(error)
  fs.writeFileSync(path.join(artifactDir, 'gridex-real-customer-e2e.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
