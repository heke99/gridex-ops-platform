import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

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

describe("canonical_onboard_customer_graph: one-off contracts keep pending_signature", () => {
  const body = functionBody("canonical_onboard_customer_graph");

  it("no longer downgrades a requested one-off pending_signature to draft", () => {
    expect(body).not.toContain("not v_has_catalog_offer and v_status = 'pending_signature'");
    expect(body).not.toContain("'\"draft\"'::jsonb");
  });

  it("still routes signed-document intake through the evidence import", () => {
    expect(body).toContain("v_has_signed_document and v_status in ('signed', 'active')");
    expect(body).toContain("case when v_has_catalog_offer then 'pending_signature' else 'draft' end");
  });

  it("preserves the ediel object-batch branch and grants", () => {
    expect(body).toContain("return gridex_prodat_object_batch.onboard_v1(v_command);");
    expect(body).toContain("return public.gridex_onboard_customer_graph(v_command);");
    expect(migration).toContain(
      "grant execute on function public.canonical_onboard_customer_graph(jsonb) to service_role;",
    );
  });
});
