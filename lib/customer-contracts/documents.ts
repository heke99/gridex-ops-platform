import "server-only";

import { createHash } from "node:crypto";
import { supabaseService } from "@/lib/supabase/service";

export const CUSTOMER_CONTRACT_DOCUMENT_BUCKET = "customer-contract-documents";

export type CustomerContractDocumentRow = {
  id: string;
  company_id: string;
  customer_contract_id: string;
  document_type: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string;
  document_sha256: string;
  generated_at: string;
  generation_snapshot: Record<string, unknown>;
  archived_at: string | null;
  verified_at: string | null;
  created_at: string;
};

function signedContractPath(input: {
  companyId: string;
  customerContractId: string;
  documentSha256: string;
}): string {
  return [
    input.companyId,
    input.customerContractId,
    `signed-contract-${input.documentSha256}.pdf`,
  ].join("/");
}

function isAlreadyExistsError(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  return (
    String(error.statusCode ?? "") === "409" ||
    /already exists|duplicate/i.test(error.message ?? "")
  );
}

export async function archiveSignedCustomerContractPdf(input: {
  companyId: string;
  customerContractId: string;
  pdfBuffer: Buffer;
  mimeType?: string | null;
  documentSha256?: string;
  generatedAt?: string;
  generationSnapshot: Record<string, unknown>;
}): Promise<CustomerContractDocumentRow> {
  const mimeType = input.mimeType ?? "application/pdf";
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const documentSha256 =
    input.documentSha256 ??
    createHash("sha256").update(input.pdfBuffer).digest("hex");
  const storagePath = signedContractPath({
    companyId: input.companyId,
    customerContractId: input.customerContractId,
    documentSha256,
  });

  const { data: existing, error: existingError } = await supabaseService
    .from("customer_contract_documents")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("customer_contract_id", input.customerContractId)
    .eq("document_type", "signed_contract_pdf")
    .eq("document_sha256", documentSha256)
    .maybeSingle();
  if (existingError) throw existingError;

  if (
    existing?.storage_bucket === CUSTOMER_CONTRACT_DOCUMENT_BUCKET &&
    existing.storage_path === storagePath
  ) {
    return existing as CustomerContractDocumentRow;
  }

  const upload = await supabaseService.storage
    .from(CUSTOMER_CONTRACT_DOCUMENT_BUCKET)
    .upload(storagePath, input.pdfBuffer, {
      contentType: mimeType,
      cacheControl: "31536000",
      upsert: false,
    });
  if (upload.error && !isAlreadyExistsError(upload.error)) {
    throw upload.error;
  }

  const payload = {
    company_id: input.companyId,
    customer_contract_id: input.customerContractId,
    document_type: "signed_contract_pdf",
    storage_bucket: CUSTOMER_CONTRACT_DOCUMENT_BUCKET,
    storage_path: storagePath,
    mime_type: mimeType,
    document_sha256: documentSha256,
    generated_at: generatedAt,
    generation_snapshot: input.generationSnapshot,
    archived_at: generatedAt,
    verified_at: generatedAt,
  };

  const response = existing
    ? await supabaseService
        .from("customer_contract_documents")
        .update(payload)
        .eq("id", existing.id)
        .eq("company_id", input.companyId)
        .select("*")
        .single()
    : await supabaseService
        .from("customer_contract_documents")
        .insert(payload)
        .select("*")
        .single();
  if (response.error) throw response.error;

  return response.data as CustomerContractDocumentRow;
}

export async function listCustomerContractDocuments(
  customerContractIds: string[],
  options: { companyId?: string | null } = {},
): Promise<CustomerContractDocumentRow[]> {
  if (customerContractIds.length === 0) return [];

  let query = supabaseService
    .from("customer_contract_documents")
    .select("*")
    .in("customer_contract_id", customerContractIds)
    .order("generated_at", { ascending: false });
  if (options.companyId) query = query.eq("company_id", options.companyId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CustomerContractDocumentRow[];
}

export async function getCustomerContractDocumentById(
  documentId: string,
): Promise<CustomerContractDocumentRow | null> {
  const { data, error } = await supabaseService
    .from("customer_contract_documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  return (data as CustomerContractDocumentRow | null) ?? null;
}

export async function downloadAndVerifyCustomerContractDocument(
  document: CustomerContractDocumentRow,
): Promise<Buffer> {
  if (!document.storage_path) {
    throw new Error("customer_contract_document_storage_path_missing");
  }
  const bucket = document.storage_bucket ?? CUSTOMER_CONTRACT_DOCUMENT_BUCKET;
  const { data, error } = await supabaseService.storage
    .from(bucket)
    .download(document.storage_path);
  if (error || !data) {
    throw error ?? new Error("customer_contract_document_download_failed");
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const actualSha256 = createHash("sha256").update(buffer).digest("hex");
  if (actualSha256 !== document.document_sha256) {
    throw new Error("customer_contract_document_hash_mismatch");
  }

  if (!document.verified_at) {
    await supabaseService
      .from("customer_contract_documents")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", document.id)
      .eq("document_sha256", document.document_sha256);
  }

  return buffer;
}
