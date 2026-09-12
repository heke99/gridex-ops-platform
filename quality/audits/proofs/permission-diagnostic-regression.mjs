import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

// Supplemental actual-source control-flow proof. Node22/Vitest and PG17 are separate gates.
const ref = process.argv.find(value => value.startsWith('--source-ref='))?.slice(13)
const file = 'lib/rbac/getAdminUserById.ts'
const source = ref ? execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8')
const target = '00000000-0000-4000-8000-000000000012'
const actor = '00000000-0000-4000-8000-000000000015'
const valid = { target_user_id: target, scope: 'shared_active_companies', permissions: ['billing.write'], evaluated_at: '2026-09-12T12:00:00+00:00' }
let failures = 0
const cases = [
  ['valid', valid, null, ['billing.write']],
  ['empty', { ...valid, permissions: [] }, null, []],
  ['rpc error', valid, { code: '42501', message: 'private'.repeat(100) }],
  ['null', null], ['array', []], ['wrong target', { ...valid, target_user_id: actor }],
  ['wrong scope', { ...valid, scope: 'company' }], ['null permissions', { ...valid, permissions: null }],
  ['nonstring key', { ...valid, permissions: [42] }], ['empty key', { ...valid, permissions: [''] }],
  ['missing time', { ...valid, evaluated_at: undefined }], ['bad time', { ...valid, evaluated_at: 'invalid' }],
  ['duplicate key', { ...valid, permissions: ['billing.write', 'billing.write'] }],
]
for (const [name, data, error, expected] of cases) {
  const calls = []
  const logs = []
  const context = vm.createContext({ console: { error: (...args) => logs.push(args) }, Date, Error })
  const service = {
    rpc: async (name, args) => { calls.push(['rpc', name, args]); return { data, error: error ?? null } },
    auth: { admin: { getUserById: async id => { calls.push(['auth', id]); return { data: { user: { id, email: 'synthetic@example.invalid' } }, error: null } } } },
    from: table => { calls.push(['from', table]); const query = { select: () => query, eq: () => query, in: () => query, then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) }; return query },
  }
  const boundary = new vm.SyntheticModule(['supabaseService'], function () { this.setExport('supabaseService', service) }, { context })
  const serverOnly = new vm.SyntheticModule([], function () {}, { context })
  const sourceModule = new vm.SourceTextModule(stripTypeScriptTypes(source), { identifier: file, context })
  await sourceModule.link(id => id === 'server-only' ? serverOnly : id === '@/lib/supabase/service' ? boundary : Promise.reject(new Error(`Unexpected import ${id}`)))
  await sourceModule.evaluate()
  try {
    if (expected) {
      const result = await sourceModule.namespace.getAdminUserById(actor, target)
      assert.deepEqual(structuredClone(result.effectivePermissions), expected)
      assert.deepEqual(structuredClone(calls[0]), ['rpc', 'canonical_get_platform_user_permission_diagnostic', { p_actor_user_id: actor, p_target_user_id: target }])
      assert.deepEqual(calls[1], ['auth', target])
    } else {
      await assert.rejects(sourceModule.namespace.getAdminUserById(actor, target), /Behörighetsdiagnostiken är inte tillgänglig/)
      assert.equal(calls.some(([kind]) => kind === 'auth' || kind === 'from'), false)
      assert.ok(JSON.stringify(logs).length < 500)
    }
    console.log(`PASS ${name}`)
  } catch (failure) {
    failures++
    console.log(`FAIL ${name}: ${failure.message}`)
  }
}
console.log(`${cases.length - failures}/${cases.length} actual-source cases; supported tests and native SQL NOT_RUN`)
process.exitCode = failures ? 1 : 0
