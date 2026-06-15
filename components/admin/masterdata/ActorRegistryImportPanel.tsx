import { importActorRegistryXmlAction } from '@/app/admin/network-owners/actions'

type ImportRunRow = {
  id: string
  source_filename: string | null
  status: string
  total_records: number | null
  created_count: number | null
  updated_count: number | null
  unchanged_count: number | null
  conflict_count: number | null
  error_count: number | null
  started_at: string | null
  finished_at: string | null
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(parsed)) : value
}

export default function ActorRegistryImportPanel({ importRuns }: { importRuns: ImportRunRow[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-700">Aktörsregister</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">Importera XML/registerfil</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Importen skapar eller uppdaterar aktörer idempotent. Motstridiga Ediel-ID, org.nr, route, subadress eller certifikat skickas till granskning i stället för att gissas.
          </p>
        </div>

        <form action={importActorRegistryXmlAction} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:min-w-[360px]">
          <label className="text-sm font-semibold text-slate-800" htmlFor="actor_registry_xml">XML-fil</label>
          <input id="actor_registry_xml" name="actor_registry_xml" type="file" accept=".xml,text/xml,application/xml" required className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" name="force_reprocess" className="rounded border-slate-300" />
            Kör om även om samma filhash redan importerats
          </label>
          <button type="submit" className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            Importera och verifiera
          </button>
        </form>
      </div>

      {importRuns.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3 font-medium">Fil</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Poster</th>
                <th className="px-4 py-3 font-medium">Skapade/uppdaterade</th>
                <th className="px-4 py-3 font-medium">Konflikter/fel</th>
                <th className="px-4 py-3 font-medium">Startad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {importRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{run.source_filename ?? 'XML-import'}</td>
                  <td className="px-4 py-3 text-slate-700">{run.status}</td>
                  <td className="px-4 py-3 text-slate-700">{run.total_records ?? 0}</td>
                  <td className="px-4 py-3 text-slate-700">{run.created_count ?? 0} / {run.updated_count ?? 0}</td>
                  <td className="px-4 py-3 text-slate-700">{run.conflict_count ?? 0} / {run.error_count ?? 0}</td>
                  <td className="px-4 py-3 text-slate-700">{formatDate(run.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

export type { ImportRunRow }
