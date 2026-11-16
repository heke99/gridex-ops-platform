import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listPlatformCompanies } from '@/lib/tenant/scope'
import { loadControlledTestReceiverIdentities } from '@/lib/ediel/testing/controlledTestReceiverIdentity'
import { issueControlledTestReceiverIdentityAction, revokeControlledTestReceiverIdentityAction } from './actions'

export const dynamic = 'force-dynamic'

type Props = { searchParams?: Promise<{ companyId?: string; runStatus?: string; runMessage?: string }> }

export default async function ControlledTestReceiverIdentityPage({ searchParams }: Props) {
  const context = await requirePlatformAdminAccess()
  const params = await searchParams
  const companies = await listPlatformCompanies()
  const company = companies.find(row => row.id === params?.companyId) ?? companies[0]
  const receipts = company ? await loadControlledTestReceiverIdentities(context.userId, company.id) : []
  const writable = Boolean(company && ['onboarding', 'active'].includes(company.status ?? ''))

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <Link href="/admin/ediel/test-center/invoice-test" className="text-sm underline">Till fakturatest</Link>
      <h1 className="text-2xl font-semibold">Lokal TEST-mottagaridentitet</h1>
      <p>Utfärda en tidsbegränsad mottagaridentitet för isolerade simuleringar. Den gäller enbart TEST och intygar ingen verklig marknadsregistrering. Utskick och produktionsåtkomst aktiveras inte.</p>
      {params?.runMessage ? <p role={params.runStatus === 'error' ? 'alert' : 'status'} className="rounded-xl border p-3">{params.runMessage}</p> : null}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">Bolag
          <select name="companyId" defaultValue={company?.id} className="rounded-lg border p-2">
            {companies.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <button className="rounded-lg border px-4 py-2">Visa bolag</button>
      </form>
      {!company ? <p>Inget bolag finns att konfigurera.</p> : (
        <>
          {!writable ? <p role="status">Bolagets status tillåter inte nya testidentiteter. Befintliga registreringar kan fortfarande återkallas.</p> : null}
          <form action={issueControlledTestReceiverIdentityAction} className="space-y-4 rounded-2xl border p-5">
            <h2 className="text-lg font-semibold">Utfärda testidentitet för {company.name}</h2>
            <input type="hidden" name="companyId" value={company.id} />
            <input type="hidden" name="environment" value="test" />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <fieldset disabled={!writable} className="grid gap-4">
              <label className="grid gap-1">Unikt femsiffrigt TEST-ID
                <input name="receiverEdielId" required pattern="[0-9]{5}" maxLength={5} inputMode="numeric" className="rounded-lg border p-2" />
              </label>
              <label className="grid gap-1">Aktörsroll i simuleringen
                <select name="role" defaultValue="supplier" className="rounded-lg border p-2">
                  <option value="supplier">Elleverantör</option>
                  <option value="esco">Energitjänsteföretag</option>
                </select>
              </label>
              <label className="grid gap-1">Testets syfte
                <input name="purpose" required maxLength={200} className="rounded-lg border p-2" />
              </label>
              <label className="grid gap-1">Giltig till (UTC, högst 30 dagar)
                <input name="expiresAt" type="datetime-local" required className="rounded-lg border p-2" />
              </label>
              <label className="flex gap-2">
                <input type="checkbox" name="acknowledgement" value="LOCAL_TEST_ONLY" required />
                Jag bekräftar att identiteten enbart används för lokal TEST-simulering.
              </label>
              <button className="justify-self-start rounded-lg bg-slate-900 px-4 py-2 text-white">Utfärda lokal TEST-identitet</button>
            </fieldset>
          </form>
          <section className="space-y-3" aria-labelledby="receiver-history">
            <h2 id="receiver-history" className="text-lg font-semibold">Registreringar</h2>
            {receipts.length === 0 ? <p>Inga lokala testidentiteter har utfärdats för bolaget.</p> : receipts.map(row => (
              <article key={row.registrationId} className="space-y-2 rounded-2xl border p-4">
                <p><strong>{row.receiverEdielId}</strong> · {row.roleCode === 'electricity_supplier' ? 'Elleverantör' : 'Energitjänsteföretag'} · {row.status === 'issued' ? 'Giltig' : row.status === 'revoked' ? 'Återkallad' : 'Utgången'}</p>
                <p>Giltighet: {row.validFrom} – {row.validUntil}</p>
                {row.status !== 'revoked' ? (
                  <form action={revokeControlledTestReceiverIdentityAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="companyId" value={company.id} />
                    <input type="hidden" name="registrationId" value={row.registrationId} />
                    <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                    <label className="grid gap-1">Orsak till återkallelse
                      <input name="reason" required maxLength={200} className="rounded-lg border p-2" />
                    </label>
                    <button className="rounded-lg border px-4 py-2">Återkalla testidentitet</button>
                  </form>
                ) : null}
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  )
}
