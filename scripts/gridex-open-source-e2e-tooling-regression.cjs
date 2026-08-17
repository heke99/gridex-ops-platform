#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const requiredFiles = [
  '.github/workflows/browser-quality-e2e.yml',
  'playwright.config.mjs',
  'e2e/browser/public.spec.mjs',
  'e2e/browser/authenticated.spec.mjs',
  'e2e/k6/platform-smoke.js',
  'scripts/install-browser-e2e-tooling.sh',
]

const issues = []
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) issues.push(`Missing open-source E2E file: ${file}`)
}

if (issues.length === 0) {
  const workflow = read('.github/workflows/browser-quality-e2e.yml')
  const install = read('scripts/install-browser-e2e-tooling.sh')
  const config = read('playwright.config.mjs')
  const publicSpec = read('e2e/browser/public.spec.mjs')
  const authenticatedSpec = read('e2e/browser/authenticated.spec.mjs')
  const k6 = read('e2e/k6/platform-smoke.js')

  const requiredTokens = [
    [install, '@playwright/test@1.60.0', 'Playwright is not pinned to the reviewed version.'],
    [install, '@axe-core/playwright@4.11.3', 'axe-core Playwright integration is not pinned to the reviewed version.'],
    [workflow, 'grafana/k6:2.1.0', 'k6 is not pinned to the reviewed version.'],
    [workflow, 'zaproxy/action-baseline@v0.15.0', 'OWASP ZAP baseline action is missing or not pinned.'],
    [workflow, 'GRIDEX_E2E_BROWSER_BASE_URL', 'Staging browser target is not wired.'],
    [workflow, 'GRIDEX_E2E_BROWSER_EMAIL', 'Staging browser account email is not wired.'],
    [workflow, 'GRIDEX_E2E_BROWSER_PASSWORD', 'Staging browser account password is not wired.'],
    [config, "trace: 'retain-on-failure'", 'Playwright traces are not retained on failure.'],
    [config, "screenshot: 'only-on-failure'", 'Playwright failure screenshots are not enabled.'],
    [config, "video: 'retain-on-failure'", 'Playwright failure videos are not enabled.'],
    [publicSpec, 'AxeBuilder', 'Public browser E2E is missing axe accessibility analysis.'],
    [publicSpec, 'wcag22aa', 'Public browser E2E is missing WCAG 2.2 AA coverage.'],
    [authenticatedSpec, '/admin/operations', 'Authenticated browser E2E does not traverse operations.'],
    [authenticatedSpec, '/admin/customers', 'Authenticated browser E2E does not traverse customers.'],
    [k6, 'http_req_failed', 'k6 smoke test is missing error-rate threshold.'],
    [k6, 'http_req_duration', 'k6 smoke test is missing latency threshold.'],
  ]

  for (const [source, token, message] of requiredTokens) {
    if (!source.includes(token)) issues.push(message)
  }
}

if (issues.length > 0) {
  console.error('Gridex open-source E2E tooling regression failed:')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log('Gridex open-source E2E tooling regression passed: Playwright + axe-core + k6 + OWASP ZAP are pinned and wired.')
