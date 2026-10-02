import { billingFieldLabel, type BillingProfileRevision } from '@/lib/customer-service/billingProfileRevisions'

function address(row: BillingProfileRevision) {
  const parts = [row.billing_street, [row.billing_postal_code, row.billing_city].filter(Boolean).join(' '), row.billing_country]
    .filter((part) => part && String(part).trim())
  return parts.length ? parts.join(', ') : '—'
}

export default function CustomerBillingProfileHistory({ revisions }: { revisions: BillingProfileRevision[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="billing-profile-history">
      <h2 id="billing-profile-history" className="text-base font-semibold text-slate-950">Historik för fakturauppgifter</h2>
      <p className="mt-1 text-sm text-slate-600">
        Varje ändring av faktura-e-post eller fakturaadress sparas som en ny version. Fakturaunderlag visar vilken version som användes.
      </p>
      {revisions.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">Ingen historik ännu.</p>
      ) : (
        <ol className="mt-4 grid gap-3">
          {revisions.map((row) => (
            <li key={row.revision} className="rounded-2xl border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">Version {row.revision}</span>
                <time dateTime={row.recorded_at} className="text-slate-600">
                  {new Date(row.recorded_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}
                </time>
              </div>
              <p className="mt-1 text-slate-600">Ändrat: {row.changed_fields.map(billingFieldLabel).join(', ') || '—'}</p>
              <dl className="mt-2 grid gap-1 text-slate-800 sm:grid-cols-[10rem_1fr]">
                <dt className="text-slate-600">Faktura-e-post</dt>
                <dd className="break-all">{row.invoice_email ?? '—'}</dd>
                <dt className="text-slate-600">Fakturaadress</dt>
                <dd>{address(row)}</dd>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
