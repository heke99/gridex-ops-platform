import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess, requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { isMissingSchemaError } from '@/lib/launch/readiness'
import { createRouteManualReviewAction, markRouteNotRelevantAction, verifyActorRouteForManualSendAction } from '@/app/admin/ediel/route-readiness/actions'

export const dynamic = 'force-dynamic'

type ActorRouteRow = {
  id: string
  actor_id: string
  message_family: string
  application_reference: string | null
  environment: string
  subaddress: string | null
  communication_type: string | null
  communication_address: string | null
  edi_charset: string | null
  edi_syntax: string | null
  party_id: string | null
  interchange_party_id: string | null
  requires_poa: boolean
  is_verified: boolean
  auto_send_allowed: boolean
  status: string
  source: string
  updated_at: string
  platform_market_actors?: {
    name?: string | null
    legal_name?: string | null
    org_number?: string | null
    match_status?: string | null
    visible_to_tenants?: boolean | null
  } | null
}

type ActorRoleRow = { actor_id: string; actor_role: string; is_active: boolean }
type IssueRow = { id: string; actor_id: string | null; issue_type: string; severity: string; status: string; message: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FAMILY = /^[A-Z][A-Z0-9_]{0,31}$/
const ROLE = /^[a-z][a-z0-9_]{0,63}$/

function requirementScope(actorId: unknown, family: unknown) {
  if (typeof actorId !== 'string' || !UUID.test(actorId)) return null
  if (typeof family !== 'string' || !FAMILY.test(family)) return null
  return { actorId: actorId.toLowerCase(), family }
}

function selectRequirements(scope: NonNullable<ReturnType<typeof requirementScope>>) {
  return supabaseService
    .from('gridex_route_readiness_v')
    .select('actor_id,actor_name,actor_role,message_family')
    .eq('actor_id', scope.actorId)
    .eq('message_family', scope.family)
}

async function decideRequirement(formData: FormData) {
  'use server'

  await requirePlatformAdminActionAccess()
  const scope = requirementScope(formData.get('actorId'), formData.get('messageFamily'))
  const actorRole = formData.get('actorRole')
  const decision = formData.get('decision')
  if (!scope || typeof actorRole !== 'string' || !ROLE.test(actorRole) || (decision !== 'review' && decision !== 'exclude')) {
    throw new Error('Ogiltigt beredskapsbeslut.')
  }

  const { data, error } = await selectRequirements(scope).eq('actor_role', actorRole).maybeSingle()
  if (error || data?.actor_id !== scope.actorId || data.message_family !== scope.family || data.actor_role !== actorRole) {
    throw new Error('Beredskapskravet kunde inte verifieras.')
  }

  const requirement = new FormData()
  requirement.set('actorId', data.actor_id)
  requirement.set('messageFamily', data.message_family)
  requirement.set('actorRole', data.actor_role)
  await (decision === 'review' ? createRouteManualReviewAction : markRouteNotRelevantAction)(requirement)
}

function bool(value: boolean | null | undefined) {
  return value ? 'Ja' : 'Nej'
}

function field(value: string | null | undefined) {
  return value?.trim() ? value : '—'
}

function routeTone(row: ActorRouteRow) {
  if (!row.communication_address) return 'border-red-200 bg-red-50 text-red-800'
  if (!row.is_verified || row.status !== 'active') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (row.auto_send_allowed) return 'border-purple-200 bg-purple-50 text-purple-800'
  return 'border-emerald-200 bg-emerald-50 text-emerald-800'
}

async function loadRoutes() {
  const [routesResult, rolesResult, issuesResult] = await Promise.all([
    supabaseService
      .from('platform_actor_routes')
      .select('*,platform_market_actors(name,legal_name,org_number,match_status,visible_to_tenants)')
      .order('updated_at', { ascending: false })
      .limit(500),
    supabaseService
      .from('platform_actor_roles')
      .select('actor_id,actor_role,is_active')
      .eq('is_active', true),
    supabaseService
      .from('platform_actor_import_issues')
      .select('id,actor_id,issue_type,severity,status,message')
      .in('status', ['open', 'acknowledged'])
      .limit(500),
  ])

  if (routesResult.error && !isMissingSchemaError(routesResult.error)) throw routesResult.error
  if (rolesResult.error && !isMissingSchemaError(rolesResult.error)) throw rolesResult.error
  if (issuesResult.error && !isMissingSchemaError(issuesResult.error)) throw issuesResult.error

  return {
    routes: routesResult.error ? [] : (routesResult.data ?? []) as ActorRouteRow[],
    roles: rolesResult.error ? [] : (rolesResult.data ?? []) as ActorRoleRow[],
    issues: issuesResult.error ? [] : (issuesResult.data ?? []) as IssueRow[],
  }
}

export default async function AdminEdielRoutesPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
} = {}) {
  await requirePlatformAdminAccess()
  const params = await searchParams
  const scope = requirementScope(params?.requirementActor, params?.requirementFamily)
  const requirementRequested = params?.requirementActor !== undefined || params?.requirementFamily !== undefined
  const [{ routes, roles, issues }, requirements] = await Promise.all([
    loadRoutes(),
    scope ? selectRequirements(scope).order('actor_role', { ascending: true }) : null,
  ])
  const verifiedRequirements = scope ? (requirements?.data ?? []).filter(row =>
    row.actor_id === scope.actorId
    && row.message_family === scope.family
    && typeof row.actor_role === 'string'
    && ROLE.test(row.actor_role),
  ) : []
  const requirementMessage = !scope ? 'Välj en giltig aktör och meddelandefamilj i ruttlistan.'
    : requirements?.error ? 'Beredskapskraven kunde inte läsas.'
      : !verifiedRequirements.length ? 'Inga beredskapskrav hittades för aktören och meddelandefamiljen.' : null
  const rolesByActor = new Map<string, string[]>()
  for (const role of roles) {
    const list = rolesByActor.get(role.actor_id) ?? []
    list.push(role.actor_role)
    rolesByActor.set(role.actor_id, list)
  }
  const issuesByActor = new Map<string, IssueRow[]>()
  for (const issue of issues) {
    if (!issue.actor_id) continue
    const list = issuesByActor.get(issue.actor_id) ?? []
    list.push(issue)
    issuesByActor.set(issue.actor_id, list)
  }

  return (
    <main className="space-y-6">
      <AdminHeader
        title="Ediel routes"
        subtitle="Produktionsvy mot actor registry: platform_market_actors, platform_actor_roles.actor_role, platform_actor_routes och import issues. Tenant-admins ska inte kunna ändra denna masterdata."
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Routes från actor registry</h2>
            <p className="text-sm text-slate-600">Verifiera route utan att slå på autosändning. Använd separat readiness innan auto_send_allowed sätts.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/ediel/auto-readiness" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">Aktörsberedskap</Link>
            <Link href="/admin/ediel/route-readiness" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Öppna route-readiness</Link>
            <Link href="/admin/ediel/routes/legacy" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Legacy route profiles</Link>
          </div>
        </div>
      </section>

      {requirementRequested && (
        <section id="beredskapskrav" aria-labelledby="beredskapskrav-heading" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 id="beredskapskrav-heading" className="text-lg font-semibold text-slate-950">Beredskapskrav</h2>
          {requirementMessage ? <p role="status">{requirementMessage}</p> : (
            <>
              <p className="text-sm text-slate-600">{verifiedRequirements[0].actor_name} · {verifiedRequirements[0].message_family}</p>
              <p className="text-sm text-slate-600">Beslutet gäller rollen och meddelandefamiljen i både test och produktion.</p>
              {verifiedRequirements.map(row => (
                <form key={row.actor_role} action={decideRequirement} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
                  <input type="hidden" name="actorId" value={row.actor_id} />
                  <input type="hidden" name="actorRole" value={row.actor_role} />
                  <input type="hidden" name="messageFamily" value={row.message_family} />
                  <span className="text-sm font-medium text-slate-950">{row.actor_role}</span>
                  <button type="submit" name="decision" value="review" className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50">Skapa granskning</button>
                  <button type="submit" name="decision" value="exclude" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Markera kravet som ej relevant</button>
                </form>
              ))}
            </>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Actor</th>
                <th className="px-3 py-3">Roller</th>
                <th className="px-3 py-3">Meddelande</th>
                <th className="px-3 py-3">Adressering</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Issues</th>
                <th className="px-3 py-3">Åtgärder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {routes.map((route) => {
                const actor = route.platform_market_actors
                const actorRoles = rolesByActor.get(route.actor_id) ?? []
                const actorIssues = issuesByActor.get(route.actor_id) ?? []
                const routeFamily = route.message_family.toUpperCase()
                const requirementParams = new URLSearchParams({
                  requirementActor: route.actor_id,
                  requirementFamily: ['MAIL', 'EMAIL'].includes(routeFamily) ? 'CONTACT' : routeFamily,
                })
                return (
                  <tr key={route.id} className="align-top">
                    <td className="px-3 py-4">
                      <div className="font-medium text-slate-950">{field(actor?.name)}</div>
                      <div className="text-xs text-slate-500">Org: {field(actor?.org_number)} · Match: {field(actor?.match_status)}</div>
                    </td>
                    <td className="px-3 py-4 text-slate-700">{actorRoles.length ? actorRoles.join(', ') : '—'}</td>
                    <td className="px-3 py-4 text-slate-700">
                      <div>{route.message_family}</div>
                      <div className="text-xs text-slate-500">{field(route.application_reference)} · {route.environment}</div>
                    </td>
                    <td className="px-3 py-4 text-xs text-slate-700">
                      <div>Adress: {field(route.communication_address)}</div>
                      <div>Subadress: {field(route.subaddress)}</div>
                      <div>Party: {field(route.party_id)} · UNB: {field(route.interchange_party_id)}</div>
                      <div>EDI: {field(route.edi_syntax)} / {field(route.edi_charset)}</div>
                    </td>
                    <td className="px-3 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${routeTone(route)}`}>
                        {route.status} · verified {bool(route.is_verified)} · auto {bool(route.auto_send_allowed)}
                      </span>
                      <div className="mt-2 text-xs text-slate-500">POA: {bool(route.requires_poa)} · Källa: {field(route.source)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs text-slate-700">
                      {actorIssues.length === 0 ? '—' : actorIssues.map((issue) => (
                        <div key={issue.id} className="mb-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                          {issue.severity}: {issue.issue_type} {issue.message ? `– ${issue.message}` : ''}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col gap-2">
                        <form action={verifyActorRouteForManualSendAction}>
                          <input type="hidden" name="actorId" value={route.actor_id} />
                          <input type="hidden" name="routeId" value={route.id} />
                          <button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700">Verifiera manuell</button>
                        </form>
                        <Link href={`/admin/ediel/routes?${requirementParams}#beredskapskrav`} prefetch={false} className="text-xs font-medium text-slate-700 underline hover:text-slate-950">
                          Visa aktörens beredskapskrav
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {routes.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Inga platform actor routes hittades. Importera actors/routes eller kör senaste migration.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
