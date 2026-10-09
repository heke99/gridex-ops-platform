// inbound-review: C
// inbound-review: D
// inbound-review: E
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  item: {} as Row,
  events: [] as Row[],
  marks: [] as Row[],
  portal: [] as Row[],
  portalFail: false,
  itemWrites: 0,
  // Simulates a concurrent writer that commits right after our read.
  beforeFirstUpdate: null as null | (() => void),
}));

function itemsBuilder() {
  const filters: Array<[string, string, unknown]> = [];
  let patch: Row | null = null;
  const matches = () =>
    filters.every(([op, k, v]) => (op === "is" ? (db.item[k] ?? null) === v : db.item[k] === v));
  const run = () => {
    if (patch) {
      if (db.beforeFirstUpdate) {
        const hook = db.beforeFirstUpdate;
        db.beforeFirstUpdate = null;
        hook();
      }
      if (!matches()) return { data: null, error: null };
      db.item = { ...db.item, ...patch };
      db.itemWrites += 1;
      return { data: { id: db.item.id }, error: null };
    }
    return { data: matches() ? { ...db.item } : null, error: null };
  };
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.update = (p: Row) => {
    patch = p;
    return b;
  };
  b.eq = (k: string, v: unknown) => {
    filters.push(["eq", k, v]);
    return b;
  };
  b.is = (k: string, v: unknown) => {
    filters.push(["is", k, v]);
    return b;
  };
  b.maybeSingle = async () => run();
  return b;
}

function eventsBuilder() {
  let patch: Row | null = null;
  const b: Record<string, unknown> = {};
  b.update = (p: Row) => {
    patch = p;
    return b;
  };
  b.eq = () => b;
  b.select = () => b;
  b.maybeSingle = async () => {
    db.marks.push(patch ?? {});
    return { data: { id: "e" }, error: null };
  };
  return b;
}

function portalBuilder() {
  let row: Row | null = null;
  const b: Record<string, unknown> = {};
  b.upsert = (r: Row) => {
    row = r;
    return b;
  };
  b.select = () => b;
  b.maybeSingle = async () => {
    if (db.portalFail) return { data: null, error: new Error("portal down") };
    db.portal.push(row ?? {});
    return { data: { id: "p" }, error: null };
  };
  return b;
}

vi.mock("@/lib/supabase/service", () => ({
  supabaseService: {
    from: (table: string) =>
      table === "invoice_export_items" ? itemsBuilder() : table === "invoice_provider_events" ? eventsBuilder() : portalBuilder(),
    rpc: async () => ({ data: db.events.splice(0), error: null }),
  },
}));
vi.mock("@/lib/platform/schemaReadiness", () => ({ assertPlatformSchemaReady: async () => undefined }));
vi.mock("@/lib/events/domainEvents", () => ({ emitDomainEvent: async () => undefined }));

import {
  isAllowedProviderTransition,
  parseProviderTimestamp,
  processPendingInvoiceProviderEvents,
  retryReviewableInvoiceProviderEvents,
} from "@/lib/billing/providerEventProcessor";

const COMPANY = "c-1";
function event(id: string, type: string, payload: Row = {}): Row {
  return {
    id,
    company_id: COMPANY,
    matched_invoice_export_item_id: "item-1",
    provider: "capway",
    environment: "test",
    provider_invoice_guid: "guid-1",
    event_type: type,
    payload,
    received_at: "2026-10-01T08:00:00.000Z",
  };
}
async function run(...events: Row[]) {
  db.events = events;
  return processPendingInvoiceProviderEvents({ companyId: COMPANY });
}

beforeEach(() => {
  db.item = {
    id: "item-1",
    company_id: COMPANY,
    provider: "capway",
    environment: "test",
    provider_invoice_guid: "guid-1",
    provider_status: null,
    status: "sent",
    status_payload: {},
    customer_id: "cust-1",
    customer_contract_id: "cc-1",
  };
  db.marks = [];
  db.portal = [];
  db.portalFail = false;
  db.itemWrites = 0;
  db.beforeFirstUpdate = null;
});

