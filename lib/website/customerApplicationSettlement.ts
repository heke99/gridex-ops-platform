import type { PublicContractOffer } from "@/lib/website/publicContracts";
import type { WebsiteQuoteRecord } from "@/lib/pricing/websiteQuotes";
import { websiteSettlementForContract, type WebsiteSettlement } from "@/lib/pricing/websiteSettlement";
import { WebsiteQuoteSettlementSchema } from "./customerApplicationSchemas";

export function canonicalQuoteSettlement(
  quote: WebsiteQuoteRecord,
  offer: PublicContractOffer,
): WebsiteSettlement {
  const parsed = WebsiteQuoteSettlementSchema.safeParse(quote.quote_snapshot?.settlement)
  if (parsed.success) return parsed.data
  const pricingInterval = typeof quote.quote_snapshot?.pricing_interval === 'string'
    ? quote.quote_snapshot.pricing_interval
    : null
  return websiteSettlementForContract({
    contractType: offer.contract_type,
    pricingInterval,
  })
}

export function sameSettlement(left: WebsiteSettlement, right: WebsiteSettlement): boolean {
  return left.model === right.model
    && left.customer_accepts === right.customer_accepts
    && left.energy_price_locked_at_signup === right.energy_price_locked_at_signup
    && left.uses_actual_metered_consumption === right.uses_actual_metered_consumption
    && left.market_data_role === right.market_data_role
    && left.settlement_resolution === right.settlement_resolution
}
