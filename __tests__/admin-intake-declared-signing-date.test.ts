import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer-contracts/onlineSigning", () => ({
  sendOnlineContractSignatureRequest: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: {} }));

import {
  autoSendSigningLinkAfterCreate,
  type AutoSendSigningLinkDeps,
} from "@/lib/customer-contracts/autoSendSigningLink";

import { signedAgreementDocumentTiming } from "@/lib/customer-contracts/signingMethod";

const migration = readFileSync(
  resolve(
    __dirname,
    "../supabase/migrations/20261010200000_admin_intake_declared_signing_date_and_one_off_pending_signature.sql",
  ),
  "utf8",
);

function functionBody(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("$function$;", start);
  return migration.slice(start, end);
}

describe("signedAgreementDocumentTiming", () => {
  const now = new Date("2026-10-10T08:15:00.000Z");

  it("uses the real upload time and carries the declared signing date in metadata", () => {
    expect(signedAgreementDocumentTiming({ declaredSignedDate: "2026-09-01", now })).toEqual({
      uploaded_at: "2026-10-10T08:15:00.000Z",
      metadata: { declaredSignedDate: "2026-09-01" },
    });
  });

  it("omits the declared date when absent so the import falls back to import time", () => {
    expect(signedAgreementDocumentTiming({ declaredSignedDate: null, now })).toEqual({
      uploaded_at: "2026-10-10T08:15:00.000Z",
      metadata: {},
    });
    expect(signedAgreementDocumentTiming({ declaredSignedDate: "  ", now }).metadata).toEqual({});
  });
});

describe("admin signed agreement import: staff-declared signing date", () => {
  const body = functionBody("gridex_finalize_admin_imported_signed_agreement_v1");

  it("keeps the trigger signature, security and search_path", () => {
    expect(body).toContain("returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, private, extensions, pg_catalog, pg_temp");
    expect(migration).toContain(
      "revoke all on function public.gridex_finalize_admin_imported_signed_agreement_v1() from authenticated",
    );
  });

  it("validates the declared date: ISO date, not before 2000-01-01, not in the future", () => {
    expect(body).toContain("new.metadata->>'declaredSignedDate'");
    expect(body).toContain("'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(body).toContain("v_declared_signed_date < date '2000-01-01'");
    expect(body).toContain("v_declared_signed_date > (v_imported_at at time zone 'Europe/Stockholm')::date");
    expect(body).toContain("admin_signed_contract_import_declared_signed_date_invalid");
    expect(body).toContain("admin_signed_contract_import_declared_signed_date_out_of_range");
  });

  it("uses the declared date as signed_at and original signature timestamp, import time separately", () => {
    expect(body).toContain("v_original_signature_timestamp := v_accepted_at;");
    expect(body).toContain("'staff_declared_signing_date_from_uploaded_signed_agreement'");
    expect(body).toContain("signed_at = v_accepted_at");
    expect(body).toContain("'imported_at', v_imported_at");
    expect(body).not.toContain("'original_signature_timestamp', null");
  });

  it("falls back to the previous import-time semantics without a declared date", () => {
    expect(body).toContain("v_accepted_at := coalesce(new.uploaded_at, v_imported_at);");
    expect(body).toContain(
      "v_timestamp_semantics text := 'administrative_import_time_original_signature_time_not_supplied'",
    );
  });
});

describe("migration scope", () => {
  it("leaves canonical_onboard_customer_graph unchanged (one-off contracts stay draft at INSERT)", () => {
    expect(migration).not.toContain("create or replace function public.canonical_onboard_customer_graph(");
  });
});

describe("autoSendSigningLinkAfterCreate: draft one-off contracts", () => {
  const input = {
    companyId: "company-1",
    customerId: "customer-1",
    contractId: "contract-1",
    actorUserId: "user-1",
    actorCanWriteContracts: true,
  };

  function deps() {
    return {
      loadContract: vi.fn(async () => ({ status: "draft", signed_at: null })),
      loadCustomerEmail: vi.fn(async () => "kund@example.se"),
      hasActiveSignatureRequest: vi.fn(async () => false),
      send: vi.fn(async () => undefined) as unknown as AutoSendSigningLinkDeps["send"],
      logError: vi.fn(),
    } satisfies AutoSendSigningLinkDeps;
  }

  it("sends for a draft contract when send-for-signing was explicitly requested", async () => {
    const d = deps();
    const result = await autoSendSigningLinkAfterCreate({ ...input, allowDraftWhenRequested: true }, d);
    expect(result).toMatchObject({ status: "sent", email: "kund@example.se" });
    expect(d.send).toHaveBeenCalledWith({
      companyId: "company-1",
      customerId: "customer-1",
      contractId: "contract-1",
      recipientEmail: "kund@example.se",
      actorUserId: "user-1",
      channel: "internal",
    });
  });

  it("skips a draft contract without the explicit option", async () => {
    const d = deps();
    const result = await autoSendSigningLinkAfterCreate(input, d);
    expect(result).toEqual({ status: "skipped", reason: "not_pending", message: null });
    expect(d.send).not.toHaveBeenCalled();
  });
});
