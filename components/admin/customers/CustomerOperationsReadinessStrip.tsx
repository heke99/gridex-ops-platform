type ReadinessItem = {
  label: string
  ok: boolean
  detail: string
}

function tone(ok: boolean) {
  return ok
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
}

export default function CustomerOperationsReadinessStrip({
  items,
}: {
  items: ReadinessItem[]
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Samlad readiness
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Snabb kontroll av det som oftast blockerar kundens operativa flöden.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <div
            key={item.label}
            className={`rounded-2xl border px-4 py-3 ${tone(item.ok)}`}
          >
            <div className="text-xs font-medium uppercase tracking-wide opacity-80">
              {item.label}
            </div>
            <div className="mt-2 text-sm font-semibold">
              {item.ok ? 'OK' : 'Behöver åtgärd'}
            </div>
            <div className="mt-1 text-xs opacity-80">{item.detail}</div>
          </div>
        ))}
      </div>
    </section>
  )
}