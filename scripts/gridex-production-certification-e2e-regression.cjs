#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) throw new Error(`Missing production E2E file: ${relativePath}`)
  return fs.readFileSync(fullPath, 'utf8')
}

function requireText(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`${label}: missing ${JSON.stringify(needle)}`)
}

function rejectText(source, needle, label) {
  if (source.includes(needle)) throw new Error(`${label}: forbidden ${JSON.stringify(needle)}`)
}

function jobSection(source, jobName, nextJobName = null) {
  const startToken = `\n  ${jobName}:\n`
  const start = source.indexOf(startToken)
  if (start < 0) throw new Error(`Missing workflow job: ${jobName}`)
  if (!nextJobName) return source.slice(start)
  const endToken = `\n  ${nextJobName}:\n`
  const end = source.indexOf(endToken, start + startToken.length)
  if (end < 0) throw new Error(`Missing workflow job after ${jobName}: ${nextJobName}`)
  return source.slice(start, end)
}

const workflow = read('.github/workflows/production-certification-e2e.yml')
const config = read('playwright.production-certification.config.mjs')
const preflight = read('e2e/production/preflight.spec.mjs')
const tenantBootstrap = read('e2e/production/tenant-bootstrap.spec.mjs')
const liveCustomerPreflight = read('e2e/production/live-customer-preflight.spec.mjs')
const evidence = read('e2e/production/helpers/evidence.mjs')

requireText(workflow, 'workflow_dispatch:', 'production workflow must be manual-only')
rejectText(workflow, 'pull_request:', 'production workflow must never run on pull requests')
rejectText(workflow, 'push:', 'production workflow must never run on pushes')
rejectText(workflow, 'schedule:', 'production workflow must never run on a schedule')
requireText(workflow, 'confirm_production', 'production workflow confirmation gate')
requireText(workflow, 'CREATE_SYNTHETIC_TENANT', 'synthetic tenant mutation confirmation gate')
requireText(workflow, 'AUTHORIZED_LIVE_CUSTOMER', 'live customer authorization gate')
requireText(workflow, 'https://app.gridex.se', 'production OPS target pin')
requireText(workflow, 'https://gridex.se', 'Gridex tenant website target pin')
requireText(workflow, 'environment: production-e2e', 'production GitHub Environment boundary')

const preflightJob = jobSection(workflow, 'preflight', 'tenant-bootstrap')
const tenantJob = jobSection(workflow, 'tenant-bootstrap', 'live-customer-preflight')
const liveQuoteJob = jobSection(workflow, 'live-customer-preflight')

for (const secret of [
  'GRIDEX_E2E_CUSTOMER_ADDRESS',
  'GRIDEX_E2E_CUSTOMER_POSTAL_CODE',
  'GRIDEX_E2E_CUSTOMER_CITY',
  'GRIDEX_E2E_CUSTOMER_ANNUAL_KWH',
]) {
  rejectText(preflightJob, secret, 'platform preflight must not receive customer fixture secrets')
  rejectText(tenantJob, secret, 'tenant bootstrap must not receive customer fixture secrets')
  requireText(liveQuoteJob, secret, 'live quote must receive only required customer fixture secrets')
}
for (const secret of [
  'GRIDEX_E2E_SUPERADMIN_EMAIL',
  'GRIDEX_E2E_SUPERADMIN_PASSWORD',
  'GRIDEX_E2E_TENANT_ADMIN_EMAIL',
  'GRIDEX_E2E_TENANT_ADMIN_PASSWORD',
]) {
  rejectText(liveQuoteJob, secret, 'live quote job must not receive admin credentials')
}

for (const [key, value] of [
  ['trace', "trace: 'off'"],
  ['screenshot', "screenshot: 'off'"],
  ['video', "video: 'off'"],
]) {
  requireText(config, value, `PII-safe Playwright ${key}`)
}
requireText(config, "retries: 0", 'production browser must not silently replay mutations')
requireText(config, "workers: 1", 'production browser mutation serialization')

requireText(preflight, "mode: 'preflight'", 'production preflight evidence')
requireText(preflight, 'superadmin_email_fingerprint', 'production preflight identity fingerprinting')
rejectText(preflight, 'GRIDEX_E2E_CUSTOMER_PERSON_NUMBER', 'preflight must not load customer PII')

requireText(tenantBootstrap, 'GRIDEX E2E Certification', 'synthetic tenant unmistakable naming')
requireText(tenantBootstrap, "status: 'waiting_external'", 'tenant bootstrap durable external wait state')
requireText(tenantBootstrap, "waiting_for: 'tenant_admin_invitation_email_verification'", 'tenant invitation wait reason')
requireText(tenantBootstrap, 'tenant_admin_email_fingerprint', 'tenant admin PII-safe fingerprint evidence')
rejectText(tenantBootstrap, 'GRIDEX_E2E_CUSTOMER_PERSON_NUMBER', 'tenant bootstrap must not load customer PII')

requireText(liveCustomerPreflight, "mode: 'live-customer-preflight'", 'live customer quote preflight evidence')
requireText(liveCustomerPreflight, 'GRIDEX_E2E_CUSTOMER_ADDRESS', 'live quote needs real address secret')
requireText(liveCustomerPreflight, 'GRIDEX_E2E_CUSTOMER_POSTAL_CODE', 'live quote needs real postal-code secret')
requireText(liveCustomerPreflight, 'GRIDEX_E2E_CUSTOMER_CITY', 'live quote needs real city secret')
requireText(liveCustomerPreflight, 'GRIDEX_E2E_CUSTOMER_ANNUAL_KWH', 'live quote needs real annual consumption secret')
requireText(liveCustomerPreflight, 'contract_submission_attempted: false', 'live quote must stop before contract submission')
requireText(liveCustomerPreflight, 'customer_account_created: false', 'live quote must stop before customer account creation')
requireText(liveCustomerPreflight, 'market_outbound_attempted: false', 'live quote must stop before market outbound')
requireText(liveCustomerPreflight, 'address_fingerprint', 'live quote evidence must fingerprint address')
rejectText(liveCustomerPreflight, 'GRIDEX_E2E_CUSTOMER_PERSON_NUMBER', 'quote preflight must not load person number')
rejectText(liveCustomerPreflight, 'GRIDEX_E2E_CUSTOMER_EMAIL', 'quote preflight must not load customer email')
rejectText(liveCustomerPreflight, 'GRIDEX_E2E_CUSTOMER_PHONE', 'quote preflight must not load customer phone')

requireText(evidence, "createHash('sha256')", 'evidence fingerprint implementation')
requireText(evidence, "mode: 0o600", 'local evidence file permissions')

const forbiddenLiveContractSecrets = [
  'GRIDEX_E2E_CUSTOMER_NAME',
  'GRIDEX_E2E_CUSTOMER_EMAIL',
  'GRIDEX_E2E_CUSTOMER_PHONE',
  'GRIDEX_E2E_CUSTOMER_PERSON_NUMBER',
  'GRIDEX_E2E_CUSTOMER_FACILITY_ID',
  'GRIDEX_E2E_CUSTOMER_PORTAL_PASSWORD',
]
for (const secret of forbiddenLiveContractSecrets) {
  rejectText(workflow, secret, 'real-contract/customer identity secrets must stay outside quote preflight workflow')
}

console.log('Gridex production certification E2E safety regression passed.')
