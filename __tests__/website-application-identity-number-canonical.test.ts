// inbound-review: G
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: new Proxy(
    {},
    {
      get() {
        throw new Error("validation must reject before any database access");
      },
    },
  ),
}));

import {
  canonicalSwedishOrganizationNumber,
  canonicalSwedishPersonalNumber,
} from "@/lib/validation/customerFields";
import { ApplicationSchema } from "@/lib/website/customerApplicationSchemas";
import { normalizeRawApplication } from "@/lib/website/customerApplicationCore";
import { processWebsiteCustomerApplication } from "@/lib/website/customerApplicationProcess";
import type { IntegrationApiClient } from "@/lib/integrations/apiAuth";

const TODAY = new Date(Date.UTC(2026, 9, 9));

function withCheckDigit(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const d = Number(nine[i]) * (i % 2 === 0 ? 2 : 1);
    sum += d > 9 ? d - 9 : d;
  }
  return `${nine}${(10 - (sum % 10)) % 10}`;
}

describe("canonical Swedish identity numbers", () => {
  it("collapses 10- and 12-digit personnummer to one 12-digit value", () => {
    const forms = ["811218-9876", "8112189876", "19811218-9876", "198112189876"];
    expect(new Set(forms.map((v) => canonicalSwedishPersonalNumber(v, TODAY)))).toEqual(new Set(["198112189876"]));
  });

  it("derives the century from date rules and the '+' separator", () => {
    const young = withCheckDigit("100508123"); // born 2010-05-08
    expect(canonicalSwedishPersonalNumber(young, TODAY)).toBe(`20${young}`);
    const future = withCheckDigit("261231123"); // 2026-12-31 is after TODAY -> 1926
    expect(canonicalSwedishPersonalNumber(future, TODAY)).toBe(`19${future}`);
    expect(canonicalSwedishPersonalNumber("811218+9876", TODAY)).toBe("188112189876");
  });

  it("rejects invalid check digits and impossible dates", () => {
    expect(canonicalSwedishPersonalNumber("811218-9875", TODAY)).toBeNull();
    expect(canonicalSwedishPersonalNumber("811318-9876", TODAY)).toBeNull();
    expect(canonicalSwedishPersonalNumber("12345", TODAY)).toBeNull();
  });

  it("canonicalizes organisation numbers to 10 digits", () => {
    expect(canonicalSwedishOrganizationNumber("556036-0793", TODAY)).toBe("5560360793");
    expect(canonicalSwedishOrganizationNumber("165560360793", TODAY)).toBe("5560360793");
    expect(canonicalSwedishOrganizationNumber("556036-0794", TODAY)).toBeNull();
  });

  it("stores the canonical 12-digit value after schema parsing", () => {
    const customerSchema = ApplicationSchema.shape.customer;
    const parse = (raw: Record<string, unknown>) =>
      customerSchema.parse((normalizeRawApplication(raw) as { customer: unknown }).customer);
    expect(parse({ customer: { personal_number: "811218-9876" } }).personal_number).toBe("198112189876");
    expect(parse({ personnummer: "198112189876" }).personal_number).toBe("198112189876");
    expect(parse({ customer: { customer_type: "business", org_number: "16556036-0793" } }).org_number).toBe("5560360793");
  });
});

describe("website application rejects invalid identity numbers with 422", () => {
  const client = { companyId: "c-1", id: "client-1" } as unknown as IntegrationApiClient;

  it("returns 422 personal_number_invalid for a bad personnummer", async () => {
    const result = await processWebsiteCustomerApplication({
      client,
      idempotencyKey: "idem-key-0001",
      rawBody: { customer: { customer_type: "private", personal_number: "811218-9875" } },
    });
    expect(result.status).toBe(422);
    expect((result.body as { code: string }).code).toBe("personal_number_invalid");
  });

  it("returns 422 org_number_invalid for a bad organisationsnummer", async () => {
    const result = await processWebsiteCustomerApplication({
      client,
      idempotencyKey: "idem-key-0002",
      rawBody: { customer: { customer_type: "business", org_number: "556036-0794" } },
    });
    expect(result.status).toBe(422);
    expect((result.body as { code: string }).code).toBe("org_number_invalid");
  });
});
