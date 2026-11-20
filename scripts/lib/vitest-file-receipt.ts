import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { Reporter, TestModule, TestRunEndReason, TestSpecification, Vitest } from 'vitest/node'

const maximumFiles = 10_000
const maximumReceiptBytes = 1024 * 1024
const finalStates = new Set(['passed', 'failed', 'skipped'])
const gitHash = /^[a-f0-9]{40}$/

type Checkout = {
  commit: string
  tree: string
  clean: boolean
}

type FileResult = {
  id: string
  file: string
  project: string
  pool: string
  status: ReturnType<TestModule['state']> | 'not_reported'
}

type Receipt = {
  schema: 'gridex-vitest-file-receipt-v1'
  source: Checkout | null
  sourceUnchanged: boolean | null
  state: 'complete' | 'incomplete'
  reason: TestRunEndReason | 'initializing' | 'started' | 'invalid_specifications' | 'receipt_size_limit'
  expectedFileCount: number | null
  unhandledErrorCount: number | null
  integrityFailures: number
  files: FileResult[]
}

function checkout(root: string): { root: string; source: Checkout } | null {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5_000,
    maxBuffer: maximumReceiptBytes,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }
  try {
    const [checkoutRoot, commit, tree] = execFileSync(
      'git', ['rev-parse', '--show-toplevel', 'HEAD', 'HEAD^{tree}'], options,
    ).trimEnd().split('\n')
    if (!isAbsolute(checkoutRoot) || !gitHash.test(commit) || !gitHash.test(tree)) return null
    const clean = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).trim() === ''
    return { root: checkoutRoot, source: { commit, tree, clean } }
  } catch {
    return null
  }
}

function repositoryFile(root: string, moduleId: string): string | null {
  if (!isAbsolute(moduleId)) return null
  const file = relative(root, moduleId)
  if (!file || isAbsolute(file) || file === '..' || file.startsWith(`..${sep}`)) return null
  return file.split(sep).join('/')
}

export class VitestFileReceiptReporter implements Reporter {
  private root: string | undefined
  private path: string | undefined
  private receipt: Receipt | undefined

  onInit(vitest: Vitest) {
    if (vitest.config.watch || vitest.config.coverage.enabled) return
    this.startReceipt(vitest.config.root)
  }

  private startReceipt(root: string) {
    const observed = checkout(root)
    this.root = observed?.root ?? root
    this.path = join(this.root, 'e2e-artifacts', `vitest-file-receipt-${randomUUID()}.json`)
    this.receipt = {
      schema: 'gridex-vitest-file-receipt-v1',
      source: observed?.source ?? null,
      sourceUnchanged: null,
      state: 'incomplete',
      reason: 'initializing',
      expectedFileCount: null,
      unhandledErrorCount: null,
      integrityFailures: 0,
      files: [],
    }
    this.save()
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>) {
    const root = this.root
    if (!root) return
    if (this.receipt?.reason !== 'initializing') this.startReceipt(root)
    const receipt = this.receipt
    if (!receipt) return
    receipt.expectedFileCount = specifications.length
    if (specifications.length > maximumFiles) {
      receipt.reason = 'receipt_size_limit'
      this.save()
      return
    }

    const ids = new Set<string>()
    const files: FileResult[] = []
    for (const spec of specifications) {
      const file = repositoryFile(root, spec.moduleId)
      if (!file || ids.has(spec.taskId)) {
        receipt.reason = 'invalid_specifications'
        receipt.integrityFailures = 1
        this.save()
        return
      }
      ids.add(spec.taskId)
      files.push({ id: spec.taskId, file, project: spec.project.name, pool: spec.pool, status: 'not_reported' })
    }
    receipt.files = files
    receipt.reason = 'started'
    this.save()
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>, errors: ReadonlyArray<unknown>, reason: TestRunEndReason) {
    const { root, receipt } = this
    if (!root || receipt?.reason !== 'started') return

    const remaining = new Map(receipt.files.map(file => [file.id, file]))
    for (const testModule of modules) {
      const file = remaining.get(testModule.id)
      if (!file || file.file !== repositoryFile(root, testModule.moduleId) || file.project !== testModule.project.name) {
        receipt.integrityFailures += 1
        continue
      }
      file.status = testModule.state()
      remaining.delete(testModule.id)
    }

    const finished = checkout(root)?.source
    const source = receipt.source
    receipt.sourceUnchanged = Boolean(source?.clean && finished?.clean &&
      source.commit === finished.commit && source.tree === finished.tree)
    receipt.reason = reason
    receipt.unhandledErrorCount = errors.length
    if (
      receipt.sourceUnchanged && reason !== 'interrupted' && receipt.integrityFailures === 0 &&
      remaining.size === 0 && receipt.files.length > 0 && receipt.files.every(file => finalStates.has(file.status))
    ) {
      receipt.state = 'complete'
    }
    this.save()
  }

  private save() {
    const { path, receipt } = this
    if (!path || !receipt) return
    let bytes = JSON.stringify(receipt)
    if (Buffer.byteLength(bytes) + 1 > maximumReceiptBytes) {
      bytes = JSON.stringify({ ...receipt, state: 'incomplete', reason: 'receipt_size_limit', files: [] })
    }
    try {
      mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`
      writeFileSync(temporary, `${bytes}\n`, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, path)
    } catch {
      console.warn('Vitest file receipt could not be saved.')
    }
  }
}
