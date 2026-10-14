import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import type { PublicContractOffer } from "@/lib/website/publicContracts";
import { resolvePublicContractOffer } from "@/lib/website/publicContracts";
import {
  resolveBasePriceSourceValues,
  resolvePricingConfiguration,
} from "@/lib/pricing/priceSourceResolver";
import { calculateOfferQuote, OfferQuoteError } from "@/lib/pricing/offerQuote";
import { persistWebsiteQuote } from "@/lib/pricing/websiteQuotes";

vi.mock("@/lib/website/publicContracts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/website/publicContracts")>();
  return { ...actual, resolvePublicContractOffer: vi.fn() };
});

vi.mock("@/lib/pricing/priceSourceResolver", () => ({
  resolvePricingConfiguration: vi.fn(),
  resolveBasePriceSourceValues: vi.fn(),
}));

vi.mock("@/lib/pricing/basePriceCalculator", () => ({
  calculateBasePrice: vi.fn(() => ({
    status: "success",
    baseSekPerKwh: 0,
    lines: [],
    warnings: [],
    errors: [],
  })),
}));

vi.mock("@/lib/pricing/websiteQuotes", async (original) => ({
  ...await original<typeof import('@/lib/pricing/websiteQuotes')>(), persistWebsiteQuote: vi.fn(),
}));

const client: IntegrationApiClient = {
  id: "api-client",
  company_id: "company-1",
  name: "Website",
  status: "active",
  key_prefix: "gx",
  secret_hash: "hash",
  scopes: ["website_contracts.read"],
  allowed_ips: [],
  rate_limit_per_minute: 120,
  expires_at: null,
};

