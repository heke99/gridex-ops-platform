// inbound-review: A
// inbound-review: B
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  tenantConnections: [] as Array<Record<string, unknown>>,
  providerConnections: [] as Array<Record<string, unknown>>,
  writes: [] as string[],
}));

function chain(table: string) {
  const filters: Record<string, unknown> = {};
  let write = false;
  const result = () => {
    if (write) state.writes.push(table);
    if (table === "invoice_export_items") return { data: state.items, error: null };
    if (table === "billing_provider_connections") {
      return { data: "company_id" in filters ? state.tenantConnections : state.providerConnections, error: null };
    }
    return { data: { id: `${table}-row` }, error: null };
  };
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.limit = () => builder;
  builder.eq = (k: string, v: unknown) => {
    filters[k] = v;
    return builder;
  };
  builder.upsert = () => {
    write = true;
    return builder;
  };
  builder.maybeSingle = async () => result();
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return builder;
}

vi.mock("@/lib/supabase/service", () => ({ supabaseService: { from: (table: string) => chain(table) } }));
vi.mock("@/lib/platform/schemaReadiness", () => ({ assertPlatformSchemaReady: async () => undefined }));
vi.mock("@/lib/events/domainEvents", () => ({ emitDomainEvent: async () => undefined }));
vi.mock("@/lib/billing/providerEventProcessor", () => ({ processPendingInvoiceProviderEvents: async () => undefined }));

import { POST } from "@/app/api/webhooks/billing/[provider]/route";

const SECRET = "tenant-a-secret";
const ctx = { params: Promise.resolve({ provider: "capway" }) };
const body = JSON.stringify({ id: "evt-9", invoiceGuid: "guid-9", type: "paid" });
const twoTenants = [
  { id: "i1", company_id: "c-a", environment: "test" },
  { id: "i2", company_id: "c-b", environment: "test" },
];

function signed(secret: string) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "x-gridex-timestamp": String(ts), "x-gridex-signature": `sha256=${sig}` };
}
function post(headers: Record<string, string>) {
  return POST(
    new NextRequest("http://localhost/api/webhooks/billing/capway", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    }),
    ctx,
  );
}
async function snapshot(res: Response) {
  const json = await res.json();
  return { status: res.status, code: json.code, error: json.error };
}

beforeEach(() => {
  process.env.TENANT_A_SECRET = SECRET;
  state.writes = [];
  state.items = [{ id: "item-1", company_id: "c-a", environment: "test" }];
  state.tenantConnections = [{ id: "conn-a", secret_reference: { webhook_secret_env: "TENANT_A_SECRET" } }];
  state.providerConnections = [{ id: "conn-a", secret_reference: { webhook_secret_env: "TENANT_A_SECRET" } }];
});

describe("billing webhook: no routing oracle before signature (B)", () => {
  it("returns an identical 401 for unverifiable requests regardless of routing outcome", async () => {
    const forged = signed("attacker-secret");
    const routable = await snapshot(await post(forged));
    state.items = [];
    const unknown = await snapshot(await post(forged));
    state.items = twoTenants;
    const ambiguous = await snapshot(await post(forged));
    state.items = [{ id: "item-1", company_id: "c-a", environment: "test" }];
    state.tenantConnections = [];
    const noConnection = await snapshot(await post(forged));
    for (const s of [routable, unknown, ambiguous, noConnection]) {
      expect(s).toEqual({ status: 401, code: "billing_webhook_unauthorized", error: routable.error });
    }
    expect(state.writes).toEqual([]);
  });
});

describe("billing webhook: verified but unroutable events are retried (A)", () => {
  it("returns retryable 503 with Retry-After when the GUID is not stored yet", async () => {
    state.items = [];
    const res = await post(signed(SECRET));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(state.writes).toEqual([]);
  });

  it("returns retryable 503 when the tenant connection lacks a secret but the signature is genuine", async () => {
    state.tenantConnections = [{ id: "conn-a", secret_reference: {} }];
    const res = await post(signed(SECRET));
    expect(res.status).toBe(503);
  });

  it("returns retryable 409 for an ambiguous GUID with a genuine signature", async () => {
    state.items = twoTenants;
    const res = await post(signed(SECRET));
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("accepts a routable verified event", async () => {
    const res = await post(signed(SECRET));
    expect(res.status).toBe(200);
    expect(state.writes.length).toBeGreaterThan(0);
  });
});
