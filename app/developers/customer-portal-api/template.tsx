import type { ReactNode } from 'react'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export default function CustomerPortalApiTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 lg:px-10">
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-sm leading-6 text-slate-800">
          <h2 className="text-base font-semibold text-slate-950">Pricing, quote validity and billing</h2>
          <p className="mt-2">
            API contract <strong>{WEBSITE_INTEGRATION_CONTRACT_VERSION}</strong> exposes settlement semantics explicitly. Customer-visible website
            prices do not expire because time passes; commercial availability and final invoice settlement are separate concepts.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <code>valid_until</code> remains in V1 for wire compatibility and immutable audit evidence. Gridex does
              not use it as a customer-price expiry and an issued website quote is not rejected because that timestamp passes.
            </li>
            <li>
              <code>valid_to</code> on a published price option or area price is the commercial end date of that price
              definition. <code>null</code> means no commercial end date is configured.
            </li>
            <li>
              Only fixed-price products lock the energy price at signup. Monthly market, hourly, quarter-hour, portfolio
              and mixed products accept the pricing model; quote market data is checkout/audit evidence only.
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
