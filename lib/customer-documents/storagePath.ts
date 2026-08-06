export const CUSTOMER_DOCUMENT_BUCKET = "customer-documents" as const;

export type CustomerDocumentType =
  | "power_of_attorney"
  | "complete_agreement"
  | "grid_invoice_suggested";

export type ParsedCustomerDocumentStoragePath = {
  companyId: string;
  customerId: string;
  scope: "customer" | `site-${string}`;
  siteId: string | null;
  documentType: CustomerDocumentType;
  fileName: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DOCUMENT_TYPES = new Set<CustomerDocumentType>([
  "power_of_attorney",
  "complete_agreement",
  "grid_invoice_suggested",
]);

function normalizeUuid(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function assertUuid(value: string, field: string): string {
  const normalized = normalizeUuid(value);
  if (!normalized) {
    throw new Error(`${field} must be a canonical UUID`);
  }
  return normalized;
}

export function sanitizeCustomerDocumentFileName(value: string): string {
  const normalized =
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "document";

  if (normalized === "." || normalized === "..") {
    return "document";
  }

  return normalized.slice(0, 255);
}

export function parseCustomerDocumentStoragePath(
  value: string,
): ParsedCustomerDocumentStoragePath | null {
  if (!value || value !== value.replace(/^\/+|\/+$/g, "") || value.includes("//")) {
    return null;
  }

  const parts = value.split("/");
  if (
    parts.length !== 7 ||
    parts[0] !== "companies" ||
    parts[2] !== "customers"
  ) {
    return null;
  }

  const companyId = normalizeUuid(parts[1]);
  const customerId = normalizeUuid(parts[3]);
  if (!companyId || !customerId) return null;

  const scope = parts[4];
  let siteId: string | null = null;
  if (scope === "customer") {
    siteId = null;
  } else if (scope.startsWith("site-")) {
    siteId = normalizeUuid(scope.slice(5));
    if (!siteId) return null;
  } else {
    return null;
  }

  const documentType = parts[5] as CustomerDocumentType;
  if (!DOCUMENT_TYPES.has(documentType)) return null;

  const fileName = parts[6];
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    fileName.length > 255 ||
    !FILE_NAME_PATTERN.test(fileName)
  ) {
    return null;
  }

  return {
    companyId,
    customerId,
    scope: scope as ParsedCustomerDocumentStoragePath["scope"],
    siteId,
    documentType,
    fileName,
  };
}

export function customerDocumentStoragePathMatches(
  value: string,
  expected: {
    companyId: string;
    customerId: string;
    siteId?: string | null;
  },
): boolean {
  const parsed = parseCustomerDocumentStoragePath(value);
  if (!parsed) return false;

  const companyId = normalizeUuid(expected.companyId);
  const customerId = normalizeUuid(expected.customerId);
  if (!companyId || !customerId) return false;
  if (parsed.companyId !== companyId || parsed.customerId !== customerId) {
    return false;
  }

  if (expected.siteId === undefined) return true;
  const siteId = expected.siteId ? normalizeUuid(expected.siteId) : null;
  return parsed.siteId === siteId;
}

export function buildCustomerDocumentStoragePath(params: {
  companyId: string;
  customerId: string;
  siteId: string | null;
  documentType: CustomerDocumentType;
  fileName: string;
  timestampFileName?: boolean;
  now?: Date;
}): string {
  const companyId = assertUuid(params.companyId, "companyId");
  const customerId = assertUuid(params.customerId, "customerId");
  const scope = params.siteId
    ? `site-${assertUuid(params.siteId, "siteId")}`
    : "customer";

  const sanitizedFileName = sanitizeCustomerDocumentFileName(params.fileName);
  const fileName =
    params.timestampFileName === false
      ? sanitizedFileName
      : `${(params.now ?? new Date())
          .toISOString()
          .replace(/[:.]/g, "-")}_${sanitizedFileName}`;

  const path = `companies/${companyId}/customers/${customerId}/${scope}/${params.documentType}/${fileName}`;
  if (!parseCustomerDocumentStoragePath(path)) {
    throw new Error("Generated customer document storage path is invalid");
  }
  return path;
}
