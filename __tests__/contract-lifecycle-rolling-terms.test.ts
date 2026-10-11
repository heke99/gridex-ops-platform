import { afterEach, describe, expect, it, vi } from "vitest";
import { getContractLifecycleSummary } from "@/lib/customer-contracts/lifecycle";

const monthlyFromMonthEnd = {
  startsAt: "2026-01-31",
  autoRenewEnabled: true,
  autoRenewTermMonths: 1,
  status: "active" as const,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("rolling contract terms are anchored to the start date", () => {
  it("does not drift after a month-end clamp", () => {
    const summary = getContractLifecycleSummary(monthlyFromMonthEnd, "2026-06-15");
    expect(summary.currentTermStart).toBe("2026-05-31");
    expect(summary.currentTermEnd).toBe("2026-06-30");
    expect(summary.nextRenewalDate).toBe("2026-06-30");
  });

  it("keeps the clamped February boundary in the first term", () => {
    const summary = getContractLifecycleSummary(monthlyFromMonthEnd, "2026-02-10");
    expect(summary.currentTermStart).toBe("2026-01-31");
    expect(summary.currentTermEnd).toBe("2026-02-28");
  });

  it("moves to the next term exactly on the boundary", () => {
    const summary = getContractLifecycleSummary(monthlyFromMonthEnd, "2026-03-31");
    expect(summary.currentTermStart).toBe("2026-03-31");
    expect(summary.currentTermEnd).toBe("2026-04-30");
  });

  it("uses the Stockholm calendar date as the default reference date", () => {
    vi.useFakeTimers();
    // 2026-06-29 22:30Z is already 2026-06-30 00:30 in Stockholm.
    vi.setSystemTime(new Date("2026-06-29T22:30:00.000Z"));
    const summary = getContractLifecycleSummary(monthlyFromMonthEnd);
    expect(summary.currentTermStart).toBe("2026-06-30");
    expect(summary.currentTermEnd).toBe("2026-07-31");
  });
});
