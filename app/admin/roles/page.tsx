// app/admin/roles/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import {
 ROLE_PERMISSION_PROFILES,
 getRoleProfilePermissions,
} from '@/lib/admin/accessModel'

type RoleRow = {
 id: string
 key: string
 name: string | null
 description: string | null
 is_system: boolean | null
 created_at: string | null
}

type PermissionRow = {
 id: string
 key: string
 name: string | null
 description: string | null
}

type RolePermissionRow = {
 role_id: string
 permission_id: string
}

function formatDate(value: string | null) {
 if (!value) return '—'

 try {
 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
 } catch {
 return value
 }
}

function uniqueSorted(values: string[]) {
 return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'sv'))
}

export default async function AdminRolesPage() {
 await requirePlatformAdminAccess()
 const supabase = await createSupabaseServerClient()

 const {
 data: { user },
 } = await supabase.auth.getUser()

 const [rolesResult, permissionsResult, rolePermissionsResult] = await Promise.all([
 supabase.from('roles').select('*').order('key'),
 supabase.from('permissions').select('*').order('key'),
 supabase.from('role_permissions').select('role_id, permission_id'),
 ])

 if (rolesResult.error) throw rolesResult.error
 if (permissionsResult.error) throw permissionsResult.error
 if (rolePermissionsResult.error) throw rolePermissionsResult.error

 const roles = (rolesResult.data ?? []) as RoleRow[]
 const permissions = (permissionsResult.data ?? []) as PermissionRow[]
 const rolePermissions = (rolePermissionsResult.data ?? []) as RolePermissionRow[]

 const permissionKeyById = new Map(
 permissions.map((permission) => [permission.id, permission.key])
 )
 const permissionsByRoleId = new Map<string, string[]>()

 for (const row of rolePermissions) {
 const permissionKey = permissionKeyById.get(row.permission_id)
 if (!permissionKey) continue

 const current = permissionsByRoleId.get(row.role_id) ?? []
 current.push(permissionKey)
 permissionsByRoleId.set(row.role_id, current)
 }

 const permissionMetadata = new Map(
 permissions.map((permission) => [
 permission.key,
 {
 name: permission.name ?? permission.key,
 description: permission.description ?? '',
 },
 ])
 )

 const rows = roles.map((role) => {
 const actualPermissions = uniqueSorted(permissionsByRoleId.get(role.id) ?? [])
 const recommendedPermissions = getRoleProfilePermissions(role.key)

 const actualSet = new Set(actualPermissions)
 const recommendedSet = new Set(recommendedPermissions)

 const missingFromDb = recommendedPermissions.filter((key) => !actualSet.has(key))
 const extraInDb = actualPermissions.filter((key) => !recommendedSet.has(key))

 const profile = ROLE_PERMISSION_PROFILES[role.key]

 return {
 role,
 profile,
 actualPermissions,
 recommendedPermissions,
 missingFromDb,
 extraInDb,
 coverage:
 recommendedPermissions.length === 0
 ? null
 : Math.round(
 ((recommendedPermissions.length - missingFromDb.length) /
 recommendedPermissions.length) *
 100
 ),
 }
 })

 const rolesWithoutRecommendedProfile = rows.filter((entry) => !entry.profile)
 const rolesWithGaps = rows.filter(
 (entry) => entry.profile && (entry.missingFromDb.length > 0 || entry.extraInDb.length > 0)
 )
 const rolesFullyAligned = rows.filter(
 (entry) => entry.profile && entry.missingFromDb.length === 0 && entry.extraInDb.length === 0
 )

 return (
 <div className="space-y-6">
 <AdminHeader
 title="Roller och permission-profiler"
 subtitle="Jämför databasens faktiska rollkopplingar mot rekommenderad standardprofil för varje intern roll."
 userEmail={user?.email ?? null}
 />

 <section className="grid gap-4 md:grid-cols-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
 <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-700">
 Roller totalt
 </p>
 <p className="mt-3 text-3xl font-semibold text-slate-900">{rows.length}</p>
 <p className="mt-2 text-sm text-slate-700">
 Alla roller som finns i databasen just nu.
 </p>
 </div>

 <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
 <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">
 Helt i synk
 </p>
 <p className="mt-3 text-3xl font-semibold text-emerald-900">
 {rolesFullyAligned.length}
 </p>
 <p className="mt-2 text-sm text-emerald-800">
 Rollprofiler där DB matchar rekommenderad accessmodell exakt.
 </p>
 </div>

 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
 <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-700">
 Avvikelser
 </p>
 <p className="mt-3 text-3xl font-semibold text-amber-900">
 {rolesWithGaps.length}
 </p>
 <p className="mt-2 text-sm text-amber-800">
 Roller där DB och standardprofil fortfarande skiljer sig.
 </p>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
 <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-700">
 Saknar profil
 </p>
 <p className="mt-3 text-3xl font-semibold text-slate-900">
 {rolesWithoutRecommendedProfile.length}
 </p>
 <p className="mt-2 text-sm text-slate-700">
 Roller i DB som ännu inte har en definierad standardprofil i koden.
 </p>
 </div>
 </section>

 <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
 <div className="border-b border-slate-200 px-6 py-5">
 <h2 className="text-lg font-semibold text-slate-900">Rollkatalog</h2>
 <p className="mt-1 text-sm text-slate-700">
 Här ser du både faktisk DB-konfiguration och vad rollen borde ha enligt accessmodellen.
 </p>
 </div>

 <div className="space-y-6 p-6">
 {rows.map(
 ({
 role,
 profile,
 actualPermissions,
 recommendedPermissions,
 missingFromDb,
 extraInDb,
 coverage,
 }) => (
 <article
 key={role.id}
 className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
 >
 <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
 <div>
 <div className="flex flex-wrap items-center gap-2">
 <h3 className="text-lg font-semibold text-slate-900">
 {role.name ?? role.key}
 </h3>
 <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
 {role.key}
 </span>
 {role.is_system ? (
 <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
 systemroll
 </span>
 ) : null}
 </div>

 <p className="mt-2 max-w-3xl text-sm text-slate-700">
 {profile?.description ?? role.description ?? 'Ingen profilbeskrivning ännu.'}
 </p>

 <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-700">
 <span>Skapad: {formatDate(role.created_at)}</span>
 <span>Faktiska permissions: {actualPermissions.length}</span>
 <span>Rekommenderade permissions: {recommendedPermissions.length}</span>
 <span>
 Täckning: {coverage === null ? '—' : `${coverage}%`}
 </span>
 </div>
 </div>

 <div className="flex flex-wrap gap-2">
 {profile ? (
 missingFromDb.length === 0 && extraInDb.length === 0 ? (
 <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
 Matchar standardprofil
 </span>
 ) : (
 <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
 Behöver justeras
 </span>
 )
 ) : (
 <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
 Saknar profil i koden
 </span>
 )}
 </div>
 </div>

 <div className="mt-5 grid gap-4 xl:grid-cols-3">
 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <h4 className="text-sm font-semibold text-slate-900">
 Rekommenderad profil
 </h4>
 <p className="mt-1 text-xs text-slate-700">
 Baslinje från accessmodellen för denna roll.
 </p>

 <div className="mt-3 flex flex-wrap gap-2">
 {recommendedPermissions.length > 0 ? (
 recommendedPermissions.map((permissionKey) => (
 <span
 key={permissionKey}
 className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
 title={permissionMetadata.get(permissionKey)?.description ?? ''}
 >
 {permissionKey}
 </span>
 ))
 ) : (
 <span className="text-sm text-slate-700">Ingen definierad profil.</span>
 )}
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <h4 className="text-sm font-semibold text-slate-900">Saknas i DB</h4>
 <p className="mt-1 text-xs text-slate-700">
 Permissions som rollen borde ha men inte har just nu.
 </p>

 <div className="mt-3 flex flex-wrap gap-2">
 {missingFromDb.length > 0 ? (
 missingFromDb.map((permissionKey) => (
 <span
 key={permissionKey}
 className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800"
 title={permissionMetadata.get(permissionKey)?.description ?? ''}
 >
 {permissionKey}
 </span>
 ))
 ) : (
 <span className="text-sm text-slate-700">Inget saknas.</span>
 )}
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-white p-4">
 <h4 className="text-sm font-semibold text-slate-900">Extra i DB</h4>
 <p className="mt-1 text-xs text-slate-700">
 Permissions som finns i DB men inte i standardprofilen.
 </p>

 <div className="mt-3 flex flex-wrap gap-2">
 {extraInDb.length > 0 ? (
 extraInDb.map((permissionKey) => (
 <span
 key={permissionKey}
 className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-800"
 title={permissionMetadata.get(permissionKey)?.description ?? ''}
 >
 {permissionKey}
 </span>
 ))
 ) : (
 <span className="text-sm text-slate-700">Inga extra permissions.</span>
 )}
 </div>
 </div>
 </div>

 <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
 <summary className="cursor-pointer text-sm font-semibold text-slate-900">
 Visa faktiska permissions i databasen
 </summary>

 <div className="mt-4 flex flex-wrap gap-2">
 {actualPermissions.length > 0 ? (
 actualPermissions.map((permissionKey) => (
 <span
 key={permissionKey}
 className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
 title={permissionMetadata.get(permissionKey)?.description ?? ''}
 >
 {permissionKey}
 </span>
 ))
 ) : (
 <span className="text-sm text-slate-700">
 Rollen har inga permissions kopplade i DB.
 </span>
 )}
 </div>
 </details>
 </article>
 )
 )}
 </div>
 </section>
 </div>
 )
}