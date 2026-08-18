import Link from 'next/link'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  assertContractTenant,
  loadCustomerTenantContext,
} from '@/lib/tenant/entityGuards'
import { sendContractSignatureLinkAction } from './actions'

export const dynamic = 'force-dynamic'

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(date)
}

export default async function ContractSignatureAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; contractId: string }>
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const { id: customerId, contractId } = await params
  const query = await searchParams
  const access = await requireAdminPageAccess({ anyOf: ['contracts.write', 'contracts.read'] })
  const { companyId } = await loadCustomerTenantContext(customerId, access)
  await assertContractTenant({ companyId, customerId, contractId })

  const [{ data: customer, error: customerError }, { data: contract, error: contractError }, { data: requests, error: requestError }] =
    await Promise.all([
      supabaseService
        .from('customers')
        .select('full_name,company_name,email,customer_number')
        .eq('id', customerId)
        .eq('company_id', companyId)
        .single(),
      supabaseService
        .from('customer_contracts')
        .select('id,contract_name,contract_number,status,signed_at,starts_at,offer_reference,signature_snapshot_sha256')
        .eq('id', contractId)
        .eq('customer_id', customerId)
        .eq('company_id', companyId)
        .single(),
      supabaseService
        .from('customer_contract_signature_requests')
        .select('id,recipient_email,channel,expires_at,sent_at,used_at,revoked_at,created_at')
        .eq('customer_contract_id', contractId)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(10),
    ])
  if (customerError) throw customerError
  if (contractError) throw contractError
  if (requestError) throw requestError

  const canSend = ['draft', 'pending_signature', 'signature_failed'].includes(contract.status) && !contract.signed_at
  const customerName = customer.full_name ?? customer.company_name ?? customer.email ?? customer.customer_number

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <div>
        <Link href={`/admin/customers/${customerId}?tab=contracts#contracts`} className="text-sm font-medium text-slate-600 hover:text-slate-950">
          ← Tillbaka till kundkortet
        </Link>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm text-slate-500">Online-signering</div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">{contract.contract_name}</h1>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><span className="text-slate-500">Kund:</span> {customerName}</div>
          <div><span className="text-slate-500">Kundnummer:</span> {customer.customer_number ?? '—'}</div>
          <div><span className="text-slate-500">Avtalsnummer:</span> {contract.contract_number ?? '—'}</div>
          <div><span className="text-slate-500">Status:</span> {contract.status}</div>
          <div><span className="text-slate-500">Planerad start:</span> {formatDateTime(contract.starts_at)}</div>
          <div><span className="text-slate-500">Signerat:</span> {formatDateTime(contract.signed_at)}</div>
        </div>
      </section>

      {query.sent === '1' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Signeringslänken har köats via tenantens e-postflöde. En tidigare oanvänd länk har samtidigt återkallats.
        </div>
      ) : null}
      {query.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {query.error}
        </div>
      ) : null}

      {canSend ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Skicka signeringslänk</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Kunden får en säker engångslänk. På signeringssidan visas den frysta pris- och villkorsversionen och kunden signerar genom att trycka på en enda knapp.
          </p>
          <form action={sendContractSignatureLinkAction} className="mt-5 space-y-4">
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="contract_id" value={contractId} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Mottagarens e-post</span>
              <input
                type="email"
                name="recipient_email"
                required
                defaultValue={customer.email ?? ''}
                className="rounded-2xl border border-slate-300 px-4 py-3"
              />
            </label>
            <button className="w-full rounded-2xl bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800">
              {contract.status === 'pending_signature' ? 'Skicka ny signeringslänk' : 'Skicka signeringslänk'}
            </button>
          </form>
        </section>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="font-semibold">Ingen manuell signering är möjlig</h2>
          <p className="mt-2 text-sm text-slate-700">
            {contract.signed_at
              ? 'Avtalet är redan signerat och signeringsbeviset är låst.'
              : 'Avtalet kan inte skickas för signering i nuvarande livscykelstatus.'}
          </p>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Signeringshistorik</h2>
        <div className="mt-4 space-y-3">
          {(requests ?? []).length === 0 ? (
            <p className="text-sm text-slate-600">Ingen signeringslänk har skapats ännu.</p>
          ) : (
            requests!.map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                <div className="font-medium">{request.recipient_email}</div>
                <div className="mt-1 text-slate-600">
                  Skapad {formatDateTime(request.created_at)} · giltig till {formatDateTime(request.expires_at)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {request.used_at
                    ? `Använd ${formatDateTime(request.used_at)}`
                    : request.revoked_at
                      ? `Återkallad ${formatDateTime(request.revoked_at)}`
                      : request.sent_at
                        ? `Skickad ${formatDateTime(request.sent_at)}`
                        : 'Skapad men ännu inte markerad som skickad'}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  )
}
