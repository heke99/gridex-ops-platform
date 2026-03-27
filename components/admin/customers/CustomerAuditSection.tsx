import type {
  CustomerSiteRow,
  GridOwnerRow,
  MasterdataAuditEntry,
  MeteringPointRow,
} from '@/lib/masterdata/types'

type CustomerAuditSectionProps = {
  auditEntries: MasterdataAuditEntry[]
  actorDirectory: Record<string, string>
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('sv-SE')
}

function resolveEntityTitle(params: {
  entry: MasterdataAuditEntry
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}): string {
  const { entry, sites, meteringPoints } = params

  if (entry.entity_type === 'customer_site') {
    const site = sites.find((row) => row.id === entry.entity_id)
    if (!site) return 'Anläggning'
    return site.site_name
  }

  const meteringPoint = meteringPoints.find((row) => row.id === entry.entity_id)
  if (!meteringPoint) return 'Mätpunkt'
  return meteringPoint.meter_point_id
}

function resolveEntityKind(entry: MasterdataAuditEntry): string {
  if (entry.entity_type === 'customer_site') return 'Anläggning'
  return 'Mätpunkt'
}

function resolveActionLabel(action: string): string {
  const labels: Record<string, string> = {
    customer_site_created: 'Skapad',
    customer_site_updated: 'Uppdaterad',
    metering_point_created: 'Skapad',
    metering_point_updated: 'Uppdaterad',
  }

  return labels[action] ?? action
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    site_name: 'Anläggningsnamn',
    facility_id: 'Anläggnings-ID',
    site_type: 'Typ',
    status: 'Status',
    grid_owner_id: 'Nätägare',
    price_area_code: 'Elområde',
    move_in_date: 'Flyttdatum',
    annual_consumption_kwh: 'Årsförbrukning',
    current_supplier_name: 'Nuvarande leverantör',
    current_supplier_org_number: 'Leverantör org.nr',
    street: 'Gatuadress',
    care_of: 'C/O',
    postal_code: 'Postnummer',
    city: 'Ort',
    country: 'Land',
    internal_notes: 'Intern anteckning',
    meter_point_id: 'Mätpunkts-ID',
    site_facility_id: 'Anläggnings-ID på mätpunkten',
    ediel_reference: 'EDIEL-referens',
    measurement_type: 'Mättyp',
    reading_frequency: 'Avläsningsfrekvens',
    start_date: 'Startdatum',
    end_date: 'Slutdatum',
    is_settlement_relevant: 'Settlement-relevant',
    site_id: 'Anläggning',
  }

  return labels[key] ?? key
}

function resolveReferenceValue(params: {
  key: string
  value: unknown
  sites: CustomerSiteRow[]
  gridOwners: GridOwnerRow[]
}): string {
  const { key, value, sites, gridOwners } = params

  if (key === 'grid_owner_id' && typeof value === 'string') {
    return gridOwners.find((owner) => owner.id === value)?.name ?? value
  }

  if (key === 'site_id' && typeof value === 'string') {
    return sites.find((site) => site.id === value)?.site_name ?? value
  }

  return normalizeValue(value)
}

function buildChangeRows(params: {
  entry: MasterdataAuditEntry
  sites: CustomerSiteRow[]
  gridOwners: GridOwnerRow[]
}): Array<{ key: string; from: string; to: string }> {
  const { entry, sites, gridOwners } = params

  const oldValues = entry.old_values ?? {}
  const newValues = entry.new_values ?? {}

  const keys = Array.from(
    new Set([...Object.keys(oldValues), ...Object.keys(newValues)])
  ).filter(
    (key) =>
      ![
        'id',
        'created_at',
        'updated_at',
        'created_by',
        'updated_by',
        'customer_id',
      ].includes(key)
  )

  const rows: Array<{ key: string; from: string; to: string }> = []

  for (const key of keys) {
    const oldValue = oldValues[key]
    const newValue = newValues[key]

    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      continue
    }

    rows.push({
      key,
      from: resolveReferenceValue({
        key,
        value: oldValue,
        sites,
        gridOwners,
      }),
      to: resolveReferenceValue({
        key,
        value: newValue,
        sites,
        gridOwners,
      }),
    })
  }

  return rows
}

export default function CustomerAuditSection({
  auditEntries,
  actorDirectory,
  sites,
  meteringPoints,
  gridOwners,
}: CustomerAuditSectionProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Senaste ändringar
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Audit för anläggningar och mätpunkter med vem som ändrade vad och när.
        </p>
      </div>

      <div className="space-y-4">
        {auditEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Inga audit-händelser ännu för anläggningar eller mätpunkter.
          </div>
        ) : (
          auditEntries.map((entry) => {
            const changes = buildChangeRows({
              entry,
              sites,
              gridOwners,
            })

            return (
              <article
                key={entry.id}
                className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    {resolveEntityKind(entry)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    {resolveActionLabel(entry.action)}
                  </span>
                  <span>
                    {actorDirectory[entry.actor_user_id ?? ''] ??
                      entry.actor_user_id ??
                      'Okänd användare'}
                  </span>
                  <span>{formatDateTime(entry.created_at)}</span>
                </div>

                <div className="mt-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    {resolveEntityTitle({
                      entry,
                      sites,
                      meteringPoints,
                    })}
                  </h3>
                </div>

                {changes.length > 0 ? (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-950/50">
                        <tr className="text-left text-slate-500 dark:text-slate-400">
                          <th className="px-4 py-3 font-medium">Fält</th>
                          <th className="px-4 py-3 font-medium">Före</th>
                          <th className="px-4 py-3 font-medium">Efter</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {changes.map((change) => (
                          <tr key={change.key}>
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                              {fieldLabel(change.key)}
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                              {change.from}
                            </td>
                            <td className="px-4 py-3 text-slate-900 dark:text-white">
                              {change.to}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    Ingen fältdiff tillgänglig för denna händelse.
                  </p>
                )}
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}