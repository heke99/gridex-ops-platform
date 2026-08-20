import { describe, expect, it } from "vitest";

import {
  assertWebsiteQuotePersistenceInvariant,
} from "@/lib/pricing/websiteQuotes";
import { CANONICAL_CONTRACT_PRICING_SCHEMA } from "@/lib/pricing/canonicalContractEngine";

function validInput() {
  return {
    pricingSnapshotSchemaVersion: CANONICAL_CONTRACT_PRICING_SCHEMA,
    priceOptionReference: "canonical_variable_monthly",
    invoiceDeliveryMethod: "email",
    resolvedBaseComponents: [],
    resolvedPriceComponents: [],
    quoteSnapshot: {
      snapshot_schema: CANONICAL_CONTRACT_PRICING_SCHEMA,
      pricing_snapshot_schema_version: CANONICAL_CONTRACT_PRICING_SCHEMA,
      price_option_reference: "canonical_variable_monthly",
      invoice_delivery_method: "email",
    },
  };
}

describe("website quote persistence invariants", () => {
  it("accepts a complete canonical v3 quote input", () => {
    expect(() => assertWebsiteQuotePersistenceInvariant(validInput())).not.toThrow();
  });

  it("fails before DB insert when price_option_reference is missing", () => {
    try {
      assertWebsiteQuotePersistenceInvariant({
        ...validInput(),
        priceOptionReference: null,
      });
      throw new Error("expected missing price option to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "missing_price_option_reference" });
    }
  });

  it("fails before DB insert when invoice delivery is missing", () => {
    try {
      assertWebsiteQuotePersistenceInvariant({
        ...validInput(),
        invoiceDeliveryMethod: null,
      });
      throw new Error("expected missing invoice delivery to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "missing_invoice_delivery_method" });
    }
  });

  it("fails with invalid_pricing_schema instead of leaking a 23514", () => {
    try {
      assertWebsiteQuotePersistenceInvariant({
        ...validInput(),
        pricingSnapshotSchemaVersion: "gridex_contract_pricing_v5",
      });
      throw new Error("expected invalid pricing schema to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_pricing_schema" });
    }
  });

  it("never discards or rewrites an explicit verified price option", () => {
    try {
      assertWebsiteQuotePersistenceInvariant({
        ...validInput(),
        priceOptionReference: "explicit_verified_option",
      });
      throw new Error("expected explicit option mismatch to be rejected");
    } catch (error) {
      expect(error).toMatchObject({ code: "price_option_reference_mismatch" });
    }
  });
});
