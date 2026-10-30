import "server-only";

import { createHash } from "node:crypto";

import { signedAgreementDocumentTiming } from "@/lib/customer-contracts/signingMethod";
import { saveCustomerAuthorizationDocument } from "@/lib/operations/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  try {
    supabase = await createSupabaseServerClient();
    const timing = signedAgreementDocumentTiming({ declaredSignedDate: input.declaredSignedDate });
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
      uploaded_at: timing.uploaded_at,
      metadata: {
        // Required by the canonical import trigger.
        source: "customer_intake",
        documentRole: "signed_agreement",
        channel: "admin_contract_create",
        ...timing.metadata,
      },
    });
    return { documentId: document.id };
  } catch (error) {
    // A lost response does not establish rollback. Never delete a potentially
    // authoritative original or replay the write. Read back on the real staff
    // client; RLS/transport/partial evidence failures remain unconfirmed.
    if (supabase) {
      try {
        const document = await supabase.from("customer_authorization_documents")
          .select("id,company_id,customer_id,customer_contract_id,site_id,metering_point_id,document_type,status,storage_bucket,file_path,file_checksum,mime_type,metadata")
          .eq("company_id", input.companyId).eq("customer_id", input.customerId)
          .eq("customer_contract_id", input.contractId).eq("storage_bucket", BUCKET)
          .eq("file_path", filePath).eq("file_checksum", checksum).maybeSingle();
        const d = document.data;
        const metadata = d?.metadata && typeof d.metadata === "object" && !Array.isArray(d.metadata)
          ? d.metadata as Record<string, unknown> : {};
        if (document.error || !d || d.company_id !== input.companyId || d.customer_id !== input.customerId
          || d.customer_contract_id !== input.contractId || (d.site_id ?? null) !== input.siteId
          || (d.metering_point_id ?? null) !== input.meteringPointId || d.document_type !== "complete_agreement"
          || d.status !== "active" || d.storage_bucket !== BUCKET || d.file_path !== filePath
          || d.file_checksum !== checksum || d.mime_type !== "application/pdf"
          || metadata.source !== "customer_intake" || metadata.documentRole !== "signed_agreement") throw error;
        const contract = await supabase.from("customer_contracts")
          .select("id,company_id,customer_id,status,signed_at,document_sha256,signature_snapshot,signature_snapshot_sha256,contract_price_snapshot_id,contract_product_version_id,contract_publication_version_id,price_plan_version_id,legal_bundle_version_id")
          .eq("id", input.contractId).eq("company_id", input.companyId).eq("customer_id", input.customerId).maybeSingle();
        const c = contract.data;
        const signature = c?.signature_snapshot && typeof c.signature_snapshot === "object" && !Array.isArray(c.signature_snapshot)
          ? c.signature_snapshot as Record<string, unknown> : {};
        if (contract.error || !c || c.id !== input.contractId || c.company_id !== input.companyId
          || c.customer_id !== input.customerId || !["signed", "active", "terminated", "cancelled", "expired"].includes(c.status ?? "")
          || !c.signed_at || c.document_sha256 !== checksum || !/^[0-9a-f]{64}$/.test(c.signature_snapshot_sha256 ?? "")
          || !c.contract_price_snapshot_id || signature.source_authorization_document_id !== d.id
          || signature.signed_document_sha256 !== checksum || signature.contract_price_snapshot_id !== c.contract_price_snapshot_id
          || signature.signing_method !== "imported_signed_document" || signature.schema !== "gridex_imported_signed_contract_v1"
          || signature.company_id !== input.companyId || signature.customer_id !== input.customerId || signature.contract_id !== input.contractId
          || !c.contract_product_version_id || signature.contract_product_version_id !== c.contract_product_version_id
          || !c.contract_publication_version_id || signature.contract_publication_version_id !== c.contract_publication_version_id
          || !c.price_plan_version_id || signature.price_plan_version_id !== c.price_plan_version_id
          || !c.legal_bundle_version_id || signature.legal_bundle_version_id !== c.legal_bundle_version_id
          || typeof signature.signed_contract_document_id !== "string") throw error;
        const pricing = await supabase.from("contract_price_snapshots")
          .select("id,company_id,customer_id,contract_id,price_plan_version_id,snapshot_hash,snapshot_quality")
          .eq("id", c.contract_price_snapshot_id).eq("company_id", input.companyId).eq("customer_id", input.customerId)
          .eq("contract_id", input.contractId).eq("price_plan_version_id", c.price_plan_version_id).maybeSingle();
        const price = pricing.data;
        if (pricing.error || !price || price.id !== c.contract_price_snapshot_id || price.company_id !== input.companyId
          || price.customer_id !== input.customerId || price.contract_id !== input.contractId || price.price_plan_version_id !== c.price_plan_version_id
          || price.snapshot_quality !== "canonical" || !/^[0-9a-f]{64}$/.test(price.snapshot_hash ?? "")
          || signature.pricing_snapshot_sha256 !== price.snapshot_hash) throw error;
        const original = await supabase.from("customer_contract_documents")
          .select("id,company_id,customer_contract_id,document_type,storage_bucket,storage_path,document_sha256,verified_at")
          .eq("id", signature.signed_contract_document_id).eq("company_id", input.companyId)
          .eq("customer_contract_id", input.contractId).eq("document_type", "signed_contract_pdf")
          .eq("storage_bucket", BUCKET).eq("storage_path", filePath).eq("document_sha256", checksum).maybeSingle();
        const pdf = original.data;
        if (original.error || !pdf || pdf.id !== signature.signed_contract_document_id || pdf.company_id !== input.companyId
          || pdf.customer_contract_id !== input.contractId || pdf.document_type !== "signed_contract_pdf"
          || pdf.storage_bucket !== BUCKET || pdf.storage_path !== filePath || pdf.document_sha256 !== checksum || !pdf.verified_at) throw error;
        return { documentId: d.id };
      } catch {
        // Preserve the original failure and uploaded private PDF for review.
      }
    }
    throw error;
  }
}
