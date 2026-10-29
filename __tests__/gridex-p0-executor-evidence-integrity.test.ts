import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../scripts/gridex-p0-executor.cjs', import.meta.url), 'utf8')
const root = path.resolve('/synthetic/p0-evidence-project')
const firstId = 'GRIDEX-P0-001'
const secondId = 'GRIDEX-P0-002'
const browserSpec = 'e2e/browser/synthetic.spec.mjs'

type Manifest = { scenarios: Record<string, { npm_scripts: string[]; browser_specs: string[] }> }
type ChildResult = { status: number | null; error?: Error; signal?: string }
type Scenario = {
  id: string
  status: string
  deterministic_support_status: string
  browser_boundary_status: string
  full_journey_status: string
  deterministic_gates: Array<{ script: string; status: string; exit_code: number }>
  browser_specs: string[]
}
type Evidence = {
  schema_version: number
  commit_sha: string | null
  validation_status: string
  mapping_validation_status: string
  deterministic_support_status: string
  browser_boundary_status: string
  full_journey_status: string
  execution_requested: boolean
  requested_scenarios: string[]
  unexecuted_scenarios: string[]
  scenarios: Scenario[]
  issues: string[]
}

const defaultManifest = (): Manifest => ({ scenarios: {
  [firstId]: { npm_scripts: ['synthetic:gate-a', 'synthetic:gate-b'], browser_specs: [browserSpec] },
  [secondId]: { npm_scripts: ['synthetic:gate-c'], browser_specs: [] },
} })

class ScriptExit extends Error {
  constructor(readonly code: number) { super(`script exited ${code}`) }
}

