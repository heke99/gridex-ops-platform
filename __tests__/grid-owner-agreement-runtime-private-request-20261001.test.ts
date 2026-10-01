import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import ts from 'typescript'
import { expect, it } from 'vitest'

// Execute the browser's actual private request regions; only the transport is
// controlled. No Playwright runner, request, Auth, SQL or provider is invoked.
const browserPath = new URL('../e2e/browser/grid-owner-agreement-runtime-20261001.spec.mjs', import.meta.url)
const browserSource = readFileSync(browserPath, 'utf8')
const source = ts.createSourceFile(browserPath.pathname, browserSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const guardImport = source.statements.find(statement => ts.isImportDeclaration(statement)
  && ts.isStringLiteral(statement.moduleSpecifier)
  && statement.moduleSpecifier.text === './grid-owner-agreement-private-request-20261001.mjs') as ts.ImportDeclaration | undefined
const agreementPrivateRequest = guardImport
  ? (await import(new URL('./grid-owner-agreement-private-request-20261001.mjs', browserPath).href)).agreementPrivateRequest
  : undefined
const pdf = Buffer.from('%PDF-1.4\n% Synthetic private request control.\n%%EOF\n')
const sha = createHash('sha256').update(pdf).digest('hex')
const canary = 'SYN_PRIVATE signed://object?token=SYN_TOKEN Authorization: Bearer SYN_SECRET body=SYN_BODY'
const company = '11111111-1111-4111-8111-111111111111'

type Response = { status: () => number; json?: () => Promise<unknown>; headers?: () => Record<string, string>; body?: () => Promise<Buffer> }
type Request = { get?: (url: string, options: unknown) => Promise<Response>; post?: (url: string, options: unknown) => Promise<Response> }
type Call = { url: string; options: unknown }

const cleanup = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'cleanupHttp')
if (!cleanup) throw new Error('missing_actual_cleanup_region')
const cleanupHttp = new Function('expect', 'f', 'agreementPrivateRequest', `${cleanup.getText(source)}; return cleanupHttp`)
  (expect, { company }, agreementPrivateRequest) as (request: Request, expectedClaimed: number) => Promise<void>
const browserTest = source.statements.find(statement => ts.isExpressionStatement(statement)
  && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(source) === 'test') as ts.ExpressionStatement | undefined
const callback = browserTest && ts.isCallExpression(browserTest.expression) ? browserTest.expression.arguments[1] : undefined
if (!callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) throw new Error('missing_actual_browser_region')
const statements = [...callback.body.statements]
const start = statements.findIndex(statement => statement.getText(source).includes('context.request.get'))
const end = statements.findIndex((statement, index) => index > start && statement.getText(source).includes("name: 'Arkivera'"))
if (start < 0 || end < 0) throw new Error('missing_actual_document_region')
const documentSource = statements.slice(start, end).map(statement => statement.getText(source)).join('\n')
const documentBytes = new Function('context', 'href', 'expect', 'sha', 'createHash', 'agreementPrivateRequest',
  `return (async () => { ${documentSource} })()`)
const verifyDocument = (request: Request) => documentBytes({ request }, '/admin/agreements/grid-owners/documents?path=owned.pdf', expect, sha, createHash, agreementPrivateRequest) as Promise<void>

async function caught(run: () => Promise<unknown>) {
  try { await run() } catch (error) { return error }
  throw new Error('expected_private_failure_was_swallowed')
}
function assertPrivateFailure(error: unknown) {
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe('agreement_runtime_private_request_failed')
  expect(Object.getOwnPropertyNames(error)).toEqual(['stack', 'message'])
  expect(inspect(error, { showHidden: true, depth: 10 })).not.toContain(canary)
  expect(inspect(error, { showHidden: true, depth: 10 })).not.toContain('SYN_TOKEN')
  expect(inspect(error, { showHidden: true, depth: 10 })).not.toContain('SYN_SECRET')
  expect(inspect(error, { showHidden: true, depth: 10 })).not.toContain('SYN_BODY')
}
function rawFailure() {
  return Object.assign(new Error(canary, { cause: new Error(canary) }), {
    url: canary, headers: { authorization: canary }, body: canary, stdout: canary, stderr: canary,
  })
}
const validProtected = (): Response => ({ status: () => 307, headers: () => ({ location: 'http://127.0.0.1:54321/storage/v1/object/sign/grid-owner-agreements/owned.pdf?token=SYN_TOKEN' }) })
const validBytes = (): Response => ({ status: () => 200, body: async () => pdf })

