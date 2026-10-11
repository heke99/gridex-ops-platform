import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: {} }));

import {
  SIGNED_AGREEMENT_FILE_REQUIRED_MESSAGE,
  SIGNED_AGREEMENT_FILE_SIZE_MESSAGE,
  SIGNED_AGREEMENT_FILE_TYPE_MESSAGE,
  SIGNED_AGREEMENT_FILE_UNEXPECTED_MESSAGE,
  SIGNED_AGREEMENT_MAX_BYTES,
  SIGNED_DATE_FUTURE_MESSAGE,
  SIGNED_DATE_INVALID_MESSAGE,
  SIGNING_METHOD_REQUIRED_MESSAGE,
  parseContractSigningMethod,
  resolveContractSigningChoice,
  todayInStockholm,
} from "@/lib/customer-contracts/signingMethod";
import {
  SIGNED_AGREEMENT_REQUIRES_CONTRACT_MESSAGE,
  resolveIntakeSigningChoice,
  validateContractSigningChoice,
  type CreateCustomerGraphParams,
} from "@/app/admin/customers/actions.part-1";

const pdf = { name: "avtal.pdf", type: "application/pdf", size: 2048 };
const TODAY = "2026-10-10";

describe("resolveContractSigningChoice", () => {
  it("requires an explicit choice", () => {
    expect(resolveContractSigningChoice({ method: "", file: null, signedDate: null, today: TODAY })).toEqual({
      ok: false,
      errors: { signingMethod: SIGNING_METHOD_REQUIRED_MESSAGE },
    });
    expect(parseContractSigningMethod("signed")).toBeNull();
  });

  it("send_for_signing -> pending_signature and sends the link, no import", () => {
    const result = resolveContractSigningChoice({ method: "send_for_signing", file: null, signedDate: null, today: TODAY });
    expect(result).toMatchObject({
      ok: true,
      createStatus: "pending_signature",
      sendSigningLink: true,
      importSignedAgreement: false,
      signedAtIso: null,
    });
  });

  it("draft -> draft without sending", () => {
    const result = resolveContractSigningChoice({ method: "draft", file: null, signedDate: null, today: TODAY });
    expect(result).toMatchObject({ ok: true, createStatus: "draft", sendSigningLink: false, importSignedAgreement: false });
  });

  it("rejects an uploaded file when the choice is not 'already signed'", () => {
    expect(resolveContractSigningChoice({ method: "send_for_signing", file: pdf, signedDate: null, today: TODAY })).toEqual({
      ok: false,
      errors: { signedAgreementFile: SIGNED_AGREEMENT_FILE_UNEXPECTED_MESSAGE },
    });
  });

  it("uploaded_signed requires the file", () => {
    expect(resolveContractSigningChoice({ method: "uploaded_signed", file: null, signedDate: TODAY, today: TODAY })).toEqual({
      ok: false,
      errors: { signedAgreementFile: SIGNED_AGREEMENT_FILE_REQUIRED_MESSAGE },
    });
  });

  it("uploaded_signed accepts only PDF within the size limit", () => {
    const image = resolveContractSigningChoice({
      method: "uploaded_signed",
      file: { name: "avtal.png", type: "image/png", size: 10 },
      signedDate: TODAY,
      today: TODAY,
    });
    expect(image).toEqual({ ok: false, errors: { signedAgreementFile: SIGNED_AGREEMENT_FILE_TYPE_MESSAGE } });
    const disguised = resolveContractSigningChoice({
      method: "uploaded_signed",
      file: { name: "avtal.exe", type: "application/pdf", size: 10 },
      signedDate: TODAY,
      today: TODAY,
    });
    expect(disguised).toEqual({ ok: false, errors: { signedAgreementFile: SIGNED_AGREEMENT_FILE_TYPE_MESSAGE } });
    const big = resolveContractSigningChoice({
      method: "uploaded_signed",
      file: { ...pdf, size: SIGNED_AGREEMENT_MAX_BYTES + 1 },
      signedDate: TODAY,
      today: TODAY,
    });
    expect(big).toEqual({ ok: false, errors: { signedAgreementFile: SIGNED_AGREEMENT_FILE_SIZE_MESSAGE } });
  });

  it("uploaded_signed validates the signing date", () => {
    expect(
      resolveContractSigningChoice({ method: "uploaded_signed", file: pdf, signedDate: "2026-10-11", today: TODAY }),
    ).toEqual({ ok: false, errors: { signedDate: SIGNED_DATE_FUTURE_MESSAGE } });
    expect(
      resolveContractSigningChoice({ method: "uploaded_signed", file: pdf, signedDate: "2026-02-30", today: TODAY }),
    ).toEqual({ ok: false, errors: { signedDate: SIGNED_DATE_INVALID_MESSAGE } });
  });

  it("uploaded_signed defaults the date to today and imports without sending", () => {
    const result = resolveContractSigningChoice({
      method: "uploaded_signed",
      file: pdf,
      signedDate: "",
      today: TODAY,
      uploadedCreateStatus: "draft",
    });
    expect(result).toEqual({
      ok: true,
      method: "uploaded_signed",
      createStatus: "draft",
      importSignedAgreement: true,
      sendSigningLink: false,
      signedDate: TODAY,
      signedAtIso: null,
    });
  });

  it("uploaded_signed with an earlier date passes it as the acceptance time", () => {
    const result = resolveContractSigningChoice({ method: "uploaded_signed", file: pdf, signedDate: "2026-09-01", today: TODAY });
    expect(result).toMatchObject({ ok: true, signedDate: "2026-09-01", signedAtIso: "2026-09-01T12:00:00.000Z" });
  });

  it("todayInStockholm uses Swedish time", () => {
    expect(todayInStockholm(new Date("2026-10-09T22:30:00Z"))).toBe("2026-10-10");
  });
});

