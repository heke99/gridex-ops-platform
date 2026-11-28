type Props = {
  action: (formData: FormData) => Promise<void>
  label?: string
}

export default function BillingExportQueueForm({ action, label = 'Förbered fakturaexporter' }: Props) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Fakturamånad
        <input
          type="month"
          name="period_month"
          required
          className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500"
        />
      </label>
      <button type="submit" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">
        {label}
      </button>
    </form>
  )
}
