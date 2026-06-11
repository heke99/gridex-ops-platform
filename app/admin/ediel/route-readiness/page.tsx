import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { isMissingSchemaError, routeReadinessLabel, routeReadinessNextStep, type RouteReadinessStatus } from '@/lib/launch/readiness'
import {
  createRouteManualReviewAction,
  markContactOnlySupplierAction,
  markRouteNotRelevantAction,
  saveSupplierContactAction,
  verifyActorRouteForManualSendAction,
} from './actions'

export const dynamic = 'force-dynamic'

type RouteReadinessRow = {
  actor_id: string
  actor_name: string | null
  legal_name: string | null
  org_number: string | null
  actor_status: string | null
  match_status: string | null
  visible_to_tenants: boolean | null
  actor_role: string | null
  message_family: string | null
  requirement_level: string | null
  route_id: string | null
  application_reference: string | null
  environment: string | null
  subaddress: string | null
  communication_type: string | null
  communication_address: string | null
  edi_charset: string | null
  edi_syntax: string | null
  party_id: string | null
  interchange_party_id: string | null
  requires_poa: boolean | null
  is_verified: boolean | null
  auto_send_allowed: boolean | null
  route_status: string | null
  route_source: string | null
  route_updated_at: string | null
  readiness_status: RouteReadinessStatus
  next_step: string | null
}

type ContactRow = {
  actor_id: string
  contact_type: string
  email: string | null
  phone: string | null
  is_verified: boolean
}

const ORDER: RouteReadinessStatus[] = [
  'critical_missing_route',
  'not_sendable',
  'needs_review',
  'recommended_missing_route',
  'optional_missing_route',
  'ready_verified_manual_send',
  'ready_auto_send_allowed',
  'not_required',
]

function statusTone(status: RouteReadinessStatus) {
  if (status === 'critical_missing_route' || status === 'not_sendable') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'needs_review' || status === 'recommended_missing_route') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status === 'ready_auto_send_allowed') return 'border-purple-200 bg-purple-50 text-purple-800'
  if (status === 'ready_verified_manual_send') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function field(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || String(value).trim().length === 0) return '—'
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej'
  return String(value)
}

function summary(rows: RouteReadinessRow[]) {
  const counts = new Map<RouteReadinessStatus, number>()
  for (const row of rows) counts.set(row.readiness_status, (counts.get(row.readiness_status) ?? 0) + 1)
  return ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }))
}

async function loadRouteReadiness() {
  const result = await supabaseService
    .from('gridex_route_readiness_v')
    .select('*')
    .order('readiness_status', { ascending: true })
    .order('actor_name', { ascending: true })
    .limit(500)

  if (result.error) {
    if (isMissingSchemaError(result.error)) return { rows: [] as RouteReadinessRow[], error: 'Migrationen för route-readiness saknas eller är inte körd ännu.' }
    throw result.error
  }

  return { rows: (result.data ?? []) as RouteReadinessRow[], error: null as string | null }
}

async function loadContacts(actorIds: string[]) {
  if (actorIds.length === 0) return [] as ContactRow[]
  const result = await supabaseService
    .from('platform_actor_contacts')
    .select('actor_id,contact_type,email,phone,is_verified')
    .in('actor_id', actorIds)
    .limit(1000)
  if (result.error) {
    if (isMissingSchemaError(result.error)) return [] as ContactRow[]
    throw result.error
  }
  return (result.data ?? []) as ContactRow[]
}

