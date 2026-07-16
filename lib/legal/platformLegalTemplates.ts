import crypto from "node:crypto";

import { supabaseService } from "@/lib/supabase/service";
import {
  CANONICAL_LEGAL_MODULES,
  type CanonicalLegalModule,
} from "@/lib/legal/canonicalModules";

export type PlatformLegalTemplate = {
  id: string;
  type: CanonicalLegalModule | string;
  version: string;
  title: string;
  body: string;
  status: "draft" | "published" | "archived" | string;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type LegalTemplateCompany = {
  id: string;
  name: string | null;
  slug: string | null;
  org_number: string | null;
  primary_contact_email: string | null;
  support_email: string | null;
  phone: string | null;
  website: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  postal_code: string | null;
  city: string | null;
  country_code: string | null;
  branding: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  status: string | null;
};

export type RenderedTenantLegalTemplate = {
  title: string;
  body: string;
  placeholdersUsed: Record<string, string>;
  missingPlaceholders: string[];
  checksum: string;
};

export type CopyTemplateResult = {
  companyId: string;
  inserted: number;
  skipped: number;
  missingTemplates: string[];
  createdVersionIds: string[];
};

export const LEGAL_TEMPLATE_PLACEHOLDERS = [
  "company_name",
  "legal_name",
  "brand_name",
  "organization_number",
  "org_number",
  "company_address",
  "customer_service_email",
  "support_email",
  "contact_email",
  "complaints_email",
  "data_protection_email",
  "billing_information",
  "dispute_resolution_information",
  "phone",
  "website",
  "address_line_1",
  "address_line_2",
  "postal_code",
  "city",
  "country",
] as const;

const COMPANY_TEMPLATE_COLUMNS =
  "id,name,slug,company_slug,org_number,primary_contact_email,support_email,phone,website,address_line_1,address_line_2,postal_code,city,country_code,branding,metadata,status";

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const cleaned = textValue(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function stableChecksum(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeTemplateRow(
  row: Record<string, unknown>,
): PlatformLegalTemplate {
  return {
    id: String(row.id),
    type: String(row.type),
    version: String(row.version ?? ""),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    status: String(row.status ?? "draft"),
    published_at: (row.published_at as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    metadata: objectValue(row.metadata),
  };
}

function normalizeCompanyRow(
  row: Record<string, unknown>,
): LegalTemplateCompany {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    slug:
      ((row.slug as string | null) ?? (row.company_slug as string | null)) ??
      null,
    org_number: (row.org_number as string | null) ?? null,
    primary_contact_email:
      (row.primary_contact_email as string | null) ?? null,
    support_email: (row.support_email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    address_line_1: (row.address_line_1 as string | null) ?? null,
    address_line_2: (row.address_line_2 as string | null) ?? null,
    postal_code: (row.postal_code as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    country_code: (row.country_code as string | null) ?? null,
    branding: objectValue(row.branding),
    metadata: objectValue(row.metadata),
    status: (row.status as string | null) ?? null,
  };
}

export function legalTemplatePlaceholderValues(
  company: LegalTemplateCompany,
): Record<string, string> {
  const branding = company.branding ?? {};
  const metadata = company.metadata ?? {};
  const companyName =
    firstText(company.name, metadata.company_name, metadata.legal_name) ?? "";
  const brandName =
    firstText(
      branding.brand_name,
      branding.display_name,
      branding.name,
      metadata.brand_name,
      company.name,
    ) ?? companyName;
  const contactEmail =
    firstText(
      company.support_email,
      company.primary_contact_email,
      metadata.contact_email,
    ) ?? "";
  const address = [company.address_line_1, company.address_line_2]
    .filter(Boolean)
    .join(", ");
  const billingInformation =
    firstText(metadata.billing_information, metadata.billing_text) ?? "";
  const disputeInformation =
    firstText(
      metadata.dispute_resolution_information,
      metadata.dispute_resolution_text,
    ) ?? "";

  return {
    company_name: companyName,
    legal_name: firstText(metadata.legal_name, company.name) ?? companyName,
    brand_name: brandName,
    organization_number:
      firstText(company.org_number, metadata.organization_number, metadata.org_number) ??
      "",
    org_number:
      firstText(company.org_number, metadata.organization_number, metadata.org_number) ??
      "",
    company_address: address,
    customer_service_email: contactEmail,
    support_email: contactEmail,
    contact_email: contactEmail,
    complaints_email:
      firstText(metadata.complaints_email, contactEmail) ?? "",
    data_protection_email:
      firstText(metadata.data_protection_email, contactEmail) ?? "",
    billing_information: billingInformation,
    dispute_resolution_information: disputeInformation,
    phone: firstText(company.phone, metadata.phone) ?? "",
    website: firstText(company.website, metadata.website) ?? "",
    address_line_1:
      firstText(company.address_line_1, metadata.address_line_1) ?? "",
    address_line_2:
      firstText(company.address_line_2, metadata.address_line_2) ?? "",
    postal_code: firstText(company.postal_code, metadata.postal_code) ?? "",
    city: firstText(company.city, metadata.city) ?? "",
    country:
      firstText(company.country_code, metadata.country, metadata.country_code) ??
      "SE",
  };
}

export function renderTenantLegalTemplate(
  template: Pick<PlatformLegalTemplate, "title" | "body">,
  company: LegalTemplateCompany,
): RenderedTenantLegalTemplate {
  const values = legalTemplatePlaceholderValues(company);
  const missing = new Set<string>();
  const render = (input: string): string =>
    input.replace(
      /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g,
      (match, key: string) => {
        const normalized = key.trim();
        if (!Object.prototype.hasOwnProperty.call(values, normalized)) {
          missing.add(normalized);
          return match;
        }
        const value = values[normalized];
        if (!value) missing.add(normalized);
        return value || match;
      },
    );

  const title = render(template.title);
  const body = render(template.body);
  return {
    title,
    body,
    placeholdersUsed: values,
    missingPlaceholders: Array.from(missing).sort(),
    checksum: stableChecksum(`${title}\n${body}`),
  };
}

export async function listPlatformLegalTemplates(): Promise<
  PlatformLegalTemplate[]
> {
  const { data, error } = await supabaseService
    .from("canonical_legal_template_versions_v")
    .select(
      "id,type,version,title,body,status,published_at,created_at,updated_at,metadata",
    )
    .order("type", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(
    normalizeTemplateRow,
  );
}

export async function listPublishedPlatformLegalTemplates(): Promise<
  PlatformLegalTemplate[]
> {
  const templates = (await listPlatformLegalTemplates()).filter(
    (template) => template.status === "published",
  );
  const latestByType = new Map<string, PlatformLegalTemplate>();
  for (const row of templates) {
    if (!latestByType.has(row.type)) latestByType.set(row.type, row);
  }
  return Array.from(latestByType.values());
}

export async function listLegalTemplateCompanies(
  limit = 500,
): Promise<LegalTemplateCompany[]> {
  const { data, error } = await supabaseService
    .from("companies")
    .select(COMPANY_TEMPLATE_COLUMNS)
    .neq("status", "deleted_test_only")
    .order("name", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(
    normalizeCompanyRow,
  );
}

export async function loadLegalTemplateCompany(
  companyId: string,
): Promise<LegalTemplateCompany | null> {
  const { data, error } = await supabaseService
    .from("companies")
    .select(COMPANY_TEMPLATE_COLUMNS)
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? normalizeCompanyRow(data as Record<string, unknown>)
    : null;
}

/**
 * Canonical templates are rendered with the tenant legal-profile snapshot at
 * publication time. There is intentionally no per-tenant copy operation.
 */
export async function copyPublishedTemplatesToCompany(input: {
  companyId: string;
  actorUserId: string | null;
  onlyMissing?: boolean;
  publishNow?: boolean;
  templateTypes?: string[];
  source?: string;
}): Promise<CopyTemplateResult> {
  const company = await loadLegalTemplateCompany(input.companyId);
  if (!company) throw new Error("Company not found.");
  const requested = input.templateTypes?.length
    ? input.templateTypes
    : [...CANONICAL_LEGAL_MODULES];
  const published = await listPublishedPlatformLegalTemplates();
  const available = new Set(published.map((row) => row.type));
  const missingTemplates = requested.filter((type) => !available.has(type));
  return {
    companyId: company.id,
    inserted: 0,
    skipped: requested.length - missingTemplates.length,
    missingTemplates,
    createdVersionIds: [],
  };
}

export async function copyPublishedTemplatesToCompanies(input: {
  companyIds: string[];
  actorUserId: string | null;
  onlyMissing?: boolean;
  publishNow?: boolean;
  templateTypes?: string[];
  source?: string;
}): Promise<CopyTemplateResult[]> {
  const uniqueIds = Array.from(new Set(input.companyIds.filter(Boolean)));
  const results: CopyTemplateResult[] = [];
  for (const companyId of uniqueIds) {
    results.push(await copyPublishedTemplatesToCompany({ ...input, companyId }));
  }
  return results;
}

export function summarizeCopyResults(results: CopyTemplateResult[]): string {
  const available = results.reduce((sum, row) => sum + row.skipped, 0);
  const missing = Array.from(
    new Set(results.flatMap((row) => row.missingTemplates)),
  );
  const parts = [
    `${results.length} tenant(s) validated`,
    `${available} canonical module binding(s) available`,
  ];
  if (missing.length > 0) {
    parts.push(`missing master templates: ${missing.join(", ")}`);
  }
  return parts.join(" · ");
}
