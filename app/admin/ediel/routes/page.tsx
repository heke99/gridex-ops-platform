import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import {
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

type RouteValidationIssue = {
  key: string
  severity: 'error' | 'warning'
  label: string
  resolution: string
}

function buildRouteValidation(params: {
  route: CommunicationRouteRow
  gridOwner: GridOwnerRow | null
  profile: Awaited<ReturnType<typeof getEdielRouteProfileByCommunicationRouteId>> | null
}): RouteValidationIssue[] {
  const issues: RouteValidationIssue[] = []

  if (!params.route.is_active) {
    issues.push({
      key: 'route_inactive',
      severity: 'error',
      label: 'Communication route är inaktiv',
      resolution: 'Aktivera routen eller välj en annan route för denna nätägare.',
    })
  }

  if (!params.profile) {
    issues.push({
      key: 'profile_missing',
      severity: 'error',
      label: 'Ediel-profil saknas helt',
      resolution: 'Skapa och spara en Ediel-profil för routen innan den används i drift.',
    })
    return issues
  }

  if (!params.profile.is_enabled) {
    issues.push({
      key: 'profile_disabled',
      severity: 'error',
      label: 'Ediel-profilen är inte aktiverad',
      resolution: 'Slå på Ediel-profilen för routen.',
    })
  }

  if (!params.route.target_email?.trim()) {
    issues.push({
      key: 'target_email',
      severity: 'warning',
      label: 'target_email saknas',
      resolution:
        'Fyll target_email på communication route för tydlig mottagare vid SMTP-sändning.',
    })
  }

  if (!params.profile.sender_ediel_id?.trim()) {
    issues.push({
      key: 'sender_ediel_id',
      severity: 'error',
      label: 'sender_ediel_id saknas',
      resolution: 'Fyll avsändarens Ediel-id på routeprofilen.',
    })
  }

  if (
    !(
      params.profile.receiver_ediel_id?.trim() ||
      params.gridOwner?.ediel_id?.trim()
    )
  ) {
    issues.push({
      key: 'receiver_ediel_id',
      severity: 'error',
      label: 'receiver_ediel_id saknas',
      resolution:
        'Fyll mottagarens Ediel-id på routeprofilen eller i grid owner-masterdata.',
    })
  }

  if (!params.profile.mailbox?.trim()) {
    issues.push({
      key: 'mailbox',
      severity: 'error',
      label: 'mailbox saknas',
      resolution: 'Fyll mailbox på routeprofilen så att rätt Ediel-brevlåda används.',
    })
  }

  return issues
}

function isRouteReadyForOutbound(issues: RouteValidationIssue[]): boolean {
  return issues.every((issue) => issue.severity !== 'error')
}

function summaryTone(issues: RouteValidationIssue[]): 'green' | 'yellow' | 'red' {
  if (issues.some((issue) => issue.severity === 'error')) return 'red'
  if (issues.length > 0) return 'yellow'
  return 'green'
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

function Pill({
  text,
  tone,
}: {
  text: string
  tone: 'green' | 'yellow' | 'red' | 'slate' | 'blue'
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'yellow'
        ? 'bg-amber-100 text-amber-700'
        : tone === 'red'
          ? 'bg-rose-100 text-rose-700'
          : tone === 'blue'
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-100 text-slate-700'

  return <div className={`rounded-full px-2 py-1 text-xs ${toneClass}`}>{text}</div>
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

  const validationByRouteId = new Map(
    edielRoutes.map((route) => {
      const profile = profileByRouteId.get(route.id) ?? null
      const gridOwner = route.grid_owner_id
        ? gridOwnerById.get(route.grid_owner_id) ?? null
        : null

      return [
        route.id,
        buildRouteValidation({
          route,
          gridOwner,
          profile,
        }),
      ] as const
    })
  )

  const readyForTestCount = edielRoutes.filter((route) =>
    isRouteReadyForOutbound(validationByRouteId.get(route.id) ?? [])
  ).length

  const routesMissingTargetEmail = edielRoutes.filter((route) =>
    (validationByRouteId.get(route.id) ?? []).some((issue) => issue.key === 'target_email')
  ).length

  const routesMissingReceiverEdiel = edielRoutes.filter((route) =>
    (validationByRouteId.get(route.id) ?? []).some(
      (issue) => issue.key === 'receiver_ediel_id'
    )
  ).length

  const routesMissingMailbox = edielRoutes.filter((route) =>
    (validationByRouteId.get(route.id) ?? []).some((issue) => issue.key === 'mailbox')
  ).length

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ediel-routes"
        subtitle="Konfigurera både communication route och Ediel-profil på samma ställe, med target email, Ediel-id, subadresser, mailbox och Strato-transport."
        userEmail={user?.email ?? null}
      />

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Totala candidate routes</div>
          <div className="mt-2 text-3xl font-semibold text-slate-950">
            {edielRoutes.length}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm text-emerald-700">Redo för test</div>
          <div className="mt-2 text-3xl font-semibold text-emerald-900">
            {readyForTestCount}
          </div>
          <div className="mt-2 text-xs text-emerald-700">
            Har aktiverad route/profil och de kritiska Ediel-fälten för outbound.
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm text-amber-700">Saknar target_email</div>
          <div className="mt-2 text-3xl font-semibold text-amber-900">
            {routesMissingTargetEmail}
          </div>
          <div className="mt-2 text-xs text-amber-700">
            Varning, inte alltid blockerande men bör fyllas.
          </div>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div className="text-sm text-rose-700">Saknar receiver/mailbox</div>
          <div className="mt-2 text-3xl font-semibold text-rose-900">
            {routesMissingReceiverEdiel + routesMissingMailbox}
          </div>
          <div className="mt-2 text-xs text-rose-700">
            Blockerar riktig drift tills routeprofilen är komplett.
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Vad som måste finnas</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">1. Ediel-profil</div>
            <div className="mt-1">
              sender_ediel_id, receiver_ediel_id och mailbox ska vara ifyllda.
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">2. target_email</div>
            <div className="mt-1">
              Bör finnas för att outbound SMTP-sändning ska bli tydlig och spårbar.
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">3. Mottagarens Ediel-id</div>
            <div className="mt-1">
              Kan komma från routeprofilen eller från grid_owners.ediel_id.
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">4. Mailbox</div>
            <div className="mt-1">
              Mailbox ska vara den brevlåda som faktiskt används i Ediel-transporten.
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="font-medium text-slate-900">5. Enabled</div>
            <div className="mt-1">
              Routeprofilen måste vara aktiverad för att routen ska räknas som användbar.
            </div>
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

            const effectiveReceiverEdielId =
              profile?.receiver_ediel_id ?? gridOwner?.ediel_id ?? null

            const validationIssues = validationByRouteId.get(route.id) ?? []
            const isReadyForTest = isRouteReadyForOutbound(validationIssues)

            return (
              <div key={route.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-base font-semibold text-slate-950">
                    {route.route_name}
                  </div>

                  <Pill text={route.route_type} tone="slate" />
                  <Pill text={route.route_scope} tone="slate" />
                  <Pill
                    text={route.is_active ? 'aktiv route' : 'inaktiv route'}
                    tone={route.is_active ? 'green' : 'yellow'}
                  />
                  <Pill
                    text={profile?.is_enabled ? 'Ediel påslagen' : 'Ediel ej påslagen'}
                    tone={profile?.is_enabled ? 'green' : 'slate'}
                  />
                  <Pill
                    text={isReadyForTest ? 'redo för outbound' : 'blockerad'}
                    tone={isReadyForTest ? 'green' : 'red'}
                  />
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
                  <Grid label="Grid owner Ediel-id" value={gridOwner?.ediel_id ?? null} />
                  <Grid
                    label="Profile receiver Ediel-id"
                    value={profile?.receiver_ediel_id ?? null}
                  />
                  <Grid label="Effective receiver Ediel-id" value={effectiveReceiverEdielId} />
                  <Grid label="Profile mailbox" value={profile?.mailbox ?? null} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {validationIssues.length === 0 ? (
                    <Pill text="inga blockerare" tone="green" />
                  ) : (
                    validationIssues.map((issue) => (
                      <Pill
                        key={issue.key}
                        text={issue.label}
                        tone={issue.severity === 'error' ? 'red' : 'yellow'}
                      />
                    ))
                  )}
                </div>

                <div
                  className={`mt-4 rounded-2xl border p-4 ${
                    summaryTone(validationIssues) === 'green'
                      ? 'border-emerald-200 bg-emerald-50'
                      : summaryTone(validationIssues) === 'yellow'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-rose-200 bg-rose-50'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">
                    {validationIssues.length === 0
                      ? 'Route är användbar'
                      : validationIssues.some((issue) => issue.severity === 'error')
                        ? 'Route är blockerad'
                        : 'Route är delvis användbar'}
                  </div>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {validationIssues.length === 0 ? (
                      <div>
                        Alla kritiska Ediel-fält finns på plats för outbound via denna route.
                      </div>
                    ) : (
                      validationIssues.map((issue) => (
                        <div key={issue.key}>
                          <div className="font-medium">{issue.label}</div>
                          <div className="text-slate-600">{issue.resolution}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-5 grid gap-6 xl:grid-cols-2">
                  <form
                    action={saveEdielCommunicationRouteAction}
                    className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      Communication route
                    </div>

                    <input type="hidden" name="id" value={route.id} />
                    <input type="hidden" name="route_name" value={route.route_name} />
                    <input type="hidden" name="route_scope" value={route.route_scope} />
                    <input type="hidden" name="route_type" value={route.route_type} />
                    <input
                      type="hidden"
                      name="grid_owner_id"
                      value={route.grid_owner_id ?? ''}
                    />
                    <input type="hidden" name="target_system" value={route.target_system} />
                    <input type="hidden" name="endpoint" value={route.endpoint ?? ''} />
                    <input
                      type="hidden"
                      name="supported_payload_version"
                      value={route.supported_payload_version ?? ''}
                    />
                    <input type="hidden" name="route_notes" value={route.notes ?? ''} />
                    <input
                      type="hidden"
                      name="is_active"
                      value={route.is_active ? 'true' : 'false'}
                    />

                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Target email
                      </label>
                      <input
                        name="target_email"
                        defaultValue={route.target_email ?? ''}
                        placeholder="ediel@nätägare.se"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2"
                      />
                    </div>

                    <div className="text-xs text-slate-500">
                      Här kan du uppdatera route-nivåns mottagaradress direkt utan att
                      gå via integrations-sidan.
                    </div>

                    <button className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-300">
                      Spara target email
                    </button>
                  </form>

                  <form
                    action={saveEdielRouteProfileAction}
                    className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      Ediel-profil
                    </div>

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

                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        name="senderEdielId"
                        defaultValue={profile?.sender_ediel_id ?? ''}
                        placeholder="Gridex Ediel-id"
                        className="rounded-xl border border-slate-300 px-3 py-2"
                      />
                      <input
                        name="receiverEdielId"
                        defaultValue={
                          profile?.receiver_ediel_id ?? gridOwner?.ediel_id ?? ''
                        }
                        placeholder="Mottagarens Ediel-id"
                        className="rounded-xl border border-slate-300 px-3 py-2"
                      />
                      <input
                        name="applicationReference"
                        defaultValue={
                          profile?.application_reference ?? '23-DDQ-PRODAT'
                        }
                        placeholder="Application Reference"
                        className="rounded-xl border border-slate-300 px-3 py-2"
                      />
                      <input
                        name="mailbox"
                        defaultValue={profile?.mailbox ?? 'ediel@gridex.se'}
                        placeholder="Mailbox"
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
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}