export default async function EdielRouteReadinessPage() {
  await requirePlatformAdminAccess()
  const { rows, error } = await loadRouteReadiness()
  const contacts = await loadContacts([...new Set(rows.map((row) => row.actor_id))])
  const contactsByActor = new Map<string, ContactRow[]>()
  for (const contact of contacts) {
    const list = contactsByActor.get(contact.actor_id) ?? []
    list.push(contact)
    contactsByActor.set(contact.actor_id, list)
  }

  const sortedRows = [...rows].sort((a, b) => {
    const byStatus = ORDER.indexOf(a.readiness_status) - ORDER.indexOf(b.readiness_status)
    if (byStatus !== 0) return byStatus
    return field(a.actor_name).localeCompare(field(b.actor_name), 'sv')
  })

  return (
    <main className="space-y-6">
      <AdminHeader
        title="Route-readiness"
        subtitle="Verifiera actor registry, saknade routes och manuella kontaktvägar innan elbolag får skicka i produktion. Bulk-verifiering slår aldrig på autosändning."
      />

      {error ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {error}
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        {summary(sortedRows).map((item) => (
          <div key={item.status} className={`rounded-2xl border p-4 ${statusTone(item.status)}`}>
            <div className="text-2xl font-semibold">{item.count}</div>
            <div className="mt-1 text-sm font-medium">{routeReadinessLabel(item.status)}</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Saknade och verifierade routes</h2>
            <p className="text-sm text-slate-600">Nätägare kräver PRODAT för kritiska marknadsflöden. UTILTS är rekommenderad för mätvärden. Suppliers kan vara contact-only.</p>
          </div>
          <a href="/api/admin/ediel/route-readiness/export" className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Exportera CSV</a>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Aktör</th>
                <th className="px-3 py-3">Roll</th>
                <th className="px-3 py-3">Familj</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Route</th>
                <th className="px-3 py-3">Kontakt</th>
                <th className="px-3 py-3">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row) => {
                const actorContacts = contactsByActor.get(row.actor_id) ?? []
                const needsContact = ['optional_missing_route', 'not_required'].includes(row.readiness_status)
                return (
                  <tr key={`${row.actor_id}-${row.actor_role}-${row.message_family}-${row.route_id ?? 'missing'}`} className="align-top">
                    <td className="px-3 py-4">
                      <div className="font-medium text-slate-950">{field(row.actor_name)}</div>
                      <div className="text-xs text-slate-500">Org: {field(row.org_number)} · Match: {field(row.match_status)}</div>
                    </td>
                    <td className="px-3 py-4 text-slate-700">{field(row.actor_role)}</td>
                    <td className="px-3 py-4 text-slate-700">{field(row.message_family)}</td>
                    <td className="px-3 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row.readiness_status)}`}>{routeReadinessLabel(row.readiness_status)}</span>
                      <div className="mt-2 max-w-xs text-xs text-slate-600">{row.next_step ?? routeReadinessNextStep(row.readiness_status)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs text-slate-700">
                      <div>Status: {field(row.route_status)}</div>
                      <div>Adress: {field(row.communication_address)}</div>
                      <div>Subadress: {field(row.subaddress)}</div>
                      <div>Verifierad: {field(row.is_verified)} · Auto: {field(row.auto_send_allowed)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs text-slate-700">
                      {actorContacts.length === 0 ? <div>—</div> : actorContacts.map((contact) => (
                        <div key={`${contact.contact_type}-${contact.email}-${contact.phone}`} className="mb-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                          {contact.contact_type}: {contact.email ?? contact.phone} {contact.is_verified ? '✓' : ''}
                        </div>
                      ))}
                      {needsContact ? (
                        <form action={saveSupplierContactAction} className="mt-2 grid min-w-64 gap-2">
                          <input type="hidden" name="actorId" value={row.actor_id} />
                          <select name="contactType" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                            <option value="general">Allmän</option>
                            <option value="switching">Leverantörsbyte</option>
                            <option value="moving">Flytt</option>
                            <option value="customer_service">Kundservice</option>
                            <option value="policy">Policy/bundenhet</option>
                            <option value="poa">Fullmakt</option>
                            <option value="billing">Fakturering</option>
                          </select>
                          <input name="email" placeholder="kontakt@bolag.se" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                          <button className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white">Spara kontakt</button>
                        </form>
                      ) : null}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col gap-2">
                        {row.route_id ? (
                          <form action={verifyActorRouteForManualSendAction}>
                            <input type="hidden" name="actorId" value={row.actor_id} />
                            <input type="hidden" name="routeId" value={row.route_id} />
                            <button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700">Verifiera manuellt</button>
                          </form>
                        ) : null}
                        <form action={createRouteManualReviewAction}>
                          <input type="hidden" name="actorId" value={row.actor_id} />
                          <input type="hidden" name="actorRole" value={row.actor_role ?? ''} />
                          <input type="hidden" name="messageFamily" value={row.message_family ?? ''} />
                          <button className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50">Skapa review</button>
                        </form>
                        <form action={markRouteNotRelevantAction}>
                          <input type="hidden" name="actorId" value={row.actor_id} />
                          <input type="hidden" name="actorRole" value={row.actor_role ?? ''} />
                          <input type="hidden" name="messageFamily" value={row.message_family ?? ''} />
                          <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Ej relevant</button>
                        </form>
                        {['electricity_supplier', 'supplier'].includes(String(row.actor_role)) ? (
                          <form action={markContactOnlySupplierAction}>
                            <input type="hidden" name="actorId" value={row.actor_id} />
                            <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Contact-only</button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {sortedRows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">Ingen route-readiness data hittades.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
