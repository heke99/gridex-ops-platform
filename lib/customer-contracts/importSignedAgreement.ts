import { tenantInsert } from '@/lib/supabase/tenantQuery'
import "server-only";

import { createHash } from "node:crypto";

import { signedAgreementDocumentTiming } from "@/lib/customer-contracts/signingMethod";
import type { CustomerAuthorizationDocumentRow } from "@/lib/operations/types";
import { supabaseService } from "@/lib/supabase/service";

/**
 * Uploads an already-signed agreement PDF for an existing (draft or
 * pending_signature) contract and records it as a `complete_agreement`
 * authorization document. The insert fires the canonical DB import command
 * (gridex_finalize_admin_imported_signed_agreement_v1), which verifies the PDF
 * evidence, records the signature snapshot and moves the contract to `signed`
 * with signed_at = the staff-declared signing date (metadata.declaredSignedDate;
 * import time when absent). uploaded_at is the real upload time. Same bucket,
 * table and metadata contract as the admin customer intake upload.
 */

const BUCKET = "customer-documents";

/**
 * Records an uploaded, already-signed agreement as the `complete_agreement`
 * document that fires the canonical import trigger. The trigger records the
 * contract's signed event through gridex_record_customer_contract_event_v1,
 * which only the service role may call, so the row is written with the
 * service role and an explicit acting employee: the trigger asserts that
 * employee's contracts.create right and the tenant/customer/contract chain
 * (FINDINGS F61). Shared by the customer intake and the customer card.
 */
export async function recordSignedAgreementDocument(input: {
  companyId: string;
  customerId: string;
  contractId: string;
  siteId: string | null;
  meteringPointId: string | null;
  actorUserId: string;
  filePath: string;
  checksum: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  title: string;
  notes: string;
  /** Staff-declared signing date (YYYY-MM-DD); null = import time. */
  declaredSignedDate: string | null;
  channel?: string;
}): Promise<CustomerAuthorizationDocumentRow> {
  const timing = signedAgreementDocumentTiming({ declaredSignedDate: input.declaredSignedDate });
  const { data, error } = await tenantInsert(input.companyId, "customer_authorization_documents", {
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.siteId,
      metering_point_id: input.meteringPointId,
      customer_contract_id: input.contractId,
      document_type: "complete_agreement",
      status: "active",
      title: input.title,
      file_name: input.fileName,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      storage_bucket: BUCKET,
      file_path: input.filePath,
      file_checksum: input.checksum,
      reference: `CONTRACT-${input.contractId.slice(0, 8)}`,
      notes: input.notes,
      // Real upload time; the canonical import uses metadata.declaredSignedDate
      // as the signing date and records the import time separately.
      uploaded_at: timing.uploaded_at,
      metadata: {
        // Required by the canonical import trigger.
        source: "customer_intake",
        documentRole: "signed_agreement",
        ...(input.channel ? { channel: input.channel } : {}),
        ...timing.metadata,
      },
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CustomerAuthorizationDocumentRow;
}

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
  actorUserId: string;
  file: File;
  /** Staff-declared signing date (YYYY-MM-DD); null = import time. */
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
    const document = await recordSignedAgreementDocument({
      companyId: input.companyId,
      customerId: input.customerId,
      contractId: input.contractId,
      siteId: input.siteId,
      meteringPointId: input.meteringPointId,
      actorUserId: input.actorUserId,
      filePath,
      checksum,
      fileName: input.file.name || null,
      mimeType: "application/pdf",
      fileSizeBytes: input.file.size || null,
      title: "Signerat avtal uppladdat på kundkortet",
      notes: "Signerat avtal uppladdat när avtalet skapades.",
      declaredSignedDate: input.declaredSignedDate,
      channel: "admin_contract_create",
    });
    return { documentId: document.id };
  } catch (error) {
    // No orphaned object when the canonical import rejects the document.
    await supabaseService.storage.from(BUCKET).remove([filePath]).catch(() => undefined);
    throw error;
  }
}
