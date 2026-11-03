// Source/config component contract only: no deployment, provider request or effective-live claim.
// Vercel Git policy semantics: https://vercel.com/docs/project-configuration/git-configuration
// Unspecified branches default true; if multiple patterns match, any true enables deployment.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { load } = require('js-yaml') as { load: (text: string) => unknown }
const { isMatch } = require('picomatch') as { isMatch: (value: string, pattern: string) => boolean }
type Policy = boolean | Record<string, boolean> | undefined
type Workflow = { on: Record<string, unknown>; jobs: { deploy: {
  if?: string; steps: { name?: string; run?: string }[]
} } }
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as { git?: { deploymentEnabled?: Policy } }
const workflow = load(readFileSync(new URL('../.github/workflows/vercel-production-deploy.yml', import.meta.url), 'utf8')) as Workflow
const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

// This is the documented configuration interpretation, not an observation of Vercel's service.
function gitDeploymentAllowed(branch: string, policy: Policy = config.git?.deploymentEnabled): boolean {
  if (policy === undefined) return true
  if (typeof policy === 'boolean') return policy
  const matches = Object.entries(policy).filter(([pattern]) => isMatch(branch, pattern))
  return matches.length ? matches.some(([, enabled]) => enabled === true) : true
}
function deployJobAllowed(eventName: string): boolean {
  const expression = workflow.jobs.deploy.if
  if (expression === undefined) return true // GitHub's default for this job with no needs.
  // Execute the actual simple field-equality condition; unsupported expressions fail closed here.
  return runInNewContext(`Boolean(${expression})`, { github: { event_name: eventName, ref: 'refs/heads/main' } }, { timeout: 1000 }) as boolean
}
function detectCredential(syntheticToken: string): string {
  const script = workflow.jobs.deploy.steps.find(step => step.name === 'Detect Vercel deployment credential')?.run
  expect(script).toBeTypeOf('string')
  const home = mkdtempSync(join(tmpdir(), 't4-main-deploy-policy-')); homes.push(home)
  const emptyBin = join(home, 'empty-bin'); mkdirSync(emptyBin)
  const output = join(home, 'github-output')
  // Actual detector uses only Bash builtins. No ambient token or external commands are inherited.
  const result = spawnSync('/bin/bash', ['-c', script!], { encoding: 'utf8', timeout: 5000,
    env: { NODE_ENV: 'test', PATH: emptyBin, GITHUB_OUTPUT: output, VERCEL_TOKEN: syntheticToken } })
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0)
  return readFileSync(output, 'utf8').trim()
}

describe('automatic main production deployment boundaries', () => {
  it('disables the actual configured Git auto-deployment path for main', () => {
    expect(gitDeploymentAllowed('main')).toBe(false)
  })
  it.each(['feature/test', 'main-preview', 'maintenance', 'release/v1', 'dev'])('preserves the default enabled policy for %s', branch => {
    expect(gitDeploymentAllowed(branch)).toBe(true)
  })
  it('uses the documented any-true rule when patterns overlap', () => {
    expect(gitDeploymentAllowed('experiment-one-dev', { 'experiment-*': false, '*-dev': true })).toBe(true)
  })
  it.each(['push', 'pull_request', 'schedule', 'workflow_run', 'repository_dispatch'])('does not admit the production job on %s', event => {
    expect(deployJobAllowed(event)).toBe(false)
  })
  it('retains the existing explicit manual route without granting execution authority', () => {
    expect(Object.hasOwn(workflow.on, 'workflow_dispatch')).toBe(true)
    expect(deployJobAllowed('workflow_dispatch')).toBe(true)
  })
  it('keeps the actual manual credential detector closed when no token is configured', () => {
    expect(detectCredential('')).toBe('available=false')
  })
  it('keeps the actual manual credential detector available for a synthetic configured token', () => {
    expect(detectCredential('synthetic-component-only')).toBe('available=true')
  })
})
