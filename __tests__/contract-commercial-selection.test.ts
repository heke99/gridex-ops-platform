import { describe, expect, it } from "vitest";

import {
  commercialModelSchema,
  resolveCommercialSelection,
  type CanonicalCommercialModel,
  type CommercialPriceComponent,
} from "@/lib/pricing/commercialModel";
import { calculatePriceComponents } from "@/lib/pricing/priceComponentCalculator";
import type { BillingUnderlayInput } from "@/lib/pricing/types";

function component(
  input: Partial<CommercialPriceComponent> & {
    reference: string;
    code: string;
  },
): CommercialPriceComponent {
  return {
    component_reference: input.reference,
    component_code: input.code,
    internal_name: input.code,
    customer_name: input.code,
    internal_description: null,
    customer_description: null,
    component_type: input.component_type ?? "commercial_fee",
    amount: input.amount ?? 0,
    unit: input.unit ?? "sek_month",
    calculation_type: input.calculation_type ?? "per_month",
    calculation_base: input.calculation_base ?? null,
    vat_treatment: "standard",
    selection_policy: input.selection_policy ?? "mandatory",
    default_selected: input.default_selected ?? true,
    customer_can_deselect: input.customer_can_deselect ?? false,
    admin_must_select: input.admin_must_select ?? false,
    informational_only: false,
    lifecycle: input.lifecycle ?? "recurring",
    periodization_rule: input.periodization_rule ?? "active_days",
    invoice_line_name: input.code,
    accounting_classification: "electricity_revenue",
    sort_order: input.sort_order ?? 100,
    valid_from: null,
    valid_to: null,
    conditions: input.conditions ?? {
      contract_types: [],
      price_option_references: [],
      price_areas: [],
      customer_types: [],
      invoice_delivery_methods: [],
      sales_channels: [],
      minimum_site_count: null,
      maximum_site_count: null,
      minimum_annual_consumption_kwh: null,
      maximum_annual_consumption_kwh: null,
      valid_from: null,
      valid_to: null,
    },
    website_published: input.website_published ?? true,
    metadata: {},
  };
}

function model(): CanonicalCommercialModel {
  return commercialModelSchema.parse({
    schema_version: "gridex_contract_pricing_v6_selection",
    price_options: [12, 24, 36].map((months, index) => ({
      price_option_reference: `fixed_${months}_months`,
      option_code: `fixed_${months}`,
      customer_name: `${months} månader`,
      internal_description: null,
      contract_type: "fixed",
      binding_months: months,
      notice_months: 1,
      auto_renew_enabled: false,
      renewal_term_months: null,
      valid_from: null,
      valid_to: null,
      earliest_start_date: null,
      latest_start_date: null,
      status: "active",
      sort_order: index,
      version_number: 1,
      area_prices: ["SE1", "SE2", "SE3", "SE4"].map((area, areaIndex) => ({
        price_row_reference: `fixed_${months}_${area.toLowerCase()}`,
        price_area: area,
        amount: 100 + index * 10 + areaIndex,
        unit: "ore_per_kwh",
        vat_treatment: "standard",
        valid_from: null,
        valid_to: null,
        metadata: {},
      })),
      metadata: {},
    })),
    components: [
      component({
        reference: "monthly_fee_ref",
        code: "monthly_fee",
        amount: 49,
      }),
      component({
        reference: "paper_invoice_ref",
        code: "paper_invoice_fee",
        amount: 39,
        unit: "sek_invoice",
        calculation_type: "per_invoice",
        lifecycle: "per_invoice",
        selection_policy: "conditional",
        conditions: {
          contract_types: [],
          price_option_references: [],
          price_areas: [],
          customer_types: [],
          invoice_delivery_methods: ["paper"],
          sales_channels: [],
          minimum_site_count: null,
          maximum_site_count: null,
          minimum_annual_consumption_kwh: null,
          maximum_annual_consumption_kwh: null,
          valid_from: null,
          valid_to: null,
        },
      }),
      component({
        reference: "green_energy_ref",
        code: "green_energy_fee",
        amount: 9,
        selection_policy: "customer_optional",
        default_selected: false,
        customer_can_deselect: true,
      }),
      component({
        reference: "contract_setup_ref",
        code: "contract_setup_fee",
        amount: 199,
        unit: "sek_contract",
        calculation_type: "fixed_once",
        lifecycle: "once_per_contract",
      }),
      component({
        reference: "internal_insurance_ref",
        code: "internal_insurance",
        amount: 19,
        selection_policy: "admin_optional",
        default_selected: false,
        admin_must_select: true,
        website_published: false,
      }),
    ],
    invoice_delivery_methods: ["email", "e_invoice", "paper"],
  });
}

