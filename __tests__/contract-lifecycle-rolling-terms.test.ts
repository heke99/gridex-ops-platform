import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveContractEndsAt, getContractLifecycleSummary } from "@/lib/customer-contracts/lifecycle";

const monthlyFromMonthEnd = {
  startsAt: "2026-01-31",
  autoRenewEnabled: true,
  autoRenewTermMonths: 1,
  status: "active" as const,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("termination notice follows the Swedish day of receipt", () => {
  it.each([
    ["2026-01-31T22:59:59.999Z", "2026-02-28"],
    ["2026-01-31T23:00:00.000Z", "2026-03-01"],
    ["2026-01-31T23:00:00.001Z", "2026-03-01"],
    ["2026-02-01T00:00:00+01:00", "2026-03-01"],
    ["2026-02-01", "2026-03-01"],
  ])("records the local one-month period for %s", (terminationNoticeDate, expected) => {
    const input = { terminationNoticeDate, noticeMonths: 1, status: "active" as const };
    expect(deriveContractEndsAt(input)).toBe(expected);
    expect(getContractLifecycleSummary(input, "2026-02-15")).toMatchObject({
      noticeEffectiveEndDate: expected,
      terminationPending: true,
    });
  });
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