function intakeParams(overrides: Partial<CreateCustomerGraphParams>): CreateCustomerGraphParams {
  return {
    contractOfferId: "offer-1",
    contractTypeOverride: null,
    contractStatus: null,
    signedAgreementFile: null,
    requireContractSigningChoice: true,
    contractSigningMethod: null,
    contractSignedDate: null,
    ...overrides,
  } as CreateCustomerGraphParams;
}

describe("admin intake signing choice", () => {
  it("requires a choice when the form creates a contract", () => {
    expect(validateContractSigningChoice(intakeParams({}))).toEqual({
      contractSigningMethod: SIGNING_METHOD_REQUIRED_MESSAGE,
    });
  });

  it("does not require a choice without a contract or for non-form callers", () => {
    expect(validateContractSigningChoice(intakeParams({ contractOfferId: null }))).toEqual({});
    expect(validateContractSigningChoice(intakeParams({ requireContractSigningChoice: false }))).toEqual({});
    expect(resolveIntakeSigningChoice(intakeParams({ requireContractSigningChoice: false }))).toBeNull();
  });

  it("maps file errors to the signed agreement field", () => {
    expect(
      validateContractSigningChoice(intakeParams({ contractSigningMethod: "uploaded_signed", contractSignedDate: "2026-01-02" })),
    ).toEqual({ signedAgreementFile: SIGNED_AGREEMENT_FILE_REQUIRED_MESSAGE });
  });

  it("catalog uploads enter the import via pending_signature, one-off contracts via draft", () => {
    const file = new File(["%PDF-1.4"], "avtal.pdf", { type: "application/pdf" });
    expect(
      resolveIntakeSigningChoice(intakeParams({ contractSigningMethod: "uploaded_signed", signedAgreementFile: file })),
    ).toMatchObject({ ok: true, createStatus: "pending_signature", importSignedAgreement: true, sendSigningLink: false });
    expect(
      resolveIntakeSigningChoice(
        intakeParams({
          contractOfferId: null,
          contractTypeOverride: "fixed",
          contractSigningMethod: "uploaded_signed",
          signedAgreementFile: file,
        }),
      ),
    ).toMatchObject({ ok: true, createStatus: "draft" });
  });

  it("rejects a signed agreement file without a contract", () => {
    const file = new File(["%PDF-1.4"], "avtal.pdf", { type: "application/pdf" });
    expect(
      validateContractSigningChoice(intakeParams({ contractOfferId: null, signedAgreementFile: file })),
    ).toEqual({ signedAgreementFile: SIGNED_AGREEMENT_REQUIRES_CONTRACT_MESSAGE });
  });
});
