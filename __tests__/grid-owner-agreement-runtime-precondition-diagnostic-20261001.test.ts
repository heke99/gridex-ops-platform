import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import ts from 'typescript'
import { expect, it } from 'vitest'

// Execute the actual checked-in diagnostic function with controlled browser
// observation adapters. Real private file output; no browser/Auth/SQL/network.
const browser = readFileSync(new URL('../e2e/browser/grid-owner-agreement-runtime-20261001.spec.mjs', import.meta.url), 'utf8')
const ast = ts.createSourceFile('browser.mjs', browser, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'agreementCompanySelectionPrecondition')
if (!declaration || !ts.isFunctionDeclaration(declaration)) throw new Error('actual_agreement_diagnostic_required')
const testStatement = ast.statements.find(statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(ast) === 'test')
const callback = testStatement && ts.isExpressionStatement(testStatement) && ts.isCallExpression(testStatement.expression) ? testStatement.expression.arguments[1] : undefined
const wrapper = callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body) ? callback.body.statements.find(statement => ts.isTryStatement(statement) && statement.getText(ast).includes(".selectOption(f.company)")) : undefined
if (!wrapper) throw new Error('actual_agreement_selection_wrapper_required')
const company = '11111111-1111-4111-8111-111111111111'
const canary = 'SYN_PRIVATE email=synthetic@example.invalid session=SYN_SESSION token=SYN_TOKEN body=SYN_BODY SQL=SYN_SQL'
type Snapshot = { phase: string; status: number | null; expectedLoopbackRoute: boolean; headingCount: number | null;
  formCount: number | null; companySelectCount: number | null; fixtureOptionCount: number | null; observationStage: string | null }
type Receipt = { stage: string; snapshots: Snapshot[] }
type Adapter = { status?: unknown; url?: string; heading?: unknown; form?: unknown; select?: unknown; option?: unknown;
  captureFault?: string; writeFault?: boolean; attachFault?: boolean; selectionFault?: boolean; terminal?: Adapter }
