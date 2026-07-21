import { describe, expect, it } from "vitest";
import {
  parseAdminContractForm,
  parseStructuredOptionalFees,
} from "@/lib/contracts/adminContractSchema";

function baseForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values = {
    company_id: "11111111-1111-4111-8111-111111111111",
    name: "Canonical testavtal",
    contract_type: "variable_hourly",
    customer_type: "both",
    invoice_fee_sek: "0",
    vat_rate: "25",
    price_areas: "SE1,SE2,SE3,SE4",
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
