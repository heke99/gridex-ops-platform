import { getBaseAppUrl } from "@/lib/auth/urls";
import {
  CANONICAL_LEGAL_MODULES,
  canonicalLegalModuleLabel,
  isCanonicalLegalModule,
} from "@/lib/legal/canonicalModules";
import { supabaseService } from "@/lib/supabase/service";

const LEGACY_TYPE_TO_SEGMENT = {
  terms: "terms",
  privacy_policy: "privacy",
  withdrawal: "withdrawal",
  price_terms: "price-terms",
  power_of_attorney: "power-of-attorney",
} as const;

type LegacyLegalDocumentType = keyof typeof LEGACY_TYPE_TO_SEGMENT;
export type LegalDocumentType =
  LegacyLegalDocumentType | (typeof CANONICAL_LEGAL_MODULES)[number];

const LEGACY_SEGMENT_TO_TYPE = Object.entries(LEGACY_TYPE_TO_SEGMENT).reduce(
  (acc, [type, segment]) => {
    acc[segment] = type as LegacyLegalDocumentType;
    return acc;
  },
  {} as Record<string, LegacyLegalDocumentType>,
);

function canonicalSegment(moduleKey: string): string {
  return moduleKey.replaceAll("_", "-");
}

export function legalTypeToUrlSegment(type: string): string | null {
  const legacy = LEGACY_TYPE_TO_SEGMENT[type as LegacyLegalDocumentType];
  if (legacy) return legacy;
  return isCanonicalLegalModule(type) ? canonicalSegment(type) : null;
}

export function urlSegmentToLegalType(
  segment: string,
): LegalDocumentType | null {
  const normalized = segment.trim().toLowerCase();
  const legacy = LEGACY_SEGMENT_TO_TYPE[normalized];
  if (legacy) return legacy;
  const canonical = normalized.replaceAll("-", "_");
  return isCanonicalLegalModule(canonical) ? canonical : null;
}

function moduleMatchesRequestedType(
  moduleKey: string,
  requestedType: LegalDocumentType,
): boolean {
  if (moduleKey === requestedType) return true;
  if (requestedType === "terms") {
    return [
      "general_consumer_terms",
      "general_business_terms",
      "agreement_confirmation",
    ].includes(moduleKey);
  }
  if (requestedType === "withdrawal") {
    return [
      "withdrawal_right",
      "withdrawal_form",
      "pre_contract_information",
      "distance_contract_information",
    ].includes(moduleKey);
  }
  if (requestedType === "price_terms") {
    return (
      moduleKey === "price_terms" ||
      moduleKey.endsWith("_price_terms") ||
      moduleKey === "portfolio_terms"
    );
  }
  return false;
}

export function buildPublicLegalPath(
  slug: string,
  type: string,
  versionId: string,
): string | null {
  const segment = legalTypeToUrlSegment(type);
  if (!segment || !slug || !versionId) return null;
  return `/legal/${encodeURIComponent(slug)}/${segment}/${encodeURIComponent(versionId)}`;
}

function safeBaseAppUrl(): string | null {
  try {
    return getBaseAppUrl();
  } catch {
    return null;
  }
}

export function buildPublicLegalUrl(
  slug: string,
  type: string,
  versionId: string,
): string | null {
  const path = buildPublicLegalPath(slug, type, versionId);
  if (!path) return null;
  const base = safeBaseAppUrl();
  return base ? `${base}${path}` : path;
}

export type PublicLegalCompany = {
  id: string;
  name: string | null;
  brand_name: string | null;
  org_number: string | null;
  support_email: string | null;
  primary_contact_email: string | null;
  phone: string | null;
  website: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  slug: string | null;
};

export type PublicLegalVersion = {
  id: string;
  company_id: string;
  type: string;
  version: string;
  title: string;
  body: string;
  status: string;
  published_at: string | null;
  effective_from: string | null;
  metadata: Record<string, unknown> | null;
};

const COMPANY_PUBLIC_LEGAL_COLUMNS =
  "id,name,org_number,support_email,primary_contact_email,phone,website,address_line_1,address_line_2,postal_code,city,country_code,slug,company_slug,branding,metadata";

function deriveBrandName(row: Record<string, unknown>): string | null {
  const branding = (row.branding as Record<string, unknown> | null) ?? null;
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
  const candidates = [
    branding?.brand_name,
    branding?.display_name,
    branding?.name,
    metadata?.brand_name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim())
      return candidate.trim();
  }
  return null;
}