describe("D: explicit provider-state transition table", () => {
  it("allows disputed -> paid after dispute resolution", async () => {
    db.item.provider_status = "disputed";
    await run(event("e1", "invoice.paid"));
    expect(db.item.provider_status).toBe("paid");
  });

  it("allows overdue -> partially_paid", async () => {
    db.item.provider_status = "overdue";
    await run(event("e1", "invoice.partially_paid"));
    expect(db.item.provider_status).toBe("partially_paid");
  });

  it("never regresses paid to overdue and keeps credited/cancelled terminal", () => {
    expect(isAllowedProviderTransition("paid", "overdue")).toBe(false);
    expect(isAllowedProviderTransition("paid", "unpaid")).toBe(false);
    expect(isAllowedProviderTransition("paid", "credited")).toBe(true);
    expect(isAllowedProviderTransition("credited", "paid")).toBe(false);
    expect(isAllowedProviderTransition("cancelled", "paid")).toBe(false);
    expect(isAllowedProviderTransition("collection", "overdue")).toBe(false);
  });

  it("ignores an event whose provider timestamp is older than the last applied one", async () => {
    db.item.provider_status = "unpaid";
    db.item.status_payload = { last_provider_event_occurred_at: "2026-10-05T10:00:00Z" };
    const result = await run(event("e1", "invoice.overdue", { occurred_at: "2026-10-04T10:00:00Z" }));
    expect(result.results[0].reason).toBe("stale_provider_state_ignored");
    expect(db.item.provider_status).toBe("unpaid");
  });
});

describe("C: concurrent paid/overdue cannot regress paid", () => {
  it("re-reads and re-evaluates when the row changed after the read", async () => {
    db.item.provider_status = "unpaid";
    db.beforeFirstUpdate = () => {
      db.item = { ...db.item, provider_status: "paid" };
    };
    const result = await run(event("e-overdue", "invoice.overdue"));
    expect(db.item.provider_status).toBe("paid");
    expect(result.results[0].reason).toBe("stale_provider_state_ignored");
  });
});

describe("E: paid_at validated before any write; retries complete", () => {
  it("parses offset ISO as-is and offset-less values as Europe/Stockholm local time", () => {
    expect(parseProviderTimestamp("2026-10-05T12:00:00+02:00")).toBe("2026-10-05T10:00:00.000Z");
    expect(parseProviderTimestamp("2026-10-05T12:00:00")).toBe("2026-10-05T10:00:00.000Z");
    expect(parseProviderTimestamp("2026-01-15 12:00")).toBe("2026-01-15T11:00:00.000Z");
    expect(parseProviderTimestamp("2026-10-05")).toBe("2026-10-04T22:00:00.000Z");
    expect(parseProviderTimestamp("05/10/2026")).toBeNull();
    expect(parseProviderTimestamp("2026-02-30T10:00:00Z")).toBeNull();
    expect(parseProviderTimestamp("2026-03-29T02:30:00")).toBeNull(); // DST gap
  });

  it("sends an unparsable paid_at to review without writing anything", async () => {
    db.item.provider_status = "unpaid";
    const result = await run(event("e1", "invoice.paid", { paid_at: "not-a-date" }));
    expect(result.results[0].reason).toBe("invalid_paid_at");
    expect(db.itemWrites).toBe(0);
    expect(db.portal).toEqual([]);
    expect(db.item.provider_status).toBe("unpaid");
  });

  it("stores the Stockholm-interpreted paid_at in the portal mirror", async () => {
    await run(event("e1", "invoice.paid", { paid_at: "2026-10-05T12:00:00" }));
    expect(db.portal[0].paid_at).toBe("2026-10-05T10:00:00.000Z");
  });

  it("completes the portal mirror on retry after a mirror failure", async () => {
    db.item.provider_status = "unpaid";
    db.portalFail = true;
    const first = await run(event("e1", "invoice.paid", { paid_at: "2026-10-05T10:00:00Z" }));
    expect(first.failed).toBe(1);
    expect(db.item.provider_status).toBe("paid");
    db.portalFail = false;
    db.events = [event("e1", "invoice.paid", { paid_at: "2026-10-05T10:00:00Z" })];
    const retry = await retryReviewableInvoiceProviderEvents({ companyId: COMPANY });
    expect(retry.processed).toBe(1);
    expect(db.portal).toHaveLength(1);
    expect(db.portal[0].status).toBe("paid");
  });
});
