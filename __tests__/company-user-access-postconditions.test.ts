// local/023; AUTH01.03/04, UI01.04/05 postcondition component only, not real SSR/Auth acceptance.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  reads: [] as Array<{table: string; columns: string; filters: Array<[string, unknown]>; limit: number | null}>,
  errors: {} as Record<string, unknown>,
  authUser: null as {id: string; email: string} | null,
  authError: null as unknown,
  authReads: [] as string[],
  rpcCalls: [] as Array<{name: string; args: unknown}>,
  rpcData: null as unknown,
  rpcError: null as unknown,
  accepted: false,
  writes: [] as string[],
}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {
  auth: {admin: {getUserById: async (id: string) => {
    io.authReads.push(id); return {data: {user: io.authUser}, error: io.authError}
  }}},
  rpc: async (name: string, args: unknown) => {
    io.rpcCalls.push({name, args})
    if (!io.rpcError && name === 'canonical_accept_tenant_invitation') io.accepted = true
    return {data: io.rpcData, error: io.rpcError}
  },
  from: (table: string) => {
    const read = {table, columns: '', filters: [] as Array<[string, unknown]>, limit: null as number | null}
    io.reads.push(read)
    const query = {
      select: (columns: string) => {read.columns = columns; return query},
      eq: (key: string, value: unknown) => {read.filters.push([key, value]); return query},
      in: (key: string, values: unknown[]) => {read.filters.push([key, values]); return query},
      limit: (limit: number) => {read.limit = limit; return query},
      insert: () => {io.writes.push(table); throw new Error('No direct access grants allowed')},
      update: () => {io.writes.push(table); throw new Error('No direct access mutation allowed')},
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
        // PostgREST validates relationships before returning rows, including empty results.
        const error = read.columns.includes('roles:role_id')
          ? {code: 'PGRST200', message: 'Missing user_roles role_id relationship'} : io.errors[table] ?? null
        const rows = (io.tables[table] ?? []).filter(row => read.filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
        )).slice(0, read.limit ?? Infinity).map(row => Object.fromEntries(
          read.columns.split(',').map(key => [key, row[key]]),
        ))
        return Promise.resolve({data: error ? null : rows, error}).then(resolve, reject)
      },
    }
    return query
  },
}}))
import {acceptCompanyInvitationAccess, grantCompanyUserAccess, verifyCompanyUserAccess} from '@/lib/auth/companyUserAccess'

