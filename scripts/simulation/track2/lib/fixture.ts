import { randomBytes, randomUUID } from 'node:crypto'
import { psql, psqlRows, serviceClient } from './db'

export type FixtureActorObservation = {
  userId: string; companyId: string; observedAt: string
  authActive: boolean; profileActive: boolean; companyActive: boolean; membershipActive: boolean
  roleKeys: string[]; rolePermissionKeys: string[]
}

export type AdminFixture = {
  companyId: string
  userId: string
  email: string
  /** Genererat lokalt för denna fixture; skrivs aldrig till logg. */
  password: string
  permissionKeys: string[]
  /** Observed SQL fixture state, not ordinary signup or authenticated permission proof. */
  observedFixture?: FixtureActorObservation
}

const sqlLit = (v: string) => `'${v.replace(/'/g, "''")}'`
const actors = new Map<string, AdminFixture>()

export function fixtureActorExpectation(email: string): Pick<AdminFixture, 'userId' | 'companyId' | 'permissionKeys'> {
  const actor = actors.get(email)
  if (!actor) throw new Error('actor_fixture_identity_not_registered')
  return { userId: actor.userId, companyId: actor.companyId, permissionKeys: [...actor.permissionKeys] }
}

/** Read actual tenant-scoped fixture state; the authenticated resolver remains authoritative for DENY/effective access. */
export function observeFixtureActor(userId: string, companyId: string): FixtureActorObservation {
  let rows: Omit<FixtureActorObservation, 'observedAt'>[]
  try { rows = psqlRows<Omit<FixtureActorObservation, 'observedAt'>>(`
    SELECT u.id AS "userId",c.id AS "companyId",
      (u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())) AS "authActive",
      (profile.user_status='active') AS "profileActive",
      (c.status='active' AND c.lifecycle_status='active' AND c.is_active AND c.archived_at IS NULL AND c.suspended_at IS NULL) AS "companyActive",
      EXISTS(SELECT 1 FROM public.company_memberships membership WHERE membership.user_id=u.id AND membership.company_id=c.id
        AND membership.status='active' AND coalesce(membership.is_active,true)) AS "membershipActive",
      coalesce((SELECT jsonb_agg(DISTINCT role.key) FROM public.user_roles ur JOIN public.roles role ON role.id=ur.role_id
        WHERE ur.user_id=u.id AND ur.company_id=c.id AND coalesce(ur.status,'active')='active' AND coalesce(ur.is_active,true)
          AND coalesce(role.is_active,true)),'[]'::jsonb) AS "roleKeys",
      coalesce((SELECT jsonb_agg(DISTINCT permission.key) FROM public.user_roles ur JOIN public.roles role ON role.id=ur.role_id
        JOIN public.role_permissions grant_row ON grant_row.role_id=role.id JOIN public.permissions permission ON permission.id=grant_row.permission_id
        WHERE ur.user_id=u.id AND ur.company_id=c.id AND coalesce(ur.status,'active')='active' AND coalesce(ur.is_active,true)
          AND coalesce(role.is_active,true) AND permission.is_active AND coalesce(grant_row.effect,'allow')='allow'),'[]'::jsonb) AS "rolePermissionKeys"
    FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id
    JOIN public.companies c ON c.id=${sqlLit(companyId)} WHERE u.id=${sqlLit(userId)}`) }
  catch { throw new Error('actor_fixture_observation_failed') }
  const row = rows[0]
  if (rows.length !== 1 || row.userId !== userId || row.companyId !== companyId
    || !Array.isArray(row.roleKeys) || !row.roleKeys.every(key => typeof key === 'string')
    || !Array.isArray(row.rolePermissionKeys) || !row.rolePermissionKeys.every(key => typeof key === 'string')) {
    throw new Error('actor_fixture_observation_unqualified')
  }
  // Explicit projection excludes raw Auth rows, email, hashes and credential fields.
  return { userId, companyId, observedAt: new Date().toISOString(), authActive: row.authActive === true, profileActive: row.profileActive === true,
    companyActive: row.companyActive === true, membershipActive: row.membershipActive === true,
    roleKeys: [...new Set(row.roleKeys)].sort(), rolePermissionKeys: [...new Set(row.rolePermissionKeys)].sort() }
}

/**
 * Syntetisk auth-användare (via GoTrue admin-API, så att lösenordsinloggning fungerar) + ett eget
 * företag med company_admin-medlemskap och explicita user_permissions.
 * Mönster (rader och kolumner) från scripts/helpers/staff-write-native-fixture.ts @ 1c0c088c.
 */
export async function createAdminFixture(opts: { permissionKeys?: string[]; companyName?: string } = {}): Promise<AdminFixture> {
  const permissionKeys = [...new Set(opts.permissionKeys ?? ['billing_underlay.read', 'billing_underlay.export'])]
  const hosted = process.env.SIM_REQUIRE_ACTOR_RECEIPT === '1'
  const companyId = randomUUID()
  const email = `sim-admin-${companyId.slice(0, 8)}@example.invalid`
  const password = `Sim-${randomBytes(12).toString('hex')}!`

  const { data, error } = await serviceClient().auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { synthetic: true },
  }).catch(error => {
    if (hosted) throw new Error('actor_fixture_auth_creation_failed')
    throw error
  })
  if (error || !data.user) throw new Error(hosted
    ? 'actor_fixture_auth_creation_failed' : `createUser misslyckades: ${error?.message ?? 'ingen användare'}`)
  const userId = data.user.id

  const keys = permissionKeys.map(sqlLit).join(',')
  const roleId = hosted ? randomUUID() : null
  const roleKey = `sim_actor_${roleId}`
  try { psql(`BEGIN;
    INSERT INTO public.companies(id,name,status) VALUES('${companyId}',${sqlLit(opts.companyName ?? 'Synthetic sim company')},'active');
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES('${userId}',${sqlLit(email)},'Synthetic sim admin','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active', email=excluded.email;
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
      VALUES('${companyId}','${userId}','company_admin','active',true,now(),now(),'company_admin','company_admin');
    ${keys ? `INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT '${userId}','${companyId}',id,key FROM public.permissions WHERE key IN(${keys});` : ''}
    ${hosted ? `INSERT INTO public.roles(id,key,name,scope,is_active)
      VALUES('${roleId}',${sqlLit(roleKey)},'Disposable hosted synthetic actor','company',true);
      INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active)
      VALUES('${userId}','${companyId}','${roleId}',${sqlLit(roleKey)},'active',true);
      ${keys ? `INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
        SELECT '${roleId}',${sqlLit(roleKey)},id,key,'allow' FROM public.permissions WHERE key IN(${keys});` : ''}` : ''}
    COMMIT;`) } catch (error) {
    if (hosted) throw new Error('actor_fixture_setup_unconfirmed')
    throw error
  }
  const fixture: AdminFixture = { companyId, userId, email, password, permissionKeys }
  if (hosted) {
    fixture.observedFixture = observeFixtureActor(userId, companyId)
    Object.defineProperty(fixture, 'password', { value: password, enumerable: false })
  }
  actors.set(email, fixture)
  return fixture
}

/** Best effort; stacken är ändå tillfällig. */
export async function removeAdminFixtureUser(f: AdminFixture): Promise<void> {
  actors.delete(f.email)
  await serviceClient().auth.admin.deleteUser(f.userId).catch(() => undefined)
}