function offer(amount: number): PublicContractOffer {
  return {
    id: "offer-row",
    company_id: client.company_id,
    price_plan_id: "plan-1",
    price_plan_version_id: "version-1",
    campaign_version_id: null,
    product_code: "electricity",
    public_name: "Rörligt elpris",
    public_description: null,
    contract_type: "variable_monthly",
    energy_direction: "consumption",
    billing_model: "spot",
    customer_type: "both",
    monthly_fee_sek: null,
    invoice_fee_sek: amount,
    markup_ore_per_kwh: null,
    spot_markup_ore_per_kwh: null,
    variable_fee_ore_per_kwh: null,
    fixed_price_ore_per_kwh: null,
    green_fee_mode: null,
    green_fee_value: null,
    terms_version: "v1",
    valid_from: null,
    valid_to: null,
    sort_order: 1,
    metadata: {},
    canonical_offer_reference: "offer_quote_v1",
    pricing_snapshot: {
      pricing_model: "spot",
      vat_rate: 0.25,
      base_components: [],
      price_components: [
        {
          component_code: "invoice_fee",
          component_type: "invoice_fee",
          name: "Fakturaavgift",
          amount,
          calculation_type: "per_invoice",
          unit: "sek_invoice",
          status: "active",
          website_card_visible: false,
          metadata: {
            visibility: { website_card: false, quote_breakdown: true },
          },
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.mocked(resolvePublicContractOffer).mockReset();
  vi.mocked(resolvePricingConfiguration).mockReset();
  vi.mocked(resolveBasePriceSourceValues).mockReset();
  vi.mocked(persistWebsiteQuote).mockReset();
  vi.mocked(persistWebsiteQuote).mockResolvedValue({
    quoteReference: "quote_test_reference",
    validUntil: "2026-09-01T00:15:00.000Z",
  });
  vi.mocked(resolvePricingConfiguration).mockResolvedValue({
    vatRate: 0.25,
    baseComponents: [],
    priceComponents: [
      {
        componentType: "invoice_fee",
        name: "Fakturaavgift",
        calculationType: "per_invoice",
        amount: 19,
        unit: "sek_invoice",
        vatApplicable: true,
        metadata: {
          component_code: "invoice_fee",
          calculation_type: "per_invoice",
          input_unit: "sek_invoice",
          visibility: { website_card: false, quote_breakdown: true },
        },
      },
    ],
    warnings: [],
  });
  vi.mocked(resolveBasePriceSourceValues).mockResolvedValue({});
});


import { NextRequest } from 'next/server'
const routePorts = vi.hoisted(() => ({ claim: vi.fn(), resolution: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', () => ({
  requireIntegrationApiAccess: vi.fn().mockResolvedValue({ ok: true, client: { id: 'api-client', company_id: 'company-1' }, context: { companyId: 'company-1' }, rateLimit: { limit: 100, remaining: 99 } }),
  logIntegrationApiRequest: vi.fn().mockResolvedValue(undefined), currentIntegrationApiResponseContext: () => null,
}))
vi.mock('@/lib/integrations/writeIdempotency', async original => ({
  ...await original<typeof import('@/lib/integrations/writeIdempotency')>(),
  claimIntegrationWriteIdempotency: routePorts.claim,
  completeIntegrationWriteIdempotency: vi.fn().mockResolvedValue(undefined),
  failIntegrationWriteIdempotency: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/energy/resolutionBinding', async original => ({
  ...await original<typeof import('@/lib/energy/resolutionBinding')>(), loadQuoteEnergyResolution: routePorts.resolution,
}))
import { POST } from '@/app/api/v1/website/quote/route'
beforeEach(() => {
  vi.clearAllMocks()
  routePorts.claim.mockResolvedValue({ outcome: 'claimed', recordId: 'unit-record' })
  routePorts.resolution.mockResolvedValue({ id: 'resolution-test', priceArea: 'SE3', gridAreaCode: null, resolverVersion: 'unit', expiresAt: '2027-01-01T00:00:00Z', capabilities: { quote_ready: true }, companyId: 'company-1', priceAreaAssurance: { status: 'verified', source: 'postal_consensus', confidence: 1, priceArea: 'SE3', candidateCount: 1, uniquePriceAreaCount: 1, sourceVersion: 'unit', evidence: {} }, sourceChain: [], blockers: {}, resolvedAt: '2026-10-12T00:00:00Z' })
  vi.mocked(resolvePublicContractOffer).mockResolvedValue(offer(19))
})
describe('Website quote commercial request exactness', () => {
  it('rejects missing required customer_type before an idempotency claim or calculation', async () => {
    // Refuse at the offer transport boundary: malformed input must never reach it.
    vi.mocked(resolvePublicContractOffer).mockRejectedValue(new OfferQuoteError('Synthetic transport refusal', 'unit_quote_lookup_reached', 422))
    const response = await POST(new NextRequest('https://app.gridex.se/api/v1/website/quote', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'unit-key-1234' },
      body: JSON.stringify({ offer_reference: 'offer_quote_v1', resolution_id: 'resolution-test', annual_consumption_kwh: 10000, start_date: '2026-11-01', invoice_delivery_method: 'email', selected_component_references: [], site_count: 1 }),
    }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({ code: 'missing_field', field: 'customer_type' })
    expect(routePorts.claim).not.toHaveBeenCalled()
    expect(resolvePublicContractOffer).not.toHaveBeenCalled()
  })
  it('rejects fractional site_count in the actual calculator rather than quoting a truncated selection', async () => {
    await expect(calculateOfferQuote({ client, offerReference: 'offer_quote_v1', priceArea: 'SE3', annualConsumptionKwh: 10000, startDate: '2026-11-01', customerType: 'private', siteCount: 1.5 })).rejects.toMatchObject({ code: 'invalid_site_count', status: 400, field: 'site_count' })
    expect(persistWebsiteQuote).not.toHaveBeenCalled()
  })
  it.each([null, '', 42])('rejects invalid required customer_type %s before calculation', async customerType => {
    vi.mocked(resolvePublicContractOffer).mockRejectedValue(new OfferQuoteError('Synthetic transport refusal', 'unit_quote_lookup_reached', 422))
    const response = await POST(new NextRequest('https://app.gridex.se/api/v1/website/quote', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'unit-key-1234' },
      body: JSON.stringify({ offer_reference: 'offer_quote_v1', resolution_id: 'resolution-test', annual_consumption_kwh: 10000, start_date: '2026-11-01', customer_type: customerType, invoice_delivery_method: 'email', selected_component_references: [], site_count: 1 }),
    }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatchObject({ code: 'invalid_customer_type', field: 'customer_type' })
    expect(routePorts.claim).not.toHaveBeenCalled()
  })
  it.each([['private', 'private'], ['business', 'business'], ['company', 'business']])('preserves supported customer type %s', async (customerType, canonicalType) => {
    await calculateOfferQuote({ client, offerReference: 'offer_quote_v1', priceArea: 'SE3', annualConsumptionKwh: 10000, startDate: '2026-11-01', customerType, siteCount: 1 })
    expect(resolvePublicContractOffer).toHaveBeenCalledWith(expect.objectContaining({ customerType: canonicalType }))
  })
  it.each([1, 2])('preserves integer site_count %s in a real quote', async siteCount => {
    const result = await calculateOfferQuote({ client, offerReference: 'offer_quote_v1', priceArea: 'SE3', annualConsumptionKwh: 10000, startDate: '2026-11-01', customerType: 'private', siteCount })
    expect((result.input as Record<string, unknown>).site_count).toBe(siteCount)
    expect(persistWebsiteQuote).toHaveBeenCalledWith(expect.objectContaining({ siteCount }))
  })
})
