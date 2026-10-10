/**
 * Staff choice of how a manually created contract gets signed.
 *
 * - `uploaded_signed`: the customer already signed; the signed agreement PDF is
 *   uploaded and imported through the canonical DB import command
 *   (customer_authorization_documents -> gridex_finalize_admin_imported_signed_agreement_v1),
 *   which records the signature evidence and moves the contract to `signed`.
 * - `send_for_signing`: contract is saved as `pending_signature` and the online
 *   signing link is sent automatically.
 * - `draft`: saved as draft, link can be sent later.
 *
 * Pure module (no server imports) so the choice logic is unit-testable.
 */

export const CONTRACT_SIGNING_METHODS = ["uploaded_signed", "send_for_signing", "draft"] as const;
export type ContractSigningMethod = (typeof CONTRACT_SIGNING_METHODS)[number];

export const CONTRACT_SIGNING_METHOD_LABELS: Record<ContractSigningMethod, string> = {
  uploaded_signed: "Kunden har redan signerat – ladda upp avtalet",
  send_for_signing: "Skicka avtal för signering",
  draft: "Spara som utkast (skicka senare)",
};

/** Same limit as other admin document uploads (support attachments). */
export const SIGNED_AGREEMENT_MAX_BYTES = 10 * 1024 * 1024;
/**
 * The canonical signed-agreement import command only accepts PDF evidence
 * (admin_signed_contract_import_pdf_required), so images are rejected here
 * before anything is written.
 */
export const SIGNED_AGREEMENT_ACCEPT = "application/pdf";

export const SIGNING_METHOD_REQUIRED_MESSAGE = "Välj hur avtalet ska signeras.";
export const SIGNED_AGREEMENT_FILE_REQUIRED_MESSAGE =
  "Ladda upp det signerade avtalet när kunden redan har signerat.";
export const SIGNED_AGREEMENT_FILE_TYPE_MESSAGE = "Det signerade avtalet måste vara en PDF-fil.";
export const SIGNED_AGREEMENT_FILE_SIZE_MESSAGE = "Det signerade avtalet får vara högst 10 MB.";
export const SIGNED_AGREEMENT_FILE_UNEXPECTED_MESSAGE =
  "Ett signerat avtal laddades upp – välj \"Kunden har redan signerat\" eller ta bort filen.";
export const SIGNED_DATE_INVALID_MESSAGE = "Ange ett giltigt signeringsdatum (ÅÅÅÅ-MM-DD).";
export const SIGNED_DATE_FUTURE_MESSAGE = "Signeringsdatum kan inte vara i framtiden.";

export function parseContractSigningMethod(value: unknown): ContractSigningMethod | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return (CONTRACT_SIGNING_METHODS as readonly string[]).includes(raw)
    ? (raw as ContractSigningMethod)
    : null;
}

type FileLike = { name?: string | null; type?: string | null; size: number };

export function validateSignedAgreementFile(file: FileLike): string | null {
  const type = String(file.type ?? "").toLowerCase();
  const name = String(file.name ?? "").toLowerCase();
  if (type !== "application/pdf" || !name.endsWith(".pdf")) return SIGNED_AGREEMENT_FILE_TYPE_MESSAGE;
  if (file.size <= 0 || file.size > SIGNED_AGREEMENT_MAX_BYTES) return SIGNED_AGREEMENT_FILE_SIZE_MESSAGE;
  return null;
}

/** Today's date (YYYY-MM-DD) in Swedish time. */
export function todayInStockholm(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export type SigningChoiceErrors = Partial<
  Record<"signingMethod" | "signedAgreementFile" | "signedDate", string>
>;

export type ResolvedSigningChoice =
  | {
      ok: true;
      method: ContractSigningMethod;
      /** Status the contract row is created with (before any import). */
      createStatus: "draft" | "pending_signature";
      /** Requires the signed-agreement import after the contract exists. */
      importSignedAgreement: boolean;
      /** Send the online signing link after commit. */
      sendSigningLink: boolean;
      /** Declared signing date (YYYY-MM-DD), only for uploaded_signed. */
      signedDate: string | null;
      /** Acceptance time for the import command; null = import time (today). */
      signedAtIso: string | null;
    }
  | { ok: false; errors: SigningChoiceErrors };

/**
 * Validates the staff signing choice. `uploadedCreateStatus` is the status the
 * row is created in before the canonical import signs it (catalog contracts go
 * through pending_signature; one-off contracts start as draft).
 */
export function resolveContractSigningChoice(input: {
  method: unknown;
  file: FileLike | null;
  signedDate: unknown;
  today?: string;
  uploadedCreateStatus?: "draft" | "pending_signature";
}): ResolvedSigningChoice {
  const errors: SigningChoiceErrors = {};
  const method = parseContractSigningMethod(input.method);
  if (!method) {
    errors.signingMethod = SIGNING_METHOD_REQUIRED_MESSAGE;
    return { ok: false, errors };
  }

  if (method !== "uploaded_signed") {
    if (input.file) {
      errors.signedAgreementFile = SIGNED_AGREEMENT_FILE_UNEXPECTED_MESSAGE;
      return { ok: false, errors };
    }
    return {
      ok: true,
      method,
      createStatus: method === "draft" ? "draft" : "pending_signature",
      importSignedAgreement: false,
      sendSigningLink: method === "send_for_signing",
      signedDate: null,
      signedAtIso: null,
    };
  }

  if (!input.file) {
    errors.signedAgreementFile = SIGNED_AGREEMENT_FILE_REQUIRED_MESSAGE;
  } else {
    const fileError = validateSignedAgreementFile(input.file);
    if (fileError) errors.signedAgreementFile = fileError;
  }

  const today = input.today ?? todayInStockholm();
  const rawDate = typeof input.signedDate === "string" ? input.signedDate.trim() : "";
  const signedDate = rawDate || today;
  if (!isValidIsoDate(signedDate)) {
    errors.signedDate = SIGNED_DATE_INVALID_MESSAGE;
  } else if (signedDate > today) {
    errors.signedDate = SIGNED_DATE_FUTURE_MESSAGE;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    method,
    createStatus: input.uploadedCreateStatus ?? "pending_signature",
    importSignedAgreement: true,
    sendSigningLink: false,
    signedDate,
    // Today -> null (the import command uses its own server time, never a
    // future instant). Earlier dates use midday UTC so the calendar date is
    // stable in Swedish time.
    signedAtIso: signedDate === today ? null : `${signedDate}T12:00:00.000Z`,
  };
}

export const SIGNED_AGREEMENT_IMPORTED_MESSAGE =
  "Signerat avtal uppladdat – avtalet är registrerat som signerat.";
export const SIGNED_AGREEMENT_IMPORT_FAILED_MESSAGE =
  "Avtalet skapades men det signerade avtalet kunde inte registreras, så avtalet är inte signerat. Kontrollera PDF-filen och försök igen eller kontakta support.";
