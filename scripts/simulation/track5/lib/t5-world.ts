import { randomBytes, randomUUID } from 'node:crypto'
import { psql, serviceClient } from './db'

// Spår 5:s syntetiska värld: egna bolag och egna användare per körning (unika id, inga delade rader).
// Raderna och kolumnerna följer lib/fixture.ts (från scripts/helpers/staff-write-native-fixture.ts @ 1c0c088c).

export const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

export type T5User = { userId: string; email: string; password: string }

export function createCompany(name: string): string {
  const id = randomUUID()
  psql(`INSERT INTO public.companies(id,name,status) VALUES('${id}',${lit(name)},'active');`)
  return id
}

export async function createAuthUser(label: string): Promise<T5User> {
  const email = `sim-t5-${label}-${randomUUID().slice(0, 8)}@example.invalid`
  const password = `Sim-${randomBytes(12).toString('hex')}!`
  const { data, error } = await serviceClient().auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { synthetic: true },
  })
  if (error || !data.user) throw new Error(`createUser misslyckades: ${error?.message ?? 'ingen användare'}`)
  psql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES('${data.user.id}',${lit(email)},${lit(`Synthetic t5 ${label}`)},'active')
    ON CONFLICT(id) DO UPDATE SET user_status='active', email=excluded.email;`)
  return { userId: data.user.id, email, password }
}

/**
 * company_admin-medlemskap i bolaget + explicita user_permissions där, speglade till en egen bolagsroll
 * (user_roles + role_permissions) så att appens bolagsscopade behörighetsmotor ser dem.
 * URSPRUNG för rollspeglingen: scripts/helpers/browserFixture.ts @ 1c0c088c, mirrorBrowserRolePermissions.
 */
export function grantAdmin(userId: string, companyId: string, permissionKeys: string[]): void {
  const keys = permissionKeys.map(lit).join(',')
  psql(`BEGIN;
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
      VALUES('${companyId}','${userId}','company_admin','active',true,now(),now(),'company_admin','company_admin');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT '${userId}','${companyId}',id,key FROM public.permissions WHERE key IN(${keys});
    DO $mirror$DECLARE role uuid := gen_random_uuid(); BEGIN
      INSERT INTO public.roles(id,key,name,scope) VALUES(role,'native_actor_'||role,'Disposable sim t5 role','company');
      INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active)
        VALUES('${userId}','${companyId}',role,'native_actor_'||role,'active',true);
      INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
        SELECT role,'native_actor_'||role,up.permission_id,up.permission_key,up.effect FROM public.user_permissions up
        WHERE up.user_id='${userId}' AND up.company_id='${companyId}' AND up.is_active AND up.permission_id IS NOT NULL;
    END$mirror$;
    COMMIT;`)
  const n = Number(psql(`select count(*) from public.user_permissions where user_id='${userId}' and company_id='${companyId}'`))
  if (n !== permissionKeys.length) throw new Error(`grantAdmin: ${n} av ${permissionKeys.length} behörigheter finns i permissions`)
}

/** Syntetisk privatkund i bolaget. */
export function createCustomer(companyId: string, label: string): string {
  const id = randomUUID()
  psql(`INSERT INTO public.customers(id,company_id,customer_type,status,first_name,last_name,full_name,name,email,source,is_test_data)
    VALUES('${id}','${companyId}','private','active','Sim',${lit(label)},${lit(`Sim ${label}`)},${lit(`Sim ${label}`)},${lit(`kund-${id.slice(0, 8)}@example.invalid`)},'simulation',true);`)
  return id
}

/** Kundportalskonto: auth-användaren kopplas till en kund i bolaget (appens kundroll; inget admin-medlemskap). */
export function linkPortalAccount(userId: string, email: string, companyId: string, customerId: string): void {
  psql(`INSERT INTO public.customer_portal_accounts(company_id,user_id,customer_id,status,email,user_email,is_active,activated_at,verified_at,role,portal_user_id)
    VALUES('${companyId}','${userId}','${customerId}','active',${lit(email)},${lit(email)},true,now(),now(),'owner','${userId}');`)
}

export async function deleteAuthUser(userId: string): Promise<void> {
  await serviceClient().auth.admin.deleteUser(userId).catch(() => undefined)
}
