import type { ReactNode } from 'react'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'

export default function CustomerPortalApiLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto max-w-7xl px-5 pt-8 sm:px-8 lg:px-10">
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-sm leading-6 text-slate-800">
          <h2 className="text-base font-semibold text-slate-950">Pricing and billing semantics</h2>
          <p className="mt-2">
            API contract <strong>{WEBSITE_INTEGRATION_CONTRACT_VERSION}</strong> is unchanged. Keep quote lifecycle,
            commercial price validity and final settlement separate:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <code>valid_until</code> belongs to the checkout quote snapshot. It tells the integration when the quote
              must be validated or renewed; it is not an end date for the customer&apos;s electricity price or contract.
            </li>
            <li>
              <code>valid_to</code> on a published price option or area price is the commercial end date for that price
              definition. A <code>null</code> value means that no commercial end date is configured.
            </li>
            <li>
              For variable and spot products, quote market data is checkout/preview evidence only. It does not freeze
              the market price used on a future invoice.
            </li>
            <li>
              Final energy settlement uses the customer&apos;s actual metered consumption and the applicable authoritative
              market/settlement price for the billing period and product resolution, plus the contract&apos;s markups, fees,
              taxes and other applicable components.
            </li>
            <li>
              Public <code>market_reference</code> data must be treated as public pricing evidence only. Internal database
              identifiers are never part of the public integration contract.
            </li>
          </ul>
        </section>
      </div>
      {children}
    </>
  )
}
