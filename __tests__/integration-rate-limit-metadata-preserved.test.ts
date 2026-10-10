import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ clientUpdates: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/platform/schemaReadiness", () => ({ assertPlatformSchemaReady: async () => undefined }));
vi.mock("@/lib/supabase/service", () => {
  const ok = { data: null, error: null };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    b.insert = () => Promise.resolve(ok);
    b.update = (payload: Record<string, unknown>) => {
      if (table === "integration_api_clients") state.clientUpdates.push(payload);
      return b;
    };
    b.eq = () => b;
    b.then = (resolve: (value: unknown) => unknown) => Promise.resolve(ok).then(resolve);
    return b;
  };
  return {
    supabaseService: {
      from: builder,
      rpc: async () => ({
        data: [{
          auth_outcome: "rate_limited",
          error_code: "rate_limited",
          tenant_status: "active",
          client_id: "22222222-2222-4222-8222-222222222222",
          company_id: "11111111-1111-4111-8111-111111111111",
          client_name: "c",
          client_status: "active",
          key_prefix: "gx_live_abcd",
          secret_hash: "x",
          scopes: [],
          allowed_ips: [],
          allowed_origins: [],
          metadata: { lifecycle_status: "active", owner_note: "stale snapshot" },
          rate_limit_per_minute: 60,
          expires_at: null,
          route_limit: 60,
          request_count: 61,
          reset_at: new Date(Date.now() + 30_000).toISOString(),
        }],
        error: null,
      }),
    },
  };
});

import { requireIntegrationApiAccess } from "@/lib/integrations/apiAuth";

describe("rate-limit bookkeeping does not overwrite client metadata", () => {
  it("updates only scalar columns when a client is rate limited", async () => {
    const request = new NextRequest("http://localhost/api/v1/customers", {
      headers: { authorization: "Bearer gx_live_abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    const result = await requireIntegrationApiAccess(request, ["customers:read"]);
    expect(result.ok).toBe(false);
    expect(state.clientUpdates.length).toBe(1);
    expect(state.clientUpdates[0]).toHaveProperty("rate_limited_until");
    expect(state.clientUpdates[0]).not.toHaveProperty("metadata");
  });
});