function mapCompanyRow(row: Record<string, unknown>): PublicLegalCompany {
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    brand_name: deriveBrandName(row),
    org_number: (row.org_number as string | null) ?? null,
    support_email: (row.support_email as string | null) ?? null,
    primary_contact_email: (row.primary_contact_email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    address_line_1: (row.address_line_1 as string | null) ?? null,
    address_line_2: (row.address_line_2 as string | null) ?? null,
    postal_code: (row.postal_code as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    country: (row.country_code as string | null) ?? null,
    slug:
      (row.slug as string | null) ??
      (row.company_slug as string | null) ??
      null,
  };
}

export async function loadCompanyBySlug(
  slug: string,
): Promise<PublicLegalCompany | null> {
  const cleaned = slug.trim().toLowerCase();
  if (!cleaned) return null;
  const { data, error } = await supabaseService
    .from("companies")
    .select(COMPANY_PUBLIC_LEGAL_COLUMNS)
    .or(`slug.eq.${cleaned},company_slug.eq.${cleaned}`)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapCompanyRow(data as Record<string, unknown>);
}

export async function loadCompanySlugById(
  companyId: string,
): Promise<string | null> {
  if (!companyId) return null;
  const { data, error } = await supabaseService
    .from("companies")
    .select("slug,company_slug")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { slug?: string | null; company_slug?: string | null };
  return row.slug ?? row.company_slug ?? null;
}

type ExactBundleDocumentRow = {
  id: string;
  legal_bundle_version_id: string;
  module_key: string;
  title: string;
  rendered_body: string;
  content_sha256: string;
  template_version: string | null;
  origin: string | null;
  tenant_customized: boolean | null;
  created_at: string;
  unresolved_variables: string[] | null;
};

async function loadExactBundleDocument(input: {
  companyId: string;
  requestedType: LegalDocumentType;
  versionId: string;
}): Promise<PublicLegalVersion | null> {
  const documentResult = await supabaseService
    .from("legal_bundle_version_documents")
    .select(
      "id,legal_bundle_version_id,module_key,title,rendered_body,content_sha256,template_version,origin,tenant_customized,created_at,unresolved_variables",
    )
    .eq("id", input.versionId)
    .maybeSingle();
  if (documentResult.error || !documentResult.data) return null;

  const document = documentResult.data as ExactBundleDocumentRow;
  if (!moduleMatchesRequestedType(document.module_key, input.requestedType))
    return null;
  if ((document.unresolved_variables ?? []).length > 0) return null;

  const bundleResult = await supabaseService
    .from("legal_bundle_versions")
    .select(
      "id,company_id,status,published_at,locked_at,tenant_legal_profile_sha256",
    )
    .eq("id", document.legal_bundle_version_id)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (bundleResult.error || !bundleResult.data) return null;

  const bundle = bundleResult.data as Record<string, unknown>;
  const status = String(bundle.status ?? "");
  if (
    !["published", "replaced", "archived"].includes(status) ||
    !bundle.locked_at
  )
    return null;
  const publishedAt =
    (bundle.published_at as string | null) ?? document.created_at;

  return {
    id: document.id,
    company_id: input.companyId,
    type: document.module_key,
    version: document.template_version ?? publishedAt,
    title: document.title || canonicalLegalModuleLabel(document.module_key),
    body: document.rendered_body,
    status,
    published_at: publishedAt,
    effective_from: publishedAt,
    metadata: {
      origin: document.origin ?? "canonical_bundle_document",
      module_key: document.module_key,
      content_sha256: document.content_sha256,
      legal_bundle_version_id: document.legal_bundle_version_id,
      template_version: document.template_version,
      tenant_customized: document.tenant_customized === true,
      tenant_legal_profile_sha256: bundle.tenant_legal_profile_sha256 ?? null,
      immutable: true,
    },
  };
}

async function loadPublishedTenantOverride(input: {
  companyId: string;
  requestedType: LegalDocumentType;
  versionId: string;
}): Promise<PublicLegalVersion | null> {
  const result = await supabaseService
    .from("canonical_tenant_legal_overrides_v")
    .select(
      "id,company_id,type,version,title,body,status,published_at,metadata",
    )
    .eq("company_id", input.companyId)
    .eq("id", input.versionId)
    .eq("status", "published")
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as Record<string, unknown>;
  const type = String(row.type ?? "");
  if (!moduleMatchesRequestedType(type, input.requestedType)) return null;
  const publishedAt = (row.published_at as string | null) ?? null;
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    type,
    version: String(row.version ?? ""),
    title: String(row.title ?? canonicalLegalModuleLabel(type)),
    body: String(row.body ?? ""),
    status: String(row.status ?? ""),
    published_at: publishedAt,
    effective_from: publishedAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

async function loadLegacyPublishedVersion(input: {
  companyId: string;
  requestedType: LegalDocumentType;
  versionId: string;
}): Promise<PublicLegalVersion | null> {
  if (
    !Object.prototype.hasOwnProperty.call(
      LEGACY_TYPE_TO_SEGMENT,
      input.requestedType,
    )
  )
    return null;
  const result = await supabaseService
    .from("legal_text_versions")
    .select(
      "id,company_id,type,version,title,body,status,published_at,metadata",
    )
    .eq("company_id", input.companyId)
    .eq("id", input.versionId)
    .eq("type", input.requestedType)
    .eq("status", "published")
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as Record<string, unknown>;
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
  const publishedAt = (row.published_at as string | null) ?? null;
  const effectiveFrom =
    (typeof metadata?.effective_from === "string"
      ? metadata.effective_from
      : null) ?? publishedAt;
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    type: String(row.type),
    version: String(row.version),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    status: String(row.status ?? ""),
    published_at: publishedAt,
    effective_from: effectiveFrom,
    metadata,
  };
}

// Resolves immutable documents in this order: exact contract bundle document,
// published tenant override, then historical legacy text. The fallback exists
// only so already-issued links remain readable; all new public offers use exact
// legal_bundle_version_documents ids.
export async function loadPublishedLegalVersion(
  slug: string,
  urlSegment: string,
  versionId: string,
): Promise<{
  company: PublicLegalCompany;
  version: PublicLegalVersion;
} | null> {
  const requestedType = urlSegmentToLegalType(urlSegment);
  if (!requestedType) return null;
  const company = await loadCompanyBySlug(slug);
  if (!company) return null;

  const version =
    (await loadExactBundleDocument({
      companyId: company.id,
      requestedType,
      versionId,
    })) ??
    (await loadPublishedTenantOverride({
      companyId: company.id,
      requestedType,
      versionId,
    })) ??
    (await loadLegacyPublishedVersion({
      companyId: company.id,
      requestedType,
      versionId,
    }));

  return version ? { company, version } : null;
}
