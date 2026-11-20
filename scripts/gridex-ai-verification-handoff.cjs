#!/usr/bin/env node
'use strict'

const { isUtf8 } = require('node:buffer')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const artifactDir = path.join(root, 'e2e-artifacts')
fs.mkdirSync(artifactDir, { recursive: true })
const outputName = 'ai-verification-handoff.json'
const vitestReceiptPrefix = 'vitest-file-receipt-'
const maximumVitestReceiptBytes = 1024 * 1024
const maximumVitestFiles = 10_000
const gitHash = /^[a-f0-9]{40}$/
const secretKey = /(password|passwd|secret|token|cookie|authorization|bearer|api[_-]?key|service[_-]?role|private[_-]?key|certificate|credential)/i
const secretValue = /(Bearer\s+[A-Za-z0-9._~+\/-]+|sk[-_][A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/gi

function sanitize(value, key = '') {
  if (secretKey.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => sanitize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]))
  }
  if (typeof value === 'string') return value.replace(secretValue, '[REDACTED]')
  return value
}

function checkoutIdentity() {
  try {
    const [commit, tree] = execFileSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD', 'HEAD^{tree}'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000, maxBuffer: 1024,
    }).trimEnd().split('\n')
    return gitHash.test(commit) && gitHash.test(tree) ? { commit, tree } : null
  } catch {
    return null
  }
}

function readVitestReceipt(file) {
  const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = fs.constants
  const descriptor = fs.openSync(file, O_RDONLY | O_NONBLOCK | O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > maximumVitestReceiptBytes) throw new Error('Invalid Vitest receipt size or type')
    const buffer = Buffer.alloc(stat.size + 1)
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
    if (length !== stat.size) throw new Error('Vitest receipt changed during read')
    const content = buffer.subarray(0, length)
    if (!isUtf8(content)) throw new Error('Vitest receipt is not valid UTF-8')
    return JSON.parse(content.toString('utf8'))
  } finally {
    fs.closeSync(descriptor)
  }
}

function workflowBinding(job) {
  const { GITHUB_ACTIONS, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, GITHUB_JOB: name } = process.env
  if (GITHUB_ACTIONS !== 'true' && !runId && !runAttempt && !name && job == null) return 'local_checkout'
  const number = /^[1-9][0-9]{0,19}$/
  const jobId = /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/
  if (GITHUB_ACTIONS === 'true' && runId && runAttempt && name && number.test(runId) && number.test(runAttempt) && jobId.test(name) &&
    job?.runId === runId && job.runAttempt === runAttempt && job.job === name) return 'github_job'
  return 'unverified'
}

function vitestReceiptSummary(file, receipt, checkout) {
  const incomplete = (reason) => ({ file, state: 'incomplete', reason, observed_result: null })
  if (receipt?.schema !== 'gridex-vitest-file-receipt-v1') return incomplete('invalid_receipt')
  if (!checkout) return incomplete('checkout_unavailable')
  if (receipt.source?.commit !== checkout.commit || receipt.source?.tree !== checkout.tree) {
    return incomplete('checkout_mismatch')
  }
  const binding = workflowBinding(receipt.workflowJob)
  if (binding === 'unverified') return incomplete('execution_unverified')
  if (receipt.state !== 'complete' || receipt.source.clean !== true || receipt.sourceUnchanged !== true) {
    return incomplete('receipt_incomplete')
  }
  const count = receipt.expectedFileCount
  const unhandledErrors = receipt.unhandledErrorCount
  if (receipt.integrityFailures !== 0 || !['passed', 'failed'].includes(receipt.reason) ||
    !Number.isSafeInteger(unhandledErrors) || unhandledErrors < 0 || !Number.isInteger(count) ||
    count < 1 || count > maximumVitestFiles || !Array.isArray(receipt.files) || receipt.files.length !== count) {
    return incomplete('invalid_dispositions')
  }
  const dispositions = { passed: 0, failed: 0, skipped: 0 }
  const ids = new Set()
  for (const row of receipt.files) {
    if (typeof row?.id !== 'string' || !row.id || ids.has(row.id) ||
      typeof row.file !== 'string' || !row.file || row.file.split('/').some((part) => !part || part === '..' || part === '.') ||
      typeof row.project !== 'string' || typeof row.pool !== 'string' || !row.pool ||
      typeof row.status !== 'string' || !Object.hasOwn(dispositions, row.status)) return incomplete('invalid_dispositions')
    ids.add(row.id)
    dispositions[row.status] += 1
  }
  const failed = receipt.reason === 'failed' || dispositions.failed > 0 || unhandledErrors > 0
  const observedResult = failed ? 'failed' : dispositions.passed > 0 ? 'passed' : 'skipped'
  return {
    file, state: 'complete', binding, observed_result: observedResult,
    selected_file_count: count, dispositions, unhandled_error_count: unhandledErrors,
  }
}

const files = fs.readdirSync(artifactDir)
  .filter((name) => name.endsWith('.json') && name !== outputName)
  .sort()

const evidence = []
const failures = []
const vitestReceipts = []
const checkout = files.some((name) => name.startsWith(vitestReceiptPrefix)) ? checkoutIdentity() : null
for (const name of files) {
  const fullPath = path.join(artifactDir, name)
  const isVitestReceipt = name.startsWith(vitestReceiptPrefix)
  try {
    const payload = isVitestReceipt ? readVitestReceipt(fullPath) : JSON.parse(fs.readFileSync(fullPath, 'utf8'))
    const receipt = isVitestReceipt ? vitestReceiptSummary(name, payload, checkout) : null
    const parsed = sanitize(payload)
    const serialized = JSON.stringify(parsed)
    if (receipt) vitestReceipts.push(receipt)
    evidence.push({ file: name, data: parsed })
    if (receipt?.observed_result === 'failed' || /"status":"failed"|"status":\s*"failed"|"validation_status":"failed"|"validation_status":\s*"failed"/i.test(serialized)) {
      failures.push({ file: name, summary: 'Deterministic evidence contains a failed status. Inspect this artifact for the first broken boundary.' })
    }
  } catch (error) {
    if (isVitestReceipt) {
      vitestReceipts.push({ file: name, state: 'incomplete', reason: 'receipt_unreadable', observed_result: null })
      failures.push({ file: name, summary: 'The Vitest receipt could not be read as bounded JSON.' })
    } else {
      failures.push({ file: name, summary: `Evidence could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
}

const handoff = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  commit_sha: process.env.GITHUB_SHA || null,
  environment: process.env.GRIDEX_E2E_TARGET || process.env.VERCEL_ENV || process.env.NODE_ENV || null,
  ci_verdict_authority: 'deterministic-tests',
  ai_may_diagnose: true,
  ai_may_override_ci: false,
  instructions: 'Trace failed deterministic evidence to the first broken browser/API/domain/database/async boundary. Check incomplete Vitest evidence before interpreting the selected test files. A Vitest receipt covers only its own selection, and local checkout evidence has no workflow job binding. Never change expected behavior or security checks merely to make CI green.',
  failures,
  unit_file_receipts: vitestReceipts,
  evidence,
}
fs.writeFileSync(path.join(artifactDir, outputName), `${JSON.stringify(handoff, null, 2)}\n`)
console.log(`Wrote sanitized AI verification handoff from ${evidence.length} JSON evidence files.`)
