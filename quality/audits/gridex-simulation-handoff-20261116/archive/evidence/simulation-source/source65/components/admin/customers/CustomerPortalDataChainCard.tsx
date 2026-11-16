type ChainRow = {
  label: string
  ok: boolean
  detail: string
}

type PortalCustomerStatus = {
  label: string
  message: string
  severity: 'info' | 'warning' | 'blocking' | 'success'
  issues: string[]
}

function tone(ok: boolean): string {
  return ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'
}

function statusTone(status: PortalCustomerStatus): string {
  if (status.severity === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (status.severity === 'blocking') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status.severity === 'warning') return 'border-orange-200 bg-orange-50 text-orange-900'
  return 'border-sky-200 bg-sky-50 text-sky-900'
}

export default function CustomerPortalDataChainCard({
  status,
  rows,
}: {
  status: PortalCustomerStatus
  rows: ChainRow[]
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Kundkedja</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">Kunddata och portalstatus</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-700">
            Sammanfattar om kund, avtal, fullmakt, juridik, anläggning och mätpunkt hänger ihop innan fakturering eller leverantörsbyte fortsätter.
          </p>
        </div>
        <div className={`max-w-xl rounded-2xl border px-4 py-3 text-sm ${statusTone(status)}`}>
          <div className="font-bold">{status.label}</div>
          <p className="mt-1 leading-6">{status.message}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {rows.map((row) => (
          <div key={row.label} className={`rounded-2xl border px-4 py-3 text-sm ${tone(row.ok)}`}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{row.label}</div>
            <div className="mt-2 font-bold">{row.ok ? 'OK' : 'Behöver åtgärd'}</div>
            <div className="mt-1 text-xs leading-5 opacity-80">{row.detail}</div>
          </div>
        ))}
      </div>

      {status.issues.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Datakvalitet:</span>{' '}
          {status.issues.map((issue) => issue.replaceAll('_', ' ')).join(', ')}
        </div>
      ) : null}
    </section>
  )
}
