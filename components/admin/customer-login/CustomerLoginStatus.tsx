import type { CustomerLoginProviderView } from './CustomerLoginSetup'
import { formatAdminDateTime } from '@/lib/ui/format'

/** Server view: provider URLs, audiences and key setup never reach a client component. */
export default function CustomerLoginStatus({ providers }: { providers: CustomerLoginProviderView[] }) {
  return <section className="space-y-3" aria-label="Inloggningens status">
    {(['customer', 'staff'] as const).map(purpose => {
      const provider = providers.find(item => item.purpose === purpose)
      const tested = provider?.last_test_result?.ok
      return <article key={purpose} className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-950">{purpose === 'customer' ? 'Kundernas inloggning' : 'Personalens inloggning'}</h2>
        {!provider ? <p className="mt-2 text-sm text-slate-700">Ingen anslutning är registrerad.</p> : <>
          <p className="mt-2 break-words text-sm font-medium text-slate-900">{provider.display_name}</p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Kontrollstatus</dt><dd className="mt-1 font-medium">{tested === true ? 'Senaste kontrollen godkänd' : tested === false ? 'Behöver kontrolleras' : 'Inte kontrollerad'}</dd></div>
            <div><dt className="text-slate-500">Senast kontrollerad</dt><dd className="mt-1 font-medium">{formatAdminDateTime(provider.last_tested_at, 'Inte kontrollerad')}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-slate-700">{purpose === 'staff' ? 'Personal behöver alltid ett giltigt inloggningsbevis.' : provider.enforcement === 'enforce' ? 'Verifierad kundinloggning krävs.' : provider.enforcement === 'report' ? 'Inloggningen följs upp, men verifierad kundinloggning krävs ännu inte.' : 'Inloggningskravet behöver kontrolleras.'}</p>
        </>}
      </article>
    })}
    <p className="text-sm text-slate-600">Kontakta plattformsadministratören om anslutningen behöver ändras.</p>
  </section>
}
