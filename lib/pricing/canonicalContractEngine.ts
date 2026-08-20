export const CANONICAL_CONTRACT_PRICING_SCHEMA =
  "gridex_contract_pricing_v6_selection" as const;

const DEFAULT_INVOICE_DELIVERY_METHODS = [
  "email",
  "e_invoice",
  "paper",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalPricingNode(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    snapshot_schema: CANONICAL_CONTRACT_PRICING_SCHEMA,
    schema_version: CANONICAL_CONTRACT_PRICING_SCHEMA,
  };
}

/**
 * Converts any published contract snapshot into the single runtime shape used
 * by quote selection. Historical snapshots stay immutable in storage; their
 * version is an implementation detail and never leaks into contract creation.
 */
export function normalizePublishedCommercialSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const source = snapshot ?? {};
  return {
    ...source,
    snapshot_schema: CANONICAL_CONTRACT_PRICING_SCHEMA,
    schema_version: CANONICAL_CONTRACT_PRICING_SCHEMA,
    // Legacy price_components are frozen billing rows, not selectable
    // commercial components. Only explicit commercial_components participate
    // in customer/admin selection.
    commercial_components: Array.isArray(source.commercial_components)
      ? source.commercial_components
      : [],
    invoice_delivery_methods:
      Array.isArray(source.invoice_delivery_methods) &&
      source.invoice_delivery_methods.length > 0
        ? source.invoice_delivery_methods
        : [...DEFAULT_INVOICE_DELIVERY_METHODS],
  };
}

/**
 * The website quote persistence boundary is the final canonicalization point.
 * Every contract family (fixed, monthly, hourly, quarterly, portfolio, mixed)
 * is persisted with one schema identity after the pricing engine has resolved
 * an exact option and component set.
 */
export function normalizeWebsiteQuotePersistenceInput<T extends {
  pricingSnapshotSchemaVersion: string;
  quoteSnapshot: Record<string, unknown>;
}>(input: T): T {
  const quoteSnapshot = input.quoteSnapshot;
  return {
    ...input,
    pricingSnapshotSchemaVersion: CANONICAL_CONTRACT_PRICING_SCHEMA,
    quoteSnapshot: {
      ...quoteSnapshot,
      pricing_snapshot_schema_version: CANONICAL_CONTRACT_PRICING_SCHEMA,
      snapshot_schema: CANONICAL_CONTRACT_PRICING_SCHEMA,
      pricing: canonicalPricingNode(quoteSnapshot.pricing),
      pricing_snapshot: canonicalPricingNode(quoteSnapshot.pricing_snapshot),
    },
  } as T;
}
