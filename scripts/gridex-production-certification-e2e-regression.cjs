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

const workflow = read('.github/workflows/production-certification-e2e.yml')
const config = read('playwright.production-certification.config.mjs')
const preflight = read('e2e/production/preflight.spec.mjs')
const tenantBootstrap = read('e2e/production/tenant-bootstrap.spec.mjs')
const evidence = read('e2e/production/helpers/evidence.mjs')

requireText(workflow, 'workflow_dispatch:', 'production workflow must be manual-only')
rejectText(workflow, 'pull_request:', 'production workflow must never run on pull requests')
rejectText(workflow, 'push:', 'production workflow must never run on pushes')
rejectText(workflow, 'schedule:', 'production workflow must never run on a schedule')
requireText(workflow, 'confirm_production', 'production workflow confirmation gate')
requireText(workflow, 'CREATE_SYNTHETIC_TENANT', 'synthetic tenant mutation confirmation gate')
requireText(workflow, 'https://app.gridex.se', 'production OPS target pin')
requireText(workflow, 'https://gridex.se', 'Gridex tenant website target pin')
requireText(workflow, 'environment: production-e2e', 'production GitHub Environment boundary')

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

requireText(evidence, "createHash('sha256')", 'evidence fingerprint implementation')
requireText(evidence, "mode: 0o600", 'local evidence file permissions')

const liveCustomerSecrets = [
  'GRIDEX_E2E_CUSTOMER_NAME',
  'GRIDEX_E2E_CUSTOMER_EMAIL',
  'GRIDEX_E2E_CUSTOMER_PHONE',
  'GRIDEX_E2E_CUSTOMER_PERSON_NUMBER',
  'GRIDEX_E2E_CUSTOMER_ADDRESS',
  'GRIDEX_E2E_CUSTOMER_POSTAL_CODE',
  'GRIDEX_E2E_CUSTOMER_FACILITY_ID',
]
for (const secret of liveCustomerSecrets) {
  rejectText(workflow, secret, 'live-customer PII must not be exposed before live-customer mode exists')
}

console.log('Gridex production certification E2E safety regression passed.')
