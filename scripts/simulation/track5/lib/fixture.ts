import { randomBytes, randomUUID } from 'node:crypto'
import { psql, serviceClient } from './db'

export type AdminFixture = {
  companyId: string
  userId: string
  email: string
  /** Genererat lokalt för denna fixture; skrivs aldrig till logg. */
  password: string
  permissionKeys: string[]
}

const sqlLit = (v: string) => `'${v.replace(/'/g, "''")}'`

/**
 * Syntetisk auth-användare (via GoTrue admin-API, så att lösenordsinloggning fungerar) + ett eget
 * företag med company_admin-medlemskap och explicita user_permissions.
 * Mönster (rader och kolumner) från scripts/helpers/staff-write-native-fixture.ts @ 1c0c088c.
 */
export async function createAdminFixture(opts: { permissionKeys?: string[]; companyName?: string } = {}): Promise<AdminFixture> {
  const permissionKeys = opts.permissionKeys ?? ['billing_underlay.read', 'billing_underlay.export']
  const companyId = randomUUID()
  const email = `sim-admin-${companyId.slice(0, 8)}@example.invalid`
  const password = `Sim-${randomBytes(12).toString('hex')}!`

  const { data, error } = await serviceClient().auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { synthetic: true },
  })
  if (error || !data.user) throw new Error(`createUser misslyckades: ${error?.message ?? 'ingen användare'}`)
  const userId = data.user.id

  const keys = permissionKeys.map(sqlLit).join(',')
  psql(`BEGIN;
    INSERT INTO public.companies(id,name,status) VALUES('${companyId}',${sqlLit(opts.companyName ?? 'Synthetic sim company')},'active');
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES('${userId}',${sqlLit(email)},'Synthetic sim admin','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active', email=excluded.email;
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
      VALUES('${companyId}','${userId}','company_admin','active',true,now(),now(),'company_admin','company_admin');
    ${keys ? `INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT '${userId}','${companyId}',id,key FROM public.permissions WHERE key IN(${keys});` : ''}
    COMMIT;`)
  return { companyId, userId, email, password, permissionKeys }
}

/** Best effort; stacken är ändå tillfällig. */
export async function removeAdminFixtureUser(f: AdminFixture): Promise<void> {
  await serviceClient().auth.admin.deleteUser(f.userId).catch(() => undefined)
}
