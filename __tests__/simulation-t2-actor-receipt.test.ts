// Finite component ports exercise real fixture/login/request functions only.
// No actual Auth, database, filesystem receipts or hosted TERM acceptance.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import path from 'node:path'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const userId = '00000000-0000-4000-8000-000000000001'
const companyId = '00000000-0000-4000-8000-000000000002'
const foreignCompanyId = '00000000-0000-4000-8000-000000000003'
const sourceCommit = '6'.repeat(40)
const required = ['customers.write', 'contracts.write']
const secrets = ['SECRET_PASSWORD', 'SECRET_COOKIE', 'SECRET_JWT', 'SECRET_SERVICE_KEY']
type Options = { disabled?: boolean; wrongAuth?: boolean; authError?: boolean; createError?: boolean; missingMembership?: boolean; inactiveCompany?: boolean
  missingDbGrant?: boolean; missingContextGrant?: boolean; falseRoleLabel?: boolean; wrongContext?: boolean
  selectedCompany?: string; intent?: 'expected_denial'; foreignOwned?: boolean; sourceDrift?: boolean; requestAuthDrift?: boolean; noPermissions?: boolean
  rejection?: 'create' | 'signin' | 'getuser' | 'context' | 'database' | 'setupdatabase' }

function control(options: Options = {}) {
  const outputs: Array<{ file: string; value: string; mode?: number }> = []
  const requests: Array<{ url: string; init: RequestInit }> = [], queries: string[] = [], rpcCalls: unknown[] = []
  const dirs: Array<{ path: string; mode?: number }> = []
  const moduleCache = new Map<string, Record<string, unknown>>()
  const fileBodies = new Map<string, string>()
  const sourceFiles: Record<string, string> = {}
  for (const file of ['fixture.ts', 'session.ts', 'term-fixture.ts']) {
    const relative = 'scripts/simulation/track2/lib/' + file
    const body = readFileSync(fileURLToPath(new URL('../' + relative, import.meta.url)), 'utf8')
    sourceFiles[relative] = crypto.createHash('sha256').update(body).digest('hex')
    fileBodies.set('/component/app/' + relative, body)
  }
  if (options.sourceDrift) fileBodies.set('/component/app/scripts/simulation/track2/lib/fixture.ts', 'unqualified source')
  const assignment = JSON.stringify({ sourceCommit, environmentId: 'component-t2-epoch', simHome: '/component/private', runDir: '/component/app',
    syntheticActors: { policy: 'source-bound-synthetic-only-observed-receipts-required', ordinarySignup: 'NOT_PROVEN_ADMIN_FIXTURE_SUBSTITUTION',
      observedReceiptState: 'REQUIRED_AFTER_SCENARIO', sourceFiles }, sourceFiles })
  fileBodies.set('/component/assignment.json', assignment)
  let nextFd = 20, getUserCalls = 0
  const fds = new Map<number, { file: string; mode?: number }>()
  const info = (file: string) => ({ uid: 1000, mode: file.endsWith('.json') || file.endsWith('.ts') ? 0o100600 : 0o40700,
    isFile: () => file.endsWith('.json') || file.endsWith('.ts'), isDirectory: () => !file.endsWith('.json') && !file.endsWith('.ts'), isSymbolicLink: () => false })
  const fs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072, O_NONBLOCK: 2048, O_WRONLY: 1, O_CREAT: 64, O_EXCL: 128 },
    existsSync: (file: string) => fileBodies.has(file) || file === '/component/private',
    realpathSync: (file: string) => file, lstatSync: info, statSync: info,
    mkdirSync: (file: string, opts: { mode?: number }) => { dirs.push({ path: file, mode: opts?.mode }) },
    openSync: (file: string, _flags: unknown, mode?: number) => { const fd = nextFd++; fds.set(fd, { file, mode }); return fd },
    fstatSync: (fd: number) => info(fds.get(fd)!.file), closeSync() {},
    readFileSync: (target: string | number) => {
      const file = typeof target === 'number' ? fds.get(target)!.file : target
      const body = fileBodies.get(file)
      if (body === undefined) throw new Error('undeclared file read')
      return Buffer.from(body)
    },
    writeFileSync: (target: string | number, value: string, opts?: { mode?: number }) => {
      const item = typeof target === 'number' ? fds.get(target)! : { file: target, mode: opts?.mode }
      outputs.push({ ...item, value })
    },
  }
  const snapshot = () => ({
    userId, companyId, authActive: true, profileActive: true, companyActive: !options.inactiveCompany,
    membershipActive: !options.missingMembership, roleKeys: options.falseRoleLabel ? [] : ['native_actor_component'],
    rolePermissionKeys: options.noPermissions ? [] : options.missingDbGrant ? ['customers.write'] : required,
  })
  const db = {
    psql: (sql: string) => { queries.push(sql); if (options.rejection === 'setupdatabase') throw new Error(secrets[3]); return '' },
    psqlRows: (sql: string) => { queries.push(sql); if (options.rejection === 'database') throw new Error(secrets[3]); return [snapshot()] },
    serviceClient: () => ({ auth: { admin: { createUser: async () => {
      if (options.rejection === 'create') throw new Error(secrets[3])
      return { data: { user: { id: userId, access_token: secrets[2] } }, error: options.createError ? { message: secrets[3] } : null }
    },
      deleteUser: async () => ({}) } } }),
  }
  const context = (selected: string) => ({ authorized: true, user_id: userId, selected_company_id:
    options.wrongContext ? foreignCompanyId : selected === foreignCompanyId && !options.foreignOwned ? null : selected,
    is_platform_admin: false, roles: ['native_actor_component'], permissions: options.noPermissions ? [] : options.missingContextGrant ? ['customers.write'] : required,
    memberships: [{ company_id: companyId }, ...(options.foreignOwned ? [{ company_id: foreignCompanyId }] : [])],
    company: { id: selected, status: 'active', lifecycle_status: 'active' }, access_token: secrets[2], private_debug: secrets[3] })
  const ssr = { createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (cookies: Array<{ name: string; value: string }>) => void } }) => ({
    auth: { signInWithPassword: async () => { if (options.rejection === 'signin') throw new Error(secrets[0]);
      opts.cookies.setAll([{ name: 'sb-auth-token', value: secrets[1] }]); return { data: { user: { id: userId } }, error: null } },
      getUser: async () => { getUserCalls++; if (options.rejection === 'getuser') throw new Error(secrets[2]);
        return { data: { user: { id: options.wrongAuth || options.requestAuthDrift && getUserCalls > 1 ? foreignCompanyId : userId,
        access_token: secrets[2] } }, error: options.authError ? { message: secrets[3] } : null } } },
    rpc: async (name: string, args: { p_selected_company_id: string }) => { rpcCalls.push({ name, args });
      if (options.rejection === 'context') throw new Error(secrets[2]); return { data: context(args.p_selected_company_id), error: null } },
  }) }
  const forbidden = () => { throw new Error('undeclared actor component IO') }
  function load(name: string): Record<string, unknown> {
    if (moduleCache.has(name)) return moduleCache.get(name)!
    const relative = 'scripts/simulation/track2/lib/' + name + '.ts'
    const filename = fileURLToPath(new URL('../' + relative, import.meta.url))
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText
    const output: Record<string, unknown> = {}; moduleCache.set(name, output)
    const ports: Record<string, unknown> = { 'node:crypto': { ...crypto, randomUUID: () => companyId, randomBytes: () => ({ toString: () => secrets[0] }) },
      'node:fs': fs, 'node:path': path, 'node:child_process': { execFileSync: () => sourceCommit + '\n' }, '@supabase/ssr': ssr,
      './db': db, './env': { sim: { apiUrl: 'http://127.0.0.1:55001', anonKey: secrets[2], appUrl: 'http://127.0.0.1:55008' }, SIM_HOME: '/component/private' } }
    runInNewContext(code, { exports: output, require: (key: string) => {
      if (key === './fixture') return load('fixture')
      if (!Object.hasOwn(ports, key)) return forbidden()
      return ports[key]
    }, process: { env: { ...(options.disabled ? {} : { SIM_REQUIRE_ACTOR_RECEIPT: '1' }), SIM_HOME: '/component/private', RUN_DIR: '/component/app',
      SIM_RUNTIME_ASSIGNMENT_FILE: '/component/assignment.json' }, getuid: () => 1000 }, Buffer,
    fetch: async (url: string, init: RequestInit) => { requests.push({ url: String(url), init }); return new Response('controlled') },
    console: { info: forbidden, error: forbidden }, URL }, { filename, timeout: 5000 })
    return output
  }
  const fixture = load('fixture'), session = load('session')
  return { outputs, requests, queries, rpcCalls, dirs, getUserCalls: () => getUserCalls,
    create: () => (fixture.createAdminFixture as (opts: unknown) => Promise<Record<string, unknown>>)({ permissionKeys: options.noPermissions ? [] : required }),
    login: (admin: Record<string, unknown>) => (session.loginSession as (...args: unknown[]) => Promise<{
      userId: string; actorProof?: Record<string, unknown>; fetch: (path: string, init?: RequestInit) => Promise<Response>
    }>)(admin.email, admin.password, { companyId: options.selectedCompany ?? companyId, ...(options.intent ? { intent: options.intent } : {}) }),
  }
}

