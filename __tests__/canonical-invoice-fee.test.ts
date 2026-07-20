import { describe, expect, it } from "vitest";
import {
  assessCanonicalInvoiceFee,
  canonicalInvoiceFeeFromSnapshot,
  parseCanonicalInvoiceFee,
  upsertCanonicalInvoiceFeeComponent,
} from "@/lib/pricing/canonicalInvoiceFee";

function snapshot(amount: number, websiteCardVisible = false) {
  return {
    price_components: [
      {
        component_code: "invoice_fee",
        component_type: "invoice_fee",
        name: "Fakturaavgift",
        amount,
        calculation_type: "per_invoice",
        unit: "sek_invoice",
        status: "active",
        website_card_visible: websiteCardVisible,
      },
    ],
  };
}

describe("canonical invoice fee", () => {
  it("preserves zero as an explicit fee", () => {
    expect(parseCanonicalInvoiceFee("0", { required: true })).toBe(0);
    expect(parseCanonicalInvoiceFee("0.00", { required: true })).toBe(0);
    expect(
      assessCanonicalInvoiceFee({ rowAmount: 0, snapshot: snapshot(0) }),
    ).toEqual({
      status: "ready",
      amount: 0,
      unit: "sek_invoice",
      calculation_type: "per_invoice",
      website_card_visible: false,
      source: "price_plan_version",
    });
  });

  it("preserves a positive fee", () => {
    expect(parseCanonicalInvoiceFee("19", { required: true })).toBe(19);
    expect(canonicalInvoiceFeeFromSnapshot(snapshot(19))).toBe(19);
  });

  it("requires an explicit value for publication", () => {
    expect(() => parseCanonicalInvoiceFee("", { required: true })).toThrow(
      /Ange 0/,
    );
    expect(parseCanonicalInvoiceFee("", { required: false })).toBeNull();
    expect(() => parseCanonicalInvoiceFee("NaN")).toThrow(/numeriskt/);
    expect(() => parseCanonicalInvoiceFee(-1)).toThrow(/negativ/);
  });

  it("keeps a hidden fee canonical and calculation-ready", () => {
    const readiness = assessCanonicalInvoiceFee({
      rowAmount: 29,
      snapshot: snapshot(29, false),
    });
    expect(readiness).toMatchObject({
      status: "ready",
      amount: 29,
      website_card_visible: false,
    });
  });

  it("detects missing, conflict and ambiguous components", () => {
    expect(
      assessCanonicalInvoiceFee({ rowAmount: null, snapshot: {} }),
    ).toEqual({ status: "blocked", code: "invoice_fee_missing" });
    expect(
      assessCanonicalInvoiceFee({ rowAmount: 19, snapshot: snapshot(29) }),
    ).toMatchObject({ status: "blocked", code: "invoice_fee_conflict" });
    expect(
      assessCanonicalInvoiceFee({
        rowAmount: 19,
        snapshot: {
          price_components: [
            ...snapshot(19).price_components,
            ...snapshot(29).price_components,
          ],
        },
      }),
    ).toEqual({ status: "blocked", code: "invoice_fee_ambiguous" });
  });

  it("replaces legacy invoice fee components with one canonical component", () => {
    const result = upsertCanonicalInvoiceFeeComponent({
      snapshot: {
        price_components: [
          { component_code: "invoice_fee", amount: 12 },
          { component_code: "monthly_fee", amount: 49 },
        ],
      },
      amount: 0,
      websiteCardVisible: false,
    });
    expect(result.price_components).toEqual([
      { component_code: "monthly_fee", amount: 49 },
      expect.objectContaining({
        component_code: "invoice_fee",
        amount: 0,
        calculation_type: "per_invoice",
        unit: "sek_invoice",
        website_card_visible: false,
      }),
    ]);
  });
});
