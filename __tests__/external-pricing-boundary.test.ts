import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as quote } from "@/app/api/v1/website/quote/route";
import { POST as validateQuote } from "@/app/api/v1/website/quote/validate/route";
import { POST as resolveArea } from "@/app/api/v1/website/energy-area/resolve/route";
import { GET as publicArea } from "@/app/api/public/energy-area/route";
import {
  CUSTOMER_PORTAL_SCOPES,
  INTEGRATION_API_PERMISSION_GROUPS,
} from "@/lib/integrations/apiClientScopes";

async function expectGone(
  response: Response,
  expectedCode: string,
): Promise<void> {
  expect(response.status).toBe(410);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("deprecation")).toBe("true");
  const payload = (await response.json()) as {
    error?: { code?: string };
  };
  expect(payload.error?.code).toBe(expectedCode);
}

describe("external tenant pricing responsibility boundary", () => {
  it("removes OPS quote and public energy-area resolution", async () => {
    await expectGone(
      await quote(
        new NextRequest("https://app.gridex.se/api/v1/website/quote", {
          method: "POST",
          body: "{}",
        }),
      ),
      "tenant_managed_pricing_required",
    );
    await expectGone(
      await validateQuote(
        new NextRequest(
          "https://app.gridex.se/api/v1/website/quote/validate",
          { method: "POST", body: "{}" },
        ),
      ),
      "quote_validation_removed",
    );
    await expectGone(
      await resolveArea(
        new NextRequest(
          "https://app.gridex.se/api/v1/website/energy-area/resolve",
          { method: "POST", body: "{}" },
        ),
      ),
      "tenant_managed_energy_area_required",
    );
    await expectGone(
      await publicArea(
        new NextRequest(
          "https://app.gridex.se/api/public/energy-area?postal_code=58220",
        ),
      ),
      "public_energy_area_removed",
    );
  });

  it("does not provision removed scopes to external API clients", () => {
    const activeScopes = new Set<string>(CUSTOMER_PORTAL_SCOPES);
    const groupedScopes = new Set(
      INTEGRATION_API_PERMISSION_GROUPS.flatMap((group) => group.scopes),
    );

    for (const scope of [
      "website_quotes.write",
      "website_quotes.validate",
      "website_energy_area.resolve",
    ]) {
      expect(activeScopes.has(scope)).toBe(false);
      expect(groupedScopes.has(scope)).toBe(false);
    }
  });
});
