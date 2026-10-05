import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  publicUrl: 'https://piidsfebjqjmnepdpnas.supabase.co',
  service: {
    supabaseUrl: 'https://piidsfebjqjmnepdpnas.supabase.co',
    auth: { url: 'https://piidsfebjqjmnepdpnas.supabase.co/auth/v1' },
    rest: { url: 'https://piidsfebjqjmnepdpnas.supabase.co/rest/v1' },
  },
  user: null as unknown,
  context: null as unknown,
  clients: [] as { id: string; company_id: string; name: string }[],
  authUrl: 'https://piidsfebjqjmnepdpnas.supabase.co/auth/v1',
  restUrl: 'https://piidsfebjqjmnepdpnas.supabase.co/rest/v1',
  authError: null as unknown,
  contextError: null as unknown,
  construct: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  company: vi.fn(),
  enroll: vi.fn(),
  select: vi.fn(),
  filters: [] as unknown[][],
}))
vi.mock('@/lib/supabase/service', () => ({
  SUPABASE_SERVICE_URL: 'https://piidsfebjqjmnepdpnas.supabase.co',
  supabaseService: state.service,
}))
vi.mock('@/lib/env/supabasePublic', () => ({
  getSupabasePublicEnv: () => ({
    url: state.publicUrl,
    anonKey: 'synthetic-public-value-never-logged',
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    state.construct()
    return {
      supabaseUrl: state.publicUrl,
      rest: { url: state.restUrl },
      auth: { url: state.authUrl, getUser: state.getUser },
      rpc: state.rpc,
    }
  },
}))
vi.mock('@/lib/tenant/governance', () => ({
  requireCompanyOperationalForWrites: state.company,
}))
vi.mock('@/lib/auth/companyInvitationFlow', () => ({
  provisionExternalStaffBootstrapInvitation: state.enroll,
}))
vi.mock('@/lib/supabase/tenantQuery', () => ({
  tenantSelect: (companyId: string, table: string, columns: string) => {
    state.select(companyId, table, columns)
    let selectedId: string | undefined
    const query = {
      eq: (key: string, value: string) => {
        state.filters.push(['eq', key, value])
        if (key === 'id') selectedId = value
        return query
      },
      is: (key: string, value: null) => {
        state.filters.push(['is', key, value])
        return query
      },
      not: (key: string, op: string, value: null) => {
        state.filters.push(['not', key, op, value])
        return query
      },
      contains: (key: string, value: string[]) => {
        state.filters.push(['contains', key, value])
        return query
      },
      or: (value: string) => {
        state.filters.push(['or', value])
        return query
      },
      order: () => query,
      limit: () => query,
      then: (
        yes: (value: unknown) => unknown,
        no: (error: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: state.clients.filter(
            (row) =>
              row.company_id === companyId &&
              (!selectedId || row.id === selectedId),
          ),
          error: null,
        }).then(yes, no),
    }
    return query
  },
}))
import {
  externalStaffEnrollmentAdmin,
  assertOpsEnrollmentSdkTargets,
} from '@/lib/auth/externalStaffEnrollmentAdmin'
import { enrollExternalStaffAdminAction } from '@/app/admin/companies/[id]/staff-enrollment-actions'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const actor = '99999999-9999-4999-8999-999999999999',
  foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const key = '11111111-1111-4111-8111-111111111111'
const invalidInputs: Record<string, string>[] = [
  { api_client_id: '' },
  { email: 'bad' },
  { role_key: '' },
  { role_key: 'platform_admin' },
  { idempotency_key: '' },
  { idempotency_key: 'bad' },
  { full_name: 'A'.repeat(161) },
]
function form(changes: Record<string, string> = {}) {
  const data = new FormData()
  Object.entries({
    api_client_id: client,
    email: 'admin@example.invalid',
    full_name: 'First Admin',
    role_key: 'company_admin',
    idempotency_key: key,
    ...changes,
  }).forEach(([name, value]) => data.set(name, value))
  return data
}
beforeEach(() => {
  vi.clearAllMocks()
  state.filters = []
  state.publicUrl = state.service.supabaseUrl =
    'https://piidsfebjqjmnepdpnas.supabase.co'
  state.authUrl = state.service.auth.url =
    'https://piidsfebjqjmnepdpnas.supabase.co/auth/v1'
  state.restUrl = state.service.rest.url =
    'https://piidsfebjqjmnepdpnas.supabase.co/rest/v1'
  state.user = { id: actor, is_anonymous: false }
  state.authError = state.contextError = null
  state.context = {
    authorized: true,
    user_id: actor,
    selected_company_id: company,
    is_platform_admin: true,
    permissions: ['users.write'],
    roles: ['platform_admin'],
  }
  state.getUser.mockImplementation(async () => ({
    data: { user: state.user },
    error: state.authError,
  }))
  state.rpc.mockImplementation(async () => ({
    data: state.context,
    error: state.contextError,
  }))
  state.company.mockResolvedValue({ id: company, status: 'active' })
  state.clients = [
    { id: client, company_id: company, name: 'Registered staff portal' },
  ]
  state.enroll.mockResolvedValue({
    invitationToken: 'never-return-this-token',
    acceptUrl: 'never-return-this-url',
    userId: null,
  })
})
describe('trusted OPS external staff first enrollment', () => {
  it('uses genuine getUser and same authenticated canonical context for selected company, then one existing canonical helper with stable key', async () => {
    const result = await enrollExternalStaffAdminAction(
      company,
      { ok: false, message: '' },
      form(),
    )
    expect(result).toMatchObject({ ok: true, status: 'pending' })
    expect(Object.keys(result).sort()).toEqual(['message', 'ok', 'status'])
    expect(state.getUser).toHaveBeenCalledOnce()
    expect(state.rpc).toHaveBeenCalledWith(
      'canonical_authenticated_tenant_context',
      { p_selected_company_id: company },
    )
    expect(state.enroll).toHaveBeenCalledExactlyOnceWith({
      companyId: company,
      apiClientId: client,
      actorUserId: actor,
      email: 'admin@example.invalid',
      fullName: 'First Admin',
      roleKey: 'company_admin',
      idempotencyKey: `ops-external-staff-enrollment:${company}:${key}`,
    })
    expect(JSON.stringify(result)).not.toMatch(
      /never-return|invitationToken|acceptUrl|actorUserId/,
    )
  })
  it('rejects a mismatched canonical subject even when context flags/permissions look privileged', async () => {
    state.context = { ...(state.context as object), user_id: foreign }
    expect(
      (await externalStaffEnrollmentAdmin.enroll(company, form())).ok,
    ).toBe(false)
    expect(state.company).not.toHaveBeenCalled()
    expect(state.select).not.toHaveBeenCalled()
    expect(state.enroll).not.toHaveBeenCalled()
  })
  it.each([
    { is_platform_admin: false },
    { is_platform_admin: 'true' },
    { authorized: false },
    { permissions: [] },
    { permissions: ['*'] },
    { selected_company_id: foreign },
  ])(
    'requires persisted exact current platform/company/users.write authority: %j',
    async (change) => {
      state.context = { ...(state.context as object), ...change }
      expect(
        (await externalStaffEnrollmentAdmin.enroll(company, form())).ok,
      ).toBe(false)
      expect(state.enroll).not.toHaveBeenCalled()
      expect(state.select).not.toHaveBeenCalled()
    },
  )
  it.each([
    null,
    { id: actor, is_anonymous: true },
    { id: actor, is_anonymous: 'true' },
    { id: actor, deleted_at: '2026-10-01T00:00:00Z' },
    { id: actor, banned_until: '2999-01-01T00:00:00Z' },
    { id: actor, banned_until: 'malformed' },
    { id: actor, banned_until: '2026' },
    { id: 'bad' },
  ])(
    'refuses missing/inactive/malformed genuine Auth identity before context: %j',
    async (user) => {
      state.user = user
      expect(
        (await externalStaffEnrollmentAdmin.enroll(company, form())).ok,
      ).toBe(false)
      expect(state.rpc).not.toHaveBeenCalled()
      expect(state.enroll).not.toHaveBeenCalled()
    },
  )
  it('rejects tenant Auth project configuration before SSR construction, getUser or RPC, including a colliding UUID', async () => {
    state.publicUrl = 'https://ayiuxjlfazkjmmtlvhsl.supabase.co'
    state.user = { id: actor, user_metadata: { is_platform_admin: true } }
    expect(
      (await externalStaffEnrollmentAdmin.enroll(company, form())).ok,
    ).toBe(false)
    expect(state.construct).not.toHaveBeenCalled()
    expect(state.getUser).not.toHaveBeenCalled()
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.enroll).not.toHaveBeenCalled()
  })
  it.each(['auth', 'rest', 'service', 'service-root', 'service-auth'])(
    'refuses mismatched ACTUAL %s SDK target before getUser or RPC',
    async (target) => {
      if (target === 'auth')
        state.authUrl = 'https://ayiuxjlfazkjmmtlvhsl.supabase.co/auth/v1'
      if (target === 'rest')
        state.restUrl = 'https://ayiuxjlfazkjmmtlvhsl.supabase.co/rest/v1'
      if (target === 'service')
        state.service.rest.url =
          'https://ayiuxjlfazkjmmtlvhsl.supabase.co/rest/v1'
      if (target === 'service-root')
        state.service.supabaseUrl = 'https://ayiuxjlfazkjmmtlvhsl.supabase.co'
      if (target === 'service-auth')
        state.service.auth.url =
          'https://ayiuxjlfazkjmmtlvhsl.supabase.co/auth/v1'
      expect(
        (await externalStaffEnrollmentAdmin.enroll(company, form())).ok,
      ).toBe(false)
      expect(state.getUser).not.toHaveBeenCalled()
      expect(state.rpc).not.toHaveBeenCalled()
      expect(state.select).not.toHaveBeenCalled()
      expect(state.enroll).not.toHaveBeenCalled()
    },
  )
  it('accepts real installed SDK target shape without network, and rejects an actual foreign SDK', () => {
    const own = createClient(
      'https://piidsfebjqjmnepdpnas.supabase.co',
      'synthetic-public-key',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    )
    const foreignSdk = createClient(
      'https://ayiuxjlfazkjmmtlvhsl.supabase.co',
      'synthetic-public-key',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    )
    expect(() => assertOpsEnrollmentSdkTargets(own)).not.toThrow()
    expect(() => assertOpsEnrollmentSdkTargets(foreignSdk)).toThrow()
  })
  it.each([
    'actor_user_id',
    'actorUserId',
    'company_id',
    'metadata',
    'callback_url',
    'membership_role',
  ])(
    'closed form denies browser authority injection %s before Auth/intent',
    async (injected) => {
      expect(
        (
          await externalStaffEnrollmentAdmin.enroll(
            company,
            form({ [injected]: foreign }),
          )
        ).ok,
      ).toBe(false)
      expect(state.getUser).not.toHaveBeenCalled()
      expect(state.enroll).not.toHaveBeenCalled()
    },
  )
  it.each(invalidInputs)(
    'validates explicit closed recipient/client/role/stable UUID: %j',
    async (change) => {
      expect(
        (await externalStaffEnrollmentAdmin.enroll(company, form(change))).ok,
      ).toBe(false)
      expect(state.enroll).not.toHaveBeenCalled()
    },
  )
  it('rejects duplicate form values and uploaded values without selecting an arbitrary identity', async () => {
    const duplicate = form()
    duplicate.append('api_client_id', foreign)
    expect(
      (await externalStaffEnrollmentAdmin.enroll(company, duplicate)).ok,
    ).toBe(false)
    const file = form()
    file.set('full_name', new Blob(['name']), 'name.txt')
    expect((await externalStaffEnrollmentAdmin.enroll(company, file)).ok).toBe(
      false,
    )
    expect(state.enroll).not.toHaveBeenCalled()
  })
  it('rejects a foreign company client before canonical invocation even when a valid UUID is manually posted', async () => {
    state.clients = [
      { id: foreign, company_id: foreign, name: 'Foreign portal' },
    ]
    expect(
      (
        await externalStaffEnrollmentAdmin.enroll(
          company,
          form({ api_client_id: foreign }),
        )
      ).ok,
    ).toBe(false)
    expect(state.enroll).not.toHaveBeenCalled()
  })
  it('returns only safe same-company registered client names/IDs and constrains registration query', async () => {
    state.clients.push({
      id: foreign,
      company_id: foreign,
      name: 'Foreign portal',
    })
    expect(await externalStaffEnrollmentAdmin.listClients(company)).toEqual([
      { id: client, name: 'Registered staff portal' },
    ])
    expect(state.select).toHaveBeenCalledWith(
      company,
      'integration_api_clients',
      'id,company_id,name',
    )
    expect(state.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'active'],
        ['is', 'deleted_at', null],
        ['is', 'revoked_at', null],
        ['contains', 'scopes', ['staff_users.read', 'staff_users.write']],
      ]),
    )
  })
  it('denies the dropdown read before any company/client query when persisted permission is absent despite metadata hints', async () => {
    state.user = {
      id: actor,
      user_metadata: { is_platform_admin: true, roles: ['platform_admin'] },
    }
    state.context = { ...(state.context as object), permissions: [] }
    await expect(
      externalStaffEnrollmentAdmin.listClients(company),
    ).rejects.toThrow()
    expect(state.company).not.toHaveBeenCalled()
    expect(state.select).not.toHaveBeenCalled()
  })
  it('refuses Auth or canonical context errors without any helper call or query', async () => {
    state.authError = new Error('synthetic-private-auth-detail')
    expect(
      (await externalStaffEnrollmentAdmin.enroll(company, form())).ok,
    ).toBe(false)
    expect(state.rpc).not.toHaveBeenCalled()
    state.authError = null
    state.contextError = new Error('synthetic-private-context-detail')
    expect(
      (await externalStaffEnrollmentAdmin.enroll(company, form())).ok,
    ).toBe(false)
    expect(state.company).not.toHaveBeenCalled()
    expect(state.select).not.toHaveBeenCalled()
    expect(state.enroll).not.toHaveBeenCalled()
  })
  it('replays the same submitted UUID through the same canonical key, with one helper submission per request and no own Auth/email work', async () => {
    await externalStaffEnrollmentAdmin.enroll(company, form())
    await externalStaffEnrollmentAdmin.enroll(company, form())
    expect(state.enroll).toHaveBeenCalledTimes(2)
    expect(state.enroll.mock.calls[0]).toEqual(state.enroll.mock.calls[1])
    expect(state.getUser).toHaveBeenCalledTimes(2)
    state.enroll.mockRejectedValue(new Error('IDEMPOTENCY_KEY_REUSE_MISMATCH'))
    const changed = await externalStaffEnrollmentAdmin.enroll(
      company,
      form({ email: 'different@example.invalid' }),
    )
    expect(changed.ok).toBe(false)
    expect(changed.message).toContain('samma inbjudan')
    expect(state.enroll).toHaveBeenCalledTimes(3)
  })
  it('retains native current role-ceiling/readiness denial and redacts unexpected errors without any automatic retry', async () => {
    for (const message of [
      'staff_role_ceiling_exceeded',
      'staff_identity_delivery_not_registered',
      'synthetic-sensitive-native-details',
    ]) {
      state.enroll.mockRejectedValue(new Error(message))
      const result = await externalStaffEnrollmentAdmin.enroll(company, form())
      expect(result.ok).toBe(false)
      expect(result.message).not.toContain(message)
    }
    expect(state.enroll).toHaveBeenCalledTimes(3)
  })
})
