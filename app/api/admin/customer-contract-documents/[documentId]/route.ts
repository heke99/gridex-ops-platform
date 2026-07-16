import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  jsonError,
  requireAdminApiAccess,
} from "@/lib/admin/apiGuards";
import {
  downloadAndVerifyCustomerContractDocument,
  getCustomerContractDocumentById,
} from "@/lib/customer-contracts/documents";
import { internalApiError } from "@/lib/http/apiError";
import { assertCompanyAccessForGuard } from "@/lib/tenant/entityGuards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const access = await requireAdminApiAccess([
    "documents.read",
    "customers.read",
  ]);
  if (access.response) return access.response;

  const { documentId } = await context.params;
  let document;
  try {
    document = await getCustomerContractDocumentById(documentId);
  } catch (error) {
    return internalApiError({
      context: "customer-contract-document-read",
      error,
      code: "customer_contract_document_read_failed",
      message: "Avtalsdokumentet kunde inte hämtas.",
    });
  }

  if (!document) return jsonError("Avtalsdokumentet hittades inte", 404);

  try {
    await assertCompanyAccessForGuard(document.company_id, access.guard);
  } catch (error) {
    return apiErrorResponse(error, 403);
  }

  try {
    const pdf = await downloadAndVerifyCustomerContractDocument(document);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": document.mime_type || "application/pdf",
        "content-length": String(pdf.byteLength),
        "content-disposition": `attachment; filename="avtal-${document.customer_contract_id}.pdf"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "x-gridex-document-sha256": document.document_sha256,
      },
    });
  } catch (error) {
    const isHashMismatch =
      error instanceof Error &&
      error.message === "customer_contract_document_hash_mismatch";
    return internalApiError({
      context: "customer-contract-document-download",
      error,
      code: isHashMismatch
        ? "customer_contract_document_integrity_failed"
        : "customer_contract_document_download_failed",
      message: isHashMismatch
        ? "Avtalsdokumentets integritet kunde inte verifieras."
        : "Avtalsdokumentet kunde inte laddas ner.",
      status: isHashMismatch ? 409 : 404,
    });
  }
}
