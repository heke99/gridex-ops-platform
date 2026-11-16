import { supabaseService } from "@/lib/supabase/service";

export type ContractFlowTraceStep = {
  key: string;
  label: string;
  rows: Array<Record<string, unknown>>;
  error: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StepDefinition = {
  key: string;
  label: string;
  table: string;
  textFields: string[];
  tenantScoped?: boolean;
};

const STEPS: StepDefinition[] = [
  {
    key: "internal_offer",
    label: "Intern avtalsprodukt",
    table: "contract_offers",
    textFields: ["name", "product_code"],
  },
  {
    key: "product",
    label: "Canonical produkt",
    table: "contract_products",
    textFields: ["product_code", "name"],
    tenantScoped: false,
  },
  {
    key: "version",
    label: "Produktversion",
    table: "contract_product_versions",
    textFields: ["content_sha256"],
    tenantScoped: false,
  },
  {
    key: "assignment",
    label: "Tenanttilldelning",
    table: "tenant_contract_assignments",
    textFields: [],
  },
  {
    key: "publication",
    label: "Website-publicering",
    table: "public_contract_offers",
    textFields: ["offer_reference", "public_name", "product_code"],
  },
  {
    key: "quote",
    label: "Offert",
    table: "website_contract_quotes",
    textFields: ["quote_reference", "offer_reference"],
  },
  {
    key: "application",
    label: "Kundansökan",
    table: "website_customer_applications",
    textFields: [
      "application_number",
      "contract_number",
      "customer_number",
      "quote_reference",
      "external_customer_id",
    ],
  },
  {
    key: "customer",
    label: "Kund",
    table: "customers",
    textFields: ["customer_number", "email"],
  },
  {
    key: "contract",
    label: "Kundavtal",
    table: "customer_contracts",
    textFields: ["contract_number"],
  },
  {
    key: "site",
    label: "Anläggning",
    table: "customer_sites",
    textFields: ["facility_id", "normalized_facility_id"],
  },
  {
    key: "meter",
    label: "Mätpunkt",
    table: "metering_points",
    textFields: [
      "meter_point_id",
      "metering_point_id",
      "normalized_metering_point_id",
    ],
  },
  {
    key: "supply",
    label: "Leveransperiod",
    table: "customer_supply_periods",
    textFields: [],
  },
  {
    key: "underlay",
    label: "Faktureringsunderlag",
    table: "billing_underlays",
    textFields: [],
  },
  {
    key: "export",
    label: "Canonical exportitem",
    table: "invoice_export_items",
    textFields: [
      "provider_invoice_guid",
      "provider_invoice_number",
      "idempotency_key",
    ],
  },
  {
    key: "invoice",
    label: "Kundfaktura",
    table: "customer_invoices",
    textFields: [
      "invoice_number",
      "partner_invoice_reference",
    ],
  },
];

function rowId(row: Record<string, unknown>): string | null {
  return typeof row.id === "string" ? row.id : null;
}

function stringIds(
  rows: Array<Record<string, unknown>>,
  fields: string[],
): string[] {
  return Array.from(
    new Set(
      rows.flatMap((row) =>
        fields.flatMap((field) =>
          typeof row[field] === "string" && row[field]
            ? [String(row[field])]
            : [],
        ),
      ),
    ),
  );
}

async function loadExactMatches(
  definition: StepDefinition,
  companyId: string,
  search: string,
): Promise<ContractFlowTraceStep> {
  const baseQuery = () => {
    const query = supabaseService.from(definition.table).select("*");
    return definition.tenantScoped === false
      ? query
      : query.eq("company_id", companyId);
  };
  const byId = UUID_PATTERN.test(search)
    ? await baseQuery()
        .eq("id", search)
        .limit(25)
    : { data: [], error: null };
  if (byId.error) {
    return {
      key: definition.key,
      label: definition.label,
      rows: [],
      error: byId.error.message,
    };
  }
  const rows = [...((byId.data ?? []) as Array<Record<string, unknown>>)];
  for (const field of definition.textFields) {
    const result = await baseQuery()
      .eq(field, search)
      .limit(25);
    if (result.error) {
      return {
        key: definition.key,
        label: definition.label,
        rows,
        error: result.error.message,
      };
    }
    rows.push(...((result.data ?? []) as Array<Record<string, unknown>>));
  }
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = rowId(row);
    if (id) unique.set(id, row);
  }
  return {
    key: definition.key,
    label: definition.label,
    rows: Array.from(unique.values()),
    error: null,
  };
}

