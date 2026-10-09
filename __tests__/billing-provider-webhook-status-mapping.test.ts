import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fromCalls: [] as string[],
  items: [] as Array<Record<string, unknown>>,
  connections: [] as Array<Record<string, unknown>>,
}));

function chain(table: string) {
  const result = () => {
    if (table === "invoice_export_items") return { data: state.items, error: null };
    if (table === "billing_provider_connections") return { data: state.connections, error: null };
    return { data: { id: `${table}-row` }, error: null };
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "limit", "upsert"]) builder[method] = () => builder;
  builder.maybeSingle = async () => result();
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: {
    from: (table: string) => {
      state.fromCalls.push(table);
      return chain(table);
    },
  },
}));
vi.mock("@/lib/platform/schemaReadiness", () => ({ assertPlatformSchemaReady: async () => undefined }));
vi.mock("@/lib/events/domainEvents", () => ({ emitDomainEvent: async () => undefined }));
vi.mock("@/lib/billing/providerEventProcessor", () => ({ processPendingInvoiceProviderEvents: async () => undefined }));

import { POST } from "@/app/api/webhooks/billing/[provider]/route";

const SECRET = "test-webhook-secret";
const COMPANY = "11111111-1111-4111-8111-111111111111";

function request(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/webhooks/billing/capway", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

function signed(body: string, secret = SECRET) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "x-gridex-timestamp": String(ts), "x-gridex-signature": `sha256=${sig}` };
}

const ctx = { params: Promise.resolve({ provider: "capway" }) };
const validBody = JSON.stringify({ id: "evt-1", invoiceGuid: "guid-1", type: "paid" });

beforeEach(() => {
  state.fromCalls = [];
  state.items = [{ id: "item-1", company_id: COMPANY, environment: "test" }];
  state.connections = [{ id: "conn-1", secret_reference: { webhook_secret_env: "TEST_BILLING_WEBHOOK_SECRET" } }];
  process.env.TEST_BILLING_WEBHOOK_SECRET = SECRET;
});

describe("billing provider webhook status mapping", () => {
  it("rejects invalid JSON with 400", async () => {
    const res = await POST(request("{not json", signed("{not json")), ctx);
    expect(res.status).toBe(400);
  });

  it("rejects missing invoiceGuid with 400", async () => {
    const body = JSON.stringify({ id: "evt-1" });
    const res = await POST(request(body, signed(body)), ctx);
    expect(res.status).toBe(400);
  });

  it("rejects malformed signature with 401 before any database lookup", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(request(validBody, { "x-gridex-timestamp": ts, "x-gridex-signature": "garbage" }), ctx);
    expect(res.status).toBe(401);
    expect(state.fromCalls).toEqual([]);
  });

  it("rejects missing timestamp with 401 before any database lookup", async () => {
    const res = await POST(request(validBody, { "x-gridex-signature": "a".repeat(64) }), ctx);
    expect(res.status).toBe(401);
    expect(state.fromCalls).toEqual([]);
  });

  it("rejects wrong signature with 401", async () => {
    const res = await POST(request(validBody, signed(validBody, "other-secret")), ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown invoice GUID", async () => {
    state.items = [];
    const res = await POST(request(validBody, signed(validBody)), ctx);
    expect(res.status).toBe(404);
  });

  it("returns 422 when the tenant connection has no webhook secret", async () => {
    delete process.env.TEST_BILLING_WEBHOOK_SECRET;
    const res = await POST(request(validBody, signed(validBody)), ctx);
    expect(res.status).toBe(422);
  });

  it("accepts a valid webhook without leaking the internal company id", async () => {
    const res = await POST(request(validBody, signed(validBody)), ctx);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(COMPANY);
    expect(JSON.parse(text).data).not.toHaveProperty("companyId");
  });
});
