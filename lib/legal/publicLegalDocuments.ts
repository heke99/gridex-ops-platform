import { getBaseAppUrl } from "@/lib/auth/urls";
import {
  CANONICAL_LEGAL_MODULES,
  canonicalLegalModuleLabel,
  isCanonicalLegalModule,
} from "@/lib/legal/canonicalModules";
import {
  buildCustomerLegalDocuments,
  isCustomerLegalDocumentKind,
  renderCustomerLegalDocumentBody,
  type CustomerLegalDocumentKind,
  type CustomerLegalModuleVersion,
} from "@/lib/legal/customerDocumentPackage";
import { supabaseService } from "@/lib/supabase/service";

const LEGACY_TYPE_TO_SEGMENT = {
  agreement: "agreement",
  terms: "terms",
  privacy_policy: "privacy",
  withdrawal: "withdrawal",
  price_terms: "price-terms",
  power_of_attorney: "power-of-attorney",
} as const;

type LegacyLegalDocumentType = keyof typeof LEGACY_TYPE_TO_SEGMENT;
export type LegalDocumentType =
  | LegacyLegalDocumentType
  | CustomerLegalDocumentKind
  | (typeof CANONICAL_LEGAL_MODULES)[number];

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
  if (isCustomerLegalDocumentKind(type)) return canonicalSegment(type);
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
  if (requestedType === "agreement") {
    return ![
      "power_of_attorney",
      "withdrawal_right",
      "withdrawal_form",
    ].includes(moduleKey);
  }
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

type CustomerBundleDocumentRow = ExactBundleDocumentRow & {
  sort_order: number | null;
};

async function loadCustomerBundleDocument(input: {
  companyId: string;
  requestedType: LegalDocumentType;
  versionId: string;
}): Promise<PublicLegalVersion | null> {
  if (!isCustomerLegalDocumentKind(input.requestedType)) return null;

  const bundleResult = await supabaseService
    .from("legal_bundle_versions")
    .select(
      "id,company_id,status,published_at,locked_at,tenant_legal_profile_snapshot,tenant_legal_profile_sha256",
    )
    .eq("id", input.versionId)
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

  const documentResult = await supabaseService
    .from("legal_bundle_version_documents")
    .select(
      "id,legal_bundle_version_id,module_key,title,rendered_body,content_sha256,template_version,origin,tenant_customized,created_at,unresolved_variables,sort_order",
    )
    .eq("legal_bundle_version_id", input.versionId)
    .order("sort_order", { ascending: true })
    .order("module_key", { ascending: true });
  if (documentResult.error) return null;

  const rows = (documentResult.data ?? []) as CustomerBundleDocumentRow[];
  if (rows.some((row) => (row.unresolved_variables ?? []).length > 0)) {
    return null;
  }
  const modules = rows.map((row) => ({
    id: row.id,
    module_key: row.module_key,
    version: row.template_version ?? row.created_at,
    title: row.title,
    published_at:
      typeof bundle.published_at === "string"
        ? bundle.published_at
        : row.created_at,
    content_sha256: row.content_sha256,
    legal_bundle_version_id: row.legal_bundle_version_id,
    origin: row.origin,
  })) satisfies CustomerLegalModuleVersion[];
  const customerDocument = buildCustomerLegalDocuments({
    companyId: input.companyId,
    legalBundleVersionId: input.versionId,
    modules,
  }).find((document) => document.document_type === input.requestedType);
  if (!customerDocument) return null;

  const includedIds = new Set(customerDocument.source_document_ids);
  const includedRows = rows.filter((row) => includedIds.has(row.id));
  if (includedRows.length !== customerDocument.source_document_ids.length) {
    return null;
  }
  const publishedAt =
    (bundle.published_at as string | null) ?? includedRows[0]?.created_at ?? null;

  return {
    id: input.versionId,
    company_id: input.companyId,
    type: customerDocument.document_type,
    version: customerDocument.document_version,
    title: customerDocument.title,
    body: renderCustomerLegalDocumentBody({
      kind: customerDocument.document_type,
      modules: includedRows.map((row) => ({
        title: row.title,
        body: row.rendered_body,
      })),
    }),
    status,
    published_at: publishedAt,
    effective_from: publishedAt,
    metadata: {
      origin: "canonical_customer_document_package",
      content_sha256: customerDocument.document_hash,
      legal_bundle_version_id: input.versionId,
      module_keys: customerDocument.module_keys,
      source_document_ids: customerDocument.source_document_ids,
      acceptance_mode: customerDocument.acceptance_mode,
      tenant_legal_profile_snapshot:
        bundle.tenant_legal_profile_snapshot ?? null,
      tenant_legal_profile_sha256: bundle.tenant_legal_profile_sha256 ?? null,
      immutable: true,
    },
  };
}

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
      "id,company_id,status,published_at,locked_at,tenant_legal_profile_snapshot,tenant_legal_profile_sha256",
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
      tenant_legal_profile_snapshot:
        bundle.tenant_legal_profile_snapshot ?? null,
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

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function companyFromTenantLegalSnapshot(
  current: PublicLegalCompany,
  metadata: Record<string, unknown> | null,
): PublicLegalCompany {
  const profile = recordValue(metadata?.tenant_legal_profile_snapshot);
  if (Object.keys(profile).length === 0) return current;
  const postal = recordValue(profile.postal_address);
  const sourceCompany = recordValue(profile.source_company_snapshot);
  const legalName = textValue(profile.legal_name) ?? textValue(sourceCompany.name);
  const serviceEmail =
    textValue(profile.customer_service_email) ??
    textValue(sourceCompany.support_email);
  const addressText =
    textValue(postal.address_line_1) ??
    textValue(postal.street) ??
    textValue(postal.address) ??
    textValue(postal.text);

  return {
    ...current,
    // Once a published tenant profile snapshot exists, legal identity fields
    // must come only from that immutable snapshot. Falling back field-by-field
    // to the current tenant record could make an old agreement appear to have
    // been issued by a later company profile.
    name: legalName,
    org_number: textValue(profile.organization_number),
    support_email: serviceEmail,
    primary_contact_email: serviceEmail,
    phone: textValue(profile.phone),
    website: textValue(profile.website),
    address_line_1: addressText,
    address_line_2: textValue(postal.address_line_2),
    postal_code: textValue(postal.postal_code),
    city: textValue(postal.city),
    country: textValue(postal.country),
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
    (await loadCustomerBundleDocument({
      companyId: company.id,
      requestedType,
      versionId,
    })) ??
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

  return version
    ? {
        company: companyFromTenantLegalSnapshot(company, version.metadata),
        version,
      }
    : null;
}
