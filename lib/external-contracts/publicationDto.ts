export const API_CONTRACT_RESPONSE_SCHEMA_VERSION = "2026-07-30.2" as const;

export type ExternalContractChannel = "website" | "api";

const INTERNAL_KEYS = new Set([
  "company_id",
  "companyId",
  "tenant_id",
  "tenantId",
  "source_contract_offer_id",
  "contract_product_id",
  "contract_product_version_id",
  "contract_publication_id",
  "contract_publication_version_id",
  "price_plan_id",
  "price_plan_version_id",
  "price_book_id",
  "legal_bundle_id",
  "legal_bundle_version_id",
  "commercial_snapshot",
  "publication_snapshot",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sanitize(value: unknown, removeIdentifierKeys = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, removeIdentifierKeys));
  }
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const identifierKey =
      key === "id" ||
      key.endsWith("_id") ||
      /Id$/.test(key);
    if (
      !INTERNAL_KEYS.has(key) &&
      !(removeIdentifierKeys && identifierKey)
    ) {
      result[key] = sanitize(item, removeIdentifierKeys);
    }
  }
  return result;
}

function pricingFrom(
  publication: Record<string, unknown>,
  commercial: Record<string, unknown>,
  removeIdentifierKeys: boolean,
): Record<string, unknown> {
  const explicit = record(publication.pricing);
  const snapshotPricing = record(commercial.pricing);
  const allowed: Record<string, unknown> = {
    ...snapshotPricing,
    ...explicit,
  };
  for (const key of [
    "monthly_fee_sek",
    "invoice_fee_sek",
    "spot_markup_ore_per_kwh",
    "variable_fee_ore_per_kwh",
    "fixed_price_ore_per_kwh",
    "green_fee_mode",
    "green_fee_value",
    "start_fee_sek",
    "administration_fee_sek",
    "break_fee_sek",
    "discount_value",
    "discount_unit",
    "discount_months",
    "vat_rate",
    "price_areas",
    "base_components",
    "portfolio_method",
    "production",
    "interval_resolution",
    "price_options",
    "commercial_components",
    "invoice_delivery_methods",
    "snapshot_schema",
  ]) {
    if (commercial[key] !== undefined) allowed[key] = commercial[key];
  }
  const commercialComponents = Array.isArray(commercial.commercial_components)
    ? commercial.commercial_components
    : null;
  if (commercialComponents) {
    allowed.component_catalog = commercialComponents;
    allowed.calculation_components = commercialComponents.filter((value) => {
      const component = record(value);
      return component.informational_only !== true;
    });
    allowed.display_components = commercialComponents.filter((value) => {
      const component = record(value);
      return component.website_published === true;
    });
  }
  return sanitize(allowed, removeIdentifierKeys) as Record<string, unknown>;
}

/**
 * The one external publication boundary for website and API contract feeds.
 * API responses use a strict allowlist. Website responses retain documented
 * compatibility fields, but the same recursive internal-key denylist applies.
 */
export function mapContractPublicationToPublicDto(input: {
  publication: Record<string, unknown>;
  channel: ExternalContractChannel;
}): Record<string, unknown> {
  const publication = input.publication;
  const commercial = record(publication.commercial_snapshot);
  const offerReference = text(
    publication.offer_reference,
    commercial.offer_reference,
    input.channel === "website" ? publication.id : null,
  );
  if (!offerReference) {
    throw new Error("contract_external_dto_offer_reference_missing");
  }

  const base = {
    offer_reference: offerReference,
    name: text(
      publication.name,
      publication.public_name,
      commercial.name,
      commercial.public_name,
    ) ?? "Elavtal",
    description: text(
      publication.description,
      publication.public_description,
      commercial.description,
      commercial.public_description,
    ),
    contract_type:
      text(publication.contract_type, commercial.contract_type) ?? "variable_monthly",
    energy_direction:
      text(publication.energy_direction, commercial.energy_direction) ??
      "consumption",
    customer_type:
      text(publication.customer_type, commercial.customer_type) ?? "both",
    pricing: pricingFrom(
      publication,
      commercial,
      input.channel === "api",
    ),
    valid_from: text(publication.valid_from, commercial.valid_from),
    valid_to: text(publication.valid_to, commercial.valid_to),
    channel: input.channel,
  };

  if (input.channel === "api") return base;
  return {
    ...(sanitize(publication) as Record<string, unknown>),
    ...base,
  };
}
