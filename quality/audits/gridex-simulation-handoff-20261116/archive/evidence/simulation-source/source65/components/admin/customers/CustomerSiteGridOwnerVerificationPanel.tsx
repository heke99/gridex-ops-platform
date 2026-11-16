import { verifyCustomerSiteGridOwnerManually } from '@/app/admin/customers/[id]/actions'

async function verifyCustomerSiteGridOwnerFormAction(formData: FormData): Promise<void> {
  'use server'
  await verifyCustomerSiteGridOwnerManually(formData)
}

type GridOwnerCandidate = {
  id: string
  name: string
  edielId?: string | null
  gridAreaCode?: string | null
  priceAreaCode?: string | null
  source?: string | null
  confidence?: number | null
  routeReady?: boolean | null
  certificateReady?: boolean | null
  readinessMessage?: string | null
}

export function CustomerSiteGridOwnerVerificationPanel(props: {
  companyId: string
  customerId: string
  customerSiteId: string
  candidates: GridOwnerCandidate[]
}) {
  if (props.candidates.length === 0) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h3 className="font-semibold">Nätägare behöver verifieras</h3>
        <p className="mt-1">Ingen säker kandidat finns. Kontrollera adress, postnummer och nätområdesmasterdata innan EDIFACT skickas.</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Manuell verifiering av nätägare</h3>
        <p className="mt-1 text-sm text-slate-600">
          Verifieringen sparar nätområde på anläggningen och loggas i kundens operationshändelser. Postal fallback är bara ett förslag och blir aldrig automatiskt send-ready.
        </p>
      </div>
      <div className="space-y-3">
        {props.candidates.map((candidate) => (
          <form key={candidate.id} action={verifyCustomerSiteGridOwnerFormAction} className="rounded-xl border border-slate-200 p-3">
            <input type="hidden" name="company_id" value={props.companyId} />
            <input type="hidden" name="customer_id" value={props.customerId} />
            <input type="hidden" name="customer_site_id" value={props.customerSiteId} />
            <input type="hidden" name="grid_owner_id" value={candidate.id} />
            <input type="hidden" name="grid_area_code" value={candidate.gridAreaCode ?? ''} />
            <input type="hidden" name="price_area_code" value={candidate.priceAreaCode ?? ''} />
            <input type="hidden" name="source" value={candidate.source ?? 'manual_admin_verification'} />
            <input type="hidden" name="confidence" value={String(candidate.confidence ?? 1)} />
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium text-slate-900">{candidate.name}</div>
                <div className="mt-1 text-xs text-slate-600">
                  Ediel-ID {candidate.edielId ?? 'saknas'} · Nätområde {candidate.gridAreaCode ?? 'saknas'} · Källa {candidate.source ?? 'manuell'} · Confidence {Math.round((candidate.confidence ?? 0) * 100)}%
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {candidate.readinessMessage ?? 'Kontrollera route och certifikat innan utskick.'}
                </div>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Verifiera nätägare
              </button>
            </div>
          </form>
        ))}
      </div>
    </section>
  )
}
