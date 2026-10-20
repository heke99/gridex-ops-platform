import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const script = readFileSync(new URL('../scripts/ediel-masterplan-test-coverage.cjs', import.meta.url), 'utf8')
const root = path.resolve('/synthetic/masterplan-project')
const testFiles = ['__tests__/first.test.ts', '__tests__/nested/second.test.ts']
const nodeFile = 'scripts/test-ediel-synthetic.cjs'

type Run = {
  status: number | null
  stdout: string | null
  stderr: string | null
  error?: Error
  signal?: string | null
}

const passedFile = (name: string) => ({
  name,
  status: 'passed',
  assertionResults: [{ title: 'asserts the contract', status: 'passed' }],
})
const completeReport = () => ({ success: true, testResults: testFiles.map(file => passedFile(path.join(root, file))) })
const reportedRun = (report: unknown): Run => ({ status: 0, stdout: JSON.stringify(report), stderr: '' })

class ScriptExit extends Error {
  constructor(readonly code: number) { super(`script exited ${code}`) }
}

// Exercise the entire production script with a small, read-only ledger and
// process boundary. No real test producer, database or filesystem write runs.
function runParser({
  vitest = reportedRun(completeReport()),
  node = { status: 0, stdout: '', stderr: '' } as Run,
  includeNodeScript = false,
  check = true,
} = {}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const calls: { command: string; args: string[] }[] = []
  const tag = (id: string) => ['//', 'masterplan:', id].join(' ')
  const contents = new Map([
    [path.join(root, 'quality/audits/ediel-masterplan-v2/coverage.json'), JSON.stringify({
      rules: [{ id: 'P-04', status: 'VERIFIED' }],
      acceptance_contracts: [{ id: 'AT-P-04', status: 'PASSED' }],
    })],
    [path.join(root, testFiles[0]), tag('P-04')],
    [path.join(root, testFiles[1]), tag('AT-P-04')],
    [path.join(root, nodeFile), tag('P-04')],
  ])
  const entry = (name: string, directory = false) => ({ name, isDirectory: () => directory })
  const fs = {
    readFileSync(file: string) {
      if (!contents.has(file)) throw new Error(`unexpected read: ${file}`)
      return contents.get(file)
    },
    readdirSync(directory: string) {
      if (directory === path.join(root, '__tests__')) return [entry('first.test.ts'), entry('nested', true)]
      if (directory === path.join(root, '__tests__/nested')) return [entry('second.test.ts')]
      if (directory === path.join(root, 'scripts')) return includeNodeScript ? [path.basename(nodeFile)] : []
      throw new Error(`unexpected directory: ${directory}`)
    },
  }
  let exitCode = 0
  try {
    runInNewContext(script, {
      __dirname: path.join(root, 'scripts'),
      require(name: string) {
        if (name === 'node:fs') return fs
        if (name === 'node:path') return path
        if (name === 'node:child_process') return {
          spawnSync(command: string, args: string[]) {
            calls.push({ command, args })
            if (command === 'npx') return vitest
            if (command === '/synthetic/node') return node
            throw new Error(`unexpected process: ${command}`)
          },
        }
        throw new Error(`unexpected module: ${name}`)
      },
      process: {
        argv: ['node', 'ediel-masterplan-test-coverage.cjs', ...(check ? ['--check'] : [])],
        execPath: '/synthetic/node',
        exit(code: number) { throw new ScriptExit(code) },
      },
      console: {
        log: (...args: unknown[]) => stdout.push(args.join(' ')),
        error: (...args: unknown[]) => stderr.push(args.join(' ')),
      },
    }, { filename: 'ediel-masterplan-test-coverage.cjs', timeout: 1000 })
  } catch (error) {
    if (!(error instanceof ScriptExit)) throw error
    exitCode = error.code
  }
  return { exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n'), calls }
}

function expectRejected(vitest: Run, check = true) {
  const result = runParser({ vitest, check })
  expect(result.exitCode).toBe(1)
  expect(result.stdout).not.toContain('tagged green 2')
  expect(result.stderr).not.toBe('')
}

describe('masterplan coverage runner integrity', () => {
  it('accepts one positive result for every requested file and preserves the ledger statuses', () => {
    const result = runParser()
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Masterplan IDs: 2; approved 2; tagged green 2; tagged failing 0; untagged 0')
    expect(result.stderr).toBe('')
    expect(result.calls).toEqual([{ command: 'npx', args: ['vitest', 'run', '--reporter=json', ...testFiles] }])
  })

  it('accepts relative result names and runner output before the JSON report', () => {
    const report = { success: true, testResults: testFiles.map(passedFile) }
    const result = runParser({ vitest: { status: 0, stdout: `runner log\n${JSON.stringify(report)}`, stderr: '' } })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('tagged green 2')
  })

  it.each([
    ['nonzero exit', { status: 1 }],
    ['launch failure', { status: null, error: new Error('spawn failed') }],
    ['terminated process', { status: null, signal: 'SIGTERM' }],
    ['missing exit status', { status: null }],
    ['error despite zero status', { status: 0, error: new Error('maxBuffer exceeded') }],
    ['signal despite zero status', { status: 0, signal: 'SIGTERM' }],
  ])('rejects %s even when stdout claims every test passed', (_name, outcome) => {
    expectRejected({ ...reportedRun(completeReport()), ...outcome })
  })

  it.each([true, false])('rejects a failed runner in check=%s mode', check => {
    expectRejected({ ...reportedRun(completeReport()), status: 1 }, check)
  })

  it.each([
    ['unsuccessful report', { ...completeReport(), success: false }],
    ['missing success flag', { testResults: completeReport().testResults }],
    ['nonboolean success flag', { ...completeReport(), success: 'true' }],
    ['null report', null],
    ['missing results', { success: true }],
    ['nonarray results', { success: true, testResults: {} }],
    ['empty results', { success: true, testResults: [] }],
    ['partial results', { success: true, testResults: [passedFile(testFiles[0])] }],
    ['duplicate results', { success: true, testResults: [passedFile(testFiles[0]), passedFile(testFiles[0])] }],
    ['extra result', { success: true, testResults: [...completeReport().testResults, passedFile('__tests__/other.test.ts')] }],
    ['outside-root result', { success: true, testResults: [passedFile('../first.test.ts'), passedFile(testFiles[1])] }],
    ['unnamed result', { success: true, testResults: [{ status: 'passed' }, passedFile(testFiles[1])] }],
    ['null result', { success: true, testResults: [null, passedFile(testFiles[1])] }],
  ])('rejects %s without attesting unreported files', (_name, report) => {
    expectRejected(reportedRun(report))
  })

  it.each(['', 'not JSON', '{"success":true', null])('rejects unreadable stdout %s without crashing', stdout => {
    expectRejected({ status: 0, stdout, stderr: null })
  })

  it.each([
    ['failed file', { ...passedFile(testFiles[0]), status: 'failed' }],
    ['pending file', { ...passedFile(testFiles[0]), status: 'pending' }],
    ['skipped file', { ...passedFile(testFiles[0]), status: 'skipped' }],
    ['empty assertions', { ...passedFile(testFiles[0]), assertionResults: [] }],
    ['missing assertions', { name: testFiles[0], status: 'passed' }],
    ['only skipped assertions', { ...passedFile(testFiles[0]), assertionResults: [{ status: 'pending' }] }],
    ['failed assertion inside passed file', { ...passedFile(testFiles[0]), assertionResults: [{ status: 'passed' }, { status: 'failed' }] }],
  ])('rejects %s as positive execution evidence', (_name, firstFile) => {
    expectRejected(reportedRun({ success: true, testResults: [firstFile, passedFile(testFiles[1])] }))
  })

  it('permits pending/todo assertions alongside a real pass without claiming per-assertion coverage', () => {
    const report = completeReport()
    report.testResults[0].assertionResults.push({ title: 'conditional check', status: 'pending' }, { title: 'future check', status: 'todo' })
    expect(runParser({ vitest: reportedRun(report) }).exitCode).toBe(0)
  })

  it('keeps a failing node:test producer red even when every Vitest file passed', () => {
    const result = runParser({ includeNodeScript: true, node: { status: 1, stdout: '', stderr: 'synthetic node failure' } })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('tagged green 1; tagged failing 1')
    expect(result.stdout).toContain(`P-04: tagged test failing: ${nodeFile}`)
    expect(result.calls[0]).toEqual({ command: '/synthetic/node', args: ['--experimental-vm-modules', '--test', nodeFile] })
  })
})
