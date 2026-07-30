import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ContractReadModelError,
  mapCanonicalContractOfferRow,
} from "@/lib/customer-contracts/db";
import {
  API_CONTRACT_RESPONSE_SCHEMA_VERSION,
  mapContractPublicationToPublicDto,
} from "@/lib/external-contracts/publicationDto";

function canonicalRow(): Record<string, unknown> {
  return {
    id: "offer-1",
    contract_offer_id: "offer-1",
    company_id: "company-1",
    assignment_id: "assignment-1",
    name: "Rörligt",
    slug: "rorligt",
    status: "active",
    offer_status: "active",
    lifecycle_status: "published",
    assignment_status: "active",
    internal_sales_allowed: true,
    website_publication_allowed: false,
    api_publication_allowed: false,
    internal_channel_status: "active",
    website_channel_status: "missing",
    api_channel_status: "missing",
    internal_channel_valid_from: null,
    internal_channel_valid_to: null,
    website_channel_valid_from: null,
    website_channel_valid_to: null,
    api_channel_valid_from: null,
    api_channel_valid_to: null,
    active_publication_version_count: 1,
    internally_sellable_now: true,
    website_available_now: false,
    api_available_now: false,
    currently_sellable: true,
    internal_readiness: { ready: true, blockers: [] },
    website_readiness: {
      ready: false,
      blockers: [
        {
          code: "website_publication_permission_missing",
          message: "Behörighet saknas.",
        },
      ],
    },
    api_readiness: {
      ready: false,
      blockers: [
        {
          code: "api_publication_permission_missing",
          message: "Behörighet saknas.",
        },
      ],
    },
  };
}

describe("canonical contract channel completion", () => {
  it("fails closed when a mandatory permission column is absent", () => {
    const row = canonicalRow();
    delete row.website_publication_allowed;
    expect(() => mapCanonicalContractOfferRow(row)).toThrowError(
      new ContractReadModelError(
        "canonical_contract_offer_missing_website_publication_allowed",
      ),
    );
  });

  it("keeps internal, website and API availability independent", () => {
    const row = mapCanonicalContractOfferRow(canonicalRow());
    expect(row.internally_sellable_now).toBe(true);
    expect(row.website_available_now).toBe(false);
    expect(row.api_available_now).toBe(false);
    expect(row.website_readiness.blockers[0]?.code).toBe(
      "website_publication_permission_missing",
    );
  });

  it("maps an API publication to a strict public DTO without internal IDs", () => {
    const dto = mapContractPublicationToPublicDto({
      channel: "api",
      publication: {
        offer_reference: "gridex-rorligt-2026",
        name: "Gridex Rörligt",
        contract_type: "variable_monthly",
        energy_direction: "consumption",
        customer_type: "private",
        company_id: "00000000-0000-4000-8000-000000000001",
        contract_product_version_id:
          "00000000-0000-4000-8000-000000000002",
        pricing: {
          monthly_fee_sek: 49,
          price_plan_version_id:
            "00000000-0000-4000-8000-000000000003",
          nested: {
            legal_bundle_version_id:
              "00000000-0000-4000-8000-000000000004",
          },
        },
        valid_from: "2026-07-28T00:00:00+02:00",
        valid_to: null,
      },
    });

    expect(dto).toEqual({
      offer_reference: "gridex-rorligt-2026",
      name: "Gridex Rörligt",
      description: null,
      contract_type: "variable_monthly",
      energy_direction: "consumption",
      customer_type: "private",
      pricing: {
        monthly_fee_sek: 49,
        nested: {},
      },
      valid_from: "2026-07-28T00:00:00+02:00",
      valid_to: null,
      channel: "api",
    });
    expect(JSON.stringify(dto)).not.toMatch(
      /company_id|contract_product_version_id|price_plan_version_id|legal_bundle_version_id/,
    );
  });

  it("keeps runtime, ETag metadata and OpenAPI on schema 2026-07-29.1", () => {
    expect(API_CONTRACT_RESPONSE_SCHEMA_VERSION).toBe("2026-07-29.1");
    const specification = JSON.parse(
      readFileSync(
        resolve("docs/openapi/website-integration-v1.json"),
        "utf8",
      ),
    ) as {
      paths: Record<string, { get: Record<string, unknown> }>;
    };
    const operation = specification.paths["/api/v1/contracts"]?.get;
    expect(operation?.["x-required-scopes"]).toEqual([
      "api_contracts.read",
    ]);
    expect(
      Object.keys(
        (operation?.responses ?? {}) as Record<string, unknown>,
      ),
    ).toEqual(
      expect.arrayContaining([
        "401",
        "403",
        "410",
        "423",
        "429",
        "500",
      ]),
    );
  });
});
