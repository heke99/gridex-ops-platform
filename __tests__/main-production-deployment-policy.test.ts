// Source/config component contract only: no deployment, provider request or effective-live claim.
// Vercel Git policy semantics: https://vercel.com/docs/project-configuration/git-configuration
// Unspecified branches default true; if multiple patterns match, any true enables deployment.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
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

const mainSha = 'b'.repeat(40)
const otherSha = 'c'.repeat(40)
const projectId = 'synthetic-project'
const deploymentId = 'synthetic-deployment'
const canonicalRepository = 'heke99/gridex-ops-platform'
const origin = `https://github.com/${canonicalRepository}`
const readyDeployment = {
  id: deploymentId, projectId, target: 'production', readyState: 'READY', meta: { githubCommitSha: mainSha },
}

function manualProductionFixture() {
  const home = mkdtempSync(join(tmpdir(), 'main-deploy-guard-'))
  homes.push(home)
  const bin = join(home, 'bin')
  mkdirSync(bin)
  const jq = spawnSync('/bin/bash', ['-c', 'command -v jq'], { encoding: 'utf8', timeout: 1000 })
  expect(jq.status).toBe(0)
  symlinkSync(jq.stdout.trim(), join(bin, 'jq'))
  writeFileSync(join(bin, 'seq'), '#!/bin/bash\nprintf "1\\n"\n', { mode: 0o700 })
  writeFileSync(join(bin, 'git'), `#!/bin/bash
case "$*" in
  'remote get-url origin') printf '%s\\n' "$FIXTURE_ORIGIN" ;;
  'rev-parse HEAD') printf '%s\\n' "$FIXTURE_CHECKOUT" ;;
  'ls-remote --exit-code origin refs/heads/main') printf '%s\\n' "$FIXTURE_MAIN" ;;
  *) exit 80 ;;
esac
`, { mode: 0o700 })
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
while (( $# )); do
  if [[ "$1" == --data ]]; then
    printf '%s' "$2" > "$FIXTURE_POST"
    printf '%s\\n' '{"id":"synthetic-deployment","url":"synthetic.vercel.app"}'
    exit 0
  fi
  shift
done
printf '%s\\n' "$FIXTURE_RESPONSE"
`, { mode: 0o700 })
  const postedPath = join(home, 'post.json')
  const steps = workflow.jobs.deploy.steps
  return {
    posted: () => existsSync(postedPath) ? JSON.parse(readFileSync(postedPath, 'utf8')) : null,
    run(name: string, fixture: Record<string, string | undefined> = {}) {
      const step = steps.find(candidate => candidate.name === name)
      expect(step?.run).toBeTypeOf('string')
      const result = spawnSync('/bin/bash', ['-c', step!.run!], {
        encoding: 'utf8', timeout: 5000, env: {
          PATH: bin, GITHUB_OUTPUT: join(home, 'output'),
          GITHUB_REPOSITORY: canonicalRepository, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: mainSha,
          VERCEL_TOKEN: 'synthetic-component-only', VERCEL_TEAM_ID: 'synthetic-team',
          VERCEL_PROJECT_ID: projectId, VERCEL_REPO_ID: '123', DEPLOYMENT_ID: deploymentId,
          FIXTURE_ORIGIN: `${origin}.git`, FIXTURE_CHECKOUT: mainSha,
          FIXTURE_MAIN: `${mainSha}\trefs/heads/main`, FIXTURE_POST: postedPath,
          FIXTURE_RESPONSE: JSON.stringify(readyDeployment), ...fixture, NODE_ENV: 'test',
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.stdout + result.stderr).not.toContain('synthetic-component-only')
      return result
    },
  }
}

describe('explicit production dispatch provenance', () => {
  const verify = 'Verify the requested production source'
  const create = 'Create production deployment from current main commit'
  const ready = 'Wait for production deployment'

  it('keeps the legacy main dispatch and accepts a matching optional commit', () => {
    const fixture = manualProductionFixture()
    expect(workflow.jobs.deploy.steps[0].name).toBe(verify)
    expect(fixture.run(verify).status).toBe(0)
    expect(fixture.run(verify, { EXPECTED_DEPLOY_SHA: mainSha }).status).toBe(0)
    expect(fixture.posted()).toBeNull()
  })

  it.each([
    { GITHUB_REPOSITORY: 'synthetic/other-repository' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REF: 'refs/tags/main' },
    { GITHUB_SHA: mainSha.slice(0, 8) },
    { EXPECTED_DEPLOY_SHA: otherSha },
  ])('rejects an unqualified dispatch before checkout %#', invalid => {
    const fixture = manualProductionFixture()
    expect(fixture.run(verify, invalid).status).toBe(1)
    expect(fixture.posted()).toBeNull()
  })

  it('fails an explicit production job when the detector cannot find a credential', () => {
    const fixture = manualProductionFixture()
    const step = workflow.jobs.deploy.steps.find(candidate => candidate.name === 'Require Vercel deployment credential for manual deployment')
    expect(step).toMatchObject({ if: "steps.credential.outputs.available != 'true'" })
    expect(fixture.run(step!.name!, { VERCEL_TOKEN: '' }).status).toBe(1)
    expect(fixture.posted()).toBeNull()
  })

  it.each([
    { FIXTURE_ORIGIN: 'https://github.com/synthetic/other-repository' },
    { FIXTURE_CHECKOUT: otherSha },
    { FIXTURE_MAIN: '' },
    { FIXTURE_MAIN: `${otherSha}\trefs/heads/main` },
    { FIXTURE_MAIN: `${mainSha}\trefs/heads/main\n${otherSha}\trefs/heads/main` },
  ])('stops before provider entry on source mismatch %#', invalid => {
    const fixture = manualProductionFixture()
    expect(fixture.run(create, invalid).status).toBe(1)
    expect(fixture.posted()).toBeNull()
  })

  it('passes the exact current main commit and target to the provider', () => {
    const fixture = manualProductionFixture()
    expect(fixture.run(create, { FIXTURE_ORIGIN: origin }).status).toBe(0)
    expect(fixture.posted()).toMatchObject({
      project: projectId, target: 'production',
      gitSource: { type: 'github', repoId: '123', ref: 'main', sha: mainSha },
    })
  })

  it('accepts READY only for the same deployment, project and commit', () => {
    const fixture = manualProductionFixture()
    expect(fixture.run(ready).status).toBe(0)
    const nested = {
      ...readyDeployment, projectId: undefined, project: { id: projectId },
      gitSource: { sha: mainSha }, meta: undefined,
    }
    expect(fixture.run(ready, { FIXTURE_RESPONSE: JSON.stringify(nested) }).status).toBe(0)
  })

  it.each([
    { id: 'synthetic-other' },
    { projectId: 'synthetic-other' },
    { projectId: undefined },
    { project: { id: 'synthetic-other' } },
    { target: 'preview' },
    { gitSource: { sha: otherSha } },
    { meta: undefined },
    { readyState: 'ERROR' },
    { readyState: 'CANCELED' },
  ])('rejects unsupported or divergent deployment readback %#', invalid => {
    const fixture = manualProductionFixture()
    const FIXTURE_RESPONSE = JSON.stringify({ ...readyDeployment, ...invalid, opaque: 'synthetic-private-field' })
    const result = fixture.run(ready, { FIXTURE_RESPONSE })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).not.toContain('synthetic-private-field')
  })
})
