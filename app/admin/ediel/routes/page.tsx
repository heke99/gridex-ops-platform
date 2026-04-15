// app/admin/ediel/routes/page.tsx

import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import { saveEdielRouteProfileAction } from '@/app/admin/ediel/routes/actions'

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
  auth_config: Record<string, unknown> | null
  supported_payload_version: string | null
  notes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

type GridOwnerRow = {
  id: string
  name: string
  ediel_id: string | null
  owner_code: string
}

function isEdielCandidateRoute(route: CommunicationRouteRow): boolean {
  if (route.route_type === 'ediel_partner') return true
  if (route.target_system?.toLowerCase().includes('ediel')) return true
  if (route.target_email?.toLowerCase().includes('ediel')) return true
  return false
}

function Grid({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-all text-sm text-slate-900">
        {value && value.length > 0 ? value : '—'}
      </div>
    </div>
  )
}

export default async function AdminEdielRoutesPage() {
  const supabase = await createSupabaseServerClient()

  const [
    {
      data: { user },
    },
    routesResult,
    gridOwnersResult,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('communication_routes')
      .select('*')
      .order('updated_at', { ascending: false }),
    supabase.from('grid_owners').select('id,name,ediel_id,owner_code').order('name'),
  ])

  if (routesResult.error) throw routesResult.error
  if (gridOwnersResult.error) throw gridOwnersResult.error

  const allRoutes = (routesResult.data ?? []) as CommunicationRouteRow[]
  const gridOwners = (gridOwnersResult.data ?? []) as GridOwnerRow[]

  const edielRoutes = allRoutes.filter(isEdielCandidateRoute)

  const profiles = await Promise.all(
    edielRoutes.map((route) => getEdielRouteProfileByCommunicationRouteId(route.id))
  )

  const profileByRouteId = new Map(
    profiles.filter(Boolean).map((profile) => [profile!.communication_route_id, profile!])
  )

  const gridOwnerById = new Map(gridOwners.map((row) => [row.id, row]))

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel-routes"
        subtitle="Konfigurera vilka routes som faktiskt används mot Ediel, med Ediel-id, subadresser, mailbox och Strato-transport."
        userEmail={user?.email ?? null}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Totala candidate routes</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {edielRoutes.length}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Aktiva routes</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {edielRoutes.filter((route) => route.is_active).length}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Med Ediel-profil</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {profiles.filter(Boolean).length}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Redo för test</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {
              profiles.filter(
                (profile) =>
                  profile?.is_enabled &&
                  profile?.sender_ediel_id &&
                  profile?.receiver_ediel_id &&
                  profile?.mailbox
              ).length
            }
          </div>
        </div>
      </section>

      <section className="space-y-5">
        {edielRoutes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
            Inga routes ser ut att vara Ediel-routes ännu. Skapa eller uppdatera en
            communication route med route_type = <span className="font-medium">ediel_partner</span>.
          </div>
        ) : (
          edielRoutes.map((route) => {
            const profile = profileByRouteId.get(route.id) ?? null
            const gridOwner = route.grid_owner_id
              ? gridOwnerById.get(route.grid_owner_id) ?? null
              : null

            return (
              <div key={route.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-semibold text-slate-950">
                    {route.route_name}
                  </div>

                  <div className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    {route.route_type}
                  </div>

                  <div className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    {route.route_scope}
                  </div>

                  <div
                    className={`rounded-full px-2 py-1 text-xs ${
                      route.is_active
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {route.is_active ? 'aktiv route' : 'inaktiv route'}
                  </div>

                  <div
                    className={`rounded-full px-2 py-1 text-xs ${
                      profile?.is_enabled
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {profile?.is_enabled ? 'Ediel påslagen' : 'Ediel ej påslagen'}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <Grid label="Route-id" value={route.id} />
                  <Grid label="Target system" value={route.target_system} />
                  <Grid label="Target email" value={route.target_email} />
                  <Grid label="Endpoint" value={route.endpoint} />
                  <Grid
                    label="Nätägare"
                    value={
                      gridOwner
                        ? `${gridOwner.name}${gridOwner.ediel_id ? ` (${gridOwner.ediel_id})` : ''}`
                        : null
                    }
                  />
                  <Grid label="Payload version" value={route.supported_payload_version} />
                  <Grid label="Route notes" value={route.notes} />
                  <Grid label="Profile mailbox" value={profile?.mailbox ?? null} />
                </div>

                <form action={saveEdielRouteProfileAction} className="mt-5 space-y-4">
                  <input type="hidden" name="actorUserId" value={user?.id ?? ''} />
                  <input type="hidden" name="communicationRouteId" value={route.id} />

                  <div className="flex items-center gap-2">
                    <input
                      id={`isEnabled-${route.id}`}
                      type="checkbox"
                      name="isEnabled"
                      defaultChecked={profile?.is_enabled ?? true}
                      className="h-4 w-4"
                    />
                    <label
                      htmlFor={`isEnabled-${route.id}`}
                      className="text-sm font-medium text-slate-700"
                    >
                      Aktivera Ediel för denna route
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      name="senderEdielId"
                      defaultValue={profile?.sender_ediel_id ?? ''}
                      placeholder="Gridex Ediel-id"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="receiverEdielId"
                      defaultValue={profile?.receiver_ediel_id ?? gridOwner?.ediel_id ?? ''}
                      placeholder="Mottagarens Ediel-id"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="applicationReference"
                      defaultValue={profile?.application_reference ?? '23-DDQ-PRODAT'}
                      placeholder="Application Reference"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />

                    <input
                      name="senderSubAddress"
                      defaultValue={profile?.sender_sub_address ?? 'GRIDEX'}
                      placeholder="Sender sub address"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="receiverSubAddress"
                      defaultValue={profile?.receiver_sub_address ?? 'PRODAT'}
                      placeholder="Receiver sub address"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="mailbox"
                      defaultValue={profile?.mailbox ?? 'ediel@gridex.se'}
                      placeholder="Mailbox"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />

                    <input
                      name="smtpHost"
                      defaultValue={profile?.smtp_host ?? 'smtp.strato.com'}
                      placeholder="SMTP host"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="smtpPort"
                      defaultValue={profile?.smtp_port?.toString() ?? '465'}
                      placeholder="SMTP port"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="imapHost"
                      defaultValue={profile?.imap_host ?? 'imap.strato.com'}
                      placeholder="IMAP host"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />

                    <input
                      name="imapPort"
                      defaultValue={profile?.imap_port?.toString() ?? '993'}
                      placeholder="IMAP port"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="payloadFormat"
                      defaultValue={profile?.payload_format ?? 'edifact'}
                      placeholder="Payload format"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                    <input
                      name="encryptionMode"
                      defaultValue={profile?.encryption_mode ?? 'none'}
                      placeholder="Encryption mode"
                      className="rounded-xl border border-slate-300 px-3 py-2"
                    />
                  </div>

                  <textarea
                    name="notes"
                    defaultValue={profile?.notes ?? route.notes ?? ''}
                    placeholder="Anteckningar"
                    className="min-h-[100px] w-full rounded-xl border border-slate-300 px-3 py-2"
                  />

                  <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white">
                    Spara Ediel-profil
                  </button>
                </form>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}