async function addLinkedRows(
  step: ContractFlowTraceStep,
  definition: StepDefinition,
  companyId: string,
  field: string,
  ids: string[],
) {
  if (ids.length === 0 || step.error) return;
  const result = supabaseService
    .from(definition.table)
    .select("*");
  const tenantQuery =
    definition.tenantScoped === false
      ? result
      : result.eq("company_id", companyId);
  const linkedResult = await tenantQuery.in(field, ids).limit(100);
  if (linkedResult.error) {
    step.error = linkedResult.error.message;
    return;
  }
  const rows = new Map(
    step.rows.flatMap((row) => {
      const id = rowId(row);
      return id ? [[id, row] as const] : [];
    }),
  );
  for (const row of (linkedResult.data ?? []) as Array<Record<string, unknown>>) {
    const id = rowId(row);
    if (id) rows.set(id, row);
  }
  step.rows = Array.from(rows.values());
}

export async function traceContractFlow(input: {
  companyId: string;
  search: string;
}): Promise<ContractFlowTraceStep[]> {
  const search = input.search.trim();
  if (!search || search.length > 200) {
    throw new Error("Spårningsvärdet måste innehålla 1–200 tecken.");
  }
  const steps = await Promise.all(
    STEPS.map((definition) =>
      loadExactMatches(definition, input.companyId, search),
    ),
  );
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const definition = (key: string) =>
    STEPS.find((step) => step.key === key) as StepDefinition;

  const applicationIds = stringIds(byKey.get("application")?.rows ?? [], ["id"]);
  await addLinkedRows(
    byKey.get("quote") as ContractFlowTraceStep,
    definition("quote"),
    input.companyId,
    "consumed_application_id",
    applicationIds,
  );

  const initiallyMatchedProductIds = stringIds(
    byKey.get("product")?.rows ?? [],
    ["id"],
  );
  await addLinkedRows(
    byKey.get("version") as ContractFlowTraceStep,
    definition("version"),
    input.companyId,
    "contract_product_id",
    initiallyMatchedProductIds,
  );

  const versionIds = Array.from(new Set([
    ...stringIds(byKey.get("version")?.rows ?? [], ["id"]),
    ...stringIds(
      [
        ...(byKey.get("internal_offer")?.rows ?? []),
        ...(byKey.get("publication")?.rows ?? []),
        ...(byKey.get("quote")?.rows ?? []),
      ],
      ["contract_product_version_id"],
    ),
  ]));
  await addLinkedRows(
    byKey.get("version") as ContractFlowTraceStep,
    definition("version"),
    input.companyId,
    "id",
    versionIds,
  );
  await addLinkedRows(
    byKey.get("assignment") as ContractFlowTraceStep,
    definition("assignment"),
    input.companyId,
    "contract_product_version_id",
    versionIds,
  );
  await addLinkedRows(
    byKey.get("publication") as ContractFlowTraceStep,
    definition("publication"),
    input.companyId,
    "contract_product_version_id",
    versionIds,
  );

  const productIds = Array.from(new Set([
    ...stringIds(byKey.get("product")?.rows ?? [], ["id"]),
    ...stringIds(
      [
        ...(byKey.get("internal_offer")?.rows ?? []),
        ...(byKey.get("version")?.rows ?? []),
        ...(byKey.get("publication")?.rows ?? []),
      ],
      ["contract_product_id"],
    ),
  ]));
  await addLinkedRows(
    byKey.get("product") as ContractFlowTraceStep,
    definition("product"),
    input.companyId,
    "id",
    productIds,
  );

  await addLinkedRows(
    byKey.get("internal_offer") as ContractFlowTraceStep,
    definition("internal_offer"),
    input.companyId,
    "contract_product_version_id",
    versionIds,
  );

  const tenantHasCanonicalGraph =
    (byKey.get("internal_offer")?.rows.length ?? 0) > 0 ||
    (byKey.get("assignment")?.rows.length ?? 0) > 0 ||
    (byKey.get("publication")?.rows.length ?? 0) > 0 ||
    (byKey.get("quote")?.rows.length ?? 0) > 0;
  if (!tenantHasCanonicalGraph) {
    (byKey.get("product") as ContractFlowTraceStep).rows = [];
    (byKey.get("version") as ContractFlowTraceStep).rows = [];
  }

  const customerIds = stringIds(
    steps.flatMap((step) => step.rows),
    ["customer_id"],
  );
  const contractIds = stringIds(
    steps.flatMap((step) => step.rows),
    ["contract_id", "customer_contract_id"],
  );
  const siteIds = stringIds(steps.flatMap((step) => step.rows), [
    "site_id",
    "customer_site_id",
  ]);
  const meterIds = stringIds(steps.flatMap((step) => step.rows), [
    "metering_point_id",
  ]);
  const underlayIds = stringIds(steps.flatMap((step) => step.rows), [
    "billing_underlay_id",
  ]);
  const exportIds = stringIds(steps.flatMap((step) => step.rows), [
    "invoice_export_item_id",
    "canonical_export_item_id",
    "partner_export_id",
  ]);

  await Promise.all([
    addLinkedRows(byKey.get("customer") as ContractFlowTraceStep, definition("customer"), input.companyId, "id", customerIds),
    addLinkedRows(byKey.get("contract") as ContractFlowTraceStep, definition("contract"), input.companyId, "id", contractIds),
    addLinkedRows(byKey.get("site") as ContractFlowTraceStep, definition("site"), input.companyId, "id", siteIds),
    addLinkedRows(byKey.get("meter") as ContractFlowTraceStep, definition("meter"), input.companyId, "id", meterIds),
    addLinkedRows(byKey.get("underlay") as ContractFlowTraceStep, definition("underlay"), input.companyId, "id", underlayIds),
    addLinkedRows(byKey.get("export") as ContractFlowTraceStep, definition("export"), input.companyId, "id", exportIds),
  ]);

  const allCustomerIds = stringIds(steps.flatMap((step) => step.rows), [
    "customer_id",
  ]);
  const allContractIds = stringIds(steps.flatMap((step) => step.rows), [
    "contract_id",
    "customer_contract_id",
  ]);
  await Promise.all([
    addLinkedRows(byKey.get("application") as ContractFlowTraceStep, definition("application"), input.companyId, "customer_id", allCustomerIds),
    addLinkedRows(byKey.get("contract") as ContractFlowTraceStep, definition("contract"), input.companyId, "customer_id", allCustomerIds),
    addLinkedRows(byKey.get("site") as ContractFlowTraceStep, definition("site"), input.companyId, "customer_id", allCustomerIds),
    addLinkedRows(byKey.get("meter") as ContractFlowTraceStep, definition("meter"), input.companyId, "customer_id", allCustomerIds),
    addLinkedRows(byKey.get("supply") as ContractFlowTraceStep, definition("supply"), input.companyId, "customer_id", allCustomerIds),
    addLinkedRows(byKey.get("underlay") as ContractFlowTraceStep, definition("underlay"), input.companyId, "customer_id", allCustomerIds),
    addLinkedRows(byKey.get("invoice") as ContractFlowTraceStep, definition("invoice"), input.companyId, "customer_id", allCustomerIds),
    addLinkedRows(byKey.get("supply") as ContractFlowTraceStep, definition("supply"), input.companyId, "contract_id", allContractIds),
    addLinkedRows(byKey.get("underlay") as ContractFlowTraceStep, definition("underlay"), input.companyId, "customer_contract_id", allContractIds),
    addLinkedRows(byKey.get("export") as ContractFlowTraceStep, definition("export"), input.companyId, "customer_contract_id", allContractIds),
    addLinkedRows(byKey.get("invoice") as ContractFlowTraceStep, definition("invoice"), input.companyId, "customer_contract_id", allContractIds),
  ]);

  const allUnderlayIds = stringIds(byKey.get("underlay")?.rows ?? [], ["id"]);
  await addLinkedRows(
    byKey.get("export") as ContractFlowTraceStep,
    definition("export"),
    input.companyId,
    "billing_underlay_id",
    allUnderlayIds,
  );
  const allExportIds = stringIds(byKey.get("export")?.rows ?? [], ["id"]);
  await addLinkedRows(
    byKey.get("invoice") as ContractFlowTraceStep,
    definition("invoice"),
    input.companyId,
    "invoice_export_item_id",
    allExportIds,
  );

  return steps;
}
