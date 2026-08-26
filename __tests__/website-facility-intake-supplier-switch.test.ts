import { describe, expect, it } from "vitest";
import { assessWebsiteApplicationReadiness } from "@/lib/website/applicationReview";

const VERIFIED_GRID_OWNER_ID = "11111111-1111-4111-8111-111111111111";

function baseReadyInput(overrides: Record<string, unknown> = {}) {
  return {
    customer: {
      email: "kund@example.com",
      first_name: "Ada",
      last_name: "Andersson",
      personal_number: "199001011234",
    },
    site: {
      street: "Storgatan 1",
      postal_code: "11122",
      city: "Stockholm",
      grid_area_code: "STH",
      price_area_code: "SE3",
      grid_owner_id: VERIFIED_GRID_OWNER_ID,
      grid_owner_verification_status: "verified",
    },
    metering_point: {
      metering_point_id: "735999123456789012",
    },
    contract: {
      offer_reference: "offer_demo_ref",
      requested_start_mode: "earliest_possible",
      calculated_earliest_start_date: "2026-09-01",
    },
    consents: {
      power_of_attorney: true,
      terms: true,
      privacy_policy: true,
      withdrawal: true,
      price_terms: true,
    },
    ...overrides,
  };
}

describe("website facility intake supplier-switch readiness", () => {
  it("reaches ready_for_switch when facility id is only on metering_point.site_facility_id", () => {
    const readiness = assessWebsiteApplicationReadiness(
      baseReadyInput({
        site: {
          street: "Storgatan 1",
          postal_code: "11122",
          city: "Stockholm",
          grid_area_code: "STH",
          price_area_code: "SE3",
          grid_owner_id: VERIFIED_GRID_OWNER_ID,
          grid_owner_verification_status: "verified",
          // deliberately omit site.facility_id
        },
        metering_point: {
          metering_point_id: "735999123456789012",
          site_facility_id: "fac 123",
        },
      }),
    );

    expect(readiness.facilityVerified).toBe(true);
    expect(readiness.canStartSwitch).toBe(true);
    expect(readiness.status).toBe("ready_for_switch");
    expect(readiness.missingFields).not.toContain("site");
  });

  it("still blocks switch and requests grid-owner completion when metering identity is missing", () => {
    const readiness = assessWebsiteApplicationReadiness(
      baseReadyInput({
        site: {
          street: "Storgatan 1",
          postal_code: "11122",
          city: "Stockholm",
          grid_area_code: "STH",
          price_area_code: "SE3",
          grid_owner_id: VERIFIED_GRID_OWNER_ID,
          grid_owner_verification_status: "verified",
          facility_id: "FAC123",
        },
        metering_point: {},
      }),
    );

    expect(readiness.canStartSwitch).toBe(false);
    expect(readiness.missingFields).toContain("metering_point_id");
    expect(readiness.nextStep).toMatch(/nätägare/i);
  });
});
