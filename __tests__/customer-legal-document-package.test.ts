import { describe, expect, it } from "vitest";
import {
  buildCustomerLegalDocuments,
  customerLegalAcceptanceCategoryForModule,
  customerLegalDocumentKindForModule,
} from "@/lib/legal/customerDocumentPackage";

const companyId = "00000000-0000-4000-8000-000000000010";
const bundleId = "00000000-0000-4000-8000-000000000020";

function moduleVersion(moduleKey: string, index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    module_key: moduleKey,
    version: `v${index}`,
    title: moduleKey,
    published_at: "2026-08-05T10:00:00.000Z",
    content_sha256: String(index).padStart(64, "a").slice(-64),
    legal_bundle_version_id: bundleId,
  };
}

describe("customer legal document package", () => {
  it("groups the canonical module set into agreement, POA and withdrawal", () => {
    const documents = buildCustomerLegalDocuments({
      companyId,
      legalBundleVersionId: bundleId,
      modules: [
        moduleVersion("agreement_confirmation", 1),
        moduleVersion("price_terms", 2),
        moduleVersion("privacy_policy", 3),
        moduleVersion("distance_contract_information", 4),
        moduleVersion("power_of_attorney", 5),
        moduleVersion("withdrawal_right", 6),
        moduleVersion("withdrawal_form", 7),
      ],
      urlForKind: (kind) => `https://app.gridex.se/legal/tenant/${kind}/${bundleId}`,
    });

    expect(documents.map((document) => document.requirement_code)).toEqual([
      "agreement",
      "power_of_attorney",
      "withdrawal",
    ]);
    expect(documents[0]?.module_keys).toEqual([
      "agreement_confirmation",
      "distance_contract_information",
      "price_terms",
      "privacy_policy",
    ]);
    expect(documents[1]?.primary_document_id).toBe(
      "00000000-0000-4000-8000-000000000005",
    );
    expect(documents[2]?.acceptance_mode).toBe("acknowledge");
  });

  it("omits withdrawal when no withdrawal modules are published", () => {
    const documents = buildCustomerLegalDocuments({
      companyId,
      legalBundleVersionId: bundleId,
      modules: [
        moduleVersion("general_business_terms", 1),
        moduleVersion("power_of_attorney", 2),
      ],
    });

    expect(documents.map((document) => document.requirement_code)).toEqual([
      "agreement",
      "power_of_attorney",
    ]);
  });

  it("is deterministic and tenant-bound", () => {
    const modules = [
      moduleVersion("price_terms", 2),
      moduleVersion("agreement_confirmation", 1),
    ];
    const first = buildCustomerLegalDocuments({
      companyId,
      legalBundleVersionId: bundleId,
      modules,
    });
    const reordered = buildCustomerLegalDocuments({
      companyId,
      legalBundleVersionId: bundleId,
      modules: [...modules].reverse(),
    });
    const anotherTenant = buildCustomerLegalDocuments({
      companyId: "00000000-0000-4000-8000-000000000011",
      legalBundleVersionId: bundleId,
      modules,
    });

    expect(first[0]?.document_hash).toBe(reordered[0]?.document_hash);
    expect(first[0]?.document_reference).toBe(
      reordered[0]?.document_reference,
    );
    expect(first[0]?.document_reference).not.toBe(
      anotherTenant[0]?.document_reference,
    );
  });

  it("maps grouped presentation back to the exact legacy evidence categories", () => {
    expect(customerLegalAcceptanceCategoryForModule("agreement_confirmation")).toBe(
      "terms",
    );
    expect(customerLegalAcceptanceCategoryForModule("privacy_policy")).toBe(
      "privacy_policy",
    );
    expect(customerLegalAcceptanceCategoryForModule("fixed_price_terms")).toBe(
      "price_terms",
    );
    expect(
      customerLegalAcceptanceCategoryForModule("distance_contract_information"),
    ).toBe("withdrawal");
    expect(customerLegalAcceptanceCategoryForModule("power_of_attorney")).toBe(
      "power_of_attorney",
    );
  });

  it("never places POA or withdrawal modules in the agreement", () => {
    expect(customerLegalDocumentKindForModule("power_of_attorney")).toBe(
      "power_of_attorney",
    );
    expect(customerLegalDocumentKindForModule("withdrawal_right")).toBe(
      "withdrawal",
    );
    expect(customerLegalDocumentKindForModule("withdrawal_form")).toBe(
      "withdrawal",
    );
    expect(customerLegalDocumentKindForModule("privacy_policy")).toBe(
      "agreement",
    );
  });
});
