// app/admin/ediel/routes/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  explainEdielRouteRuntime,
  getEdielRouteRuntimeByCommunicationRouteId,
  type EdielRouteRuntimeRow,
} from '@/lib/ediel/config'
import {
  quickFixEdielProfileBasicsAction,
  quickFixEdielRouteActivationAction,
  quickFixEdielTargetEmailAction,
  quickFixGridOwnerEdielIdAction,
  saveEdielCommunicationRouteAction,
  saveEdielRouteProfileAction,
} from '@/app/admin/ediel/routes/actions'

export const dynamic = 'force-dynamic'

type CommunicationRouteRow = {
  id: string
  route_name: string
  is_active: boolean
  route_scope: string
  route_type: string
  grid_owner_id: string | null
  target_system: string
  endpoint: string | null
  target_email: string | null
  supported_payload_version: string | null
  notes: string | null
  updated_at: string
}

type GridOwnerRow = {
  id: string
  name: string
  ediel_id: string | null
  owner_code: string | null
}

function isEdielCandidateRoute(route: CommunicationRouteRow): boolean {
  if (route.route_type === 'ediel_partner') return true
  if (route.target_system?.toLowerCase().includes('ediel')) return true
  if (route.target_email?.toLowerCase().includes('ediel')) return true
  return false
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Pill({
  text,
  tone,
}: {
  text: string
  tone: 'green' | 'yellow' | 'red' | 'blue' | 'slate'
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'yellow'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'red'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : tone === 'blue'
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {text}
    </span>
  )
}

function Field({
  label,
  value,
}: {
  label: string
  value: string | number | null | undefined
}) {
  const display =
    value === null || value === undefined || String(value).trim().length === 0
      ? '—'
      : String(value)

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-900">{display}</div>
    </div>
  )
}

function boolTone(value: boolean): 'green' | 'red' {
  return value ? 'green' : 'red'
}

function issueTone(value: 'error' | 'warning'): 'red' | 'yellow' {
  return value === 'error' ? 'red' : 'yellow'
}

function sortRoutesForOps(rows: Array<{
  route: CommunicationRouteRow
  runtime: EdielRouteRuntimeRow | null
  ready: boolean
  issueCount: number
  errorCount: number
}>) {
  return [...rows].sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? 1 : -1
    if (a.errorCount !== b.errorCount) return b.errorCount - a.errorCount
    if (a.issueCount !== b.issueCount) return b.issueCount - a.issueCount
    return a.route.route_name.localeCompare(b.route.route_name, 'sv')
  })
}