describe('T2 observed hosted actor proof', () => {
  it('provisions the canonical scoped role path for direct hosted admin fixtures used by smoke', async () => {
    const c = control()
    await c.create()
    const setup = c.queries.find(sql => sql.startsWith('BEGIN;'))!
    expect(setup).toContain('INSERT INTO public.roles')
    expect(setup).toContain('INSERT INTO public.user_roles')
    expect(setup).toContain('INSERT INTO public.role_permissions')
    expect(setup).toContain(`'${userId}','${companyId}'`)
    expect(setup).toContain("WHERE key IN('customers.write','contracts.write')")
  })
  it('records real Auth/context/scoped role evidence for each request with private safe outputs', async () => {
    const c = control(), admin = await c.create(), session = await c.login(admin)
    await session.fetch('/admin/customers/intake', { method: 'POST' })
    await session.fetch('/admin/customers/example?tab=contracts')
    expect(c.getUserCalls()).toBeGreaterThanOrEqual(3)
    expect(c.outputs).toHaveLength(2)
    for (const item of c.outputs) {
      expect(item.file).toMatch(/^\/component\/private\/actor-receipts\/.+\.json$/)
      expect(item.mode).toBe(0o600)
      const receipt = JSON.parse(item.value)
      expect(receipt).toMatchObject({ schema: 'gridex-t2-observed-actor-v1', intent: 'authorized', sourceCommit, companyId, userId,
        requestedCompanyId: companyId, authVerified: true, selectedCompanyVerified: true, tenantRoleVerified: true,
        licenseVerified: false, licensePolicy: 'NO_APPLICATION_LICENSE_GATE_IDENTIFIED' })
      expect(receipt.contextEvidenceSHA256).toMatch(/^[a-f0-9]{64}$/)
      expect(receipt.assignmentSha256).toMatch(/^[a-f0-9]{64}$/)
      for (const secret of secrets) expect(item.value).not.toContain(secret)
    }
    expect(c.dirs.every(dir => dir.mode === 0o700)).toBe(true)
    expect(JSON.stringify(admin)).not.toContain(secrets[0])
    expect(JSON.stringify(session)).not.toContain(secrets[1])
    expect(c.queries.some(sql => sql.includes('role_permissions') && sql.includes('company_memberships') && sql.includes(userId) && sql.includes(companyId))).toBe(true)
    expect(c.rpcCalls).toContainEqual({ name: 'canonical_authenticated_tenant_context', args: { p_selected_company_id: companyId } })
  })
  it.each([{ wrongAuth: true }, { authError: true }, { missingMembership: true }, { inactiveCompany: true },
    { missingDbGrant: true }, { missingContextGrant: true }, { falseRoleLabel: true }, { wrongContext: true },
    { selectedCompany: foreignCompanyId }, { sourceDrift: true }, { noPermissions: true }])('rejects unproven actor/context before app traffic: %j', async options => {
    const c = control(options)
    await expect((async () => { const admin = await c.create(), session = await c.login(admin); await session.fetch('/admin/customers/intake') })()).rejects.toThrow()
    expect(c.requests).toEqual([]); expect(c.outputs).toEqual([])
  })
  it('rechecks current Auth rather than reusing a login marker before a later action', async () => {
    const c = control({ requestAuthDrift: true }), admin = await c.create(), session = await c.login(admin)
    await expect(session.fetch('/admin/customers/intake', { method: 'POST' })).rejects.toThrow()
    expect(c.requests).toEqual([]); expect(c.outputs).toEqual([])
  })
  it('keeps the intentional foreign-selected-company GET oracle as a denied context, not authorized proof', async () => {
    const c = control({ selectedCompany: foreignCompanyId, intent: 'expected_denial' }), admin = await c.create(), session = await c.login(admin)
    await session.fetch('/admin/customers/example?tab=contracts')
    expect(c.requests).toHaveLength(1)
    expect(JSON.parse(c.outputs[0].value)).toMatchObject({ intent: 'expected_denial', companyId, requestedCompanyId: foreignCompanyId,
      authVerified: true, tenantRoleVerified: true, selectedCompanyVerified: false, requestedCompanyDenied: true })
  })
  it('never turns explicit denial intent into a capability for customer actions', async () => {
    const c = control({ selectedCompany: foreignCompanyId, intent: 'expected_denial' }), admin = await c.create(), session = await c.login(admin)
    await expect(session.fetch('/admin/customers/intake', { method: 'POST' })).rejects.toThrow()
    expect(c.requests).toEqual([]); expect(c.outputs).toEqual([])
  })
  it('rejects expected-denial intent when the requested company is actually owned', async () => {
    const c = control({ selectedCompany: foreignCompanyId, intent: 'expected_denial', foreignOwned: true })
    await expect((async () => c.login(await c.create()))()).rejects.toThrow()
  })
  it('leaves standalone compatibility mode without actor collection', async () => {
    const c = control({ disabled: true }), admin = await c.create(), session = await c.login(admin)
    await session.fetch('/admin/customers/intake')
    expect(c.requests).toHaveLength(1); expect(c.outputs).toEqual([])
    expect(c.getUserCalls()).toBe(0)
    expect(c.queries.some(sql => sql.includes('INSERT INTO public.roles'))).toBe(false)
  })
  it('never exports raw Auth-admin diagnostic payloads containing credentials', async () => {
    const c = control({ createError: true })
    await expect(c.create()).rejects.toThrow('actor_fixture_auth_creation_failed')
    expect(c.queries).toEqual([]); expect(c.outputs).toEqual([])
  })
  it.each(['create', 'signin', 'getuser', 'context', 'database', 'setupdatabase'] as const)('sanitizes rejected %s boundary without exporting credential diagnostics', async rejection => {
    const c = control({ rejection })
    let failure: unknown
    try { await c.login(await c.create()) } catch (error) { failure = error }
    expect(failure).toBeDefined()
    for (const secret of secrets) expect(String(failure)).not.toContain(secret)
    expect(c.requests).toEqual([]); expect(c.outputs).toEqual([])
  })
})
