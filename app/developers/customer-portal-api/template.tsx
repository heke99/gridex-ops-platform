import type { ReactNode } from 'react'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export default function CustomerPortalApiTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 lg:px-10">
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-sm leading-6 text-slate-800">
          <h2 className="text-base font-semibold text-slate-950">Pricing, quote validity and billing</h2>
          <p className="mt-2">
            API contract <strong>{WEBSITE_INTEGRATION_CONTRACT_VERSION}</strong> is unchanged. Quote freshness,
            commercial price validity and final invoice settlement are separate concepts.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <code>valid_until</code> is the checkout quote snapshot lifetime. It is used to validate or renew the
              quote before submission; it is not an end date for the customer&apos;s electricity price or agreement.
            </li>
            <li>
              <code>valid_to</code> on a published price option or area price is the commercial end date of that price
              definition. <code>null</code> means no commercial end date is configured.
            </li>
            <li>
              For variable and spot products, quote market data is checkout and audit evidence only. It does not freeze
              the market price used on a future invoice.
            </li>
            <li>
              Final energy settlement uses actual metered consumption and the applicable authoritative market/settlement
              price for the billing period and product resolution, plus the agreement&apos;s markups, fees, taxes and other
              applicable pricing components.
            </li>
            <li>
              Public <code>market_reference</code> data contains only public pricing evidence; internal database identifiers
              are not part of the integration contract.
            </li>
          </ul>
        </section>
      </div>
      {children}
    </>
  )
}