it.each([['Error with private cause and fields', rawFailure()], ['primitive rejection', canary], ['undefined rejection', undefined]])(
  'actual cleanup replaces %s rather than leaking or swallowing it', async (_label, error) => {
    assertPrivateFailure(await caught(() => cleanupHttp({ post: async () => { throw error } }, 1)))
  },
)
it('actual cleanup drops private JSON parse failures', async () => {
  assertPrivateFailure(await caught(() => cleanupHttp({ post: async () => ({ status: () => 202, json: async () => { throw rawFailure() } }) }, 1)))
})
it('actual cleanup retains direct-202 and exact-result assertions while hiding unexpected body values', async () => {
  assertPrivateFailure(await caught(() => cleanupHttp({ post: async () => ({ status: () => 503, json: async () => ({ private: canary }) }) }, 1)))
  assertPrivateFailure(await caught(() => cleanupHttp({ post: async () => ({ status: () => 202, json: async () => ({ private: canary }) }) }, 1)))
})
it.each([0, 1])('actual cleanup successful count %s keeps its exact body, secret binding and redirect refusal', async claimed => {
  const calls: Call[] = []
  const oldSecret = process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET
  process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET = 'SYN_SECRET'
  try {
    await cleanupHttp({ post: async (url, options) => {
      calls.push({ url, options })
      return { status: () => 202, json: async () => ({ result: { claimed, removed: claimed, retried: 0, stale: 0, errors: 0 } }) }
    } }, claimed)
    expect(calls).toEqual([{ url: 'http://127.0.0.1:3000/api/internal/grid-owner-agreements/cleanup',
      options: { headers: { Authorization: 'Bearer SYN_SECRET' }, data: { companyId: company, limit: 1 }, maxRedirects: 0 } }])
  } finally {
    if (oldSecret === undefined) delete process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET
    else process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET = oldSecret
  }
})
it.each(['protected', 'signed', 'body', 'location'])('actual document %s failure cannot escape with private values', async stage => {
  let calls = 0
  assertPrivateFailure(await caught(() => verifyDocument({ get: async () => {
    calls += 1
    if (stage === 'protected' && calls === 1) throw rawFailure()
    if (stage === 'location' && calls === 1) return { status: () => 307, headers: () => ({ location: canary }) }
    if (calls === 1) return validProtected()
    if (stage === 'signed') throw rawFailure()
    if (stage === 'body') return { status: () => 200, body: async () => { throw rawFailure() } }
    return validBytes()
  } })))
})
it('actual document success retains two direct requests and verifies the exact PDF hash', async () => {
  const calls: Call[] = []
  await verifyDocument({ get: async (url, options) => {
    calls.push({ url, options }); return calls.length === 1 ? validProtected() : validBytes()
  } })
  expect(calls).toEqual([
    { url: 'http://127.0.0.1:3000/admin/agreements/grid-owners/documents?path=owned.pdf', options: { maxRedirects: 0 } },
    { url: 'http://127.0.0.1:54321/storage/v1/object/sign/grid-owner-agreements/owned.pdf?token=SYN_TOKEN', options: { maxRedirects: 0 } },
  ])
})
it.each(['protected_status', 'signed_status', 'pdf_hash'])('actual document still rejects wrong %s without raw response context', async stage => {
  let calls = 0
  assertPrivateFailure(await caught(() => verifyDocument({ get: async () => {
    calls += 1
    if (calls === 1) return stage === 'protected_status' ? { ...validProtected(), status: () => 200 } : validProtected()
    if (stage === 'signed_status') return { ...validBytes(), status: () => 307 }
    if (stage === 'pdf_hash') return { status: () => 200, body: async () => Buffer.from(canary) }
    return validBytes()
  } })))
})
it('every actual private APIRequestContext invocation remains inside the imported safe boundary', () => {
  expect(guardImport).toBeDefined()
  const requests: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && /^(?:context\.request\.get|request\.post)$/.test(node.expression.getText(source))) requests.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(requests).toHaveLength(3)
  for (const request of requests) {
    let parent: ts.Node | undefined = request.parent
    while (parent && !(ts.isCallExpression(parent) && parent.expression.getText(source) === 'agreementPrivateRequest')) parent = parent.parent
    expect(parent).toBeDefined()
  }
})
it('the real boundary preserves successful callback results without retries', async () => {
  const saved = { saved: true }
  let attempts = 0
  expect(await agreementPrivateRequest(async () => { attempts += 1; return saved })).toBe(saved)
  expect(attempts).toBe(1)
})
it('the real boundary does not inspect arbitrary rejected values', async () => {
  const privateError = new Proxy({}, {
    get() { throw new Error(canary) },
    ownKeys() { throw new Error(canary) },
  })
  assertPrivateFailure(await caught(() => agreementPrivateRequest(async () => { throw privateError })))
})
it('an actual Node failure exits nonzero with only the safe error in ordinary stderr', () => {
  const helper = new URL('./grid-owner-agreement-private-request-20261001.mjs', browserPath).href
  const script = `import { agreementPrivateRequest } from ${JSON.stringify(helper)};
    await agreementPrivateRequest(async () => { throw Object.assign(new Error(${JSON.stringify(canary)}), {
      cause: new Error(${JSON.stringify(canary)}), headers: { authorization: ${JSON.stringify(canary)} }, body: ${JSON.stringify(canary)}
    }); });`
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', env: { NODE_ENV: 'test' }, timeout: 10_000 })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain('agreement_runtime_private_request_failed')
  for (const value of [canary, 'SYN_TOKEN', 'SYN_SECRET', 'SYN_BODY']) expect(result.stderr).not.toContain(value)
})
