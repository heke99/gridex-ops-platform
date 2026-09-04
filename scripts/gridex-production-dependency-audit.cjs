#!/usr/bin/env node
/**
 * Production dependency audit gate.
 *
 * `npm audit` conflates two very different outcomes in one exit code: "this
 * tree contains a high severity advisory" and "the registry did not answer".
 * The second is transient and, on a mandatory gate, blocks every merge for as
 * long as npm is having a bad day — which is what happened to run 2450 on main,
 * where the audit endpoint returned 503 after hanging for seven minutes.
 *
 * This keeps the gate fail-closed: an unreachable registry still fails, because
 * an audit that did not run is not a clean audit. It just retries the transient
 * case first, bounds how long it may hang, and says which of the two happened.
 */

const { spawnSync } = require('node:child_process')

const AUDIT_LEVEL = process.env.GRIDEX_AUDIT_LEVEL || 'high'
const BLOCKING_SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info']
const ATTEMPTS = Number(process.env.GRIDEX_AUDIT_ATTEMPTS || 4)
const ATTEMPT_TIMEOUT_MS = Number(process.env.GRIDEX_AUDIT_TIMEOUT_MS || 120000)

const blocking = BLOCKING_SEVERITIES.slice(0, BLOCKING_SEVERITIES.indexOf(AUDIT_LEVEL) + 1)
if (blocking.length === 0) {
  console.error(`dependency audit: unknown audit level "${AUDIT_LEVEL}"`)
  process.exit(2)
}

function runAudit() {
  const result = spawnSync(
    'npm',
    ['audit', '--omit=dev', `--audit-level=${AUDIT_LEVEL}`, '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: ATTEMPT_TIMEOUT_MS },
  )
  if (result.error?.code === 'ETIMEDOUT') {
    return { kind: 'unreachable', detail: `npm audit exceeded ${ATTEMPT_TIMEOUT_MS}ms` }
  }
  if (result.error) return { kind: 'unreachable', detail: result.error.message }

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    // npm prints a human-readable error instead of a report when the audit
    // endpoint fails, so unparseable output means the audit did not run.
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' ')
    return { kind: 'unreachable', detail: detail || 'npm audit produced no report' }
  }
  if (report?.error) {
    // npm sometimes reports the error with both fields empty, so fall back to
    // whatever it wrote to stderr rather than printing "{}" at the operator.
    const detail =
      report.error.summary?.trim() ||
      report.error.detail?.trim() ||
      (result.stderr || '').trim().split('\n').slice(-2).join(' ') ||
      `npm audit failed with code ${report.error.code ?? 'unknown'}`
    return { kind: 'unreachable', detail }
  }
  const counts = report?.metadata?.vulnerabilities
  if (!counts) return { kind: 'unreachable', detail: 'npm audit report carried no vulnerability metadata' }
  return { kind: 'report', counts, report }
}

const sleep = (ms) => {
  // Deliberately synchronous: this is a gate, not a server, and the retry must
  // finish before the process may report a verdict.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

let last = null
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  last = runAudit()
  if (last.kind === 'report') break
  console.warn(`dependency audit: attempt ${attempt}/${ATTEMPTS} could not reach the registry (${last.detail})`)
  if (attempt < ATTEMPTS) sleep(2000 * 2 ** (attempt - 1))
}

if (last.kind !== 'report') {
  // Fail closed. An audit that never ran is not a passing audit.
  console.error(
    `dependency audit: FAILED TO RUN after ${ATTEMPTS} attempts — the npm audit endpoint ` +
      `was unreachable (${last.detail}). This is not a vulnerability finding; re-run the job.`,
  )
  process.exit(1)
}

const offending = blocking
  .map((severity) => [severity, last.counts[severity] ?? 0])
  .filter(([, count]) => count > 0)

const summary = Object.entries(last.counts)
  .filter(([key]) => key !== 'total')
  .map(([key, value]) => `${key}=${value}`)
  .join(' ')

if (offending.length > 0) {
  console.error(`dependency audit: production vulnerabilities at or above "${AUDIT_LEVEL}" (${summary})`)
  for (const [severity, count] of offending) console.error(`  ${severity}: ${count}`)
  console.error('Run `npm audit --omit=dev` for the advisories.')
  process.exit(1)
}

console.log(`Production dependency audit passed (${summary}).`)