const keys = ['phase', 'status', 'expectedLoopbackRoute', 'headingCount', 'formCount', 'companySelectCount', 'fixtureOptionCount', 'observationStage']
function privateFault() { return Object.assign(new Error(canary, { cause: new Error(canary) }), { body: canary, headers: canary, url: canary }) }
async function run(adapter: Adapter = {}, performSelection = false) {
  const dir = mkdtempSync(join(tmpdir(), 'agreement-precondition-'))
  const output = join(dir, 'sanitized-agreement-runtime-precondition.json')
  const events: string[] = [], logs: string[] = [], observed: unknown[] = [], selections: unknown[] = [], snapshots: Snapshot[] = []
  const selectionError = new Error('synthetic_original_selection_failure')
  let live = adapter
  const actual = new Function('f', 'routePath', 'agreementPreconditionSnapshots', 'writeFileSync', 'console', `${declaration!.getText(ast)}; return agreementCompanySelectionPrecondition`)
    ({ company }, '/admin/agreements/grid-owners', snapshots, (path: string, bytes: string, options: { mode: number }) => {
      events.push('write'); if (live.writeFault) throw privateFault()
      writeFileSync(path, bytes, options)
    }, { log: (value: string) => { events.push('log'); logs.push(value) } }) as (page: unknown, form: unknown, response: unknown, info: unknown, phase: string) => Promise<void>
  const read = (stage: string, value: unknown) => { if (live.captureFault === stage) throw privateFault(); return value }
  const options = { evaluateAll: async (evaluate: (options: Array<{ value: string }>, current: string) => number, id: string) => {
    observed.push(id)
    expect(evaluate([{ value: '' }, { value: company }, { value: 'another-synthetic-option' }], id)).toBe(1)
    return read('fixture_option', live.option ?? 1)
  } }
  const select = { count: async () => read('company_select', live.select ?? 1), locator: (selector: string) => {
    expect(selector).toBe('option'); return options
  }, selectOption: async (id: string, ...args: unknown[]) => {
    selections.push({ id, args }); events.push('selection')
    if (adapter.selectionFault) { live = adapter.terminal ?? adapter; throw selectionError }
  } }
  const form = { count: async () => read('form', live.form ?? 1), locator: (selector: string) => {
    expect(selector).toBe('select[name="company_id"]'); return select
  } }
  const page = { url: () => read('expected_route', live.url ?? 'http://127.0.0.1:3000/admin/agreements/grid-owners'),
    getByRole: (role: string, args: unknown) => {
      expect(role).toBe('heading'); expect(args).toEqual({ name: 'Nätägaravtal', exact: true })
      return { count: async () => read('heading', live.heading ?? 1) }
    } }
  const info = { outputPath: (name: string) => { expect(name).toBe('sanitized-agreement-runtime-precondition.json'); return output },
    attach: async (name: string, value: unknown) => {
      events.push('attach'); expect(name).toBe('sanitized-agreement-runtime-precondition')
      expect(value).toEqual({ path: output, contentType: 'application/json' })
      expect(readFileSync(output, 'utf8')).not.toContain(canary)
      if (live.attachFault) throw privateFault()
    } }
  const response = { status: () => read('http_status', live.status ?? 200) }
  const selection = new Function('f', 'agreementCompanySelectionPrecondition', 'form', 'page', 'agreementPageResponse', 'testInfo', `return (async () => { ${wrapper!.getText(ast)} })()`)
  let error: unknown
  try {
    await actual(page, form, response, info, 'before_action')
    if (performSelection) await selection({ company }, actual, form, page, response, info)
  }
  catch (caught) { error = caught; events.push('failure') }
  try {
    const logged = logs.at(-1)!
    expect(logged.startsWith('AGREEMENT_RUNTIME_BROWSER_PRECONDITION ')).toBe(true)
    const receipt = JSON.parse(logged.slice('AGREEMENT_RUNTIME_BROWSER_PRECONDITION '.length)) as Receipt
    expect(Object.keys(receipt)).toEqual(['stage', 'snapshots'])
    expect(receipt.snapshots.length).toBeGreaterThanOrEqual(1); expect(receipt.snapshots.length).toBeLessThanOrEqual(2)
    for (const snapshot of receipt.snapshots) expect(Object.keys(snapshot)).toEqual(keys)
    expect(JSON.stringify(receipt)).not.toContain(canary)
    for (const fragment of ['SYN_TOKEN', 'SYN_BODY', 'SYN_SQL', 'SYN_SESSION', company, 'synthetic@example.invalid', 'http://']) {
      expect(JSON.stringify({ logs, error: inspect(error, { showHidden: true, depth: 10 }) })).not.toContain(fragment)
    }
    if (!adapter.writeFault) {
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(receipt)
      expect(statSync(output).mode & 0o777).toBe(0o600)
    }
    return { receipt, snapshot: receipt.snapshots.at(-1)!, error, events, observed, selections, selectionError }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
it('actual successful diagnostic persists only finite whitelisted fields and attaches before unchanged selection can continue', async () => {
  const result = await run()
  expect(result.error).toBeUndefined()
  expect(result.events).toEqual(['log', 'write', 'attach'])
  expect(result.receipt).toEqual({ stage: 'agreement_company_selection_precondition', snapshots: [{ phase: 'before_action', status: 200, expectedLoopbackRoute: true,
    headingCount: 1, formCount: 1, companySelectCount: 1, fixtureOptionCount: 1, observationStage: null }] })
  expect(result.observed).toEqual([company])
})
it.each([
  [{ status: 503 }, 'http_status'],
  [{ status: canary }, 'http_status'],
  [{ url: 'http://127.0.0.1:3000/login?private=SYN_TOKEN' }, 'expected_route'],
  [{ url: 'https://example.invalid/admin/agreements/grid-owners#SYN_TOKEN' }, 'expected_route'],
  [{ heading: 0 }, 'heading'],
  [{ form: 0 }, 'form'],
  [{ select: 0 }, 'company_select'],
  [{ option: 0 }, 'fixture_option'],
  [{ heading: { toJSON: () => canary } }, 'heading'],
  [{ option: Number.POSITIVE_INFINITY }, 'fixture_option'],
  [{ option: -1 }, 'fixture_option'],
  [{ option: 100_001 }, 'fixture_option'],
] as const)('actual incomplete observation %j records only fixed %s stage without preempting original auto-wait', async (adapter, stage) => {
  const result = await run(adapter)
  expect(result.snapshot.observationStage).toBe(stage)
  expect(result.error).toBeUndefined()
  expect(result.events).toEqual(['log', 'write', 'attach'])
})
it.each(['http_status', 'expected_route', 'heading', 'form', 'company_select', 'fixture_option'])('actual %s observation exception drops raw failure, cause and adapter fields', async stage => {
  const result = await run({ captureFault: stage })
  expect(result.snapshot.observationStage).toBe(stage)
  expect((result.error as Error).message).toBe('agreement_runtime_precondition_failed:capture_' + stage)
  expect(Object.getOwnPropertyNames(result.error)).toEqual(['stack', 'message'])
  expect(result.events).toEqual(['log', 'write', 'attach', 'failure'])
})
it.each(['write', 'attach'])('actual receipt %s exception cannot leak private fields or imply completed prerequisite', async stage => {
  const result = await run(stage === 'write' ? { writeFault: true } : { attachFault: true })
  expect((result.error as Error).message).toBe('agreement_runtime_precondition_failed:receipt_' + stage)
  expect(Object.getOwnPropertyNames(result.error)).toEqual(['stack', 'message'])
  expect(result.events).toEqual(stage === 'write' ? ['log', 'write', 'failure'] : ['log', 'write', 'attach', 'failure'])
})
it('mechanically removing only the new diagnostic reconstructs exact published 9e browser bytes including every selector, action, assertion and timeout', () => {
  const withoutFunction = browser.slice(0, declaration!.getStart(ast)) + browser.slice(declaration!.end + 1)
  const original = withoutFunction.replace('const agreementPreconditionSnapshots = []\n', '')
    .replace('  const agreementPageResponse = await page.goto(routePath)\n', '  await page.goto(routePath)\n')
    .replace('  await agreementCompanySelectionPrecondition(page, form, agreementPageResponse, testInfo, \'before_action\')\n', '')
    .replace('  ' + wrapper!.getText(ast), '  await form.locator(\'select[name="company_id"]\').selectOption(f.company)')
  expect(createHash('sha256').update(original).digest('hex')).toBe('28b988c6962c3065bbd1d338e91a425ccadee3dc06ee221f7397ea98374f71ac')
  expect(browser).toContain("const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Spara nätägaravtal', exact: true }) })")
  expect(browser).toContain('await form.locator(\'select[name="company_id"]\').selectOption(f.company)')
})
it('actual missing initial DOM observations do not prevent the exact original selection from succeeding', async () => {
  const result = await run({ heading: 0, form: 0, select: 0, option: 0 }, true)
  expect(result.error).toBeUndefined()
  expect(result.snapshot.observationStage).toBe('heading')
  expect(result.receipt.snapshots).toHaveLength(1)
  expect(result.selections).toEqual([{ id: company, args: [] }])
  expect(result.events).toEqual(['log', 'write', 'attach', 'selection'])
})
it('actual selection failure stores terminal counts before rethrowing the identical original error without retry', async () => {
  const result = await run({ selectionFault: true, terminal: { option: 0 } }, true)
  expect(result.error).toBe(result.selectionError)
  expect(result.receipt.snapshots.map(snapshot => snapshot.phase)).toEqual(['before_action', 'after_selection_failure'])
  expect(result.receipt.snapshots[0].fixtureOptionCount).toBe(1)
  expect(result.snapshot.fixtureOptionCount).toBe(0)
  expect(result.snapshot.observationStage).toBe('fixture_option')
  expect(result.selections).toEqual([{ id: company, args: [] }])
  expect(result.events).toEqual(['log', 'write', 'attach', 'selection', 'log', 'write', 'attach', 'failure'])
})
it('actual terminal ready counts cannot turn a failed original selection into success or an invented missing-option cause', async () => {
  const result = await run({ selectionFault: true }, true)
  expect(result.error).toBe(result.selectionError)
  expect(result.snapshot.observationStage).toBeNull()
  expect(result.receipt.snapshots).toHaveLength(2)
  expect(result.selections).toHaveLength(1)
})
it('actual terminal capture fault emits safe partial snapshot before its closed diagnostic failure', async () => {
  const result = await run({ selectionFault: true, terminal: { captureFault: 'expected_route' } }, true)
  expect((result.error as Error).message).toBe('agreement_runtime_precondition_failed:capture_expected_route')
  expect(result.snapshot.phase).toBe('after_selection_failure')
  expect(result.snapshot.observationStage).toBe('expected_route')
  expect(Object.getOwnPropertyNames(result.error)).toEqual(['stack', 'message'])
  expect(result.selections).toHaveLength(1)
})
