import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer-contracts/onlineSigning", () => ({
  sendOnlineContractSignatureRequest: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: {} }));

import {
  SIGNING_LINK_FAILED_MESSAGE,
  SIGNING_LINK_NO_EMAIL_MESSAGE,
  autoSendSigningLinkAfterCreate,
  type AutoSendSigningLinkDeps,
} from "@/lib/customer-contracts/autoSendSigningLink";

const input = {
  companyId: "company-1",
  customerId: "customer-1",
  contractId: "contract-1",
  actorUserId: "user-1",
  actorCanWriteContracts: true,
};

function deps(overrides: Partial<AutoSendSigningLinkDeps> = {}) {
  return {
    loadContract: vi.fn(async () => ({ status: "pending_signature", signed_at: null })),
    loadCustomerEmail: vi.fn(async () => " Kund@Example.se "),
    hasActiveSignatureRequest: vi.fn(async () => false),
    send: vi.fn(async () => ({}) as never),
    logError: vi.fn(),
    ...overrides,
  } satisfies AutoSendSigningLinkDeps;
}

describe("autoSendSigningLinkAfterCreate", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("sends to the customer email in the contract's company when pending and email exists", async () => {
    const result = await autoSendSigningLinkAfterCreate(input, d);
    expect(result).toEqual({
      status: "sent",
      email: "kund@example.se",
      message: "Signeringslänk skickad till kund@example.se",
    });
    expect(d.send).toHaveBeenCalledWith({
      companyId: "company-1",
      customerId: "customer-1",
      contractId: "contract-1",
      recipientEmail: "kund@example.se",
      actorUserId: "user-1",
      channel: "internal",
    });
    expect(d.hasActiveSignatureRequest).toHaveBeenCalledWith(input);
  });

  it("skips with a manual notice when the customer has no valid email", async () => {
    for (const email of [null, "", "not-an-email"]) {
      d = deps({ loadCustomerEmail: vi.fn(async () => email) });
      const result = await autoSendSigningLinkAfterCreate(input, d);
      expect(result).toEqual({ status: "skipped", reason: "no_email", message: SIGNING_LINK_NO_EMAIL_MESSAGE });
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("skips contracts that are not pending_signature", async () => {
    for (const contract of [
      { status: "active", signed_at: null },
      { status: "pending_signature", signed_at: "2026-10-01T00:00:00Z" },
    ]) {
      d = deps({ loadContract: vi.fn(async () => contract) });
      const result = await autoSendSigningLinkAfterCreate(input, d);
      expect(result).toMatchObject({ status: "skipped", reason: "not_pending", message: null });
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("swallows send errors, logs them and returns a failure result", async () => {
    d = deps({ send: vi.fn(async () => { throw new Error("email_queue_down"); }) });
    const result = await autoSendSigningLinkAfterCreate(input, d);
    expect(result).toEqual({ status: "failed", error: "email_queue_down", message: SIGNING_LINK_FAILED_MESSAGE });
    expect(d.logError).toHaveBeenCalledTimes(1);
  });

  it("skips when an active unexpired signature request already exists (idempotent replay)", async () => {
    d = deps({ hasActiveSignatureRequest: vi.fn(async () => true) });
    const result = await autoSendSigningLinkAfterCreate(input, d);
    expect(result).toMatchObject({ status: "skipped", reason: "active_request_exists" });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("does not send when the actor lacks contracts.write", async () => {
    const result = await autoSendSigningLinkAfterCreate({ ...input, actorCanWriteContracts: false }, d);
    expect(result).toMatchObject({ status: "skipped", reason: "not_permitted" });
    expect(d.send).not.toHaveBeenCalled();
  });
});
