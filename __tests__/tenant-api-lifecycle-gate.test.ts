import { describe, expect, it } from "vitest";
import { tenantApiAccessError } from "@/lib/integrations/apiAuth";

describe("central tenant API lifecycle gate", () => {
  it("allows only an operationally active tenant", () => {
    expect(tenantApiAccessError("active")).toBeNull();
  });

  it.each([
    ["onboarding", "tenant_not_operationally_ready", 403],
    ["paused", "tenant_paused", 423],
    ["suspended", "tenant_suspended", 403],
    ["closed", "tenant_closed", 410],
    ["archived", "tenant_inactive", 410],
    ["pending_deletion", "tenant_inactive", 410],
  ])("blocks %s tenants with a stable public error", (status, code, httpStatus) => {
    expect(tenantApiAccessError(status)).toMatchObject({
      code,
      status: httpStatus,
    });
  });

  it("fails closed when tenant status cannot be classified", () => {
    expect(tenantApiAccessError(undefined)).toMatchObject({
      code: "tenant_status_unavailable",
      status: 503,
    });
  });
});
