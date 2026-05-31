'use client'

export function CopyButton({ value, label = 'Kopiera' }: { value: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(value)}
      className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
    >
      {label}
    </button>
  )
}

export function CopyDnsRecordsButton({ records }: { records: Array<{ type: string; name: string; value: string; priority?: number | null }> }) {
  const value = records
    .map((record) => [record.type, record.name, record.value, record.priority ?? ''].join('\t'))
    .join('\n')

  return <CopyButton value={value} label="Kopiera alla DNS-poster" />
}
