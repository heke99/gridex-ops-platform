"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminActionAccess } from "@/lib/admin/guards";
import { supabaseService } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAILBOX_TYPES = new Set([
  "manual_supplier_switch",
  "power_of_attorney",
  "facility_information_request",
  "ai_list",
  "escalation",
  "general_manual_operations",
]);

const ENVIRONMENTS = new Set(["test", "production"]);
const EDIEL_RESERVED = new Set(["ediel@gridex.se"]);

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function intValue(formData: FormData, key: string, fallback: number): number {
  const raw = value(formData, key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function boolValue(formData: FormData, key: string): boolean {
  const raw = value(formData, key);
  return raw === "on" || raw === "true";
}

// Secret references must point at env, never store a plaintext password.
function validateSecretReference(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("env:")) {
    throw new Error("Secret reference måste peka på env, t.ex. env:MANUAL_OPS_IMAP_PASS.");
  }
  if (/password\s*=|pass\s*=|pwd\s*=|:\/\/[^/]*:[^/@]+@/i.test(raw)) {
    throw new Error("Lösenord får inte sparas i databasen. Spara bara secret_reference.");
  }
  return raw;
}

function redirectWith(status: "success" | "error", message: string): never {
  const params = new URLSearchParams({ status, message });
  redirect(`/admin/manual-mailboxes?${params.toString()}`);
}

// Creates or updates a manual operations mailbox. company_id null = platform
// default; company_id set = tenant override. Uses an explicit select -> update /
// insert (NOT PostgREST upsert) because uniqueness is enforced by PARTIAL unique
// indexes that ON CONFLICT cannot target.
export async function saveManualMailboxAction(formData: FormData): Promise<void> {
  const { userId } = await requirePlatformAdminActionAccess();

  try {
    const mailboxName = value(formData, "mailbox_name");
    if (!mailboxName) throw new Error("Ange ett namn på brevlådan.");

    const mailboxType = value(formData, "mailbox_type") ?? "general_manual_operations";
    if (!MAILBOX_TYPES.has(mailboxType)) throw new Error("Ogiltig brevlådetyp.");

    const environment = value(formData, "environment") ?? "test";
    if (!ENVIRONMENTS.has(environment)) throw new Error("Ogiltig miljö.");

    const fromEmail = value(formData, "from_email");
    if (!fromEmail || !EMAIL_RE.test(fromEmail)) throw new Error("Ange en giltig avsändaradress.");
    // The Ediel transport sender must never be reused for manual operations.
    if (EDIEL_RESERVED.has(fromEmail.toLowerCase())) {
      throw new Error("ediel@gridex.se är reserverad för Ediel/EDIFACT och får inte användas som manuell avsändare.");
    }

    const replyToEmail = value(formData, "reply_to_email");
    if (replyToEmail && !EMAIL_RE.test(replyToEmail)) throw new Error("Ange en giltig svarsadress.");

    const companyIdRaw = value(formData, "company_id");
    const companyId = companyIdRaw && UUID_RE.test(companyIdRaw) ? companyIdRaw : null;

    const row = {
      company_id: companyId,
      mailbox_name: mailboxName,
      mailbox_type: mailboxType,
      environment,
      from_email: fromEmail,
      reply_to_email: replyToEmail ?? fromEmail,
      smtp_host: value(formData, "smtp_host"),
      smtp_port: intValue(formData, "smtp_port", 465),
      smtp_username: value(formData, "smtp_username"),
      smtp_secret_reference: validateSecretReference(value(formData, "smtp_secret_reference")),
      smtp_secure: boolValue(formData, "smtp_secure"),
      imap_host: value(formData, "imap_host"),
      imap_port: intValue(formData, "imap_port", 993),
      imap_username: value(formData, "imap_username"),
      imap_secret_reference: validateSecretReference(value(formData, "imap_secret_reference")),
      imap_folder: value(formData, "imap_folder") ?? "INBOX",
      imap_secure: boolValue(formData, "imap_secure"),
      is_active: boolValue(formData, "is_active"),
      is_verified: boolValue(formData, "is_verified"),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    const mailboxId = value(formData, "mailbox_id");
    if (mailboxId && UUID_RE.test(mailboxId)) {
      const { error } = await supabaseService
        .from("manual_communication_mailboxes")
        .update(row)
        .eq("id", mailboxId);
      if (error) throw error;
    } else {
      // Find an existing row matching the partial unique scope before inserting.
      let existingQuery = supabaseService
        .from("manual_communication_mailboxes")
        .select("id")
        .eq("environment", environment)
        .eq("mailbox_type", mailboxType);
      existingQuery = companyId
        ? existingQuery.eq("company_id", companyId)
        : existingQuery.is("company_id", null);
      const existing = await existingQuery.maybeSingle();
      if (existing.error) throw existing.error;

      if (existing.data?.id) {
        const { error } = await supabaseService
          .from("manual_communication_mailboxes")
          .update(row)
          .eq("id", existing.data.id);
        if (error) throw error;
      } else {
        const { error } = await supabaseService
          .from("manual_communication_mailboxes")
          .insert({ ...row, created_by: userId });
        if (error) throw error;
      }
    }
  } catch (error) {
    redirectWith("error", error instanceof Error ? error.message : "Kunde inte spara brevlådan.");
  }

  revalidatePath("/admin/manual-mailboxes");
  redirectWith("success", "Manuell brevlåda sparad.");
}

export async function toggleManualMailboxAction(formData: FormData): Promise<void> {
  const { userId } = await requirePlatformAdminActionAccess();

  try {
    const mailboxId = value(formData, "mailbox_id");
    if (!mailboxId || !UUID_RE.test(mailboxId)) throw new Error("Brevlåda saknas eller är ogiltig.");
    const enable = value(formData, "enable") === "true";
    const { error } = await supabaseService
      .from("manual_communication_mailboxes")
      .update({ is_active: enable, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", mailboxId);
    if (error) throw error;
  } catch (error) {
    redirectWith("error", error instanceof Error ? error.message : "Kunde inte uppdatera brevlådan.");
  }

  revalidatePath("/admin/manual-mailboxes");
  redirectWith("success", "Manuell brevlåda uppdaterad.");
}