function select(
  invoiceDeliveryMethod: "email" | "e_invoice" | "paper",
  selectedComponentReferences: string[] = [],
) {
  return resolveCommercialSelection({
    model: model(),
    contractType: "fixed",
    priceOptionReference: "fixed_24_months",
    priceArea: "SE3",
    customerType: "private",
    invoiceDeliveryMethod,
    selectedComponentReferences,
    annualConsumptionKwh: 12_000,
    siteCount: 1,
    startDate: "2026-09-01",
    salesChannel: "website",
  });
}

describe("canonical commercial selection", () => {
  it("keeps 12/24/36 month options and selects the exact SE row", () => {
    const parsed = model();
    expect(parsed.price_options.map((option) => option.binding_months)).toEqual([
      12, 24, 36,
    ]);
    const selection = select("email");
    expect(selection.priceOption.price_option_reference).toBe(
      "fixed_24_months",
    );
    expect(selection.areaPrice?.price_row_reference).toBe("fixed_24_se3");
    expect(selection.areaPrice?.amount).toBe(112);
  });

  it("includes paper fee only for paper invoice", () => {
    expect(
      select("paper").conditionalComponentReferences,
    ).toContain("paper_invoice_ref");
    expect(
      select("email").conditionalComponentReferences,
    ).not.toContain("paper_invoice_ref");
    expect(
      select("e_invoice").conditionalComponentReferences,
    ).not.toContain("paper_invoice_ref");
  });

  it("accepts a published customer option and rejects an admin-only client choice", () => {
    expect(
      select("email", ["green_energy_ref"]).selectedComponentReferences,
    ).toContain("green_energy_ref");
    expect(() =>
      select("email", ["internal_insurance_ref"]),
    ).toThrow(/bara väljas internt/);
  });

  it("uses the same component calculator for the resolved invoice rows", () => {
    const selection = select("paper", ["green_energy_ref"]);
    const underlay: BillingUnderlayInput = {
      companyId: "00000000-0000-0000-0000-000000000001",
      customerId: null,
      meteringPointId: null,
      pricePlanId: null,
      pricePlanVersionId: null,
      priceArea: "SE3",
      quantityKwh: 1_000,
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      invoiceCreated: true,
      siteCount: 1,
      pricingSnapshot: {},
    };
    const calculation = calculatePriceComponents({
      underlay,
      components: selection.components,
      baseAmountExVat: 1_120,
      vatRate: 25,
    });
    const byReference = new Map(
      calculation.lines.map((line) => [
        line.metadata?.component_reference,
        line.amountExVat,
      ]),
    );
    expect(byReference.get("monthly_fee_ref")).toBe(49);
    expect(byReference.get("paper_invoice_ref")).toBe(39);
    expect(byReference.get("green_energy_ref")).toBe(9);
    expect(byReference.get("contract_setup_ref")).toBe(199);
    expect(calculation.errors).toEqual([]);
  });

  it("does not charge once-per-contract components after the first period", () => {
    const selection = select("email");
    const calculation = calculatePriceComponents({
      underlay: {
        companyId: "00000000-0000-0000-0000-000000000001",
        customerId: null,
        meteringPointId: null,
        pricePlanId: null,
        pricePlanVersionId: null,
        priceArea: "SE3",
        quantityKwh: 1_000,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        invoiceCreated: true,
        isFirstContractPeriod: false,
        pricingSnapshot: {},
      },
      components: selection.components,
      baseAmountExVat: 1_120,
      vatRate: 25,
    });
    expect(
      calculation.lines.some(
        (line) =>
          line.metadata?.component_reference === "contract_setup_ref",
      ),
    ).toBe(false);
  });
});
