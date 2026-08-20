#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const requiredFiles = [
  '.github/workflows/browser-quality-e2e.yml',
  'playwright.config.mjs',
  'e2e/browser/public.spec.mjs',
  'e2e/browser/authenticated.spec.mjs',
  'e2e/k6/platform-smoke.js',
  'e2e/k6/platform-load.js',
  'e2e/k6/platform-spike.js',
  'e2e/k6/platform-soak.js',
  'e2e/k6/public-contract-cache.js',
  'scripts/install-browser-e2e-tooling.sh',
  '.github/workflows/production-certification-e2e.yml',
  'playwright.production-certification.config.mjs',
  'e2e/production/preflight.spec.mjs',
  'e2e/production/tenant-bootstrap.spec.mjs',
  'e2e/production/helpers/evidence.mjs',
  'scripts/gridex-production-certification-e2e-regression.cjs',
]

const issues = []
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) issues.push(`Missing open-source E2E file: ${file}`)
}

if (issues.length === 0) {
  const workflow = read('.github/workflows/browser-quality-e2e.yml')
  const pkg = JSON.parse(read('package.json'))
  const config = read('playwright.config.mjs')
  const publicSpec = read('e2e/browser/public.spec.mjs')
  const authenticatedSpec = read('e2e/browser/authenticated.spec.mjs')
  const k6 = read('e2e/k6/platform-smoke.js')
  const publicContractK6 = read('e2e/k6/public-contract-cache.js')

  if (pkg.devDependencies?.['@playwright/test'] !== '1.60.0') {
    issues.push('Playwright is not pinned to @playwright/test@1.60.0 in package.json.')
  }
  if (pkg.devDependencies?.['@axe-core/playwright'] !== '4.11.3') {
    issues.push('axe-core Playwright integration is not pinned to @axe-core/playwright@4.11.3 in package.json.')
  }

  const requiredTokens = [
    [workflow, 'grafana/k6:2.1.0', 'k6 is not pinned to the reviewed version.'],
    [workflow, 'zaproxy/action-baseline@v0.15.0', 'OWASP ZAP baseline action is missing or not pinned.'],
    [workflow, 'fail_action: true', 'OWASP ZAP is not a blocking staging gate.'],
    [workflow, 'GRIDEX_E2E_BROWSER_BASE_URL', 'Staging browser target is not wired.'],
    [workflow, 'GRIDEX_E2E_BROWSER_EMAIL', 'Staging browser account email is not wired.'],
    [workflow, 'GRIDEX_E2E_BROWSER_PASSWORD', 'Staging browser account password is not wired.'],
    [workflow, 'types: [opened, synchronize, reopened, labeled]', 'Pull-request label events cannot authorize the staging matrix.'],
    [workflow, "github.event.label.name == 'staging-e2e-approved'", 'Maintainer-approved staging label gate is missing.'],
    [workflow, 'github.event.pull_request.head.repo.full_name == github.repository', 'Staging label gate is not restricted to same-repository pull requests.'],
    [config, "trace: 'retain-on-failure'", 'Playwright traces are not retained on failure.'],
    [config, "screenshot: 'only-on-failure'", 'Playwright failure screenshots are not enabled.'],
    [config, "video: 'retain-on-failure'", 'Playwright failure videos are not enabled.'],
    [publicSpec, 'AxeBuilder', 'Public browser E2E is missing axe accessibility analysis.'],
    [publicSpec, 'wcag22aa', 'Public browser E2E is missing WCAG 2.2 AA coverage.'],
    [authenticatedSpec, '/admin/operations', 'Authenticated browser E2E does not traverse operations.'],
    [authenticatedSpec, '/admin/customers', 'Authenticated browser E2E does not traverse customers.'],
    [k6, 'http_req_failed', 'k6 smoke test is missing error-rate threshold.'],
    [k6, 'http_req_duration', 'k6 smoke test is missing latency threshold.'],
    [workflow, 'public-contract-cache.js', 'Authenticated public-contract cache load is not wired.'],
    [publicContractK6, "'If-None-Match': etag", 'Public-contract load does not exercise conditional ETag reads.'],
    [publicContractK6, 'response.status === 304', 'Public-contract load does not require 304 responses.'],
    [publicContractK6, 'contract_feed_not_modified_duration', 'Public-contract load is missing a 304 latency threshold.'],
  ]

  for (const [source, token, message] of requiredTokens) {
    if (!source.includes(token)) issues.push(message)
  }

  const approvedLabelGateCount = workflow.split("github.event.label.name == 'staging-e2e-approved'").length - 1
  const sameRepositoryGateCount = workflow.split('github.event.pull_request.head.repo.full_name == github.repository').length - 1
  if (approvedLabelGateCount < 5 || sameRepositoryGateCount < 5) {
    issues.push('Every staging browser, load, soak, ZAP and certificate job must share the approved same-repository label gate.')
  }

  const productionSafety = spawnSync(
    process.execPath,
    ['scripts/gridex-production-certification-e2e-regression.cjs'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  if (productionSafety.status !== 0) {
    const detail = String(productionSafety.stderr || productionSafety.stdout || '').trim()
    issues.push(`Production certification safety contract failed${detail ? `: ${detail}` : '.'}`)
  }
}

if (issues.length > 0) {
  console.error('Gridex open-source E2E tooling regression failed:')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log('Gridex open-source E2E tooling regression passed: locked Playwright + axe-core + k6 + blocking OWASP ZAP + guarded production certification are wired.')
