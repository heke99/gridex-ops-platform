import Link from 'next/link'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getAdminUserById } from '@/lib/rbac/getAdminUserById'
import { getAllRoles } from '@/lib/rbac/getAllRoles'
import { getAllPermissions } from '@/lib/rbac/getAllPermissions'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'
import {
 getInternalRoleOptions,
 getPermissionMeta,
 getRoleMeta,
 sortPermissions,
} from '@/lib/rbac/catalog'
import {
 assignUserRoleAction,
 removeUserRoleAction,
 addUserPermissionOverrideAction,
 removeUserPermissionOverrideAction,
} from './actions'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
 if (!value) return '–'

 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return value

 return date.toLocaleString('sv-SE')
}

function toneClasses(state: 'allow' | 'deny') {
 return state === 'allow'
 ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
 : 'border-red-200 bg-red-50 text-red-700'
}

export default async function AdminUserDetailPage({
 params,
}: {
 params: Promise<{ id: string }>
}) {
 const current = await requirePlatformAdminAccess()
 const { id } = await params

 const [user, allRoles, allPermissions, effectivePermissionList] = await Promise.all([
  getAdminUserById(id),
  getAllRoles(),
  getAllPermissions(),
  getUserPermissions(id),
 ])
 const roles = getInternalRoleOptions(allRoles)
 const permissions = sortPermissions(allPermissions)
 const effectivePermissions = new Set(effectivePermissionList)

 const canManageRoles = current.permissions.includes('roles.manage')
 const canManagePermissionOverrides = current.permissions.includes('permissions.manage')

 const activeRoleCount = user.roles.length
 const overrideCount = user.overrides.length
 const allowCount = user.overrides.filter((row) => row.effect === 'allow').length
 const denyCount = user.overrides.filter((row) => row.effect === 'deny').length

 return (
 <div className="space-y-8 p-8">
 <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-start lg:justify-between">
 <div>
 <div className="flex flex-wrap items-center gap-3">
 <h1 className="text-2xl font-bold text-slate-950">
 {user.authUser.email ?? 'Användare'}
 </h1>
 <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
 Auth user
 </span>
 </div>

 <p className="mt-2 text-sm text-slate-700">{user.authUser.id}</p>
 <p className="mt-2 max-w-3xl text-sm text-slate-700">
 Roll = grundaccess. Permission override = individuell allow eller deny utöver grundrollen.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/users"
 className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
 >
 Tillbaka till användare
 </Link>
 <Link
 href="/admin/roles"
 className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
 >
 Öppna roller och permissions
 </Link>
 </div>
 </div>

 <section className="grid gap-4 xl:grid-cols-4">
 <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
 <p className="text-sm font-medium text-slate-700">Aktiva roller</p>
 <p className="mt-2 text-3xl font-semibold text-slate-950">{activeRoleCount}</p>
 </div>
 <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
 <p className="text-sm font-medium text-slate-700">Overrides</p>
 <p className="mt-2 text-3xl font-semibold text-slate-950">{overrideCount}</p>
 </div>
 <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
 <p className="text-sm font-medium text-emerald-700">Allow</p>
 <p className="mt-2 text-3xl font-semibold text-emerald-950">{allowCount}</p>
 </div>
 <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
 <p className="text-sm font-medium text-red-700">Deny</p>
 <p className="mt-2 text-3xl font-semibold text-red-950">{denyCount}</p>
 </div>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Aktiva roller</h2>
 <p className="mt-1 text-sm text-slate-700">
 Roller ger grundaccess. Kundrollen ska inte användas för intern adminaccess.
 </p>
 </div>

 {canManageRoles ? (
 <form action={assignUserRoleAction} className="flex w-full max-w-xl flex-col gap-3 md:flex-row">
 <input type="hidden" name="userId" value={id} />
 <select
 name="roleId"
 className="min-w-0 flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm"
 defaultValue=""
 required
 >
 <option value="" disabled>
 Välj intern roll
 </option>
 {roles.map((role) => {
 const meta = getRoleMeta(role.key)
 return (
 <option key={role.id} value={role.id}>
 {meta.label} ({role.key})
 </option>
 )
 })}
 </select>
 <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-800">
 Lägg till roll
 </button>
 </form>
 ) : (
 <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
 Du saknar <code>roles.manage</code>.
 </div>
 )}
 </div>

 <div className="mt-6 space-y-3">
 {user.roles.length === 0 && (
 <p className="text-sm text-slate-700">Inga aktiva roller.</p>
 )}

 {user.roles.map((role) => {
 const roleKey = role.roles?.key ?? ''
 const meta = getRoleMeta(roleKey)

 return (
 <div
 key={role.id}
 className="rounded-2xl border border-slate-200 p-4"
 >
 <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
 <div className="space-y-2">
 <div className="flex flex-wrap items-center gap-2">
 <p className="font-medium text-slate-950">
 {meta.label || role.roles?.name}
 </p>
 <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
 {roleKey}
 </span>
 </div>
 <p className="text-sm text-slate-700">{meta.description}</p>
 <p className="text-xs text-slate-700">
 Tilldelad: {formatDate(role.granted_at)}
 </p>
 </div>

 {canManageRoles ? (
 <form action={removeUserRoleAction}>
 <input type="hidden" name="userRoleId" value={role.id} />
 <input type="hidden" name="userId" value={id} />
 <button className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
 Ta bort roll
 </button>
 </form>
 ) : null}
 </div>
 </div>
 )
 })}
 </div>
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
 <div>
 <h2 className="text-lg font-semibold text-slate-950">Permission overrides</h2>
 <p className="mt-1 max-w-3xl text-sm text-slate-700">
 Här styr du individuell allow eller deny per permission. Detta kräver <code>permissions.manage</code>.
 </p>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
 Effektiva permissions just nu: <strong>{effectivePermissions.size}</strong>
 </div>
 </div>

 <div className="mt-6 space-y-3">
 {user.overrides.length === 0 && (
 <p className="text-sm text-slate-700">Inga overrides.</p>
 )}

 {user.overrides.map((override) => {
 const permissionKey = override.permissions?.key ?? ''
 const meta = getPermissionMeta(permissionKey)

 return (
 <div
 key={override.id}
 className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 lg:flex-row lg:items-start lg:justify-between"
 >
 <div className="space-y-2">
 <div className="flex flex-wrap items-center gap-2">
 <p className="font-medium text-slate-950">
 {meta.label || override.permissions?.name}
 </p>
 <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
 {permissionKey}
 </span>
 <span
 className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses(
 override.effect
 )}`}
 >
 {override.effect}
 </span>
 </div>
 <p className="text-sm text-slate-700">{meta.description}</p>
 <p className="text-xs text-slate-700">
 Sparad: {formatDate(override.granted_at)}
 {override.reason ? ` • ${override.reason}` : ''}
 </p>
 </div>

 {canManagePermissionOverrides ? (
 <form action={removeUserPermissionOverrideAction}>
 <input type="hidden" name="overrideId" value={override.id} />
 <input type="hidden" name="userId" value={id} />
 <button className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
 Ta bort override
 </button>
 </form>
 ) : null}
 </div>
 )
 })}
 </div>

 {canManagePermissionOverrides ? (
 <form action={addUserPermissionOverrideAction} className="mt-6 grid gap-3 md:grid-cols-4">
 <input type="hidden" name="userId" value={id} />

 <select
 name="permissionId"
 className="rounded-lg border px-3 py-2"
 defaultValue=""
 required
 >
 <option value="" disabled>
 Välj permission
 </option>
 {permissions.map((permission) => {
 const meta = getPermissionMeta(permission.key)
 return (
 <option key={permission.id} value={permission.id}>
 {meta.label} ({permission.key})
 </option>
 )
 })}
 </select>

 <select name="effect" className="rounded-lg border px-3 py-2" defaultValue="allow">
 <option value="allow">allow</option>
 <option value="deny">deny</option>
 </select>

 <input
 name="reason"
 placeholder="Anledning"
 className="rounded-lg border px-3 py-2"
 />

 <button className="rounded-lg bg-emerald-700 px-4 py-2 text-white">
 Lägg till override
 </button>
 </form>
 ) : (
 <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
 Du saknar <code>permissions.manage</code>, så du kan inte ändra overrides.
 </div>
 )}
 </section>
 </div>
 )
}