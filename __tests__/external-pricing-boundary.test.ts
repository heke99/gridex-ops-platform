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

async function expectAuthenticatedEndpoint(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(response.status).not.toBe(410);
  const payload = (await response.json()) as { error?: { code?: string } };
  expect(payload.error?.code).toBeTruthy();
}

describe("canonical external pricing and area boundary", () => {
  it("keeps quote and OPS area resolver as authenticated tenant endpoints", async () => {
    await expectAuthenticatedEndpoint(
      await quote(
        new NextRequest("https://app.gridex.se/api/v1/website/quote", {
          method: "POST",
          body: "{}",
        }),
      ),
    );
    await expectAuthenticatedEndpoint(
      await validateQuote(
        new NextRequest(
          "https://app.gridex.se/api/v1/website/quote/validate",
          { method: "POST", body: "{}" },
        ),
      ),
    );
    await expectAuthenticatedEndpoint(
      await resolveArea(
        new NextRequest(
          "https://app.gridex.se/api/v1/website/energy-area/resolve",
          { method: "POST", body: "{}" },
        ),
      ),
    );
  });

  it("keeps the unauthenticated legacy postal resolver removed", async () => {
    const response = await publicArea(
      new NextRequest(
        "https://app.gridex.se/api/public/energy-area?postal_code=58220",
      ),
    );
    expect(response.status).toBe(410);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("public_energy_area_removed");
  });

  it("provisions only the tenant-scoped quote and resolver permissions", () => {
    const activeScopes = new Set<string>(CUSTOMER_PORTAL_SCOPES);
    const groupedScopes = new Set(
      INTEGRATION_API_PERMISSION_GROUPS.flatMap((group) => group.scopes),
    );

    for (const scope of [
      "website_quotes.write",
      "website_quotes.validate",
      "website_energy_area.resolve",
    ]) {
      expect(activeScopes.has(scope)).toBe(true);
      expect(groupedScopes.has(scope)).toBe(true);
    }
  });
});
