import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Step = { name?: string; shell?: string; env?: Record<string, string>; run?: string }
type Workflow = { jobs: Record<string, { environment?: string; steps: Step[] }> }
const { load } = createRequire(import.meta.url)('js-yaml') as { load(source: string): Workflow }
const workflows = '.github/workflows/'
const marker = 'GRIDEX_CONFIRM_INPUT_EXECUTED'
const targets = [
  { file: 'canonical-quote-db-release-gate.yml', job: 'quote-db-release-gate', name: 'Require explicit manual confirmation when dispatched', inputs: { confirm_gate: 'GRIDEX_OPS_QUOTE_GATE' } },
  { file: 'tenant-isolation-invariants.yml', job: 'tenant-isolation-invariants', name: 'Require explicit manual confirmation when dispatched', inputs: { confirm_gate: 'GRIDEX_OPS_TENANT_INVARIANTS' } },
  { file: 'production-certification-e2e.yml', job: 'preflight', name: 'Confirm production and target configuration', inputs: { confirm_production: 'PRODUCTION' } },
  { file: 'production-certification-e2e.yml', job: 'tenant-bootstrap', name: 'Confirm explicit synthetic production mutation', inputs: { confirm_production: 'PRODUCTION', confirm_synthetic_tenant: 'CREATE_SYNTHETIC_TENANT' } },
  { file: 'production-certification-e2e.yml', job: 'tenant-admin-verify', name: 'Confirm manual Strato verification checkpoint', inputs: { confirm_production: 'PRODUCTION', confirm_tenant_admin: 'VERIFIED_TENANT_ADMIN_MANUALLY' } },
  { file: 'production-certification-e2e.yml', job: 'live-customer-preflight', name: 'Confirm authorized live customer quote', inputs: { confirm_production: 'PRODUCTION', confirm_live_customer: 'AUTHORIZED_LIVE_CUSTOMER' } },
]
const syntheticSecrets: Record<string, string> = {
  GRIDEX_E2E_PROD_BASE_URL: 'https://app.gridex.se',
  GRIDEX_E2E_TENANT_WEBSITE_URL: 'https://gridex.se',
  GRIDEX_E2E_SUPERADMIN_EMAIL: 'synthetic-admin@example.test',
  GRIDEX_E2E_SUPERADMIN_PASSWORD: 'synthetic-admin-placeholder-only',
  GRIDEX_E2E_TENANT_ADMIN_EMAIL: 'synthetic-tenant@example.test',
  GRIDEX_E2E_TENANT_ADMIN_PASSWORD: 'synthetic-tenant-placeholder-only',
  GRIDEX_E2E_CUSTOMER_ADDRESS: 'Synthetic test street',
  GRIDEX_E2E_CUSTOMER_POSTAL_CODE: '00000',
  GRIDEX_E2E_CUSTOMER_CITY: 'Synthetic fixture',
  GRIDEX_E2E_CUSTOMER_ANNUAL_KWH: '1000',
}

function confirmationStep(target: typeof targets[number]) {
  const document = load(fs.readFileSync(path.resolve(import.meta.dirname, '..', workflows, target.file), 'utf8'))
  const job = document.jobs[target.job]
  expect(job.environment).toBe('production-e2e')
  const step = job.steps.find((candidate) => candidate.name === target.name)
  if (!step?.run || step.shell !== 'bash') throw new Error('Missing named Bash confirmation step')
  return step as Step & { run: string }
}

function runConfirmation(target: typeof targets[number], inputs: Record<string, string>, secrets = syntheticSecrets) {
  const step = confirmationStep(target)
  // Model expression expansion into script or env exactly where the YAML places
  // it. Deliberately do not interpolate/re-evaluate values expanded into env.
  const resolve = (source: string) => source.replace(/\$\{\{\s*(inputs|secrets)\.([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, scope: string, key: string) => (scope === 'inputs' ? inputs : secrets)[key] ?? '')
  const script = resolve(step.run)
  expect(script).not.toContain('${{')
  const resolvedStepEnv = Object.fromEntries(Object.entries(step.env ?? {}).map(([key, value]) => [key, resolve(value)]))
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', ...resolvedStepEnv }
  // Execute only the six selected guard blocks. No job, action, downstream
  // command, credential from process.env, provider or network request is used.
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', script], { env, timeout: 2_000 })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (value: string) => {
      stdout += value
      if (stdout.length > 32_768) { child.kill(); reject(new Error('Unexpected guard output volume')) }
    })
    child.stderr.setEncoding('utf8').on('data', (value: string) => {
      stderr += value
      if (stderr.length > 32_768) { child.kill(); reject(new Error('Unexpected guard output volume')) }
    })
    child.once('error', reject)
    child.once('close', (status, signal) => {
      if (signal) reject(new Error(`Guard terminated by ${signal}`))
      else resolve({ status, stdout, stderr })
    })
  })
}

for (const target of targets) {
  describe(`${target.file}: ${target.job} confirmation`, () => {
    const validInputs: Record<string, string> = Object.fromEntries(Object.entries(target.inputs))
    it('accepts the exact original confirmations and synthetic target configuration', async () => {
      const result = await runConfirmation(target, validInputs)
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    })

    for (const input of Object.keys(target.inputs)) {
      it.each(['', 'WRONG', ` ${validInputs[input]}`, `${validInputs[input]}\n`])(`rejects invalid ${input} values %#`, async (value) => {
        const result = await runConfirmation(target, { ...validInputs, [input]: value })
          expect(result.status).toBe(1)
        expect(result.stderr).not.toContain(marker)
      })

      it.each([
        `$(printf ${marker} >&2)`,
        '`printf ' + marker + ' >&2`',
        '" ]] || { printf ' + marker + ' >&2; exit 0; }; #',
      ])(`treats shell syntax in ${input} as literal data %#`, async (value) => {
        const result = await runConfirmation(target, { ...validInputs, [input]: value })
          expect(result.status).toBe(1)
        expect(result.stdout).not.toContain(marker)
        expect(result.stderr).not.toContain(marker)
      })
    }

    if (target.file === 'production-certification-e2e.yml') {
      it('keeps the production target allowlist effective', async () => {
        const result = await runConfirmation(target, validInputs, { ...syntheticSecrets, GRIDEX_E2E_PROD_BASE_URL: 'https://invalid.example.test' })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('OPS production target must be')
      })
      it('keeps the required credential/fixture configuration guard effective', async () => {
        const secrets = Object.fromEntries(Object.entries(syntheticSecrets).filter(([key]) => key !== 'GRIDEX_E2E_PROD_BASE_URL'))
        const result = await runConfirmation(target, validInputs, secrets)
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('Missing required secret: GRIDEX_E2E_PROD_BASE_URL')
      })
    }
  })
}
