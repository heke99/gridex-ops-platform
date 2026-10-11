import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => ({}) }));
vi.mock("@/lib/email/emailEvents", () => ({ triggerEmailEvent: vi.fn() }));

import { stockholmWithdrawalDeadlineDate } from "@/lib/time/stockholm";
import { eventVariables } from "@/lib/website/customerApplicationCommunication";

// Stored value mirrors the DB: accepted_at + interval '14 days' (UTC).
function stored(acceptedAtIso: string) {
  return new Date(new Date(acceptedAtIso).getTime() + 14 * 86_400_000).toISOString();
}

describe("cooling-off deadline is shown as end of Stockholm signing date + 14 days", () => {
  it("signed 2026-10-09 00:30 Stockholm (2026-10-08 22:30Z) ends 2026-10-23", () => {
    const acceptedAt = "2026-10-08T22:30:00.000Z";
    expect(stockholmWithdrawalDeadlineDate({ acceptedAt })).toBe("2026-10-23");
    expect(stockholmWithdrawalDeadlineDate({ storedDeadlineAt: stored(acceptedAt) })).toBe("2026-10-23");
  });

  it("is correct across the October DST change", () => {
    // 2026-10-20 00:30 CEST, deadline period crosses 2026-10-25 DST end.
    const acceptedAt = "2026-10-19T22:30:00.000Z";
    expect(stockholmWithdrawalDeadlineDate({ storedDeadlineAt: stored(acceptedAt) })).toBe("2026-11-03");
  });

  it("returns null for missing or invalid values", () => {
    expect(stockholmWithdrawalDeadlineDate({ storedDeadlineAt: null })).toBeNull();
    expect(stockholmWithdrawalDeadlineDate({ storedDeadlineAt: "nope" })).toBeNull();
  });

  it("website application email variables use the Stockholm deadline", () => {
    const vars = eventVariables({
      companyName: "Bolag",
      customer: { full_name: "Test Person" } as never,
      customerNumber: "1",
      withdrawalDeadline: stored("2026-10-08T22:30:00.000Z"),
    });
    expect(vars.cancellation_deadline).toBe("2026-10-23");
  });
});
