import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
}));

vi.mock("@/lib/supabase/service", () => {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "or", "eq", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      state.calls.push([method, args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => ({ data: { id: "c1", name: "Bolag", slug: "bolag" }, error: null });
  return {
    supabaseService: {
      from: (table: string) => {
        state.calls.push(["from", [table]]);
        return builder;
      },
    },
  };
});

import { loadCompanyBySlug } from "@/lib/legal/publicLegalDocuments";

beforeEach(() => {
  state.calls = [];
});

describe("loadCompanyBySlug", () => {
  it.each([
    "x,id.neq.00000000-0000-0000-0000-000000000000",
    "a)",
    "bolag.eq.x",
    "bolag*",
    "bo lag",
    "",
  ])("rejects slug %j without querying", async (slug) => {
    await expect(loadCompanyBySlug(slug)).resolves.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("looks up a valid slug restricted to active companies", async () => {
    const company = await loadCompanyBySlug(" Bolag-1 ");
    expect(company?.name).toBe("Bolag");
    expect(state.calls).toContainEqual(["or", ["slug.eq.bolag-1,company_slug.eq.bolag-1"]]);
    expect(state.calls).toContainEqual(["eq", ["status", "active"]]);
  });
});
