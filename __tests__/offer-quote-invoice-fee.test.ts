import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";
import type { PublicContractOffer } from "@/lib/website/publicContracts";
import { resolvePublicContractOffer } from "@/lib/website/publicContracts";
import {
  resolveBasePriceSourceValues,
  resolvePricingConfiguration,
} from "@/lib/pricing/priceSourceResolver";
import { calculateOfferQuote } from "@/lib/pricing/offerQuote";
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

vi.mock("@/lib/pricing/websiteQuotes", () => ({
  persistWebsiteQuote: vi.fn(),
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

describe("website quote invoice fee", () => {
  it("includes a hidden invoice fee in quote lines", async () => {
    vi.mocked(resolvePublicContractOffer).mockResolvedValue(offer(19));

    const result = await calculateOfferQuote({
      client,
      offerReference: "offer_quote_v1",
      priceArea: "SE3",
      annualConsumptionKwh: 5000,
      startDate: "2026-09-01",
      customerType: "private",
    });

    expect(result.lines).toContainEqual(
      expect.objectContaining({
        component_code: "invoice_fee",
        unit: "sek_invoice",
        calculation_type: "per_invoice",
        amount_ex_vat: 19,
        vat_amount: 4.75,
        amount_inc_vat: 23.75,
      }),
    );
  });

  it("preserves a published zero invoice fee", async () => {
    vi.mocked(resolvePublicContractOffer).mockResolvedValue(offer(0));
    vi.mocked(resolvePricingConfiguration).mockResolvedValue({
      vatRate: 0.25,
      baseComponents: [],
      priceComponents: [
        {
          componentType: "invoice_fee",
          name: "Fakturaavgift",
          calculationType: "per_invoice",
          amount: 0,
          unit: "sek_invoice",
          vatApplicable: true,
          metadata: {
            component_code: "invoice_fee",
            calculation_type: "per_invoice",
            input_unit: "sek_invoice",
          },
        },
      ],
      warnings: [],
    });

    const result = await calculateOfferQuote({
      client,
      offerReference: "offer_quote_v1",
      priceArea: "SE3",
      annualConsumptionKwh: 5000,
      startDate: "2026-09-01",
    });

    expect(result.lines).toContainEqual(
      expect.objectContaining({
        component_code: "invoice_fee",
        amount_ex_vat: 0,
        amount_inc_vat: 0,
      }),
    );
  });

  it("rejects missing, conflicting and ambiguous invoice fees", async () => {
    vi.mocked(resolvePublicContractOffer).mockResolvedValue({
      ...offer(19),
      invoice_fee_sek: null,
      pricing_snapshot: {},
    });
    await expect(
      calculateOfferQuote({
        client,
        offerReference: "offer_quote_v1",
        priceArea: "SE3",
        annualConsumptionKwh: 5000,
        startDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "invoice_fee_missing" });

    vi.mocked(resolvePublicContractOffer).mockResolvedValue({
      ...offer(19),
      invoice_fee_sek: 29,
    });
    await expect(
      calculateOfferQuote({
        client,
        offerReference: "offer_quote_v1",
        priceArea: "SE3",
        annualConsumptionKwh: 5000,
        startDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "invoice_fee_conflict" });

    const ambiguous = offer(19);
    ambiguous.pricing_snapshot = {
      ...ambiguous.pricing_snapshot,
      price_components: [
        ...(ambiguous.pricing_snapshot?.price_components as unknown[]),
        {
          component_code: "invoice_fee",
          component_type: "invoice_fee",
          amount: 29,
          calculation_type: "per_invoice",
          unit: "sek_invoice",
          status: "active",
        },
      ],
    };
    vi.mocked(resolvePublicContractOffer).mockResolvedValue(ambiguous);
    await expect(
      calculateOfferQuote({
        client,
        offerReference: "offer_quote_v1",
        priceArea: "SE3",
        annualConsumptionKwh: 5000,
        startDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "invoice_fee_ambiguous" });
  });

  it("requires a valid start date and customer type", async () => {
    await expect(
      calculateOfferQuote({
        client,
        offerReference: "offer_quote_v1",
        priceArea: "SE3",
        annualConsumptionKwh: 5000,
        startDate: null,
      }),
    ).rejects.toMatchObject({ code: "invalid_start_date" });

    await expect(
      calculateOfferQuote({
        client,
        offerReference: "offer_quote_v1",
        priceArea: "SE3",
        annualConsumptionKwh: 5000,
        startDate: "2026-09-01",
        customerType: "both",
      }),
    ).rejects.toMatchObject({ code: "invalid_customer_type" });
  });
});
