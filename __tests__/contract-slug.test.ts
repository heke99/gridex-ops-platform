import { describe, expect, it } from "vitest";

import { slugifyContract } from "@/lib/contracts/slug";

describe("slugifyContract", () => {
  it("transliterates Swedish contract names", () => {
    expect(slugifyContract("Gridex Månad")).toBe("gridex-manad");
    expect(slugifyContract("ÅÄÖ El")).toBe("aao-el");
  });

  it("normalizes separators without making slug an identity", () => {
    expect(slugifyContract("  Rörligt / Kvartspris  ")).toBe("rorligt-kvartspris");
    expect(slugifyContract("---")).toBe("");
  });
});
