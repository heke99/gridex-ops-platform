import { importGridOwnerFileAction } from '@/app/admin/customers/[id]/grid-owner-import-actions'

export default function CustomerGridOwnerFileImportCard({
  customerId,
}: {
  customerId: string
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Import från nätägarfil
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ladda upp CSV, TSV, TXT eller JSON för inkomna mätvärden eller billing underlag.
          Systemet parser filen, mappar mot kundens anläggningar och mätpunkter och registrerar raderna i databasen.
        </p>
      </div>

      <form action={importGridOwnerFileAction} className="grid gap-4">
        <input type="hidden" name="customer_id" value={customerId} />

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Importtyp</span>
          <select
            name="import_mode"
            defaultValue="meter_values"
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            <option value="meter_values">Mätvärden</option>
            <option value="billing_underlay">Billing underlag</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Fil</span>
          <input
            type="file"
            name="file"
            accept=".csv,.tsv,.txt,.json"
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            required
          />
        </label>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          Exempelkolumner för mätvärden: <br />
          <code>meter_point_id;value_kwh;read_at;reading_type;quality_code;period_start;period_end</code>
          <br />
          <br />
          Exempelkolumner för billing underlag: <br />
          <code>meter_point_id;underlay_year;underlay_month;total_kwh;total_sek_ex_vat;status</code>
        </div>

        <div className="flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Importera fil
          </button>
        </div>
      </form>
    </section>
  )
}