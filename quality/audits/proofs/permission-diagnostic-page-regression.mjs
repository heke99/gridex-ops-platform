import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

// Supplemental actual-source orchestration proof. Stop at the JSX rendering
// boundary only; do not replace page/loader/guard or permission policy functions.
// Actual TSX rendering is covered by the permanent supported Vitest suite.
const ref = process.argv.find(value => value.startsWith('--source-ref='))?.slice(13)
const actor = '00000000-0000-4000-8000-000000000015'
const target = '00000000-0000-4000-8000-000000000012'
const response = permissions => ({ target_user_id: target, scope: 'shared_active_companies', permissions, evaluated_at: '2026-09-12T12:00:00+00:00' })
const cases = [
  { name: 'canonical one', data: response(['billing.write']), count: 1 },
  { name: 'canonical empty', data: response([]), count: 0 },
  { name: 'RPC failure', data: response([]), error: { code: '42501', message: 'denied' } },
  { name: 'malformed response', data: null },
  { name: 'wrong target', data: { ...response([]), target_user_id: actor } },
  { name: 'guard admission failure', admitted: false },
  { name: 'platform-looking role without canonical admission', platform: false },
]
let failures = 0
for (const test of cases) {
  const calls = []
  const context = vm.createContext({ console: { error: () => {} }, Date, Error })
  const service = {
    rpc: async (name, args) => { calls.push(['diagnostic', name, args]); return { data: test.data, error: test.error ?? null } },
    auth: { admin: { getUserById: async id => { calls.push(['target-auth', id]); return { data: { user: { id } }, error: null } } } },
    from: () => { const query = { select: () => query, eq: () => query, order: () => query, in: () => query, then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) }; return query },
  }
  const session = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: async name => {
      calls.push(['session', name])
      return { data: name === 'canonical_authenticated_tenant_context'
        ? { authorized: test.admitted !== false, user_id: actor, is_platform_admin: test.platform !== false, roles: ['super_admin'], permissions: ['admin.access'] }
        : [], error: null }
    },
    from: service.from,
  }
  const mocks = {
    'server-only': {},
    'react': { cache: fn => fn },
    'next/link': { default: () => {} },
    'next/cache': { revalidatePath: () => {} },
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    'next/navigation': { redirect: to => { throw new Error(`redirect:${to}`) }, notFound: () => { throw new Error('not-found') } },
    '@/lib/supabase/service': { supabaseService: service },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => session },
  }
  const cache = new Map()
  async function load(id, importer) {
    if (mocks[id] || id.startsWith('node:')) {
      if (cache.has(id)) return cache.get(id)
      const object = mocks[id] ?? await import(id)
      const boundaryModule = new vm.SyntheticModule(Object.keys(object), function () { for (const [key, value] of Object.entries(object)) this.setExport(key, value) }, { context })
      cache.set(id, boundaryModule)
      return boundaryModule
    }
    const relative = id.startsWith('@/') ? id.slice(2) : id.startsWith('.') ? path.join(path.dirname(importer.identifier), id) : id
    const file = path.resolve(relative.endsWith('.tsx') ? relative : relative.endsWith('.ts') ? relative : relative + '.ts')
    if (cache.has(file)) return cache.get(file)
    let source = ref ? execFileSync('git', ['show', `${ref}:${path.relative(process.cwd(), file)}`], { encoding: 'utf8' }) : fs.readFileSync(file, 'utf8')
    if (file.endsWith('/app/admin/users/[id]/page.tsx')) {
      const rendering = source.indexOf('\n return (\n <div')
      assert.ok(rendering > 0, 'exact JSX rendering boundary')
      source = source.slice(0, rendering) + '\n return { count: effectivePermissions.size };\n}\n'
    }
    const sourceModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { identifier: file, context })
    cache.set(file, sourceModule)
    return sourceModule
  }
  try {
    const page = await load('app/admin/users/[id]/page.tsx')
    await page.link(load)
    await page.evaluate()
    if (test.count !== undefined) {
      assert.deepEqual(structuredClone(await page.namespace.default({ params: Promise.resolve({ id: target }) })), { count: test.count })
      const diagnostic = calls.find(([kind]) => kind === 'diagnostic')
      assert.deepEqual(structuredClone(diagnostic), ['diagnostic', 'canonical_get_platform_user_permission_diagnostic', { p_actor_user_id: actor, p_target_user_id: target }])
      assert.deepEqual(calls.find(([kind]) => kind === 'target-auth'), ['target-auth', target])
    } else {
      await assert.rejects(page.namespace.default({ params: Promise.resolve({ id: target }) }), test.admitted === false ? /Behörighetskontrollen nekades/ : test.platform === false ? /redirect:\/login/ : /Behörighetsdiagnostiken är inte tillgänglig/)
      assert.equal(calls.some(([kind]) => kind === 'target-auth'), false)
      if (test.admitted === false || test.platform === false) assert.equal(calls.some(([kind]) => kind === 'diagnostic'), false)
    }
    console.log(`PASS ${test.name}`)
  } catch (error) {
    failures++
    console.log(`FAIL ${test.name}: ${error.message}`)
  }
}
console.log(`${cases.length - failures}/${cases.length} actual-source page orchestration cases; TSX rendering, supported tests and native SQL NOT_RUN`)
process.exitCode = failures ? 1 : 0
