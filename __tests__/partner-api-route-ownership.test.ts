import { existsSync, readFileSync } from 'node:fs'
import { NextRequest, type NextResponse } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { DELETE, GET, POST } from '@/app/api/partner/v1/[[...path]]/route'

type Method = 'GET' | 'POST' | 'DELETE'
type DispatchName = 'business' | 'simple' | 'canonical' | 'core'
type Dispatch = (request: NextRequest, method: Method, path: string[] | undefined) => Promise<NextResponse | null>

const trace = vi.hoisted(() => [] as Array<{ name: DispatchName; path: string; matched: boolean }>)

function observe(name: DispatchName, dispatch: Dispatch): Dispatch {
  return async (request, method, path) => {
    const entry = { name, path: `/${path?.join('/') ?? ''}`, matched: false }
    trace.push(entry)
    const response = await dispatch(request, method, path)
    entry.matched = response !== null
    return response
  }
}

vi.mock('@/lib/partner-api/business', async original => {
  const actual = await original<typeof import('@/lib/partner-api/business')>()
  return { ...actual, handleBusinessPartnerApi: observe('business', actual.handleBusinessPartnerApi) }
})
vi.mock('@/lib/partner-api/simple', async original => {
  const actual = await original<typeof import('@/lib/partner-api/simple')>()
  return { ...actual, handleSimplePartnerApi: observe('simple', actual.handleSimplePartnerApi) }
})
vi.mock('@/lib/partner-api/canonical', async original => {
  const actual = await original<typeof import('@/lib/partner-api/canonical')>()
  return { ...actual, handleCanonicalPartnerApi: observe('canonical', actual.handleCanonicalPartnerApi) }
})
vi.mock('@/lib/partner-api/core', async original => {
  const actual = await original<typeof import('@/lib/partner-api/core')>()
  return { ...actual, handlePartnerApi: observe('core', actual.handlePartnerApi) }
})

const handlers = { GET, POST, DELETE }
const openApiMethods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])
const documentationPath = 'docs/partner-api-route-owners.md'

function run(method: Method, path: string) {
  trace.length = 0
  const request = new NextRequest(`http://gridex.test/api/partner/v1${path}`, {
    method,
    ...(method === 'POST' && { body: '{}', headers: { 'content-type': 'application/json' } }),
  })
  return handlers[method](request, { params: Promise.resolve({ path: path.slice(1).split('/') }) })
}

describe('Partner API route ownership', () => {
  it('documents the first real dispatcher for every served OpenAPI operation', async () => {
    const response = await run('GET', '/openapi.json')
    expect(response.status).toBe(200)
    expect(trace).toEqual([])
    const document = await response.json() as { paths: Record<string, Record<string, unknown>> }
    const observed: string[] = []
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const methodName of Object.keys(operations).filter(key => openApiMethods.has(key))) {
        const method = methodName.toUpperCase()
        if (!Object.hasOwn(handlers, method)) throw new Error(`No mounted ${method} handler for ${path}`)
        const concrete = path.replaceAll(/\{[^}]+\}/g, 'synthetic-reference')
        const routeResponse = await run(method as Method, concrete)
        expect(routeResponse.status, `${method} ${path}`).toBe(401)
        const owner = trace.find(entry => entry.matched)
        expect(owner, `${method} ${path}`).toBeDefined()
        observed.push(`${method} ${path} ${owner?.name}`)
      }
    }
    expect(observed.length).toBeGreaterThan(0)
    const markdown = existsSync(documentationPath) ? readFileSync(documentationPath, 'utf8') : ''
    const documented = [...markdown.matchAll(/^\| (GET|POST|DELETE) \| `([^`]+)` \| \[(business|simple|canonical|core)\]/gm)]
      .map(([, method, path, owner]) => `${method} ${path} ${owner}`)
    expect(documented.sort()).toEqual(observed.sort())
  })

  it.each(['/contract', '/customer/synthetic-reference/site'])('keeps the shared business wrapper first for POST %s', async path => {
    expect((await run('POST', path)).status).toBe(401)
    expect(trace.map(entry => [entry.name, entry.matched])).toEqual([['business', true], ['simple', true]])
  })

  it.each([
    { method: 'GET', path: '/contract/synthetic-reference', delegated: '/contracts/synthetic-reference' },
    { method: 'DELETE', path: '/webhook/subscription/synthetic-reference', delegated: '/webhooks/subscriptions/synthetic-reference' },
  ] as const)('tries canonical before core for $method $path', async ({ method, path, delegated }) => {
    expect((await run(method, path)).status).toBe(401)
    expect(trace).toEqual([
      { name: 'business', path, matched: false },
      { name: 'simple', path, matched: false },
      { name: 'canonical', path, matched: true },
      { name: 'core', path: delegated, matched: true },
    ])
  })

  it.each([
    { method: 'GET', path: '/contracts/synthetic-reference' },
    { method: 'POST', path: '/webhooks/subscriptions' },
  ] as const)('keeps the legacy $method $path fallback after other dispatchers', async ({ method, path }) => {
    expect((await run(method, path)).status).toBe(401)
    expect(trace).toEqual([
      { name: 'business', path, matched: false },
      { name: 'simple', path, matched: false },
      { name: 'canonical', path, matched: false },
      { name: 'core', path, matched: true },
    ])
  })
})