const company = '11111111-1111-4111-8111-111111111111'
const user = '22222222-2222-4222-8222-222222222222'
const roleId = '33333333-3333-4333-8333-333333333333'
const foreign = '44444444-4444-4444-8444-444444444444'
const verifyInput = () => ({companyId: company, userId: user, email: 'synthetic@example.invalid', roleKey: 'company_admin', membershipRole: 'company_admin'})
const verify = () => verifyCompanyUserAccess(verifyInput())
beforeEach(() => {
  io.tables = {
    company_memberships: [{id: 'membership-own', company_id: company, user_id: user, membership_role: 'company_admin', role_key: 'company_admin', status: 'active', is_active: true}],
    user_roles: [{id: 'role-row-own', company_id: company, user_id: user, role_id: roleId, role: null, status: 'active', is_active: true}],
    roles: [{id: roleId, key: 'company_admin', name: 'Bolagsansvarig'}],
  }
  io.reads = []; io.errors = {}; io.authUser = {id: user, email: 'synthetic@example.invalid'}
  io.authError = null; io.authReads = []; io.rpcCalls = []; io.rpcError = null
  io.rpcData = {role_key: 'company_admin', membership_role: 'company_admin'}; io.accepted = false; io.writes = []
})
describe('FK-free canonical access postcondition', () => {
  it('reads the global catalog without a nonexistent tenant column but only exact referenced IDs', async () => {
    io.tables.roles.push({id: foreign, key: 'super_admin', name: 'Unrelated global role'})
    await expect(verify()).resolves.toHaveProperty('roleId', roleId)
    const catalogRead = io.reads.find(read => read.table === 'roles')!
    expect(catalogRead.columns).toBe('id,key,name')
    expect(catalogRead.filters).toEqual([['id', [roleId]]])
    expect(io.writes).toEqual([])
  })
  it('deduplicates referenced IDs without borrowing inactive or foreign tenant/user roles', async () => {
    io.tables.user_roles.push(
      {...io.tables.user_roles[0], id: 'second-different-direct-role', role: 'operations_agent'},
      {...io.tables.user_roles[0], id: 'foreign-company', company_id: foreign, role_id: foreign},
      {...io.tables.user_roles[0], id: 'foreign-user', user_id: foreign, role_id: foreign},
      {...io.tables.user_roles[0], id: 'inactive-role', status: 'inactive', role_id: foreign},
    )
    await expect(verify()).resolves.toHaveProperty('roleRowId', 'role-row-own')
    expect(io.reads.find(read => read.table === 'roles')?.filters).toEqual([['id', [roleId]]])
    expect(io.reads.find(read => read.table === 'user_roles')?.limit).toBe(10)
    expect(io.writes).toEqual([])
  })

  it('returns verified access after durable canonical invitation acceptance without the absent FK', async () => {
    await expect(acceptCompanyInvitationAccess({companyId: company, invitationId: 'invitation-own', userId: user, email: 'SYNTHETIC@example.invalid'}))
      .resolves.toEqual({membershipId: 'membership-own', roleRowId: 'role-row-own', roleId})
    expect(io.accepted).toBe(true)
    expect(io.rpcCalls).toEqual([{name: 'canonical_accept_tenant_invitation', args: {p_command: {
      company_id: company, invitation_id: 'invitation-own', user_id: user, actor_user_id: user,
      idempotency_key: `tenant-invitation-accept:${company}:invitation-own:${user}`,
    }}}])
    expect(io.authReads).toEqual([user]); expect(io.writes).toEqual([])
    const roleRead = io.reads.find(read => read.table === 'user_roles')!
    expect(roleRead.filters).toEqual([['company_id', company], ['user_id', user], ['status', 'active'], ['is_active', true]])
    expect(io.reads.find(read => read.table === 'roles')?.filters).toEqual([['id', [roleId]]])
  })
  it('retains catalog name normalization when key is null', async () => {
    io.tables.roles[0].key = null; await expect(verify()).resolves.toHaveProperty('roleId', roleId)
  })
  it('retains existing direct-role precedence over catalog names', async () => {
    io.tables.user_roles[0].role = 'operations_agent'; await expect(verify()).rejects.toThrow('systemroll saknas')
  })
  it('retains existing direct-role compatibility without inventing a catalog grant', async () => {
    io.tables.user_roles[0].role = 'company_admin'; io.tables.user_roles[0].role_id = null
    await expect(verify()).resolves.toMatchObject({roleRowId: 'role-row-own', roleId: null}); expect(io.writes).toEqual([])
  })
  it.each([
    ['company_id', foreign], ['company_id', null], ['user_id', foreign], ['status', 'inactive'], ['is_active', false],
  ])('denies user role %s=%s', async (field, value) => {
    io.tables.user_roles[0][field as string] = value
    await expect(verify()).rejects.toThrow('systemroll saknas'); expect(io.writes).toEqual([])
  })
  it('does not match a different canonical catalog role', async () => {
    io.tables.roles[0].key = 'operations_agent'; await expect(verify()).rejects.toThrow('systemroll saknas')
  })
  it('denies absent catalog mapping without adding or borrowing a role', async () => {
    io.tables.roles = [{id: foreign, key: 'company_admin', name: 'Bolagsansvarig'}]
    await expect(verify()).rejects.toThrow('systemroll saknas'); expect(io.writes).toEqual([])
  })
  it('denies duplicate matching canonical role rows', async () => {
    io.tables.user_roles.push({...io.tables.user_roles[0], id: 'second-role'})
    await expect(verify()).rejects.toThrow('Flera aktiva systemroller')
  })
  it.each([
    ['company_id', foreign], ['user_id', foreign], ['status', 'inactive'], ['is_active', false],
  ])('denies membership %s=%s before role reads', async (field, value) => {
    io.tables.company_memberships[0][field as string] = value
    await expect(verify()).rejects.toThrow('bolagskoppling saknas')
    expect(io.reads.some(read => read.table === 'user_roles')).toBe(false)
  })
  it('denies duplicate memberships', async () => {
    io.tables.company_memberships.push({...io.tables.company_memberships[0], id: 'duplicate'})
    await expect(verify()).rejects.toThrow('Flera aktiva bolagskopplingar')
  })
  it('denies membership role mismatch', async () => {
    io.tables.company_memberships[0].membership_role = 'viewer'
    await expect(verify()).rejects.toThrow('membershiprollen')
  })
  it('denies membership canonical role_key mismatch', async () => {
    io.tables.company_memberships[0].role_key = 'operations_agent'
    await expect(verify()).rejects.toThrow('role_key')
  })
  it('denies missing Auth identity before tenant reads', async () => {
    io.authUser = null; await expect(verify()).rejects.toThrow('Auth-användaren finns inte'); expect(io.reads).toEqual([])
  })
  it('denies Auth email mismatch before tenant reads', async () => {
    io.authUser!.email = 'other@example.invalid'; await expect(verify()).rejects.toThrow('e-post matchar inte'); expect(io.reads).toEqual([])
  })
  it.each(['company_memberships', 'user_roles', 'roles'])('propagates %s read error with no permission fallback', async table => {
    io.errors[table] = {code: '42501', message: 'synthetic denied read'}
    await expect(verify()).rejects.toMatchObject({code: '42501'}); expect(io.writes).toEqual([])
  })
  it('propagates canonical acceptance denial without postcondition reads', async () => {
    io.rpcError = {code: '42501'}
    await expect(acceptCompanyInvitationAccess({companyId: company, invitationId: 'invitation-own', userId: user, email: 'synthetic@example.invalid'})).rejects.toMatchObject({code: '42501'})
    expect(io.authReads).toEqual([]); expect(io.reads).toEqual([])
  })
  it('preserves grant through one canonical transaction followed by authoritative reads', async () => {
    await expect(grantCompanyUserAccess({companyId: company, userId: user, actorUserId: foreign, email: 'synthetic@example.invalid', membershipRole: 'company_admin', roleKey: 'company_admin', source: 'synthetic regression', idempotencyKey: 'same-command'}))
      .resolves.toMatchObject({membershipId: 'membership-own', roleRowId: 'role-row-own'})
    expect(io.rpcCalls.map(call => call.name)).toEqual(['canonical_change_tenant_user_access']); expect(io.writes).toEqual([])
  })
})