// Run the complete production CLI and inspect its actual serialized artifact.
// Only file/process boundaries are replaced. No npm, browser or producer runs.
function runExecutor({
  args = [] as string[],
  manifest = defaultManifest(),
  scripts = { 'synthetic:gate-a': 'synthetic only', 'synthetic:gate-b': 'synthetic only', 'synthetic:gate-c': 'synthetic only' } as Record<string, string>,
  missingBrowser = false,
  children = [] as ChildResult[],
} = {}) {
  const files = new Map([
    [path.join(root, 'PROJECT_E2E.yaml'), `scenarios:\n  - id: ${firstId}\n  - id: ${secondId}\n`],
    [path.join(root, 'e2e/p0-executors.json'), JSON.stringify(manifest)],
    [path.join(root, 'package.json'), JSON.stringify({ scripts })],
  ])
  const writes = new Map<string, string>()
  const calls: Array<{ command: string; args: string[] }> = []
  const stdout: string[] = []
  const stderr: string[] = []
  const fs = {
    mkdirSync(directory: string) {
      if (directory !== path.join(root, 'e2e-artifacts')) throw new Error(`unexpected directory: ${directory}`)
    },
    readFileSync(file: string) {
      if (!files.has(file)) throw new Error(`unexpected read: ${file}`)
      return files.get(file)
    },
    existsSync(file: string) { return file === path.join(root, browserSpec) && !missingBrowser },
    writeFileSync(file: string, text: string) { writes.set(file, text) },
  }
  let exitCode = 0
  try {
    runInNewContext(source, {
      __dirname: path.join(root, 'scripts'),
      require(name: string) {
        if (name === 'node:fs') return fs
        if (name === 'node:path') return path
        if (name === 'node:child_process') return {
          spawnSync(command: string, args: string[]) {
            const result = children[calls.length] ?? { status: 0 }
            calls.push({ command, args })
            return result
          },
        }
        throw new Error(`unexpected module: ${name}`)
      },
      process: {
        argv: ['node', 'gridex-p0-executor.cjs', ...args], platform: 'linux',
        env: { GITHUB_SHA: 'synthetic-commit-only' },
        exit(code: number) { throw new ScriptExit(code) },
      },
      console: {
        log: (...args: unknown[]) => stdout.push(args.join(' ')),
        error: (...args: unknown[]) => stderr.push(args.join(' ')),
      },
    }, { filename: 'gridex-p0-executor.cjs', timeout: 1000 })
  } catch (error) {
    if (!(error instanceof ScriptExit)) throw error
    exitCode = error.code
  }
  expect([...writes.keys()]).toEqual([path.join(root, 'e2e-artifacts/gridex-p0-executor-evidence.json')])
  const evidence = JSON.parse([...writes.values()][0]) as Evidence
  return { exitCode, evidence, calls, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
}

function expectNoJourneyAttestation(evidence: Evidence) {
  expect(evidence.browser_boundary_status).toBe('not_executed')
  expect(evidence.full_journey_status).toBe('not_verified')
  for (const scenario of evidence.scenarios) {
    expect(scenario.status).not.toBe('passed')
    expect(scenario.browser_boundary_status).toBe('not_executed')
    expect(scenario.full_journey_status).toBe('not_verified')
  }
}

describe('P0 executor evidence scope', () => {
  it('keeps no-argument mapping validation successful without executing any gates or claiming journey evidence', () => {
    const result = runExecutor()
    expect(result.exitCode).toBe(0)
    expect(result.calls).toEqual([])
    expect(result.evidence.validation_status).toBe('passed')
    expect(result.evidence.mapping_validation_status).toBe('passed')
    expect(result.evidence.deterministic_support_status).toBe('not_executed')
    expect(result.evidence.execution_requested).toBe(false)
    expect(result.evidence.scenarios).toEqual([])
    expectNoJourneyAttestation(result.evidence)
    expect(result.stdout).toContain('P0 mapping validated')
    expect(result.stdout).not.toContain('P0 executor contract passed')
  })

  it('records passing npm gates as deterministic support while the selected P0 scenario stays unverified', () => {
    const result = runExecutor({ args: [`--scenario=${firstId}`] })
    expect(result.exitCode).toBe(0)
    expect(result.evidence.scenarios[0].status).toBe('not_verified')
    expect(result.evidence.scenarios[0].deterministic_support_status).toBe('passed')
    expect(result.evidence.scenarios[0].deterministic_gates.map(gate => [gate.script, gate.status, gate.exit_code])).toEqual([
      ['synthetic:gate-a', 'passed', 0], ['synthetic:gate-b', 'passed', 0],
    ])
    expect(result.evidence.scenarios[0].browser_specs).toEqual([browserSpec])
    expect(result.evidence.requested_scenarios).toEqual([firstId])
    expect(result.evidence.unexecuted_scenarios).toEqual([])
    expect(result.calls).toEqual([
      { command: 'npm', args: ['run', 'synthetic:gate-a'] },
      { command: 'npm', args: ['run', 'synthetic:gate-b'] },
    ])
    expectNoJourneyAttestation(result.evidence)
  })

  it('keeps full-journey evidence unverified when all selected support gates passed, including a scenario with no browser mapping', () => {
    const result = runExecutor({ args: ['--all'] })
    expect(result.exitCode).toBe(0)
    expect(result.calls).toHaveLength(3)
    expect(result.evidence.requested_scenarios).toEqual([firstId, secondId])
    expect(result.evidence.scenarios.map(row => row.id)).toEqual([firstId, secondId])
    expect(result.evidence.deterministic_support_status).toBe('passed')
    expect(result.evidence.scenarios[1].browser_specs).toEqual([])
    expect(result.stdout).toContain('deterministic support passed')
    expect(result.stdout).toContain('browser and full journey evidence not verified')
    expectNoJourneyAttestation(result.evidence)
  })

  it('does not mistake an existing browser spec file for executed browser evidence', () => {
    const manifest = defaultManifest()
    manifest.scenarios[secondId].browser_specs = [browserSpec]
    const result = runExecutor({ args: ['--all'], manifest })
    expect(result.evidence.scenarios.every(row => row.deterministic_support_status === 'passed')).toBe(true)
    expect(result.calls.every(call => call.command === 'npm')).toBe(true)
    expectNoJourneyAttestation(result.evidence)
  })

  it('preserves the checkout SHA as metadata without promoting it to journey qualification', () => {
    const result = runExecutor()
    expect(result.evidence.commit_sha).toBe('synthetic-commit-only')
    expect(result.evidence.schema_version).toBe(2)
    expectNoJourneyAttestation(result.evidence)
  })
})

describe('P0 deterministic support failures', () => {
  it.each([
    ['nonzero exit', { status: 2 }],
    ['launch error', { status: null, error: new Error('synthetic spawn failure') }],
    ['termination', { status: null, signal: 'SIGTERM' }],
    ['error alongside zero status', { status: 0, error: new Error('synthetic buffer failure') }],
    ['signal alongside zero status', { status: 0, signal: 'SIGTERM' }],
  ] as const)('rejects %s without executing later gates or claiming full P0 success', (_name, child) => {
    const result = runExecutor({ args: ['--all'], children: [child] })
    expect(result.exitCode).toBe(1)
    expect(result.calls).toHaveLength(1)
    expect(result.evidence.mapping_validation_status).toBe('passed')
    expect(result.evidence.deterministic_support_status).toBe('failed')
    expect(result.evidence.scenarios[0].status).toBe('failed')
    expect(result.evidence.scenarios[0].deterministic_support_status).toBe('failed')
    expect(result.evidence.scenarios[0].deterministic_gates[0].exit_code).not.toBe(0)
    expect(result.evidence.unexecuted_scenarios).toEqual([secondId])
    expectNoJourneyAttestation(result.evidence)
  })

  it('retains the successful support result of the first scenario when a later scenario fails', () => {
    const result = runExecutor({ args: ['--all'], children: [{ status: 0 }, { status: 0 }, { status: 1 }] })
    expect(result.exitCode).toBe(1)
    expect(result.evidence.scenarios.map(row => row.deterministic_support_status)).toEqual(['passed', 'failed'])
    expect(result.evidence.scenarios.map(row => row.status)).toEqual(['not_verified', 'failed'])
    expect(result.evidence.unexecuted_scenarios).toEqual([])
    expectNoJourneyAttestation(result.evidence)
  })
})

describe('P0 mapping validation remains a prerequisite', () => {
  it.each(['missing scenario', 'no npm gates', 'unknown package script', 'extra scenario'] as const)('rejects %s before running any support', change => {
    const manifest = defaultManifest()
    if (change === 'missing scenario') delete manifest.scenarios[firstId]
    if (change === 'no npm gates') manifest.scenarios[firstId].npm_scripts = []
    if (change === 'unknown package script') manifest.scenarios[firstId].npm_scripts = ['missing:script']
    if (change === 'extra scenario') manifest.scenarios['GRIDEX-P0-999'] = { npm_scripts: ['synthetic:gate-a'], browser_specs: [] }
    const result = runExecutor({ args: ['--all'], manifest })
    expect(result.exitCode).toBe(1)
    expect(result.calls).toEqual([])
    expect(result.evidence.validation_status).toBe('failed')
    expect(result.evidence.mapping_validation_status).toBe('failed')
    expect(result.evidence.deterministic_support_status).toBe('not_executed')
    expect(result.evidence.unexecuted_scenarios).toEqual([firstId, secondId])
    expect(result.evidence.issues.length).toBeGreaterThan(0)
    expectNoJourneyAttestation(result.evidence)
  })

  it('still rejects a missing mapped browser file without running it', () => {
    const result = runExecutor({ args: ['--all'], missingBrowser: true })
    expect(result.exitCode).toBe(1)
    expect(result.calls).toEqual([])
    expect(result.evidence.issues).toEqual([`${firstId} references missing browser spec: ${browserSpec}`])
    expect(result.evidence.deterministic_support_status).toBe('not_executed')
    expectNoJourneyAttestation(result.evidence)
  })

  it('rejects an unknown requested scenario without claiming any execution', () => {
    const result = runExecutor({ args: ['--scenario=GRIDEX-P0-999'] })
    expect(result.exitCode).toBe(1)
    expect(result.calls).toEqual([])
    expect(result.evidence.issues).toContain('Unknown requested P0 scenario: GRIDEX-P0-999')
    expect(result.evidence.requested_scenarios).toEqual(['GRIDEX-P0-999'])
    expect(result.evidence.unexecuted_scenarios).toEqual(['GRIDEX-P0-999'])
    expectNoJourneyAttestation(result.evidence)
  })
})