export default async function AdminEdielRoutesPage() {
  const context = await requireAnyPermissionServer([
    'communication.read',
    'masterdata.read',
    'switching.read',
  ])

  const supabase = await createSupabaseServerClient()

  const [
    routesResult,
    gridOwnersResult,
  ] = await Promise.all([
    supabase
      .from('communication_routes')
      .select(
        'id,route_name,is_active,route_scope,route_type,grid_owner_id,target_system,endpoint,target_email,supported_payload_version,notes,updated_at'
      )
      .order('updated_at', { ascending: false }),
    supabase
      .from('grid_owners')
      .select('id,name,ediel_id,owner_code')
      .order('name'),
  ])

  if (routesResult.error) throw routesResult.error
  if (gridOwnersResult.error) throw gridOwnersResult.error

  const allRoutes = (routesResult.data ?? []) as CommunicationRouteRow[]
  const gridOwners = (gridOwnersResult.data ?? []) as GridOwnerRow[]
  const edielRoutes = allRoutes.filter(isEdielCandidateRoute)
  const gridOwnerById = new Map(gridOwners.map((row) => [row.id, row]))

  const runtimeRows = await Promise.all(
    edielRoutes.map(async (route) => {
      const runtime = await getEdielRouteRuntimeByCommunicationRouteId(route.id)
      const gridOwner = route.grid_owner_id
        ? gridOwnerById.get(route.grid_owner_id) ?? null
        : null

      const explanation = runtime
        ? explainEdielRouteRuntime({
            runtime,
            gridOwnerEdielId: gridOwner?.ediel_id ?? null,
          })
        : null

      return {
        route,
        gridOwner,
        runtime,
        explanation,
        ready: explanation?.isReadyForOutbound ?? false,
        issueCount: explanation?.issues.length ?? 1,
        errorCount:
          explanation?.issues.filter((issue) => issue.severity === 'error').length ?? 1,
      }
    })
  )

  const sortedRoutes = sortRoutesForOps(runtimeRows)

  const readyCount = sortedRoutes.filter((row) => row.ready).length
  const blockedCount = sortedRoutes.length - readyCount
  const missingRuntimeCount = sortedRoutes.filter((row) => !row.runtime).length
  const missingTargetEmailCount = sortedRoutes.filter(
    (row) => !row.route.target_email?.trim()
  ).length
  const missingReceiverCount = sortedRoutes.filter((row) => {
    const effectiveReceiver =
      row.explanation?.effectiveReceiverEdielId ??
      row.runtime?.receiver_ediel_id ??
      row.gridOwner?.ediel_id
    return !effectiveReceiver?.trim()
  }).length
  const missingMailboxCount = sortedRoutes.filter(
    (row) => !row.runtime?.mailbox?.trim()
  ).length

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel routes"
        subtitle="Den här sidan visar vad runtime faktiskt använder: effective receiver, mailbox, version override, ack-mode och blockerande route/profilproblem."
        userEmail={context.email}
      />

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Ediel-routes</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">{sortedRoutes.length}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm text-emerald-700">Redo i runtime</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-900">{readyCount}</div>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div className="text-sm text-rose-700">Blockerade</div>
          <div className="mt-2 text-3xl font-semibold text-rose-900">{blockedCount}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-700">Saknar runtime-profil</div>
          <div className="mt-2 text-3xl font-semibold text-amber-900">{missingRuntimeCount}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-700">Saknar receiver</div>
          <div className="mt-2 text-3xl font-semibold text-amber-900">{missingReceiverCount}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-700">Saknar mailbox</div>
          <div className="mt-2 text-3xl font-semibold text-amber-900">{missingMailboxCount}</div>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="text-lg font-semibold text-slate-950">Vad som är nytt här</h2>
        <p className="mt-1 text-sm text-slate-700">
          Tidigare såg sidan främst sparade routefält. Nu visar den i stället
          <span className="font-medium"> effective receiver Ediel-id</span>,
          <span className="font-medium"> runtime summary</span>,
          <span className="font-medium"> ack-mode</span>,
          <span className="font-medium"> payload/encryption</span> och exakt varför en route är blockerad.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill text={`saknar target_email: ${missingTargetEmailCount}`} tone={missingTargetEmailCount > 0 ? 'yellow' : 'green'} />
          <Pill text={`saknar receiver: ${missingReceiverCount}`} tone={missingReceiverCount > 0 ? 'yellow' : 'green'} />
          <Pill text={`saknar mailbox: ${missingMailboxCount}`} tone={missingMailboxCount > 0 ? 'yellow' : 'green'} />
        </div>
      </section>

      <section className="space-y-5">
        {sortedRoutes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
            Inga Ediel-routes hittades.
          </div>
        ) : (
          sortedRoutes.map(({ route, gridOwner, runtime, explanation }) => {
            const effectiveReceiver =
              explanation?.effectiveReceiverEdielId ??
              runtime?.receiver_ediel_id ??
              gridOwner?.ediel_id ??
              null

            return (
              <article
                key={route.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{route.route_name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {route.route_scope} · {route.route_type} · uppdaterad {formatDate(route.updated_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Pill text={route.is_active ? 'route aktiv' : 'route inaktiv'} tone={boolTone(route.is_active)} />
                    <Pill
                      text={runtime?.is_enabled ? 'profil aktiv' : 'profil saknas/av'}
                      tone={runtime?.is_enabled ? 'green' : 'red'}
                    />
                    <Pill
                      text={explanation?.isReadyForOutbound ? 'runtime redo' : 'runtime blockerad'}
                      tone={explanation?.isReadyForOutbound ? 'green' : 'red'}
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Runtime summary</div>
                  <p className="mt-2 text-sm text-slate-700">
                    {explanation?.summary ??
                      'Ingen runtime-profil hittades för routen ännu. Det betyder att communication route finns, men Ediel-runtime kan inte förklara eller använda den fullt ut.'}
                  </p>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Grid owner" value={gridOwner?.name ?? null} />
                  <Field label="Grid owner Ediel-id" value={gridOwner?.ediel_id ?? null} />
                  <Field label="Effective receiver Ediel-id" value={effectiveReceiver} />
                  <Field label="Target email" value={route.target_email} />
                  <Field label="Mailbox" value={runtime?.mailbox ?? null} />
                  <Field label="Sender Ediel-id" value={runtime?.sender_ediel_id ?? null} />
                  <Field label="Receiver Ediel-id (profil)" value={runtime?.receiver_ediel_id ?? null} />
                  <Field label="Application reference" value={runtime?.application_reference ?? null} />
                  <Field label="Ack-mode" value={runtime?.ack_mode ?? null} />
                  <Field label="Message standard" value={runtime?.message_standard ?? null} />
                  <Field label="Payload format" value={runtime?.payload_format ?? null} />
                  <Field label="Encryption mode" value={runtime?.encryption_mode ?? null} />
                  <Field label="Version override" value={runtime?.default_message_version ?? null} />
                  <Field label="Target system" value={route.target_system} />
                  <Field label="Endpoint" value={route.endpoint} />
                  <Field label="Supported payload version" value={route.supported_payload_version} />
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-sm font-semibold text-slate-900">Runtime issues</div>
                  {explanation?.issues.length ? (
                    <div className="space-y-2">
                      {explanation.issues.map((issue) => (
                        <div
                          key={issue.key}
                          className={`rounded-xl border px-3 py-3 ${
                            issue.severity === 'error'
                              ? 'border-rose-200 bg-rose-50'
                              : 'border-amber-200 bg-amber-50'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill text={issue.severity} tone={issueTone(issue.severity)} />
                            <div className="text-sm font-medium text-slate-900">{issue.label}</div>
                          </div>
                          <div className="mt-1 text-sm text-slate-700">{issue.resolution}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                      Inga blockerande eller varningsnivå-issues just nu.
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-5 xl:grid-cols-2">
                  <form
                    action={saveEdielCommunicationRouteAction}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <input type="hidden" name="id" value={route.id} />
                    <div className="mb-3 text-sm font-semibold text-slate-900">
                      Communication route
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Route name
                        </label>
                        <input
                          name="route_name"
                          defaultValue={route.route_name}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Route scope
                        </label>
                        <select
                          name="route_scope"
                          defaultValue={route.route_scope}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="supplier_switch">supplier_switch</option>
                          <option value="meter_values">meter_values</option>
                          <option value="billing_underlay">billing_underlay</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Route type
                        </label>
                        <select
                          name="route_type"
                          defaultValue={route.route_type}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="ediel_partner">ediel_partner</option>
                          <option value="partner_api">partner_api</option>
                          <option value="file_export">file_export</option>
                          <option value="email_manual">email_manual</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Grid owner
                        </label>
                        <select
                          name="grid_owner_id"
                          defaultValue={route.grid_owner_id ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="">—</option>
                          {gridOwners.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Target system
                        </label>
                        <input
                          name="target_system"
                          defaultValue={route.target_system}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Target email
                        </label>
                        <input
                          name="target_email"
                          defaultValue={route.target_email ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Endpoint
                        </label>
                        <input
                          name="endpoint"
                          defaultValue={route.endpoint ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Supported payload version
                        </label>
                        <input
                          name="supported_payload_version"
                          defaultValue={route.supported_payload_version ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Notes
                        </label>
                        <input
                          name="route_notes"
                          defaultValue={route.notes ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="is_active"
                        value="true"
                        defaultChecked={route.is_active}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Route aktiv
                    </label>

                    <div className="mt-4">
                      <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
                        Spara communication route
                      </button>
                    </div>
                  </form>

                  <form
                    action={saveEdielRouteProfileAction}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <input type="hidden" name="communicationRouteId" value={route.id} />
                    <div className="mb-3 text-sm font-semibold text-slate-900">
                      Ediel runtime profile
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Sender Ediel-id
                        </label>
                        <input
                          name="senderEdielId"
                          defaultValue={runtime?.sender_ediel_id ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Receiver Ediel-id
                        </label>
                        <input
                          name="receiverEdielId"
                          defaultValue={runtime?.receiver_ediel_id ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Sender name
                        </label>
                        <input
                          name="senderName"
                          defaultValue={runtime?.sender_name ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Receiver name
                        </label>
                        <input
                          name="receiverName"
                          defaultValue={runtime?.receiver_name ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Sender subaddress
                        </label>
                        <input
                          name="senderSubAddress"
                          defaultValue={runtime?.sender_sub_address ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Receiver subaddress
                        </label>
                        <input
                          name="receiverSubAddress"
                          defaultValue={runtime?.receiver_sub_address ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Mailbox
                        </label>
                        <input
                          name="mailbox"
                          defaultValue={runtime?.mailbox ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Application reference
                        </label>
                        <input
                          name="applicationReference"
                          defaultValue={runtime?.application_reference ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Default message version
                        </label>
                        <input
                          name="defaultMessageVersion"
                          defaultValue={runtime?.default_message_version ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Ack mode
                        </label>
                        <select
                          name="ackMode"
                          defaultValue={runtime?.ack_mode ?? 'default'}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="default">default</option>
                          <option value="none">none</option>
                          <option value="contrl_only">contrl_only</option>
                          <option value="contrl_and_aperak">contrl_and_aperak</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Message standard
                        </label>
                        <select
                          name="messageStandard"
                          defaultValue={runtime?.message_standard ?? 'edifact'}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="edifact">edifact</option>
                          <option value="xml">xml</option>
                          <option value="ai_list">ai_list</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Payload format
                        </label>
                        <select
                          name="payloadFormat"
                          defaultValue={runtime?.payload_format ?? 'edifact'}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="edifact">edifact</option>
                          <option value="xml">xml</option>
                          <option value="raw">raw</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Encryption mode
                        </label>
                        <select
                          name="encryptionMode"
                          defaultValue={runtime?.encryption_mode ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="">—</option>
                          <option value="none">none</option>
                          <option value="smime">smime</option>
                          <option value="pgp">pgp</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Environment
                        </label>
                        <select
                          name="environment"
                          defaultValue={runtime?.environment ?? 'test'}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="test">test</option>
                          <option value="production">production</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Default test flag
                        </label>
                        <select
                          name="defaultTestFlag"
                          defaultValue={runtime?.default_test_flag ?? 1}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="1">1</option>
                          <option value="0">0</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Default timezone
                        </label>
                        <input
                          name="defaultTimezone"
                          type="number"
                          defaultValue={runtime?.default_timezone ?? 1}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          SMTP host
                        </label>
                        <input
                          name="smtpHost"
                          defaultValue={runtime?.smtp_host ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          SMTP port
                        </label>
                        <input
                          name="smtpPort"
                          type="number"
                          defaultValue={runtime?.smtp_port ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          IMAP host
                        </label>
                        <input
                          name="imapHost"
                          defaultValue={runtime?.imap_host ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          IMAP port
                        </label>
                        <input
                          name="imapPort"
                          type="number"
                          defaultValue={runtime?.imap_port ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                          Notes
                        </label>
                        <input
                          name="notes"
                          defaultValue={runtime?.route_profile_notes ?? ''}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="isEnabled"
                        value="true"
                        defaultChecked={runtime?.is_enabled ?? false}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Ediel-profil aktiv
                    </label>

                    <div className="mt-4">
                      <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
                        Spara runtime profile
                      </button>
                    </div>
                  </form>
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-4">
                  <form action={quickFixEdielTargetEmailAction} className="rounded-2xl border border-slate-200 p-4">
                    <input type="hidden" name="routeId" value={route.id} />
                    <div className="mb-2 text-sm font-semibold text-slate-900">
                      Quick fix: target_email
                    </div>
                    <input
                      name="targetEmail"
                      defaultValue={route.target_email ?? ''}
                      placeholder="target_email"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
                      Spara email
                    </button>
                  </form>

                  <form action={quickFixEdielProfileBasicsAction} className="rounded-2xl border border-slate-200 p-4">
                    <input type="hidden" name="routeId" value={route.id} />
                    <div className="mb-2 text-sm font-semibold text-slate-900">
                      Quick fix: profilbas
                    </div>
                    <input
                      name="senderEdielId"
                      defaultValue={runtime?.sender_ediel_id ?? ''}
                      placeholder="senderEdielId"
                      className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      name="receiverEdielId"
                      defaultValue={runtime?.receiver_ediel_id ?? ''}
                      placeholder="receiverEdielId"
                      className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      name="mailbox"
                      defaultValue={runtime?.mailbox ?? ''}
                      placeholder="mailbox"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="enableEdiel"
                        value="true"
                        defaultChecked={runtime?.is_enabled ?? false}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Aktivera profil
                    </label>
                    <button className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
                      Spara profilbas
                    </button>
                  </form>

                  <form action={quickFixEdielRouteActivationAction} className="rounded-2xl border border-slate-200 p-4">
                    <input type="hidden" name="routeId" value={route.id} />
                    <div className="mb-2 text-sm font-semibold text-slate-900">
                      Quick fix: aktivering
                    </div>
                    <label className="mb-2 inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="activateRoute"
                        value="true"
                        defaultChecked={route.is_active}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Aktivera route
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="enableEdiel"
                        value="true"
                        defaultChecked={runtime?.is_enabled ?? false}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Aktivera Ediel-profil
                    </label>
                    <button className="mt-3 block rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
                      Kör aktivering
                    </button>
                  </form>

                  <form action={quickFixGridOwnerEdielIdAction} className="rounded-2xl border border-slate-200 p-4">
                    <input type="hidden" name="gridOwnerId" value={gridOwner?.id ?? ''} />
                    <div className="mb-2 text-sm font-semibold text-slate-900">
                      Quick fix: grid owner Ediel-id
                    </div>
                    <input
                      name="edielId"
                      defaultValue={gridOwner?.ediel_id ?? ''}
                      placeholder="grid owner ediel id"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      disabled={!gridOwner?.id}
                    />
                    <button
                      className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!gridOwner?.id}
                    >
                      Spara grid owner-id
                    </button>
                  </form>
                </div>
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}