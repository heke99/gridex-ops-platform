import { randomUUID } from 'node:crypto'
import { literal, sql } from '../live-chain-fixture'

/**
 * Replay vs production drift (FINDINGS F52): production has the company roles with their permissions
 * (company_admin: 36 keys); the canonical replay seeds no roles or role_permissions, so a tenant user can
 * never open the admin workspace locally. Mirrors production's company_admin role and its exact keys, plus
 * contracts.create (20261020250000, F59) and communication.write/operations.write (20261020270000, F62) from
 * forward migrations, which find no role to grant in the replay.
 */
const COMPANY_ADMIN_PERMISSIONS = ['audit.read', 'billing_underlay.export', 'billing_underlay.read', 'cases.read', 'cases.write', 'communication.read',
  'communication.send', 'communication.write', 'contracts.create', 'contracts.read', 'contracts.write', 'customers.read', 'customers.write', 'documents.read', 'documents.write', 'integrations.read',
  'integrations.write', 'masterdata.read', 'masterdata.write', 'metering_points.read', 'metering_points.write', 'metering.read', 'metering.write', 'operations.write',
  'partner_exports.read', 'partner_exports.write', 'poa.read', 'poa.write', 'pricing.read', 'pricing.write', 'reports.read', 'sites.read', 'sites.write',
  'switching.read', 'switching.write', 'tenants.invite', 'tenants.read', 'users.read', 'users.write']

export function ensureProductionCompanyAdminRoleParity() {
  sql(`INSERT INTO public.roles(key,name,scope,is_system_role,is_active) SELECT 'company_admin','company_admin','company',true,true
     WHERE NOT EXISTS(SELECT FROM public.roles WHERE key='company_admin');
   INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT r.id,p.id FROM public.roles r JOIN public.permissions p ON p.key=ANY(ARRAY[${COMPANY_ADMIN_PERMISSIONS.map(literal).join(',')}])
    WHERE r.key='company_admin' AND NOT EXISTS(SELECT FROM public.role_permissions x WHERE x.role_id=r.id AND x.permission_id=p.id);`)
}

/**
 * Replay vs production drift (FINDINGS F55): production's price_areas has RLS with four policies (read with
 * masterdata.read/write, write with masterdata.write); the replay enables RLS with no policy at all, so no
 * tenant user sees any price area and manual intake cannot choose one. Mirrors production's policies exactly.
 */
export function ensureProductionPriceAreaPolicyParity() {
  if (sql<boolean>(`SELECT EXISTS(SELECT FROM pg_policy WHERE polrelid='public.price_areas'::regclass)`)) return
  sql(`CREATE POLICY gridex_mp_9e3cbe6bc23874fa0e77 ON public.price_areas FOR SELECT TO authenticated USING (gridex_has_permission((SELECT auth.uid()), 'masterdata.read') OR gridex_has_permission((SELECT auth.uid()), 'masterdata.write') OR gridex_has_permission((SELECT auth.uid()), 'masterdata.write'));
   CREATE POLICY gridex_mp_238f548b0a029425a889 ON public.price_areas FOR INSERT TO authenticated WITH CHECK (gridex_has_permission((SELECT auth.uid()), 'masterdata.write'));
   CREATE POLICY gridex_mp_1f234790bf98bfe6fce4 ON public.price_areas FOR UPDATE TO authenticated USING (gridex_has_permission((SELECT auth.uid()), 'masterdata.write'));
   CREATE POLICY gridex_mp_9e72fb6670d055765a4b ON public.price_areas FOR DELETE TO authenticated USING (gridex_has_permission((SELECT auth.uid()), 'masterdata.write'));`)
}

/**
 * A tenant employee with the company_admin role, created as an invited user ends up: an Auth user
 * (through GoTrue, so it can sign in), a profile, an active membership and the company role.
 */
export async function createTenantStaff(companyId: string, name = 'E2E Kundtjänst') {
  ensureProductionCompanyAdminRoleParity()
  ensureProductionPriceAreaPolicyParity()
  const id = randomUUID(), email = `e2e-staff-${id.slice(0, 8)}@example.invalid`, password = `Staff-${randomUUID()}`
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw Error('tenant_staff_supabase_env_required')
  const created = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id, email, password, email_confirm: true }) })
  if (!created.ok) throw Error(`tenant_staff_auth_user_failed:${created.status}:${await created.text()}`)
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},${literal(name)},'active') ON CONFLICT(id) DO UPDATE SET user_status='active';
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
    VALUES(${literal(companyId)},${literal(id)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
   INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active) SELECT ${literal(id)},id,'company_admin',${literal(companyId)},'active',true FROM public.roles WHERE key='company_admin';`)
  return { userId: id, email, password }
}
