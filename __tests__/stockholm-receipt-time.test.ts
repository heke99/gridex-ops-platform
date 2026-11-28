import { describe, expect, it } from "vitest";
import { stockholmDateTimeInputToUtc, stockholmDateTimeInputValue } from "@/lib/time/stockholm";

describe("Stockholm receipt time", () => {
  it.each([
    ["2026-07-01T12:00", "2026-07-01T10:00:00.000Z"],
    ["2026-12-01T12:00", "2026-12-01T11:00:00.000Z"],
    ["2026-07-02T00:30", "2026-07-01T22:30:00.000Z"],
  ])("round-trips %s through the corresponding instant", (civil, instant) => {
    expect(stockholmDateTimeInputValue(new Date(instant))).toBe(civil);
    expect(stockholmDateTimeInputToUtc(civil, null)).toBe(instant);
  });

  it("rejects a missing spring time and an invalid calendar date", () => {
    expect(() => stockholmDateTimeInputToUtc("2026-03-29T02:30", null)).toThrow("finns inte");
    expect(() => stockholmDateTimeInputToUtc("2026-02-29T12:00", null)).toThrow("kalenderdatum");
  });

  it("requires the operator to distinguish the two occurrences of a repeated autumn time", () => {
    const civil = "2026-10-25T02:30";
    expect(() => stockholmDateTimeInputToUtc(civil, null)).toThrow("inträffar två gånger");
    expect(stockholmDateTimeInputToUtc(civil, "120")).toBe("2026-10-25T00:30:00.000Z");
    expect(stockholmDateTimeInputToUtc(civil, "60")).toBe("2026-10-25T01:30:00.000Z");
    expect(() => stockholmDateTimeInputToUtc("2026-07-01T12:00", "60")).toThrow("gäller inte");
  });
});
