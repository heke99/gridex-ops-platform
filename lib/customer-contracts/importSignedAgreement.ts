import "server-only";

import { createHash } from "node:crypto";

import { saveCustomerAuthorizationDocument } from "@/lib/operations/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

/**
 * Uploads an already-signed agreement PDF for an existing (draft or
 * pending_signature) contract and records it as a `complete_agreement`
 * authorization document. The insert fires the canonical DB import command
 * (gridex_finalize_admin_imported_signed_agreement_v1), which verifies the PDF
 * evidence, records the signature snapshot and moves the contract to `signed`
 * with signed_at = uploaded_at. Same bucket, table and metadata contract as
 * the admin customer intake upload.
 */

const BUCKET = "customer-documents";

function sanitizeFileName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "document.pdf"
  );
}

export async function importSignedAgreementForContract(input: {
  companyId: string;
  customerId: string;
  contractId: string;
  siteId: string | null;
  meteringPointId: string | null;
  file: File;
  /** Acceptance time; null = import time. */
  signedAtIso: string | null;
  declaredSignedDate: string | null;
}): Promise<{ documentId: string }> {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scope = input.siteId ? `site-${input.siteId}` : "customer";
  const filePath = `${input.customerId}/${scope}/complete_agreement/${stamp}_${sanitizeFileName(input.file.name || "avtal.pdf")}`;

  const upload = await supabaseService.storage.from(BUCKET).upload(filePath, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw upload.error;

  try {
    const supabase = await createSupabaseServerClient();
    const document = await saveCustomerAuthorizationDocument(supabase, {
      companyId: input.companyId,
      customer_id: input.customerId,
      site_id: input.siteId,
      metering_point_id: input.meteringPointId,
      customer_contract_id: input.contractId,
      document_type: "complete_agreement",
      status: "active",
      title: "Signerat avtal uppladdat på kundkortet",
      file_name: input.file.name || null,
      mime_type: "application/pdf",
      file_size_bytes: input.file.size || null,
      storage_bucket: BUCKET,
      file_path: filePath,
      file_checksum: checksum,
      reference: `CONTRACT-${input.contractId.slice(0, 8)}`,
      notes: "Signerat avtal uppladdat när avtalet skapades.",
      uploaded_at: input.signedAtIso,
      metadata: {
        // Required by the canonical import trigger.
        source: "customer_intake",
        documentRole: "signed_agreement",
        channel: "admin_contract_create",
        ...(input.declaredSignedDate ? { declaredSignedDate: input.declaredSignedDate } : {}),
      },
    });
    return { documentId: document.id };
  } catch (error) {
    // No orphaned object when the canonical import rejects the document.
    await supabaseService.storage.from(BUCKET).remove([filePath]).catch(() => undefined);
    throw error;
  }
}
