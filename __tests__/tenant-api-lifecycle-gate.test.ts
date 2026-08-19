import { describe, expect, it } from "vitest";
import { tenantApiAccessError } from "@/lib/integrations/apiAuth";

describe("central tenant API lifecycle gate", () => {
  it("allows only an operationally active tenant", () => {
    expect(tenantApiAccessError("active")).toBeNull();
  });

  it.each([
    ["onboarding", "organization_not_operationally_ready", 403],
    ["paused", "organization_paused", 423],
    ["suspended", "organization_suspended", 403],
    ["closed", "organization_closed", 410],
    ["archived", "organization_inactive", 410],
    ["pending_deletion", "organization_inactive", 410],
  ])("blocks %s tenants with a stable public error", (status, code, httpStatus) => {
    expect(tenantApiAccessError(status)).toMatchObject({
      code,
      status: httpStatus,
    });
  });

  it("fails closed when tenant status cannot be classified", () => {
    expect(tenantApiAccessError(undefined)).toMatchObject({
      code: "organization_status_unavailable",
      status: 503,
    });
  });
});
