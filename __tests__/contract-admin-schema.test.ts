import { describe, expect, it } from "vitest";
import {
  parseAdminContractForm,
  parseStructuredOptionalFees,
} from "@/lib/contracts/adminContractSchema";

function commercialComponent(input: {
  code: string;
  amount: number;
  unit?:
    | "sek_month"
    | "sek_invoice"
    | "ore_per_kwh"
    | "sek_contract"
    | "sek_event";
}) {
  const unit = input.unit ?? "sek_month";
  const calculationType =
    unit === "sek_invoice"
      ? "per_invoice"
      : unit === "ore_per_kwh"
        ? "per_kwh"
        : unit === "sek_contract"
          ? "fixed_once"
          : unit === "sek_event"
            ? "event_only"
            : "per_month";
  const lifecycle =
    unit === "sek_invoice"
      ? "per_invoice"
      : unit === "ore_per_kwh"
        ? "consumption_based"
        : unit === "sek_contract"
          ? "once_per_contract"
          : unit === "sek_event"
            ? "event_only"
            : "recurring";
  return {
    component_reference: `${input.code}_reference`,
    component_code: input.code,
    internal_name: input.code,
    customer_name: input.code,
    internal_description: null,
    customer_description: null,
    component_type: "commercial_fee",
    amount: input.amount,
    unit,
    calculation_type: calculationType,
    calculation_base: null,
    vat_treatment: "standard",
    selection_policy: "mandatory",
    default_selected: true,
    customer_can_deselect: false,
    admin_must_select: false,
    informational_only: false,
    lifecycle,
    periodization_rule: unit === "sek_month" ? "active_days" : "none",
    invoice_line_name: input.code,
    accounting_classification: "electricity_revenue",
    sort_order: 500,
    valid_from: null,
    valid_to: null,
    conditions: {
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
    website_published: true,
    metadata: {},
  };
}

function baseForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const contractType = overrides.contract_type ?? "variable_hourly";
  const selectedPriceAreas = (overrides.price_areas ?? "SE1,SE2,SE3,SE4")
    .split(",")
    .map((area) => area.trim())
    .filter(Boolean);
  const values = {
    company_id: "11111111-1111-4111-8111-111111111111",
    name: "Canonical testavtal",
    contract_type: "variable_hourly",
    customer_type: "both",
    invoice_fee_sek: "0",
    vat_rate: "25",
    price_areas: "SE1,SE2,SE3,SE4",
    price_options_json: JSON.stringify([
      {
        price_option_reference: "test_price_option",
        option_code: "test_option",
        customer_name: "Testalternativ",
        customer_type: "both",
        default: true,
        selection_required: false,
        internal_description: null,
        contract_type: contractType,
        binding_months: 0,
        notice_months: 1,
        auto_renew_enabled: false,
        renewal_term_months: null,
        valid_from: null,
        valid_to: null,
        earliest_start_date: null,
        latest_start_date: null,
        status: "active",
        sort_order: 0,
        version_number: 1,
        area_prices:
          contractType === "fixed"
            ? selectedPriceAreas.map((priceArea) => ({
                price_row_reference: `test_area_${priceArea.toLowerCase()}`,
                price_area: priceArea,
                amount: 99.5,
                unit: "ore_per_kwh",
                vat_treatment: "standard",
                valid_from: null,
                valid_to: null,
                metadata: {},
              }))
            : [],
        metadata: {},
      },
    ]),
    commercial_components_json: "[]",
    invoice_delivery_methods_json: '["email"]',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

describe("admin contract canonical form", () => {
  it("creates new contracts as drafts with one derived status source", () => {
    const parsed = parseAdminContractForm(baseForm());
    expect(parsed.lifecycleStatus).toBe("draft");
    expect(parsed.legacyStatus).toBe("draft");
    expect(parsed.isActive).toBe(false);
    expect(parsed.spotWeightPercent).toBe(100);
    expect(parsed.portfolioWeightPercent).toBe(0);
    expect(parsed.fixedWeightPercent).toBe(0);
  });

  it("rejects direct publication or archival through the editable form", () => {
    expect(() =>
      parseAdminContractForm(baseForm({ lifecycle_status: "published" })),
    ).toThrow();
    expect(() =>
      parseAdminContractForm(baseForm({ lifecycle_status: "archived" })),
    ).toThrow();
  });

  it("uses type-specific canonical weights for portfolio, mixed and fixed", () => {
    const portfolio = parseAdminContractForm(
      baseForm({ contract_type: "portfolio", portfolio_id: "portfolio-1" }),
    );
    expect([portfolio.spotWeightPercent, portfolio.portfolioWeightPercent, portfolio.fixedWeightPercent]).toEqual([0, 100, 0]);

    const mixed = parseAdminContractForm(baseForm({ contract_type: "mixed" }));
    expect([mixed.spotWeightPercent, mixed.portfolioWeightPercent, mixed.fixedWeightPercent]).toEqual([50, 50, 0]);

    const fixed = parseAdminContractForm(baseForm({ contract_type: "fixed", fixed_price_ore_per_kwh: "99.5" }));
    expect([fixed.spotWeightPercent, fixed.portfolioWeightPercent, fixed.fixedWeightPercent]).toEqual([0, 0, 100]);
    expect(fixed.priceOptions[0]?.area_prices.map((row) => row.price_area)).toEqual([
      "SE1",
      "SE2",
      "SE3",
      "SE4",
    ]);
  });

  it("requires a positive discount period whenever a discount is entered", () => {
    expect(() => parseAdminContractForm(baseForm({ discount_value: "50" }))).toThrow(
      /rabattperiod/i,
    );
    const parsed = parseAdminContractForm(
      baseForm({ discount_value: "50", discount_months: "3" }),
    );
    expect(parsed.discountMonths).toBe(3);
  });

  it("supports explicit power-of-attorney mode without hidden truthy defaults", () => {
    const parsed = parseAdminContractForm(
      baseForm({ power_of_attorney_mode: "not_required" }),
    );
    expect(parsed.powerOfAttorneyMode).toBe("not_required");
    expect(parsed.powerOfAttorneyRequired).toBe(false);
  });

  it("parses structured optional fees without dropping visibility, VAT or order", () => {
    const rows = parseStructuredOptionalFees(
      "Pappersfaktura | 39 | sek_invoice | ja | invoice_subtotal | standard | 910",
      false,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        label: "Pappersfaktura",
        amount: 39,
        unit: "sek_invoice",
        website_visibility: true,
        calculation_base: "invoice_subtotal",
        vat_treatment: "standard",
        sort_order: 910,
        billing_frequency: "per_invoice",
      }),
    ]);
  });

  it("keeps all contract-wide fees consistent for fixed-price agreements", () => {
    const parsed = parseAdminContractForm(
      baseForm({
        contract_type: "fixed",
        monthly_fee_sek: "59",
        invoice_fee_sek: "19",
        green_fee_mode: "ore_per_kwh",
        green_fee_value: "1.9",
        start_fee_sek: "99",
        admin_fee_sek: "25",
        break_fee_sek: "495",
      }),
    );

    expect(parsed.contractType).toBe("fixed");
    expect(parsed.monthlyFeeSek).toBe(59);
    expect(parsed.invoiceFeeSek).toBe(19);
    expect(parsed.greenFeeMode).toBe("ore_per_kwh");
    expect(parsed.greenFeeValue).toBe(1.9);
    expect(parsed.startFeeSek).toBe(99);
    expect(parsed.adminFeeSek).toBe(25);
    expect(parsed.breakFeeSek).toBe(495);
  });

  it("requires an explicit invoice fee, including zero", () => {
    expect(() =>
      parseAdminContractForm(baseForm({ invoice_fee_sek: "" })),
    ).toThrow(/fakturaavgift måste anges/i);
    expect(parseAdminContractForm(baseForm({ invoice_fee_sek: "0" })).invoiceFeeSek).toBe(0);
  });

  it("migrates older standard fee components into one canonical contract source", () => {
    const components = [
      commercialComponent({ code: "monthly_fee", amount: 49 }),
      commercialComponent({
        code: "invoice_administration_fee",
        amount: 19,
        unit: "sek_invoice",
      }),
      commercialComponent({
        code: "green_energy_fee",
        amount: 1.5,
        unit: "ore_per_kwh",
      }),
      commercialComponent({
        code: "start_fee",
        amount: 99,
        unit: "sek_contract",
      }),
      commercialComponent({
        code: "administration_fee",
        amount: 25,
        unit: "sek_contract",
      }),
      commercialComponent({
        code: "break_fee",
        amount: 495,
        unit: "sek_event",
      }),
      commercialComponent({
        code: "paper_invoice_fee",
        amount: 39,
        unit: "sek_invoice",
      }),
    ];
    const parsed = parseAdminContractForm(
      baseForm({
        invoice_fee_sek: "19",
        commercial_components_json: JSON.stringify(components),
      }),
    );

    expect(parsed.monthlyFeeSek).toBe(49);
    expect(parsed.invoiceFeeSek).toBe(19);
    expect(parsed.greenFeeMode).toBe("ore_per_kwh");
    expect(parsed.greenFeeValue).toBe(1.5);
    expect(parsed.startFeeSek).toBe(99);
    expect(parsed.adminFeeSek).toBe(25);
    expect(parsed.breakFeeSek).toBe(495);
    expect(parsed.commercialComponents.map((component) => component.component_code)).toEqual([
      "paper_invoice_fee",
    ]);
  });

  it("blocks contradictory or invalid commercial values before RPC", () => {
    expect(() =>
      parseAdminContractForm(
        baseForm({ spot_weight_percent: "60", portfolio_weight_percent: "30", fixed_weight_percent: "0" }),
      ),
    ).toThrow(/100 procent/i);
    expect(() => parseAdminContractForm(baseForm({ valid_from: "2026-09-01", valid_to: "2026-08-31" }))).toThrow(/slutdatum/i);
    expect(() => parseAdminContractForm(baseForm({ max_customers: "0" }))).toThrow(/minst 1/i);
  });
});
